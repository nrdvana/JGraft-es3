// Node entrypoint: execute original files without wrappers so source locations
// survive in diagnostics, including on Node 0.10.
(function() {
"use strict";

var fs= require("fs");
var path= require("path");
var vm= require("vm");
var TestJGraft= require("./TestJGraft.js");
var runner= TestJGraft.createRunner(process.argv.slice(2), function(status) {
   process.exit(status);
}, function() {
   return typeof TAP !== "undefined" && TAP.root;
});
var i, configured= false;

process.on("uncaughtException", function(error) {
   runner.fail(error.stack || error);
});

// Fixtures are relative to the test, independent of the working directory.
TestJGraft.readFile= function(filename) {
   return fs.readFileSync(path.resolve(path.dirname(runner.testFile), filename), "utf8");
};

// Compile separately so runtime SyntaxErrors never trigger this fallback.
function runScript(filename) {
   var script;
   try {
      // Keep a string filename: Node 0.10 cannot accept an options object.
      script= vm.createScript(fs.readFileSync(filename, "utf8"), filename);
   } catch (error) {
      var message= String(error.stack || error);
      if (error.name !== "SyntaxError" || message.indexOf(filename) !== -1)
         throw error;
      // Old Node exposes parser locations only through native stderr. Compile
      // without executing in a child and report its output as TAP comments.
      require("child_process").execFile(process.execPath, ["-e",
         'require("vm").createScript(require("fs").readFileSync(process.argv[1], "utf8"), process.argv[1], true)',
         filename], function(childError, stdout, stderr) {
            runner.fail(stderr || message);
         });
      return false;
   }
   script.runInThisContext();
   return true;
}

try {
   for (i= 0; i < runner.scripts.length; i++) {
      if (!runScript(runner.scripts[i]))
         return;
      if (!configured && runner.subtests !== undefined && typeof TAP !== "undefined") {
         TAP.root.filterSubtests(runner.subtests);
         configured= true;
      }
   }
} catch (error) {
   runner.fail(error.stack || error);
}
runner.pollFinished();
})();
