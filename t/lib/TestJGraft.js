// TestJGraft.runConformanceTests(t, filenameOrSuite[, apply]) runs one suite as a TAP subtest.
// Filenames are relative to the test file. Inline suites may contain Dates.
// apply(input, graft, limits) returns the output or throws an error with .code.
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
   var scripts= [], timeout= 10000, startTime= new Date().getTime(), i, match;
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
      else
         scripts.push(args[i]);
   }
   if (!scripts.length)
      fail("Usage: engine run-ENGINE.js [--timeout=MS] tap.js [library.js ...] test.t");
   return {scripts: scripts, testFile: scripts[scripts.length - 1],
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

// Compare JSON/Date values without serializing away Date types or special keys.
// Object key order is irrelevant; arrays retain their length and own properties.
function equal(a, b) {
   var keys, other, i;
   if (a === null || b === null || typeof a !== "object" || typeof b !== "object")
      return a === b || (a !== a && b !== b);
   if (tag(a) !== tag(b))
      return false;
   if (tag(a) === "[object Date]" && !equal(Date.prototype.getTime.call(a), Date.prototype.getTime.call(b)))
      return false;
   if (tag(a) === "[object Array]" && a.length !== b.length)
      return false;
   keys= Object.keys(a).sort();
   other= Object.keys(b).sort();
   if (keys.length !== other.length)
      return false;
   for (i= 0; i < keys.length; i++)
      if (keys[i] !== other[i] || !equal(a[keys[i]], b[keys[i]]))
         return false;
   return true;
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
         result.children.push(snapshot(value[result.keys[i]]));
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
      if (!unchanged(value[keys[i]], before.children[i]))
         return false;
   return true;
}

// Diagnostics must remain TAP comments even for multiline exception stacks.
function note(t, value) {
   var lines= String(value).split(/\r?\n/), i;
   for (i= 0; i < lines.length; i++)
      t.note(lines[i]);
}

function describe(value) {
   try {
      return tag(value) + " " + JSON.stringify(value);
   } catch (error) {
      return String(value);
   }
}

function runCase(t, test, apply, forbidProto) {
   t.subtest(test.name, function(t) {
      var before, output, error, caught= false, code, allowed= test.errors || {};
      var mustLimit= owns(allowed, "RESOURCE_LIMIT") && allowed.RESOURCE_LIMIT === true;
      if (!owns(test, "input") || !owns(test, "jgraft") || (!owns(test, "output") && !owns(test, "errors"))) {
         t.fail("Case requires input, jgraft, and output or errors");
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
         output= apply(test.input, test.jgraft, test.limits);
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
            note(t, error && error.stack || error);
      } else if (mustLimit) {
         t.fail("Expected RESOURCE_LIMIT");
      } else if (!owns(test, "output")) {
         t.fail("Expected an error");
      } else if (!t.ok(equal(output, test.output), "output matches")) {
         note(t, "Expected: " + describe(test.output));
         note(t, "Actual: " + describe(output));
      }
   });
}

// Provisional adapter: this is the only place tied to the implementation API.
function applyGraft(input, graft, limits) {
   return new global.JGraft(graft, {limits: limits}).apply(input);
}

function runConformanceTests(t, source, apply) {
   var suite, i, forbidProto;
   try {
      suite= typeof source === "string"? JSON.parse(TestJGraft.readFile(source)) : source;
      if (!suite || suite.version !== 1 || typeof suite.name !== "string"
            || tag(suite.tests) !== "[object Array]" || !suite.tests.length)
         throw new Error("Expected a version 1 conformance suite with a name and nonempty tests array");
   } catch (error) {
      t.subtest(typeof source === "string"? source : "Invalid suite", function(t) {
         t.fail("Cannot load conformance suite");
         note(t, error.stack || error);
      });
      return;
   }
   t.subtest(suite.name, function(t) {
      if (!apply && (typeof global.JGraft !== "function" || typeof global.JGraft.prototype.apply !== "function")) {
         t.plan(0, "JGraft.prototype.apply is not implemented");
         return;
      }
      forbidProto= !apply && new global.JGraft(["JGRAFT", {v: 1}]).forbidProto;
      for (i= 0; i < suite.tests.length; i++)
         runCase(t, suite.tests[i], apply || applyGraft, forbidProto);
   });
}

TestJGraft.runConformanceTests= runConformanceTests;

})(typeof window !== "undefined"? window
   : typeof global !== "undefined"? global
   : typeof self !== "undefined"? self
   : this);
