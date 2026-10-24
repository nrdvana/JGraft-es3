// TestJGraft.runConformanceTests(t, filenameOrSuite[, apply]) runs one suite as a TAP subtest.
// Filenames are relative to the test file. Inline suites may contain Dates.
// apply(input, graft, limits, logs) returns output or throws an error with .code;
// append portable {level,message,data?} records to logs, including before errors.
// String error codes are also accepted. Supplying apply lets this helper be
// tested independently and keeps the eventual library API in one adapter.
(function(global) {
"use strict";

// Keep host-provided methods, such as the Node/Phantom filesystem bridge.
var TestJGraft= global.TestJGraft || (global.TestJGraft= {});

// Private project helpers, shared by the browser and engine entrypoints.
// Loading this file only installs helpers; an entrypoint starts the runner.
if (typeof module !== "undefined" && module.exports)
   module.exports= TestJGraft;

// Keep argument parsing, TAP diagnostics and completion polling identical in
// both engines. readState bridges the Phantom page or reads Node's TAP root.
TestJGraft.createRunner= function(args, finish, readState) {
   var scripts= [], timeout= 10000, subtests, startTime= new Date().getTime(), i, match;
   function diagnostic(message) {
      console.log(String(message).replace(/^/gm, "# "));
   }
   function fail(message) {
      diagnostic(message);
      finish(1);
   }
   function pollFinished() {
      var state= readState();
      if (state && state.finished)
         finish(state.success? 0 : 1);
      else if (new Date().getTime() - startTime >= timeout) {
         diagnostic("Timeout (" + timeout + "ms) waiting for TAP.root.done_testing()");
         finish(2);
      } else
         setTimeout(pollFinished, 10);
   }
   for (i= 0; i < args.length; i++) {
      match= /^--timeout=([1-9][0-9]*)$/.exec(args[i]);
      if (match)
         timeout= Number(match[1]);
      else if (args[i].indexOf("--subtests=") === 0)
         subtests= args[i].slice(11);
      else
         scripts.push(args[i]);
   }
   if (!scripts.length)
      fail("Usage: engine run-ENGINE.js [--timeout=MS] [--subtests=PATTERN] tap.js [library.js ...] test.t");
   return {scripts: scripts, subtests: subtests, testFile: scripts[scripts.length - 1],
      diagnostic: diagnostic, fail: fail, pollFinished: pollFinished};
};

// HTTP tests use the document base URL supplied by the manual test server.
// Synchronous reads match the local harness and keep conformance tests simple.
if (typeof TestJGraft.readFile !== "function" && typeof global.XMLHttpRequest !== "undefined") {
   TestJGraft.readFile= function(filename) {
      var xhr= new global.XMLHttpRequest();
      xhr.open("GET", filename, false);
      xhr.send(null);
      if (xhr.status !== 200)
         throw new Error("Cannot read test data: " + filename + " (HTTP " + xhr.status + ")");
      return xhr.responseText;
   };
}

var objectTag= Object.prototype.toString;
var hasOwn= Object.prototype.hasOwnProperty;

function owns(value, key) {
   return hasOwn.call(value, key);
}

function tag(value) {
   return objectTag.call(value);
}

// Reuse TAP's descriptor-aware comparison, including arbitrary own keys.
function equal(a, b) {
   return global.TAP.deep_compare(a, b);
}

// Snapshot/path reads must also bypass old V8's own __proto__ bracket bug.
function get(value, key) {
   var d;
   if (key === "__proto__" && Object.getOwnPropertyDescriptor) {
      d= Object.getOwnPropertyDescriptor(value, key);
      return d && d.value;
   }
   return value[key];
}

// Keep original identities as well as values. A JSON clone would lose Dates,
// and value equality alone would miss a replaced-but-equal input subtree.
// Include prototype contents: old V8's JSON.parse makes "__proto__" a prototype
// rather than an own property, so checking its identity alone misses mutations.
function snapshot(value) {
   var result= {value: value}, i;
   if (value !== null && typeof value === "object") {
      result.keys= Object.keys(value).sort();
      result.children= [];
      result.tag= tag(value);
      result.length= value.length;
      if (result.tag === "[object Date]")
         result.time= Date.prototype.getTime.call(value);
      if (Object.getPrototypeOf)
         result.prototype= snapshot(Object.getPrototypeOf(value));
      for (i= 0; i < result.keys.length; i++)
         result.children.push(snapshot(get(value, result.keys[i])));
   }
   return result;
}

function unchanged(value, before) {
   var keys, i;
   if (!before.keys)
      return equal(value, before.value);
   if (value !== before.value || tag(value) !== before.tag || value.length !== before.length)
      return false;
   if (before.tag === "[object Date]" && !equal(Date.prototype.getTime.call(value), before.time))
      return false;
   if (Object.getPrototypeOf && !unchanged(Object.getPrototypeOf(value), before.prototype))
      return false;
   keys= Object.keys(value).sort();
   if (!equal(keys, before.keys))
      return false;
   for (i= 0; i < keys.length; i++)
      if (!unchanged(get(value, keys[i]), before.children[i]))
         return false;
   return true;
}

// Diagnostics must remain TAP comments even for multiline exception stacks.
function note(t, value) {
   var lines= String(value).split(/\r?\n/), i;
   for (i= 0; i < lines.length; i++)
      t.note(lines[i]);
}

// Optional context is a fixture-like object with input, jgraft, output/errors.
// Paths may describe missing nodes or expanded expressions: report the nearest
// physical ancestor rather than pretending the original tree contains them.
TestJGraft.noteError= function(t, error, context) {
   var fields= ["graftPath", "inputPath", "resource", "counts", "limits"], i, key;
   function show(label, value) {
      note(t, label + ": " + global.TAP.format(value));
   }
   function location(label, value, path) {
      var i, d, prefix= [];
      if (tag(path) !== "[object Array]") return;
      for (i= 0; i < path.length; i++) {
         if (value === null || typeof value !== "object" || !owns(value, path[i])) {
            show(label + " missing; nearest path", prefix);
            show(label + " nearest subtree", value);
            return;
         }
         d= Object.getOwnPropertyDescriptor? Object.getOwnPropertyDescriptor(value, path[i]) : null;
         prefix.push(path[i]);
         if (d && !owns(d, "value")) {
            show(label + " accessor at path", prefix);
            show(label + " containing subtree", value);
            return;
         }
         value= d? d.value : get(value, path[i]);
      }
      show(label, value);
   }
   if (error === null || typeof error !== "object") {
      show("Thrown", error);
      return;
   }
   note(t, (error.name || "Error") + (error.code? " " + error.code : "")
      + (error.message? ": " + global.TAP.format(error.message) : ""));
   for (i= 0; i < fields.length; i++) {
      key= fields[i];
      if (owns(error, key)) show(key, get(error, key));
   }
   if (context) {
      if (owns(context, "output")) show("Expected output", context.output);
      if (context.errors) show("Allowed errors", context.errors);
      if (owns(context, "jgraft")) location("Graft at recorded path", context.jgraft, error.graftPath);
      if (owns(context, "input")) location("Original input at recorded path", context.input, error.inputPath);
   }
   if (owns(error, "partial")) {
      show("Partial output", error.partial);
      location("Partial output at recorded path", error.partial, error.inputPath);
   }
   if (error.stack) note(t, error.stack);
};

function runCase(t, test, apply, forbidProto) {
   t.subtest(test.name, function(t) {
      t._jgraftDescription= test.desc;
      var before, output, error, logs= [], caught= false, code, allowed= test.errors || {};
      var mustLimit= owns(allowed, "RESOURCE_LIMIT") && allowed.RESOURCE_LIMIT === true;
      if (!owns(test, "input") || !owns(test, "jgraft") || (!owns(test, "output") && !owns(test, "errors"))) {
         t.fail("Case requires input, jgraft, and output or errors");
         return;
      }
      if (owns(test, "logs") && tag(test.logs) !== "[object Array]") {
         t.fail("Expected logs must be an array");
         return;
      }
      // The explicit requirement survives a parser which has lost the key.
      // Custom executors run every case; this restriction belongs to our adapter.
      if (forbidProto && owns(test, "needProto") && test.needProto === true) {
         t.plan(0, "Host configuration forbids __proto__ properties");
         return;
      }
      before= snapshot(test.input);
      try {
         output= apply(test.input, test.jgraft, test.limits, logs);
      } catch (exception) {
         caught= true;
         error= exception;
      }
      // Always check this, including failed grafts and unexpected exceptions.
      t.ok(unchanged(test.input, before), "input tree remains unchanged");
      if (caught) {
         code= typeof error === "string"? error : error && error.code;
         if (!t.ok(typeof code === "string" && owns(allowed, code) && allowed[code] === true
               && (!mustLimit || code === "RESOURCE_LIMIT"),
               "error is permitted: " + (code || "unclassified exception")))
            TestJGraft.noteError(t, error, test);
      } else if (mustLimit) {
         t.fail("Expected RESOURCE_LIMIT");
      } else if (!owns(test, "output")) {
         t.fail("Expected an error");
      } else if (!t.ok(equal(output, test.output), "output matches")) {
         t.noteDifferences(test.output, output);
      }
      // Static validation may reject the entire graft before any action runs.
      if (owns(test, "logs") && code !== "INVALID_GRAFT"
            && !t.ok(equal(logs, test.logs), "logs match"))
         t.noteDifferences(test.logs, logs);
   });
   // Filtered callbacks never execute, but their leaf still counts as a skip.
   t.results[t.results.length - 1]._jgraftCase= true;
}

// Provisional adapter: this is the only place tied to the implementation API.
function applyGraft(input, graft, limits, logs) {
   var instance= new global.JGraft(graft, {limits: limits}), entries, entry, i;
   try {
      return instance.apply(input);
   } finally {
      // Project observations onto the portable shape, omitting host metadata.
      entries= instance.logs || [];
      for (i= 0; i < entries.length; i++) {
         entry= {level: entries[i].level, message: entries[i].message};
         if (owns(entries[i], "data")) entry.data= entries[i].data;
         logs.push(entry);
      }
   }
}

// Count fixtures, rather than their assertions or enclosing engine/suite groups.
// Defer until root completion so TODO scopes on enclosing groups are available.
function installConformanceSummary() {
   var original= global.TAP.prototype.done_testing;
   if (original._jgraftSummary) return;
   function done(count) {
      original.call(this, count);
      if (!this.actual_success && !this._jgraftDescriptionPrinted
            && typeof this._jgraftDescription === "string") {
         this._jgraftDescriptionPrinted= true;
         note(this, this._jgraftDescription);
      }
      if (!this.subtest_level && !this._jgraftSummaryPrinted) {
         this._jgraftSummaryPrinted= true;
         conformanceSummary(this);
      }
   }
   done._jgraftSummary= true;
   global.TAP.prototype.done_testing= done;
}

function conformanceSummary(root) {
   var total= [0, 0, 0, 0, 0, 0, 0], suites= 0;
   function report(label, counts) {
      root.note(label + ': ' + counts[0] + ' cases; ' + counts[1] + ' passed, '
         + counts[2] + ' failed, ' + counts[3] + ' skipped, '
         + counts[4] + ' TODO failed, ' + counts[5] + ' TODO passed (unexpected), '
         + counts[6] + ' not run');
   }
   function collect(test, todo, counts) {
      var i, category, before= counts[0];
      todo= todo || test.todo_reason !== undefined || test._todo !== undefined;
      if (test._jgraftCase || test.skipped && !test.results.length) {
         category= test.skipped? 3
            : todo || (test.success && !test.actual_success)
            ? test.actual_success? 5 : 4 : test.success? 1 : 2;
         i= test._jgraftCase? 1 : test._jgraftCaseCount || 0;
         counts[0]+= i;
         counts[category]+= i;
      } else {
         for (i= 0; i < test.results.length; i++) collect(test.results[i], todo, counts);
         if (test._jgraftCaseCount !== undefined) {
            i= test._jgraftCaseCount - (counts[0] - before);
            counts[0]+= i;
            counts[6]+= i;
         }
      }
   }
   function visit(test, todo) {
      var counts, i, j;
      todo= todo || test.todo_reason !== undefined || test._todo !== undefined;
      if (test._jgraftSuite) {
         suites++;
         counts= [0, 0, 0, 0, 0, 0, 0];
         collect(test, todo, counts);
         for (j= 0; j < counts.length; j++) total[j]+= counts[j];
         report('Conformance ' + global.TAP.format(test.subtestPath.join(' / ')), counts);
      } else if (test.results) {
         for (i= 0; i < test.results.length; i++) visit(test.results[i], todo);
      }
   }
   visit(root, false);
   if (suites) report('Conformance total', total);
}

// Groups carry documentation and structure only; execution settings remain
// explicit on each leaf. Count leaves before execution, including skipped work.
function countCases(test, collection) {
   var i, count= 0, key;
   if (!test || typeof test.name !== "string" || !test.name
         || owns(test, "desc") && typeof test.desc !== "string")
      throw new Error("Expected a named case or group with an optional string desc");
   if (!owns(test, "tests")) return 1;
   if (tag(test.tests) !== "[object Array]" || !test.tests.length)
      throw new Error("Expected a nonempty tests array in group: " + test.name);
   for (key in test)
      if (owns(test, key) && key !== "name" && key !== "desc" && key !== "tests"
            && !(collection && key === "version"))
         throw new Error("Unexpected group property: " + key);
   for (i= 0; i < test.tests.length; i++) count+= countCases(test.tests[i], false);
   return count;
}

function runGroup(t, group, apply, forbidProto, count) {
   t.subtest(group.name, function(t) {
      var i;
      t._jgraftDescription= group.desc;
      t._jgraftCaseCount= count;
      for (i= 0; i < group.tests.length; i++)
         if (owns(group.tests[i], "tests"))
            runGroup(t, group.tests[i], apply, forbidProto, countCases(group.tests[i], false));
         else runCase(t, group.tests[i], apply, forbidProto);
   }, {container: true});
}

function runConformanceTests(t, source, apply) {
   var suite, i, forbidProto, count;
   installConformanceSummary();
   try {
      suite= typeof source === "string"? JSON.parse(TestJGraft.readFile(source)) : source;
      if (!suite || suite.version !== 1 || typeof suite.name !== "string"
            || tag(suite.tests) !== "[object Array]" || !suite.tests.length)
         throw new Error("Expected a version 1 conformance suite with a name and nonempty tests array");
      count= countCases(suite, true);
   } catch (error) {
      t.subtest(typeof source === "string"? source : "Invalid suite", function(t) {
         t.fail("Cannot load conformance suite");
         note(t, error.stack || error);
      });
      return;
   }
   t.subtest(suite.name, function(t) {
      t._jgraftSuite= true;
      t._jgraftDescription= suite.desc;
      t._jgraftCaseCount= count;
      if (!apply && (typeof global.JGraft !== "function" || typeof global.JGraft.prototype.apply !== "function")) {
         t.plan(0, "JGraft.prototype.apply is not implemented");
         return;
      }
      forbidProto= !apply && new global.JGraft(["JGRAFT", {v: 1}]).forbidProto;
      for (i= 0; i < suite.tests.length; i++)
         if (owns(suite.tests[i], "tests"))
            runGroup(t, suite.tests[i], apply || applyGraft, forbidProto, countCases(suite.tests[i], false));
         else runCase(t, suite.tests[i], apply || applyGraft, forbidProto);
   }, {container: true});
}

TestJGraft.runConformanceTests= runConformanceTests;

})(typeof window !== "undefined"? window
   : typeof global !== "undefined"? global
   : typeof self !== "undefined"? self
   : this);
