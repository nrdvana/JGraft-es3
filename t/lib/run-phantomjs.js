// PhantomJS entrypoint: the controller handles files and process lifetime;
// tests execute in a page, with their original filenames and line numbers.
(function() {
"use strict";

var fs= require("fs");
var page= require("webpage").create();
var TestJGraft= require("./TestJGraft.js");
var runner= TestJGraft.createRunner(require("system").args.slice(1), function(status) {
   phantom.exit(status);
}, function() {
   return page.evaluate(function() {
      return typeof TAP !== "undefined" && TAP.root? {
         finished: TAP.root.finished,
         success: TAP.root.success
      } : null;
   });
});
var currentScript, i, configured= false;

page.onConsoleMessage= function(message) {
   console.log(message);
};
page.onError= function(message, trace) {
   runner.diagnostic(message);
   for (var j= 0; j < trace.length; j++)
      runner.diagnostic("at " + trace[j].file + ":" + trace[j].line);
   // PhantomJS 1.9 omits syntax-error traces. Reparse without executing to
   // recover the parser's line number while retaining the original filename.
   if (!trace.length && currentScript) {
      var line= page.evaluate(function(source) {
         try {
            new Function(source);
         } catch (error) {
            return error.line || error.lineNumber;
         }
         return null;
      }, fs.read(currentScript));
      runner.diagnostic("at " + currentScript + (line? ":" + line : ""));
   }
   phantom.exit(1);
};
page.setContent("<!doctype html><html><body></body></html>", "about:blank");

// The page cannot require fs; its synchronous callback bridges fixture reads.
page.onCallback= function(filename) {
   var path= /^(?:[\\/]|[A-Za-z]:)/.test(filename)? filename
      : fs.absolute(runner.testFile).replace(/[^\\/]*$/, "") + filename;
   try {
      if (!fs.isFile(path))
         throw new Error("Cannot read test data: " + path);
      return {text: fs.read(path)};
   } catch (error) {
      return {error: String(error)};
   }
};
page.evaluate(function() {
   window.TestJGraft= {readFile: function(filename) {
      var result= window.callPhantom(filename);
      if (result.error)
         throw new Error(result.error);
      return result.text;
   }};
});

try {
   for (i= 0; i < runner.scripts.length; i++) {
      currentScript= fs.absolute(runner.scripts[i]);
      if (!page.injectJs(currentScript))
         runner.fail("Cannot load script: " + runner.scripts[i]);
      if (!configured && runner.subtests !== undefined) {
         configured= page.evaluate(function(pattern) {
            if (typeof TAP === "undefined") return false;
            TAP.root.filterSubtests(pattern);
            return true;
         }, runner.subtests);
      }
   }
} catch (error) {
   runner.fail(error.stack || error);
}
runner.pollFinished();
})();
