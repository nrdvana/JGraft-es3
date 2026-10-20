// Run original JavaScript test files with PhantomJS or Node, preserving source
// filenames and line numbers. The first script must supply TAP; the test must
// call TAP.root.done_testing() (usually through its t argument).
// Usage: phantomjs|node run-test.js [--timeout=MS] tap.js [library.js ...] test.t
(function() {
"use strict";

var browser= typeof phantom !== "undefined";
var fs= require("fs");
var args= browser? require("system").args.slice(1) : process.argv.slice(2);
var scripts= [];
var timeout= 10000;
var startTime= new Date().getTime();
var page;
var vm;
var i;
var match;
var currentScript;

function finish(status) {
   if (browser)
      phantom.exit(status);
   else
      process.exit(status);
}

// Every diagnostic line must be TAP commentary, including multiline stacks.
function diagnostic(message) {
   console.log(String(message).replace(/^/gm, "# "));
}

function fail(message) {
   diagnostic(message);
   finish(1);
}

for (i= 0; i < args.length; i++) {
   match= /^--timeout=([1-9][0-9]*)$/.exec(args[i]);
   if (match)
      timeout= Number(match[1]);
   else
      scripts.push(args[i]);
}
if (!scripts.length)
   fail("Usage: phantomjs|node run-test.js [--timeout=MS] tap.js [library.js ...] test.t");

if (browser) {
   page= require("webpage").create();
   page.onConsoleMessage= function(message) {
      console.log(message);
   };
   page.onError= function(message, trace) {
      diagnostic(message);
      for (var j= 0; j < trace.length; j++)
         diagnostic("at " + trace[j].file + ":" + trace[j].line);
      // PhantomJS 1.9 omits syntax-error traces. Reparse without executing to
      // recover the parser's line number while retaining the original URL.
      if (!trace.length && currentScript) {
         var line= page.evaluate(function(source) {
            try {
               new Function(source);
            } catch (error) {
               return error.line || error.lineNumber;
            }
            return null;
         }, fs.read(currentScript));
         diagnostic("at " + currentScript + (line? ":" + line : ""));
      }
      finish(1);
   };
   page.setContent("<!doctype html><html><body></body></html>", "about:blank");
} else {
   vm= require("vm");
   process.on("uncaughtException", function(error) {
      fail(error.stack || error);
   });
}

var testFile= scripts[scripts.length - 1];

// Fixture paths are relative to the test, independent of the working directory.
function readTestFile(filename) {
   var path;
   if (browser) {
      path= /^(?:[\\/]|[A-Za-z]:)/.test(filename)? filename
         : fs.absolute(testFile).replace(/[^\\/]*$/, "") + filename;
      if (!fs.isFile(path))
         throw new Error("Cannot read test data: " + path);
      return fs.read(path);
   }
   path= require("path").resolve(require("path").dirname(testFile), filename);
   return fs.readFileSync(path, "utf8");
}

// Phantom's page cannot require fs; its synchronous callback bridges file reads.
if (browser) {
   page.onCallback= function(filename) {
      try {
         return {text: readTestFile(filename)};
      } catch (error) {
         return {error: String(error)};
      }
   };
   page.evaluate(function() {
      window.TestJS= {readFile: function(filename) {
         var result= window.callPhantom(filename);
         if (result.error)
            throw new Error(result.error);
         return result.text;
      }};
   });
} else
   global.TestJS= {readFile: readTestFile};

// External script injection preserves the real filename in browser errors.
// Node's vm supplies the same filename without wrapping the source in a function.
try {
   for (i= 0; i < scripts.length; i++) {
      if (browser) {
         currentScript= fs.absolute(scripts[i]);
         if (!page.injectJs(currentScript))
            fail("Cannot load script: " + scripts[i]);
      } else {
         vm.runInThisContext(fs.readFileSync(scripts[i], "utf8"), {
            filename: scripts[i]
         });
      }
   }
} catch (error) {
   fail(error.stack || error);
}

function pollFinished() {
   var state= browser? page.evaluate(function() {
      return typeof TAP !== "undefined" && TAP.root? {
         finished: TAP.root.finished,
         success: TAP.root.success
      } : null;
   }) : typeof TAP !== "undefined" && TAP.root;
   if (state && state.finished)
      finish(state.success? 0 : 1);
   else if (new Date().getTime() - startTime >= timeout) {
      diagnostic("Timeout (" + timeout + "ms) waiting for TAP.root.done_testing()");
      finish(2);
   } else
      setTimeout(pollFinished, 10);
}

pollFinished();
})();
