(function(global) {
"use strict";

// Instances will hold graft state; static methods belong on this constructor.
function JGraft() {
}

global.JGraft= JGraft;

// Resolve the host global outside the strict-mode function.
})(typeof window !== "undefined"? window
   : typeof global !== "undefined"? global
   : typeof self !== "undefined"? self
   : this);
