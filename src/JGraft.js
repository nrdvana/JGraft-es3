(function(global) {
"use strict";

// Capture trusted methods once; input objects can shadow any of these names.
var hasOwn= Object.prototype.hasOwnProperty;
var enumerable= Object.prototype.propertyIsEnumerable;
var objectTag= Object.prototype.toString;
var defineProperty= Object.defineProperty;
var getDescriptor= Object.getOwnPropertyDescriptor;
var dateTime= Date.prototype.getTime;
var defaults= {mem: 67108864, ops: 1000000, new_obj: 100000, depth: 128};
var actions= {JGRAFT: -1, AT: 0, COPY: 3};
var expressions= {EXPR: -5, CAP: -4, TEMP: -3, STASH: -2, CONST: -1, NODE: 0,
   LOCAL: 51, LENGTH: 55, FAIL: 67};
// Probe an isolated object, since engines disagree on __proto__ assignment.
// Checking an inherited sentinel also works when descriptors are unavailable.
var protoProbe= {};
protoProbe.__proto__= {probe: protoProbe};
var ordinaryProto= owns(protoProbe, "__proto__") && protoProbe.probe !== protoProbe;
protoProbe= null;

function owns(value, key) {
   // Old JavaScriptCore reports its magic __proto__ accessor as an own
   // property even when no data property exists; descriptors disambiguate it.
   return value !== null && value !== undefined && (key === "__proto__"
      ? getDescriptor? !!getDescriptor(value, key) : enumerable.call(value, key)
      : hasOwn.call(value, key));
}

// Never read inherited data or call methods obtained from external trees.
// Old V8 ignores own __proto__ data properties during bracket reads.
function get(value, key) {
   if (!owns(value, key))
      return undefined;
   return key === "__proto__"? getDescriptor? getDescriptor(value, key).value
      : ordinaryProto? value[key] : undefined : value[key];
}

// Built-in tags recognize arrays/Dates without trusting an input constructor.
function type(value) {
   return value === null? "null" : typeof value !== "object"? typeof value
      : objectTag.call(value) === "[object Array]"? "array"
      : objectTag.call(value) === "[object Date]"? "date" : "object";
}

function integer(value) {
   return typeof value === "number" && isFinite(value) && Math.floor(value) === value;
}

// new JGraft(graft[, config]) takes ownership of graft and its descendants.
// Retained references must not be modified; future versions may cache analysis.
// config.limits overrides the defaults above; Infinity disables a limit.
function JGraft(graft, config) {
   var supplied= get(config, "limits"), key, value;
   this._graft= graft;
   this._limits= {};
   // Copy scalar limits so later changes to config cannot change this budget.
   for (key in defaults) {
      value= owns(supplied, key)? get(supplied, key) : defaults[key];
      if (typeof value !== "number" || value < 0 || value !== value)
         throw new TypeError("Invalid JGraft resource limit: " + key);
      this._limits[key]= value;
   }
   this.counts= null;
}

// Each attempt owns its counters. mem is a conservative allocation estimate,
// assuming no reclamation during the call; depth records the maximum reached.
function charge(state, ops, mem, objects, depth) {
   var counts= state.counts, key;
   // Charge before allocating/iterating; failed counts include rejected work.
   // Include the fixed work of checking all four counters.
   counts.ops+= 4 + (ops || 0);
   counts.mem+= mem || 0;
   counts.new_obj+= objects || 0;
   counts.depth= Math.max(counts.depth, depth || 0);
   for (key in defaults)
      if (counts[key] > state.limits[key]) {
         state.resource= key;
         fail(state, "RESOURCE_LIMIT", "JGraft resource limit exceeded: " + key);
      }
}

// Diagnostics retain the partial output, which may share input subtrees.
// No tree cloning or serialization is needed while handling an error.
function fail(state, code, message) {
   var error= new Error(message);
   error.name= "JGraftError";
   error.code= code;
   error.graftPath= state.graftPath.slice(0);
   error.inputPath= state.inputPath.slice(0);
   error.partial= state.tree? state.tree.value : state.input;
   // Keep this attempt's counters even after the instance is applied again.
   error.counts= state.counts;
   if (state.resource)
      error.resource= state.resource;
   throw error;
}

function make(state, array) {
   charge(state, 1, 32, 1);
   return array? [] : {};
}

// Account for enumeration, including inherited keys which must be ignored.
function keys(state, value) {
   var result= make(state, true), key;
   for (key in value) {
      charge(state, 1);
      if (owns(value, key)) {
         charge(state, 0, 8 + key.length * 2);
         result.push(key);
      }
   }
   return result;
}

// Assign arbitrary own keys without invoking the legacy prototype setter.
function put(state, object, key, value) {
   charge(state, 1 + String(key).length * 0.001,
      owns(object, key)? 0 : 16 + String(key).length * 2);
   if (key === "__proto__" && !ordinaryProto) {
      if (!defineProperty || !getDescriptor)
         fail(state, "INVALID_TARGET", "This engine cannot safely store __proto__ properties");
      charge(state, 1, 48, 1);
      defineProperty(object, key, {value: value, writable: true,
         enumerable: true, configurable: true});
   } else
      object[key]= value;
}

// Namespace holders keep both data and the parallel copy-on-write tree.
// cloned=true means all descendants are owned; an object marks cloned parents
// with per-child ownership under prefixed keys. Missing markers mean shared.
function holder(state, value, cloned) {
   var result= make(state);
   result.value= value;
   result.cloned= cloned;
   return result;
}

function createState(instance, input) {
   var state= {input: input, limits: instance._limits,
      counts: {mem: 0, ops: 0, new_obj: 0, depth: 0},
      graftPath: [], inputPath: []};
   // Publish before any limit check so failed attempts also expose counts.
   instance.counts= state.counts;
   charge(state, 1, 256, 4);
   state.tree= holder(state, input, false);
   return state;
}

// Copy JSON/Date data without interpreting arrays as expressions. shallow is
// used only for copy-on-write parents; deep copies become wholly owned trees.
// Supplying scope instead evaluates children in value context for construction.
function copy(state, value, depth, shallow, scope) {
   var kind= type(value), result, names, i, key;
   charge(state, 1, 0, 0, depth);
   if (kind === "date") {
      // Dates are mutable in JavaScript, so a copied value needs its own Date.
      charge(state, 1, 48, 1);
      return new Date(dateTime.call(value));
   }
   if (kind === "array" || kind === "object") {
      result= make(state, kind === "array");
      names= keys(state, value);
      charge(state, names.length);
      if (kind === "array") {
         // Preserve length independently of enumeration, including sparse data.
         charge(state, 0, value.length * 8);
         result.length= value.length;
      }
      for (i= 0; i < names.length; i++) {
         key= names[i];
         put(state, result, key, scope? argument(state, value, key, scope, depth) : shallow? get(value, key)
            : copy(state, get(value, key), depth + 1));
      }
      return result;
   }
   if (kind !== "null" && kind !== "boolean" && kind !== "string"
         && (kind !== "number" || !isFinite(value)))
      fail(state, "INVALID_TARGET", "Expected JSON data or a Date");
   charge(state, kind === "string"? value.length * 0.001 : 0);
   return value;
}

// Visit a child while retaining its location in the graft for diagnostics.
// Optional handlers select action/path/construction contexts without wrappers.
function argument(state, source, key, scope, depth, handler, parameter) {
   var result;
   charge(state, 1, 8);
   state.graftPath.push(key);
   result= (handler || evaluate)(state, get(source, key), scope, depth + 1, parameter);
   state.graftPath.pop();
   return result;
}

function operation(state, expression, table) {
   var id= get(expression, 0);
   if (typeof id === "string")
      id= get(table, id);
   if (!integer(id))
      fail(state, "INVALID_GRAFT", "Unknown action or expression");
   return id;
}

function arity(state, expression, minimum, maximum) {
   if (expression.length < minimum || expression.length > maximum)
      fail(state, "INVALID_GRAFT", "Invalid argument count");
}

// Return encoded syntax; the caller evaluates it in the current lexical scope.
function macro(state, expression, scope, depth) {
   var name;
   arity(state, expression, 2, 2);
   name= argument(state, expression, 1, scope, depth);
   if (typeof name !== "string" && !integer(name))
      fail(state, "INVALID_OPERAND", "Invalid common expression name");
   if (!owns(scope.expr, String(name)))
      fail(state, "INVALID_TARGET", "Missing common expression");
   return get(scope.expr, String(name));
}

// Begin evaluation at the current node. Reference walks refine this location;
// otherwise a previous pair's destination must not leak into diagnostics.
function location(state, scope) {
   charge(state, scope.node.keys.length, 32 + scope.node.keys.length * 8, 1);
   state.inputPath= scope.node.keys.slice(0);
}

// Flatten path arguments once. Literal selector faults are INVALID_GRAFT;
// invalid results of computed expressions are INVALID_OPERAND.
function path(state, expression, scope, depth, writing) {
   var id, tree, selectors= make(state, true), item, expanded, i, j, code;
   location(state, scope);
   charge(state, 1, 0, 0, depth);
   if (type(expression) === "object" || type(expression) === "date")
      fail(state, "INVALID_GRAFT", "Expected an implicit selector or reference expression");
   if (type(expression) !== "array") {
      charge(state, 1, 48, 1);
      expression= ["NODE", expression];
   }
   id= operation(state, expression, expressions);
   if (id === -5)
      return path(state, macro(state, expression, scope, depth), scope, depth + 1, writing);
   tree= id === 0? scope.node.tree : id === -1? scope.constants
      : id === -2? scope.stash : id === -3? scope.temp : id === -4? scope.cap : null;
   if (!tree || writing && (id === -1 || id === -4))
      fail(state, "INVALID_GRAFT", "Invalid reference namespace");
   if (id === 0) {
      charge(state, scope.node.keys.length, 32 + scope.node.keys.length * 8, 1);
      selectors= scope.node.keys.slice(0);
   }
   charge(state, expression.length);
   for (i= 1; i < expression.length; i++) {
      item= get(expression, i);
      code= type(item) === "array"? "INVALID_OPERAND" : "INVALID_GRAFT";
      item= argument(state, expression, i, scope, depth);
      if (type(item) === "array")
         expanded= item;
      else {
         charge(state, 1, 40, 1);
         expanded= [item];
      }
      charge(state, expanded.length, expanded.length * 8);
      for (j= 0; j < expanded.length; j++) {
         item= get(expanded, j);
         if (typeof item !== "string" && item !== false && !integer(item))
            fail(state, code, "Invalid path selector");
         // These namespaces permit a leading integer as an object key.
         selectors.push(selectors.length === 0 && id < 0 && id !== -4 && integer(item)? String(item) : item);
      }
   }
   if (id === -3 && !selectors.length || writing && id !== 0 && !selectors.length)
      fail(state, "INVALID_GRAFT", "Namespace root cannot be accessed this way");
   charge(state, 1, 48, 1);
   return {tree: tree, keys: selectors, namespace: id};
}

// Resolve aliases against the current parent. No inherited value is readable.
function selector(state, parent, key, writing) {
   var kind= type(parent);
   charge(state, 1);
   if (kind === "array" && (integer(key) || key === false)) {
      key= key === false? parent.length : key < 0? parent.length + key : key;
      if (key >= 0 && key < parent.length + (writing? 1 : 0))
         return key;
   } else if (kind === "object" && typeof key === "string")
      return key;
   fail(state, "INVALID_TARGET", "Path selector does not address this container");
}

function read(state, reference, depth) {
   var value= reference.tree.value, i, key;
   state.inputPath= make(state, true);
   charge(state, reference.keys.length, reference.keys.length * 8);
   for (i= 0; i < reference.keys.length; i++) {
      charge(state, 1, 0, 0, depth + i);
      key= selector(state, value, reference.keys[i], false);
      state.inputPath.push(key);
      if (!owns(value, key))
         fail(state, "INVALID_TARGET", "Missing source property");
      // AT retains these concrete indices rather than re-resolving aliases.
      reference.keys[i]= key;
      value= get(value, key);
   }
   return value;
}

// Write an entirely owned value, cloning each shared parent at most once.
// Auto-vivification only creates absent containers; it never converts scalars.
function write(state, reference, value, depth) {
   var tree= reference.tree, node= tree.value, mark= tree.cloned;
   var parent, parentMark, parentKey, child, childMark, key, i;
   state.inputPath= make(state, true);
   if (!reference.keys.length) {
      tree.value= value;
      tree.cloned= true;
      return;
   }
   charge(state, reference.keys.length, reference.keys.length * 8);
   for (i= 0; i < reference.keys.length; i++) {
      charge(state, 1, 0, 0, depth + i);
      key= selector(state, node, reference.keys[i], true);
      state.inputPath.push(key);
      if (!mark) {
         // The parent is already writable when attaching this shallow clone.
         node= copy(state, node, depth + i, true);
         mark= make(state);
         if (i === 0) {
            tree.value= node;
            tree.cloned= mark;
         } else {
            put(state, parent, parentKey, node);
            put(state, parentMark, "$" + parentKey, mark);
         }
      }
      if (i === reference.keys.length - 1) {
         put(state, node, key, value);
         if (mark !== true)
            put(state, mark, "$" + key, true);
         return;
      }
      child= get(node, key);
      // Prefix markers so arbitrary data keys cannot hit __proto__ semantics.
      childMark= mark === true? true : get(mark, "$" + key);
      if (!owns(node, key)) {
         child= make(state, typeof reference.keys[i + 1] !== "string");
         childMark= true;
         put(state, node, key, child);
         if (mark !== true)
            put(state, mark, "$" + key, true);
      }
      parent= node;
      parentMark= mark;
      parentKey= key;
      node= child;
      mark= childMark;
   }
}

// Construct literal objects/escaped arrays recursively. Referenced values are
// materialized, so subsequent writes cannot create aliases or cycles.
function construct(state, source, scope, depth) {
   return copy(state, source, depth, false, scope);
}

function evaluate(state, expression, scope, depth) {
   var kind= type(expression), id, value, local, name, i;
   location(state, scope);
   charge(state, 1, 0, 0, depth);
   if (kind === "object")
      return construct(state, expression, scope, depth);
   if (kind !== "array")
      return copy(state, expression, depth);
   if (expression.length === 1 && type(get(expression, 0)) === "array")
      return argument(state, expression, 0, scope, depth, construct);
   id= operation(state, expression, expressions);
   if (id === -5)
      return evaluate(state, macro(state, expression, scope, depth), scope, depth + 1);
   if (id >= -4 && id <= 0)
      return copy(state, read(state, path(state, expression, scope, depth), depth), depth);
   if (id === 55) {
      arity(state, expression, 1, 2);
      value= expression.length === 1? read(state, scope.node, depth)
         : argument(state, expression, 1, scope, depth);
      kind= type(value);
      if (kind !== "string" && kind !== "array")
         fail(state, "INVALID_TARGET", "LENGTH requires an array or string");
      return value.length;
   }
   if (id === 67) {
      arity(state, expression, 1, 1);
      fail(state, "INVALID_TARGET", "Explicit FAIL expression");
   }
   if (id === 51) {
      if (expression.length < 2 || expression.length % 2 !== 0)
         fail(state, "INVALID_GRAFT", "LOCAL requires pairs and a result expression");
      // Only binding roots change; nested values remain read-only expressions.
      local= scopeCopy(state, scope);
      local.temp= holder(state, copy(state, scope.temp.value, depth, true), true);
      charge(state, expression.length);
      for (i= 1; i < expression.length - 1; i+= 2) {
         name= argument(state, expression, i, local, depth);
         value= argument(state, expression, i + 1, local, depth);
         if (name === null) {
            local.node= make(state);
            local.node.tree= holder(state, value, true);
            local.node.keys= make(state, true);
         }
         else if (typeof name === "string" || typeof name === "number")
            put(state, local.temp.value, String(name), value);
         else
            fail(state, "INVALID_OPERAND", "Invalid LOCAL binding name");
      }
      return argument(state, expression, expression.length - 1, local, depth);
   }
   fail(state, "INVALID_GRAFT", "Unsupported value expression");
}

// Copy lexical bindings while sharing holders whose data must remain visible.
function scopeCopy(state, scope) {
   var result= make(state), key;
   for (key in scope) {
      charge(state, 1);
      if (owns(scope, key))
         result[key]= scope[key];
   }
   return result;
}

// Metadata constants are evaluated sequentially; macros retain their encoded
// expression form and are expanded lazily when referenced.
function declarations(state, metadata, key, scope, depth) {
   var source= get(metadata, key), name, value, i;
   if (!owns(metadata, key))
      return;
   if (type(source) !== "array" || source.length % 2)
      fail(state, "INVALID_GRAFT", "Metadata declarations require name/value pairs");
   state.graftPath.push(1, key);
   charge(state, source.length);
   for (i= 0; i < source.length; i+= 2) {
      name= get(source, i);
      if (typeof name !== "string" && !integer(name))
         fail(state, "INVALID_GRAFT", "Invalid metadata declaration name");
      value= key === "const"? argument(state, source, i + 1, scope, depth) : get(source, i + 1);
      put(state, key === "const"? scope.constants.value : scope.expr, String(name), value);
   }
   state.graftPath.pop();
   state.graftPath.pop();
}

function action(state, expression, inherited, depth) {
   var id, scope, metadata, reference, value, i;
   location(state, inherited);
   charge(state, 1, 0, 0, depth);
   if (type(expression) !== "array")
      fail(state, "INVALID_GRAFT", "Expected an action array");
   id= operation(state, expression, actions);
   scope= scopeCopy(state, inherited);
   // TEMP lasts for exactly this action, including all pairs of one COPY.
   scope.temp= holder(state, make(state), true);
   if (id === -1) {
      arity(state, expression, 2, Infinity);
      metadata= get(expression, 1);
      if (type(metadata) !== "object" || owns(metadata, "v")
            && (!integer(get(metadata, "v")) || get(metadata, "v") < 1 || get(metadata, "v") > 1))
         fail(state, "INVALID_GRAFT", "Unsupported JGraft metadata or version");
      scope.constants= holder(state, copy(state, scope.constants.value, depth, true), true);
      scope.expr= copy(state, scope.expr, depth, true);
      declarations(state, metadata, "const", scope, depth);
      declarations(state, metadata, "expr", scope, depth);
      // Constant declarations can see the parent's stash before this reset.
      scope.stash= holder(state, make(state), true);
      i= 2;
   } else if (id === 0) {
      arity(state, expression, 2, Infinity);
      reference= argument(state, expression, 1, scope, depth, path);
      if (reference.namespace !== 0)
         fail(state, "INVALID_GRAFT", "AT requires a NODE reference");
      read(state, reference, depth);
      scope.node= reference;
      i= 2;
   } else if (id === 3) {
      if (expression.length % 2 !== 1)
         fail(state, "INVALID_GRAFT", "COPY requires value/path pairs");
      charge(state, expression.length);
      for (i= 1; i < expression.length; i+= 2) {
         // Finish the source before resolving a destination that may overlap it.
         value= argument(state, expression, i, scope, depth);
         state.graftPath.push(i + 1);
         reference= path(state, get(expression, i + 1), scope, depth + 1, true);
         write(state, reference, value, depth + 1);
         state.graftPath.pop();
      }
      return;
   } else
      fail(state, "INVALID_GRAFT", "Unsupported action");
   charge(state, expression.length - i);
   for (; i < expression.length; i++)
      argument(state, expression, i, scope, depth, action);
}

// apply(input[, {clone:true}]) leaves input unchanged and returns the new tree.
// clone requests independence from all input/graft objects, including Dates.
// Counts are replaced for each attempt, including failures. Config limits are
// copied at construction; apply options are borrowed for this synchronous call.
JGraft.prototype.apply= function(input, options) {
   var state= createState(this, input), scope= make(state);
   scope.node= make(state);
   scope.node.tree= state.tree;
   scope.node.keys= make(state, true);
   scope.constants= holder(state, make(state), true);
   scope.stash= holder(state, make(state), true);
   scope.temp= holder(state, make(state), true);
   scope.cap= holder(state, make(state), true);
   scope.expr= make(state);
   if (type(this._graft) !== "array" || get(this._graft, 0) !== "JGRAFT")
      fail(state, "INVALID_GRAFT", "The root action must be JGRAFT");
   action(state, this._graft, scope, 1);
   // Detach untouched branches only after execution, using the same counters.
   if (get(options, "clone") === true)
      state.tree.value= copy(state, state.tree.value, 1);
   return state.tree.value;
};

global.JGraft= JGraft;

// Resolve the host global outside the strict-mode function.
})(typeof window !== "undefined"? window
   : typeof global !== "undefined"? global
   : typeof self !== "undefined"? self
   : this);
