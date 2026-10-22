(function(global) {
"use strict";

// Capture trusted methods once; input objects can shadow any of these names.
var hasOwn= Object.prototype.hasOwnProperty;
var enumerable= Object.prototype.propertyIsEnumerable;
var objectTag= Object.prototype.toString;
var defineProperty= Object.defineProperty;
var getDescriptor= Object.getOwnPropertyDescriptor;
var dateTime= Date.prototype.getTime;
var dateYear= Date.prototype.getUTCFullYear;
var dateGetters= [dateYear, Date.prototype.getUTCMonth, Date.prototype.getUTCDate,
   Date.prototype.getUTCHours, Date.prototype.getUTCMinutes, Date.prototype.getUTCSeconds,
   Date.prototype.getUTCMilliseconds];
var dateFields= ["year", "month", "day", "hour", "minute", "second", "tz_offset"];
var datePattern= /^([+-]?[0-9]{4,})(-?)([0-9]{2})-?([0-9]{2})(?:[T ]([0-9]{2}):?([0-9]{2}):?([0-9]{2})(?:[.,]([0-9]+))?(?:(Z)|([+\-\u2212])([0-9]{2})(?::?([0-9]{2}))?)?)?(?![\s\S])/;
var stringSlice= String.prototype.slice;
var stringCode= String.prototype.charCodeAt;
var regexpTest= RegExp.prototype.test;
var surrogatePair= /[\uD800-\uDBFF][\uDC00-\uDFFF]/;
// An absolute end assertion avoids JavaScript's $ accepting a final newline.
var jsonNumber= /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?(?![\s\S])/;
var nonzeroMantissa= /^[^eE]*[1-9]/;
var defaults= {mem: 67108864, ops: 1000000, new_obj: 100000, depth: 128};
var actions= {JGRAFT: -1, AT: 0, MATCH: 1, IF: 2, COPY: 3, MOVE: 4, SPLICE: 5, SPLIT: 6};
var expressions= {EXPR: -5, CAP: -4, TEMP: -3, STASH: -2, CONST: -1, NODE: 0,
   HAS: 1, IS: 2, NONE: 3, ANY: 4, ALL: 5, EXISTS: 6, ARRAY: 7, STR: 8, NUM: 9, BOOL: 10, DATE: 11, WITH: 12,
   SEQ: 13, SEQMAX: 14, SEQMIN: 15,
   REP: 16, START: 17, END: 18, CAPTURE: 50,
   LOCAL: 51, NOT: 52, LENGTH: 55, SLICE: 57, CONCAT: 58, SPLIT: 62, JOIN: 63, MKOBJ: 65, FAIL: 67,
   CASTBOOL: 68, CASTNUM: 69, CASTSTR: 70, CASTDATE: 71};
// Probe an isolated object, since engines disagree on __proto__ assignment.
// Checking an inherited sentinel also works when descriptors are unavailable.
var protoProbe= {};
protoProbe.__proto__= {probe: protoProbe};
var ordinaryProto= owns(protoProbe, "__proto__") && protoProbe.probe !== protoProbe;
var recreateProto= false;
var deleteProto= true;
if (!ordinaryProto && defineProperty && getDescriptor) {
   try {
      defineProperty(protoProbe, "__proto__", {value: 0, configurable: true});
      defineProperty(protoProbe, "__proto__", {value: 1, configurable: true});
      recreateProto= getDescriptor(protoProbe, "__proto__").value !== 1;
      delete protoProbe.__proto__;
   } catch (probeError) {
      // Old V8 refuses deletion even of configurable own __proto__ data.
      deleteProto= false;
   }
}
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
      : value instanceof DateValue || objectTag.call(value) === "[object Date]"? "date" : "object";
}

function integer(value) {
   return typeof value === "number" && isFinite(value) && Math.floor(value) === value;
}

// Private immutable date values retain calendar precision, leap seconds, and
// the original minute offset. They are never exposed in the target tree.
function DateValue(state, parts, count) {
   charge(state, 1, 48, 1);
   this.parts= parts;
   this.count= count;
   state.dates= true;
}

function monthDays(year, month) {
   return month === 2? year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)? 29 : 28
      : month === 4 || month === 6 || month === 9 || month === 11? 30 : 31;
}

// Truncate decimal digits before numeric conversion, avoiding binary rounding
// of a millisecond-exact field or a carry into the next second/day.
function dateSecond(state, whole, fraction) {
   var removed= stringSlice.call(fraction, state.dateDigits);
   if (!state.truncateDateResolution && regexpTest.call(nonzeroMantissa, removed))
      fail(state, "UNSUPPORTED_GRAFT", "Date resolution would lose fractional seconds");
   return state.dateDigits && fraction? Number(whole + "." + stringSlice.call(fraction, 0, state.dateDigits)) : whole;
}

// Borrow internal values, or extract a native Date using trusted UTC methods.
// Native Dates represent timestamps; their mutability stays outside expressions.
function dateRecord(state, value) {
   var parts, i;
   if (value instanceof DateValue) return value;
   if (type(value) !== "date" || !isFinite(dateTime.call(value)))
      fail(state, "INVALID_TARGET", "Expected a valid date");
   parts= make(state, true);
   charge(state, 24, 96);
   for (i= 0; i < 6; i++) parts[i]= dateGetters[i].call(value);
   parts[1]++;
   parts[5]= Number(parts[5] + "." + datePad(dateGetters[6].call(value), 3));
   parts[6]= 0;
   return new DateValue(state, parts, 7);
}

function dateProperty(state, value, key) {
   var record= dateRecord(state, value), i;
   charge(state, record.count);
   for (i= 0; i < record.count; i++)
      if (dateFields[i] === key) return record.parts[i];
   fail(state, "INVALID_TARGET", "Missing virtual date property");
}

// Parse only unambiguous required forms and numeric field objects. Validation
// precedes resolution loss, so truncation cannot repair an invalid date/time.
function castDate(state, value) {
   var kind= type(value), parts, count= 3, matched, i, second, fraction= "", text;
   if (value instanceof DateValue) return value;
   if (kind === "date") {
      if (!isFinite(dateTime.call(value))) fail(state, "INVALID_TARGET", "Invalid native Date");
      return copy(state, value, 1);
   }
   parts= make(state, true);
   charge(state, 7, 56);
   if (kind === "string") {
      charge(state, value.length * 5, value.length * 4 + 512, 1);
      matched= datePattern.exec(value);
      text= matched? matched[1] : "";
      if (!matched || text.length - (stringCode.call(text, 0) === 43 || stringCode.call(text, 0) === 45? 1 : 0) > 4 && !matched[2])
         fail(state, "INVALID_TARGET", "Invalid date string");
      parts[0]= Number(matched[1]);
      if (!isFinite(parts[0])) fail(state, "UNSUPPORTED_GRAFT", "Date year is outside the host numeric range");
      parts[1]= Number(matched[3]);
      parts[2]= Number(matched[4]);
      for (i= 3; i < 6; i++) parts[i]= matched[i + 2] === undefined? 0 : Number(matched[i + 2]);
      fraction= matched[8] || "";
      parts[6]= 0;
      if (matched[5] !== undefined) count= 6;
      if (matched[9] || matched[10]) {
         count= 7;
         if (matched[10]) {
            if (Number(matched[11]) > 23 || Number(matched[12] || 0) > 59)
               fail(state, "INVALID_TARGET", "Invalid timezone offset");
            parts[6]= Number(matched[11]) * 60 + Number(matched[12] || 0);
            if (matched[10] !== "+") {
               if (!parts[6]) fail(state, "INVALID_TARGET", "Negative zero timezone");
               parts[6]= -parts[6];
            }
         }
      }
   } else if (kind === "object") {
      for (i= 0; i < 7; i++) {
         parts[i]= owns(value, dateFields[i])? get(value, dateFields[i]) : i === 1 || i === 2? 1 : i? 0 : undefined;
         if (i >= 3 && owns(value, dateFields[i])) count= i === 6? 7 : Math.max(count, 6);
      }
   } else
      fail(state, "INVALID_TARGET", "Cannot infer a date from this value");
   for (i= 0; i < 7; i++) {
      if (i === 5? typeof parts[i] !== "number" || !isFinite(parts[i]) : !integer(parts[i]))
         fail(state, "INVALID_TARGET", "Date fields must be numeric");
   }
   if (parts[1] < 1 || parts[1] > 12 || parts[2] < 1 || parts[2] > monthDays(parts[0], parts[1])
         || parts[3] < 0 || parts[3] > 23 || parts[4] < 0 || parts[4] > 59
         || parts[5] < 0 || parts[5] >= 61 || Math.abs(parts[6]) > 1439)
      fail(state, "INVALID_TARGET", "Date fields are out of range");
   second= Math.floor(parts[5]);
   if (kind === "object" && parts[5] !== second) {
      charge(state, 1, 64);
      // Nonzero scientific spellings here are below one millisecond.
      text= String(parts[5]);
      fraction= text.indexOf("e") !== -1? "0001" : stringSlice.call(text, text.indexOf(".") + 1);
   }
   parts[5]= dateSecond(state, second, fraction);
   return new DateValue(state, parts, count);
}

// Native Date years fit six digits; internal years can use the whole supported
// numeric range. Padding never removes digits or changes calendar fields.
function datePad(value, width) {
   var text= String(value);
   while (text.length < width) text= "0" + text;
   return text;
}

function dateString(state, value) {
   var parts= value.parts, year= Math.abs(parts[0]), text, second, offset= parts[6];
   charge(state, 128, 1024);
   text= year >= 1e21? scalarString(state, year) : String(year);
   charge(state, text.length * 10, text.length * 20);
   text= (parts[0] < 0? "-" : parts[0] > 9999? "+" : "")
      + datePad(text, parts[0] < 0 || parts[0] > 9999? 6 : 4)
      + "-" + datePad(parts[1], 2) + "-" + datePad(parts[2], 2);
   if (value.count > 3) {
      second= (parts[5] < 10? "0" : "") + String(parts[5]);
      text+= (value.count === 7? "T" : " ") + datePad(parts[3], 2) + ":" + datePad(parts[4], 2) + ":" + second;
   }
   if (value.count === 7)
      text+= !offset? "Z" : (offset < 0? "-" : "+") + datePad(Math.floor(Math.abs(offset) / 60), 2)
         + datePad(Math.abs(offset) % 60, 2);
   return text;
}

// Normalize only minute offsets. Seconds (including leap seconds) stay intact;
// a zone within one day needs at most one calendar-day boundary adjustment.
function dateComparable(state, value, depth) {
   var parts= value.parts, minute, day;
   if (value.count !== 7 || !parts[6]) return parts;
   parts= copy(state, parts, depth, true);
   minute= parts[3] * 60 + parts[4] - parts[6];
   parts[2]+= Math.floor(minute / 1440);
   minute= (minute % 1440 + 1440) % 1440;
   parts[3]= Math.floor(minute / 60);
   parts[4]= minute % 60;
   parts[6]= 0;
   if (parts[2] < 1) {
      if (--parts[1] < 1) {parts[1]= 12; parts[0]--;}
      parts[2]+= monthDays(parts[0], parts[1]);
   } else {
      day= monthDays(parts[0], parts[1]);
      if (parts[2] > day) {
         parts[2]-= day;
         if (++parts[1] > 12) {parts[1]= 1; parts[0]++;}
      }
   }
   return parts;
}

function dateEqual(state, left, right, depth) {
   var a= dateRecord(state, left), b= dateRecord(state, right), i;
   if (a.count !== b.count) return false;
   left= dateComparable(state, a, depth);
   right= dateComparable(state, b, depth);
   charge(state, a.count);
   for (i= 0; i < a.count; i++)
      if (left[i] !== right[i]) return false;
   return true;
}

// Only parents containing private dates change. Such parents are owned:
// expressions copy containers, and inserting a private date into shared input
// first clones its parents. MOVE retains array identity/pending metadata here.
function exportDates(state, value, depth) {
   var kind= type(value), names, key, child, converted, info, queue, i, j;
   charge(state, 1, 0, 0, depth);
   if (value instanceof DateValue) return dateString(state, value);
   if (kind !== "array" && kind !== "object") return value;
   names= keys(state, value);
   charge(state, names.length);
   for (i= 0; i < names.length; i++) {
      key= names[i];
      child= get(value, key);
      converted= exportDates(state, child, depth + 1);
      if (converted !== child) put(state, value, key, converted);
   }
   info= kind === "array" && state.moving? arrayInfo(state, value) : null;
   if (info && info.inserts) {
      names= keys(state, info.inserts);
      charge(state, names.length);
      for (i= 0; i < names.length; i++) {
         queue= get(info.inserts, names[i]);
         charge(state, queue.length);
         for (j= 0; j < queue.length; j++)
            queue[j].value= exportDates(state, queue[j].value, depth + 1);
      }
   }
   return value;
}

// Probe at construction so installing a replacement parser changes the default
// for later instances. Test both silently discarded scalars and prototype writes.
function brokenJSON() {
   var value;
   try {
      value= JSON.parse('{"__proto__":0,"child":{"__proto__":{"probe":1}}}');
      return !owns(value, "__proto__") || get(value, "__proto__") !== 0
         || !owns(get(value, "child"), "__proto__")
         || get(get(get(value, "child"), "__proto__"), "probe") !== 1;
   } catch (error) {
      return true;
   }
}

// new JGraft(graft[, config]) takes ownership of graft and its descendants.
// Retained references must not be modified; future versions may cache analysis.
// config.limits overrides the defaults above; Infinity disables a limit.
function JGraft(graft, config) {
   var supplied= get(config, "limits"), key, value;
   this._graft= graft;
   this._limits= {};
   value= owns(config, "forbidProto")? get(config, "forbidProto") : brokenJSON();
   if (typeof value !== "boolean")
      throw new TypeError("Invalid JGraft forbidProto option");
   this.forbidProto= value;
   this._dateDigits= dateTime.call(new Date(1)) === 1? 3 : 0;
   value= owns(config, "truncateDateResolution")? get(config, "truncateDateResolution") : this._dateDigits >= 3;
   if (typeof value !== "boolean")
      throw new TypeError("Invalid JGraft truncateDateResolution option");
   this.truncateDateResolution= value;
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
   error.limits= {mem: state.limits.mem, ops: state.limits.ops,
      new_obj: state.limits.new_obj, depth: state.limits.depth};
   if (state.resource)
      error.resource= state.resource;
   throw error;
}

function make(state, array) {
   charge(state, 1, 32, 1);
   return array? [] : {};
}

// Called at charged property accesses/enumerations, including absent paths.
// This is a host/configuration restriction, never a malformed-graft diagnosis.
function property(state, key) {
   if (state.forbidProto && key === "__proto__")
      fail(state, "UNSUPPORTED_GRAFT", "Host configuration forbids __proto__ properties");
}

// Account for enumeration, including inherited keys which must be ignored.
function keys(state, value) {
   var result= make(state, true), key;
   for (key in value) {
      charge(state, 1);
      if (owns(value, key)) {
         property(state, key);
         charge(state, 0, 8 + key.length * 2);
         result.push(key);
      }
   }
   return result;
}

// Assign arbitrary own keys without invoking the legacy prototype setter.
function put(state, object, key, value) {
   property(state, key);
   charge(state, 1 + String(key).length * 0.001,
      owns(object, key)? 0 : 16 + String(key).length * 2);
   if (key === "__proto__" && !ordinaryProto) {
      if (!defineProperty || !getDescriptor)
         fail(state, "UNSUPPORTED_GRAFT", "This engine cannot safely store __proto__ properties");
      charge(state, 1, 48, 1);
      // JavaScriptCore 1.9 can ignore value changes when redefining this key.
      // Our writable containers have configurable properties, so recreate it.
      if (recreateProto)
         delete object[key];
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
   var state= {input: input, limits: instance._limits, forbidProto: instance.forbidProto,
      dateDigits: instance._dateDigits, truncateDateResolution: instance.truncateDateResolution,
      counts: {mem: 0, ops: 0, new_obj: 0, depth: 0},
      graftPath: [], inputPath: []};
   // Publish before any limit check so failed attempts also expose counts.
   instance.counts= state.counts;
   charge(state, 1, 256, 4);
   state.tree= holder(state, input, false);
   state.arrays= make(state, true);
   return state;
}

// Copy JSON/Date data without interpreting arrays as expressions. shallow is
// used only for copy-on-write parents; deep copies become wholly owned trees.
// Supplying scope instead evaluates children in value context for construction.
function copy(state, value, depth, shallow, scope) {
   var kind= type(value), result, names, i, key, info, target;
   charge(state, 1, 0, 0, depth);
   if (kind === "date") {
      if (value instanceof DateValue) return value;
      // Dates are mutable in JavaScript, so a copied value needs its own Date.
      charge(state, 1, 48, 1);
      result= dateTime.call(value);
      if (!state.dateDigits && isFinite(result) && result % 1000) {
         if (!state.truncateDateResolution)
            fail(state, "UNSUPPORTED_GRAFT", "Date resolution would lose milliseconds");
         result= Math.floor(result / 1000) * 1000;
      }
      return new Date(result);
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
         if (!shallow && !present(state, value, key))
            fail(state, "INVALID_TARGET", "Cannot enumerate a pending deletion");
         put(state, result, key, scope? argument(state, value, key, scope, depth) : shallow? get(value, key)
            : copy(state, get(value, key), depth + 1));
         if (scope && kind === "array")
            receiveElement(state, result, Number(key), state.element, true);
      }
      if (kind === "array" && !scope) {
         info= arrayInfo(state, value);
         if (info && info.split) {
            target= arrayInfo(state, result, true);
            target.split= make(state);
            target.split.origin= info.split.origin;
            charge(state, info.split.items.length, 32 + info.split.items.length * 8, 1);
            target.split.items= info.split.items.slice(0);
         }
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
// Matching can also supply the scope to use after operand evaluation.
function argument(state, source, key, scope, depth, handler, parameter, target) {
   var result;
   charge(state, 1, 8);
   state.graftPath.push(key);
   result= (handler || evaluate)(state, get(source, key), scope, depth + 1, parameter, target);
   state.graftPath.pop();
   return result;
}

function operation(state, expression, table, code) {
   var id= get(expression, 0);
   if (typeof id === "string")
      id= get(table, id);
   if (!integer(id))
      fail(state, code || "INVALID_GRAFT", "Unknown action or expression");
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
   property(state, String(name));
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
      fail(state, writing >= 2 && writing <= 3? "INVALID_TARGET" : "INVALID_GRAFT",
         "Expected an implicit selector or reference expression");
   if (type(expression) !== "array") {
      charge(state, 1, 48, 1);
      expression= ["NODE", expression];
   }
   id= operation(state, expression, expressions,
      writing >= 2 && writing <= 3? "INVALID_TARGET" : "INVALID_GRAFT");
   if (id === -5)
      return path(state, macro(state, expression, scope, depth), scope, depth + 1, writing);
   tree= id === 0? scope.node.tree : id === -1? scope.constants
      : id === -2? scope.stash : id === -3? scope.temp : id === -4? scope.cap : null;
   if (!tree || writing && (id === -1 || id === -4))
      fail(state, writing >= 2 && writing <= 3? tree? "INVALID_OPERAND" : "INVALID_TARGET"
         : "INVALID_GRAFT", "Invalid reference namespace");
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
         property(state, item);
         if (typeof item !== "string" && item !== false && !integer(item)
               && !(writing === 3 && typeof item === "number" && integer(item * 2)))
            fail(state, code, "Invalid path selector");
         // These namespaces permit a leading integer as an object key.
         selectors.push(selectors.length === 0 && id < 0 && id !== -4 && integer(item)? String(item) : item);
      }
   }
   if (id === -3 && !selectors.length || writing && id !== 0 && !selectors.length)
      fail(state, writing >= 2 && writing <= 3? "INVALID_OPERAND" : "INVALID_GRAFT",
         "Namespace root cannot be accessed this way");
   charge(state, 1, 48, 1);
   return {tree: tree, keys: selectors, namespace: id};
}

// Resolve aliases against the current parent. No inherited value is readable.
function selector(state, parent, key, writing) {
   var kind= type(parent);
   charge(state, 1);
   property(state, key);
   if (kind === "array" && writing === 2 && typeof key === "number"
         && integer(key * 2) && !integer(key)) {
      key= key < -0.5? parent.length + key : key;
      if (key >= -0.5 && key < parent.length)
         return key;
   } else if (kind === "array" && (integer(key) || key === false)) {
      key= key === false? parent.length : key < 0? parent.length + key : key;
      if (key >= 0 && key < parent.length + (writing? 1 : 0))
         return key;
   } else if (kind === "object" && typeof key === "string")
      return key;
   else if (kind === "date" && !writing && typeof key === "string")
      return key;
   fail(state, "INVALID_TARGET", "Path selector does not address this container");
}

function read(state, reference, depth) {
   var value= reference.tree.value, i, key;
   state.inputPath= make(state, true);
   if (reference.tree.deleted)
      fail(state, "INVALID_TARGET", "Current node is temporarily deleted");
   charge(state, reference.keys.length, reference.keys.length * 8);
   for (i= 0; i < reference.keys.length; i++) {
      charge(state, 1, 0, 0, depth + i);
      key= selector(state, value, reference.keys[i], false);
      state.inputPath.push(key);
      if (type(value) === "date")
         value= dateProperty(state, value, key);
      else {
         if (!present(state, value, key))
            fail(state, "INVALID_TARGET", "Missing or pending-deletion source property");
         value= get(value, key);
      }
      // AT retains these concrete indices rather than re-resolving aliases.
      reference.keys[i]= key;
   }
   return value;
}

// Metadata is kept outside user arrays. Linear identity searches are charged;
// moving an array therefore carries its pending edits without visiting its data.
function arrayInfo(state, array, create) {
   var i, info;
   charge(state, state.arrays.length);
   for (i= 0; i < state.arrays.length; i++)
      if (state.arrays[i].array === array)
         return state.arrays[i];
   if (!create)
      return null;
   info= make(state);
   info.array= array;
   info.split= null;
   charge(state, 1, 8);
   state.arrays.push(info);
   return info;
}

// During MOVE, deleted array slots hold null in the diagnostic tree while a
// separate map makes them inaccessible. This keeps partial results JSON-shaped.
function present(state, object, key) {
   var info= state.moving && type(object) === "array"? arrayInfo(state, object) : null;
   return owns(object, key) && !(info && get(info.deleted, "$" + key));
}

function childOwnership(mark, key) {
   return mark === true? true : owns(mark, "$" + key)? get(mark, "$" + key) : !!get(mark, "all");
}

function parentReference(state, reference) {
   var result= make(state);
   charge(state, reference.keys.length, reference.keys.length * 8 + 32, 1);
   result.tree= reference.tree;
   result.keys= reference.keys.slice(0, -1);
   return result;
}

// Return a writable container and its ownership map. all=true supplies the
// default for untouched children of an owned subtree; explicit false markers
// let MOVE attach shared input data without incorrectly claiming ownership.
// nextKey is the selector just beyond this reference when auto-vivifying.
function edit(state, reference, depth, create, nextKey) {
   var tree= reference.tree, node= tree.value, mark= tree.cloned;
   var parent, parentMark, parentKey, key, child, i, result;
   state.inputPath= make(state, true);
   if (tree.deleted) {
      if (!create)
         fail(state, "INVALID_TARGET", "Current node is temporarily deleted");
      node= make(state, typeof (reference.keys.length? reference.keys[0] : nextKey) !== "string");
      tree.deleted= false;
      tree.value= node;
      mark= true;
   }
   charge(state, reference.keys.length + 1, reference.keys.length * 8);
   for (i= 0; i <= reference.keys.length; i++) {
      charge(state, 1, 0, 0, depth + i);
      if (type(node) !== "object" && type(node) !== "array")
         fail(state, "INVALID_TARGET", "Expected a writable container");
      if (!mark || mark === true) {
         if (!mark)
            node= copy(state, node, depth + i, true);
         child= make(state);
         child.all= mark === true;
         mark= child;
         if (i === 0) {
            tree.value= node;
            tree.cloned= mark;
         } else {
            put(state, parent, parentKey, node);
            put(state, parentMark, "$" + parentKey, mark);
         }
      }
      if (i === reference.keys.length) {
         result= make(state);
         result.value= node;
         result.mark= mark;
         return result;
      }
      key= selector(state, node, reference.keys[i], create);
      state.inputPath.push(key);
      child= childOwnership(mark, key);
      if (!present(state, node, key)) {
         if (!create)
            fail(state, "INVALID_TARGET", "Missing parent property");
         put(state, node, key, make(state,
            typeof (i + 1 < reference.keys.length? reference.keys[i + 1] : nextKey) !== "string"));
         put(state, mark, "$" + key, true);
         revive(state, node, key);
         child= true;
      }
      parent= node;
      parentMark= mark;
      parentKey= key;
      node= get(node, key);
      mark= child;
   }
}

function revive(state, array, key) {
   var info= state.moving && type(array) === "array"? arrayInfo(state, array) : null;
   if (info && info.deleted)
      delete info.deleted["$" + key];
}

// Assign a value with its ownership marker. COPY supplies true; MOVE transfers
// the original marker, so modifying a moved shared branch still shallow-clones.
function write(state, reference, value, depth, owned, element) {
   var parent, key, inserting;
   if (state.dates && reference.tree === state.tree)
      value= exportDates(state, value, depth);
   if (owned === undefined)
      owned= true;
   if (!reference.keys.length) {
      reference.tree.value= value;
      reference.tree.cloned= owned;
      reference.tree.deleted= false;
      return;
   }
   key= reference.keys[reference.keys.length - 1];
   parent= edit(state, parentReference(state, reference), depth, true, key);
   key= selector(state, parent.value, key, true);
   state.inputPath.push(key);
   inserting= key === parent.value.length || !present(state, parent.value, key);
   put(state, parent.value, key, value);
   if (type(parent.value) === "array")
      receiveElement(state, parent.value, key, element, inserting, parent.mark);
   put(state, parent.mark, "$" + key, owned);
   revive(state, parent.value, key);
}

// Validate the destination against a virtual source removal before detaching
// anything. Only absent containers are synthesized; scalars are never coerced.
function destination(state, reference, source, depth) {
   var value= reference.tree.value, absent= reference.tree.deleted, i, j, same, key;
   state.inputPath= make(state, true);
   charge(state, reference.keys.length);
   for (i= 0; i < reference.keys.length; i++) {
      same= source && source.tree === reference.tree && source.keys.length === i;
      if (same) {
         charge(state, i);
         for (j= 0; j < i; j++)
            if (source.keys[j] !== reference.keys[j])
               same= false;
      }
      if (absent || same)
         value= make(state, typeof reference.keys[i] !== "string");
      charge(state, 1, 0, 0, depth + i);
      key= selector(state, value, reference.keys[i], i === reference.keys.length - 1? 2 : true);
      reference.keys[i]= key;
      state.inputPath.push(key);
      absent= !present(state, value, key);
      value= get(value, key);
   }
}

function sameReference(state, a, b) {
   var i;
   if (!a || !b || a.tree !== b.tree || a.keys.length !== b.keys.length)
      return false;
   charge(state, a.keys.length);
   for (i= 0; i < a.keys.length; i++)
      if (a.keys[i] !== b.keys[i])
         return false;
   return true;
}

// Register the writable array once for end-of-MOVE rebuilding. Queued inserts
// and deleted positions belong to this instance even after it changes namespace.
function pending(state, array, mark) {
   var info= arrayInfo(state, array, true);
   if (!info.deleted) {
      info.deleted= make(state);
      info.inserts= make(state);
      info.mark= mark;
      charge(state, 1, 8);
      state.moving.push(info);
   }
   return info;
}

function detach(state, reference, depth) {
   var result= make(state), parent, key, info, replacement, names, i;
   if (!reference.keys.length) {
      result.value= reference.tree.value;
      result.owned= reference.tree.cloned;
      reference.tree.value= null;
      reference.tree.deleted= true;
   } else {
      parent= edit(state, parentReference(state, reference), depth, false);
      key= reference.keys[reference.keys.length - 1];
      result.value= get(parent.value, key);
      result.owned= childOwnership(parent.mark, key);
      result.element= elementAt(state, parent.value, key);
      if (type(parent.value) === "array") {
         info= pending(state, parent.value, parent.mark);
         put(state, parent.value, key, null);
         put(state, info.deleted, "$" + key, true);
         if (info.split)
            info.split.items[key]= null;
      } else if (key === "__proto__" && !deleteProto) {
         // V8 0.10 cannot delete this own property. Replace the writable
         // container, preserving its other child identities and ownership map.
         replacement= make(state);
         names= keys(state, parent.value);
         charge(state, names.length);
         for (i= 0; i < names.length; i++)
            if (names[i] !== key)
               put(state, replacement, names[i], get(parent.value, names[i]));
         write(state, parentReference(state, reference), replacement, depth, parent.mark);
      } else
         delete parent.value[key];
      put(state, parent.mark, "$" + key, false);
   }
   return result;
}

function move(state, expression, scope, depth) {
   var source, target, item, parent, key, info, queue, i;
   if (expression.length % 2 !== 1)
      fail(state, "INVALID_GRAFT", "MOVE requires source/destination pairs");
   state.moving= make(state, true);
   charge(state, expression.length);
   for (i= 1; i < expression.length; i+= 2) {
      source= get(expression, i) === null? null : argument(state, expression, i, scope, depth, path, 2);
      target= get(expression, i + 1) === null? null : argument(state, expression, i + 1, scope, depth, path, 3);
      if (source) {
         state.graftPath.push(i);
         read(state, source, depth);
         state.graftPath.pop();
      }
      if (target) {
         state.graftPath.push(i + 1);
         destination(state, target, source, depth);
         state.graftPath.pop();
      }
      if (sameReference(state, source, target))
         continue;
      state.graftPath.push(i);
      if (source)
         item= detach(state, source, depth);
      else {
         item= make(state);
         item.value= null;
         item.owned= true;
      }
      state.graftPath[state.graftPath.length - 1]= i + 1;
      if (target) {
         key= target.keys[target.keys.length - 1];
         if (typeof key === "number" && !integer(key)) {
            if (state.dates && target.tree === state.tree)
               item.value= exportDates(state, item.value, depth);
            parent= edit(state, parentReference(state, target), depth, true, key);
            info= pending(state, parent.value, parent.mark);
            if (item.element && !acceptElement(state, info, item.element))
               item.element= null;
            queue= get(info.inserts, "$" + key);
            if (!queue) {
               queue= make(state, true);
               put(state, info.inserts, "$" + key, queue);
            }
            charge(state, 1, 8);
            queue.push(item);
         } else
            write(state, target, item.value, depth, item.owned, item.element);
      }
      state.graftPath.pop();
   }
   // A temporarily detached current node must be restored before returning.
   read(state, scope.node, depth);
   charge(state, state.moving.length);
   for (i= 0; i < state.moving.length; i++)
      finishMove(state, state.moving[i], depth);
   state.moving= null;
}

// Element metadata only accompanies direct references. Primitive strings need
// this parallel annotation because strings cannot carry an origin themselves.
function elementAt(state, array, key) {
   var info= type(array) === "array"? arrayInfo(state, array) : null, result;
   if (!info || !info.split || !info.split.items[key])
      return null;
   result= make(state);
   result.origin= info.split.origin;
   result.item= info.split.items[key];
   return result;
}

function referenceElement(state, reference, depth) {
   return reference.keys.length? elementAt(state,
      read(state, parentReference(state, reference), depth), reference.keys[reference.keys.length - 1]) : null;
}

function entry(state, list, value, owned, element) {
   var item= make(state);
   item.value= value;
   item.owned= owned;
   item.element= element;
   charge(state, 1, 8);
   list.push(item);
}

// Shared spans preserve child ownership; expression results instead materialize
// each value. Both paths preserve source element metadata and reject deletions.
function appendRange(state, entries, array, start, limit, depth, mark) {
   var i;
   charge(state, limit - start);
   for (i= start; i < limit; i++) {
      if (!present(state, array, i))
         fail(state, "INVALID_TARGET", "Cannot enumerate a missing or pending-deletion element");
      entry(state, entries, depth === null? get(array, i) : copy(state, get(array, i), depth + 1),
         depth === null? childOwnership(mark, i) : true, elementAt(state, array, i));
   }
}

// Fill metadata gaps in final array order. New values inherit the preceding
// left trim and separator; at the start only a following separator is inherited.
function normalizeMetadata(state, split, length) {
   var items= split.items, previous= null, item, next, i, j;
   charge(state, length);
   for (i= 0; i < length; i++) {
      item= items[i];
      if (!item) {
         next= null;
         if (!previous) {
            charge(state, length - i);
            for (j= i + 1; j < length && !next; j++)
               next= items[j];
         }
         item= make(state);
         item.left= previous? previous.left : "";
         item.right= "";
         item.sep= previous? previous.sep : next? next.sep : split.origin.separator;
         items[i]= item;
      }
      previous= item;
   }
}

function acceptElement(state, info, element) {
   if (!info.split && element) {
      info.split= make(state);
      info.split.origin= element.origin;
      info.split.items= make(state, true);
   }
   return element && info.split && element.origin === info.split.origin? element.item : null;
}

function receiveElement(state, array, key, element, inserting, mark) {
   var info= arrayInfo(state, array), split, item;
   if (!inserting || !element && (!info || !info.split))
      return;
   info= info || arrayInfo(state, array, true);
   item= acceptElement(state, info, element);
   split= info.split;
   split.items[key]= item;
   if (state.moving && mark)
      pending(state, array, mark);
   else
      normalizeMetadata(state, split, array.length);
}

// Rebuild one writable array without native splice/apply argument-count limits.
// Ownership travels with values and metadata travels with surviving elements.
function rebuild(state, array, mark, entries) {
   var info= arrayInfo(state, array), origin= null, fallback= null, split, item, i;
   charge(state, entries.length * 3, entries.length * 8);
   for (i= 0; i < entries.length; i++) {
      item= entries[i].element;
      if (item) {
         fallback= fallback || item.origin;
         if (info && info.split && item.origin === info.split.origin)
            origin= item.origin;
      }
   }
   origin= origin || fallback;
   if (origin) {
      info= info || arrayInfo(state, array, true);
      split= make(state);
      split.origin= origin;
      split.items= make(state, true);
      for (i= 0; i < entries.length; i++) {
         item= entries[i].element;
         split.items.push(item && item.origin === origin? item.item : null);
      }
      normalizeMetadata(state, split, entries.length);
      info.split= split;
   } else if (info)
      info.split= null;
   for (i= 0; i < entries.length; i++) {
      put(state, array, i, entries[i].value);
      put(state, mark, "$" + i, entries[i].owned);
   }
   array.length= entries.length;
}

function finishMove(state, info, depth) {
   var entries= make(state, true), array= info.array, queue, i, j;
   charge(state, array.length + 1, 0, 0, depth);
   for (i= 0; i <= array.length; i++) {
      queue= get(info.inserts, "$" + (i - 0.5));
      if (queue) {
         charge(state, queue.length, queue.length * 8);
         for (j= 0; j < queue.length; j++)
            entries.push(queue[j]);
      }
      if (i < array.length && !get(info.deleted, "$" + i))
         entry(state, entries, get(array, i), childOwnership(info.mark, i), elementAt(state, array, i));
   }
   info.deleted= null;
   info.inserts= null;
   rebuild(state, array, info.mark, entries);
}

function splice(state, expression, scope, depth) {
   var reference, parent, array, offset, count, replacements, entries, i;
   arity(state, expression, 3, Infinity);
   reference= argument(state, expression, 1, scope, depth, path, true);
   if (!reference.keys.length)
      fail(state, "INVALID_TARGET", "SPLICE requires an array element path");
   parent= parentReference(state, reference);
   array= read(state, parent, depth);
   if (type(array) !== "array")
      fail(state, "INVALID_TARGET", "SPLICE requires an array");
   offset= selector(state, array, reference.keys[reference.keys.length - 1], true);
   count= argument(state, expression, 2, scope, depth);
   if (count !== null && !integer(count))
      fail(state, "INVALID_OPERAND", "SPLICE count must be an integer or null");
   count= count === null? array.length - offset : count < 0? array.length + count - offset : count;
   if (count < 0 || count > array.length - offset)
      fail(state, "INVALID_TARGET", "SPLICE removal range is out of bounds");
   replacements= make(state, true);
   charge(state, expression.length);
   for (i= 3; i < expression.length; i++) {
      entries= argument(state, expression, i, scope, depth);
      if (state.dates && reference.tree === state.tree)
         entries= exportDates(state, entries, depth);
      entry(state, replacements, entries, true, state.element);
   }
   // Every replacement was captured before cloning or altering the array.
   if (!count && !replacements.length)
      return;
   parent= edit(state, parent, depth, false);
   array= parent.value;
   entries= make(state, true);
   charge(state, array.length + replacements.length, replacements.length * 8);
   appendRange(state, entries, array, 0, offset, null, parent.mark);
   for (i= 0; i < replacements.length; i++)
      entries.push(replacements[i]);
   appendRange(state, entries, array, offset + count, array.length, null, parent.mark);
   rebuild(state, array, parent.mark, entries);
}

// Construct literal objects/escaped arrays recursively. Referenced values are
// materialized, so subsequent writes cannot create aliases or cycles.
function construct(state, source, scope, depth) {
   return copy(state, source, depth, false, scope);
}

// A direct reference can carry one element's SPLIT metadata. Derived functions
// deliberately clear it; array metadata instead lives in the identity table.
function evaluate(state, expression, scope, depth, borrowed) {
   var captures= state.captures, result, id;
   // Function expressions start independent matches, including beneath a
   // capture-suppressing ANY/NONE/REP. Restore the caller even on probe errors.
   state.captures= null;
   try {
      result= evaluateValue(state, expression, scope, depth, borrowed);
   } finally {
      state.captures= captures;
   }
   id= type(expression) === "array"? get(expression, 0) : undefined;
   id= typeof id === "string"? get(expressions, id) : id;
   if (typeof id !== "number" || id < -5 || id > 0)
      state.element= null;
   return result;
}

// Internal consumers such as LENGTH and SLICE may inspect a reference without
// enumerating it. In particular LENGTH remains legal during pending deletions.
function borrow(state, expression, scope, depth) {
   return evaluate(state, expression, scope, depth, true);
}

// A temporary current node borrows its value. Expressions cannot mutate it,
// and writes to data subsequently returned by an expression still copy it.
function valueScope(state, scope, value) {
   var result= scopeCopy(state, scope);
   result.regex= null;
   result.node= make(state);
   result.node.tree= holder(state, value, false);
   result.node.keys= make(state, true);
   return result;
}

// LOCAL evaluates binding names and can rebind NODE with null. WITH accepts
// only literal string/integer TEMP names. Both assign sequentially into a
// private shallow TEMP root, leaving caller holders and nested data untouched.
function bindingScope(state, expression, scope, depth, local) {
   var result, name, value, i;
   if (expression.length < (local? 2 : 4) || expression.length % 2)
      fail(state, "INVALID_GRAFT", "Expected binding pairs and a final expression");
   result= scopeCopy(state, scope);
   result.temp= holder(state, copy(state, scope.temp.value, depth, true), true);
   charge(state, expression.length);
   for (i= 1; i < expression.length - 1; i+= 2) {
      name= local? argument(state, expression, i, result, depth) : get(expression, i);
      if (!(local && name === null) && typeof name !== "string"
            && !(local? typeof name === "number" : integer(name)))
         fail(state, local? "INVALID_OPERAND" : "INVALID_GRAFT", "Invalid lexical binding name");
      value= argument(state, expression, i + 1, result, depth);
      if (name === null)
         result= valueScope(state, result, value);
      else
         put(state, result.temp.value, String(name), value);
   }
   return result;
}

// Probe errors mean false; syntax/resource errors and application exceptions
// escape. Discard diagnostic path segments left by a failed argument walk so
// another alternative or a later action gets its own correct location.
// element bypasses regex entry when a cursor is already positioned; 2
// dispatches a successor-set probe rather than a boolean match. Inner
// function matches retain regex context, but restore the calling character.
function match(state, expression, scope, depth, mode, target, element) {
   var pathLength= state.graftPath.length, inputPath= state.inputPath;
   var regex= !element && !target && scope.regex, position= regex && regex.position, result;
   var captures= state.captures;
   try {
      if (element === 2)
         return sequenceValue(state, expression, scope, depth, mode, target);
      if (regex) {
         result= sequenceTerm(state, expression, scope, depth,
            position * 32 + 16 + (mode || 0), regex);
         sequencePosition(state, regex, position);
         return sequenceResolve(state, result, regex, 0);
      }
      result= matchValue(state, expression, scope, depth, mode || 0, target);
      if (!result) state.captures= captures;
      return result;
   } catch (error) {
      state.captures= captures;
      if (!error || error.counts !== state.counts
            || error.code !== "INVALID_TARGET" && error.code !== "INVALID_OPERAND")
         throw error;
      state.graftPath.length= pathLength;
      state.inputPath= inputPath;
      state.element= null;
      if (regex)
         sequencePosition(state, regex, position);
      return element === 2? -1 : false;
   }
}

function matchWithoutCaptures(state, expression, scope, depth, mode) {
   var captures= state.captures;
   state.captures= null;
   try {
      return match(state, expression, scope, depth, mode);
   } finally {
      state.captures= captures;
   }
}

// Observable matches keep immutable annotation chains. Alternatives can share
// prefixes, while failed probes simply restore the previous chain. Functions
// and actions start new chains; only their resulting capture objects escape.
function captureMatch(state, expression, scope, depth) {
   var previous= state.captures, trace= make(state), result, event;
   trace.root= scope.node;
   trace.count= 0;
   state.captures= trace;
   try {
      if (!match(state, expression, scope, depth)) return false;
      result= make(state);
      for (trace= state.captures; trace.previous; trace= trace.previous) {
         charge(state, 1);
         event= trace.event;
         if (event.name !== undefined && event.name !== null)
            put(state, result, event.name, event.range);
      }
      return result;
   } finally {
      state.captures= previous;
   }
}

// Append one rank/capture, enforcing name uniqueness against the entire match.
function captureAppend(state, trace, event) {
   var previous= trace, result;
   if (event.name !== undefined && event.name !== null) {
      property(state, event.name);
      while (previous.previous) {
         charge(state, 1);
         if (previous.event.name === event.name)
            fail(state, "INVALID_OPERAND", "Duplicate capture name");
         previous= previous.previous;
      }
   }
   result= make(state);
   result.previous= trace;
   result.event= event;
   result.root= trace.root;
   result.count= trace.count + (event.name !== undefined && event.name !== null? 1 : 0);
   return result;
}

// Ranks for deeper arrays have already been resolved. At this array compare
// all named-group lengths first, then starts, then substructure placements.
function captureRanks(state, trace, cursor, groups) {
   var result= make(state, true), event;
   while (trace && trace.previous) {
      charge(state, 1);
      event= trace.event;
      if (event.cursor === cursor && (event.group !== undefined) === groups) {
         charge(state, 0, 8);
         result.push(event);
      }
      trace= trace.previous;
   }
   return result;
}

function captureBetter(state, left, right, cursor) {
   var a, b, i, pass, x, y;
   if (!left || left === right) return false;
   if (!right) return true;
   for (pass= 0; pass < 3; pass++) {
      a= captureRanks(state, left, cursor, pass < 2);
      b= captureRanks(state, right, cursor, pass < 2);
      charge(state, a.length + b.length);
      for (i= 1; i <= a.length && i <= b.length; i++) {
         x= a[a.length - i];
         y= b[b.length - i];
         if (!pass && x.range.len !== y.range.len)
            return x.maximum? x.range.len > y.range.len : x.range.len < y.range.len;
         if (pass && x.position !== y.position)
            return x.position < y.position;
      }
   }
   return false;
}

function sequenceTrace(positions, position, fallback) {
   var trace= typeof positions !== "number" && positions["$" + position];
   return trace && trace !== true? trace : fallback;
}

// Select a complete array match without discarding its annotations. An exact
// match accepts the boundary (including predicates on the missing end node).
function sequenceResolve(state, positions, cursor, minimum) {
   var i, position, trace, best= null, found= false;
   var count= typeof positions === "number"? 1 : positions.length;
   charge(state, count);
   for (i= 0; i < count; i++) {
      position= typeof positions === "number"? positions : positions[i];
      if (position >= minimum) {
         trace= sequenceTrace(positions, position, state.captures);
         if (!found || captureBetter(state, trace, best, cursor)) best= trace;
         found= true;
      }
   }
   if (found) state.captures= best;
   return found;
}

// A sequence cursor borrows an array location or a string index. Its element
// scope is reused; a virtual one-slot array makes end-of-string genuinely
// missing (including for EXISTS and references), without decoding an array.
function sequenceCursor(state, scope, value) {
   var cursor= make(state);
   cursor.node= scope.node;
   cursor.scope= scopeCopy(state, scope);
   cursor.scope.node= make(state);
   cursor.info= typeof value === "string"? stringInfo(state, value) : null;
   cursor.start= 0;
   cursor.length= null;
   cursor.value= cursor.info? make(state, true) : value;
   if (cursor.info)
      cursor.scope.regex= cursor;
   cursor.scope.node.tree= cursor.info? holder(state, cursor.value, false) : scope.node.tree;
   charge(state, scope.node.keys.length, 32 + scope.node.keys.length * 8, 1);
   cursor.scope.node.keys= cursor.info? [] : scope.node.keys.slice(0);
   cursor.scope.node.keys.push(0);
   return cursor;
}

// Position one cursor without allocating per-element scopes. Return whether
// the position is at the end; indices beyond it cannot generate successors.
function sequencePosition(state, cursor, position) {
   var offset;
   charge(state, 1);
   cursor.position= position;
   if (cursor.info) {
      offset= stringOffset(state, cursor.info, cursor.start + position);
      if (offset < cursor.info.text.length && (cursor.length === null || position < cursor.length))
         cursor.value[0]= character(cursor.info, offset);
      else if (owns(cursor.value, 0))
         delete cursor.value[0];
      return offset >= cursor.info.text.length || cursor.length !== null && position >= cursor.length;
   }
   cursor.scope.node.keys[cursor.scope.node.keys.length - 1]= position;
   return position >= cursor.value.length;
}

// String views share the original index/checkpoints, but anchors, missing-node
// probes, literals, and repetition must respect the view's logical boundaries.
function sequenceLength(state, cursor, complete) {
   if (!cursor.info) return cursor.value.length;
   if (cursor.length !== null) return cursor.length;
   if (complete && cursor.info.length === null) stringOffset(state, cursor.info, Infinity);
   return cursor.info.length;
}

// Successors use -1 for the empty set, a number for a singleton, or an
// internal array with prefixed membership keys holding true or annotations.
// Unannotated deterministic paths allocate nothing; branching sets grow once
// per distinct position, resolving annotation ties without sorting.
function sequenceAdd(state, result, position, trace, cursor) {
   var previous, key;
   trace= trace && trace.previous? trace : null;
   if (position < 0 || result === position && !trace)
      return result;
   if (result === -1 && !trace)
      return position;
   if (typeof result === "number") {
      previous= result;
      result= make(state, true);
      if (previous !== -1) result= sequenceAdd(state, result, previous);
   }
   key= "$" + position;
   charge(state, 1);
   if (!owns(result, key)) {
      charge(state, 1, 16 + key.length * 2);
      result[key]= trace || true;
      result.push(position);
   } else if (trace && captureBetter(state, trace, result[key] === true? null : result[key], cursor))
      result[key]= trace;
   return result;
}

// Merge (and optionally filter) successor sets without sharing a mutable set.
function sequenceMerge(state, result, source, minimum, maximum, cursor) {
   var i, position, count= typeof source === "number"? 1 : source.length;
   charge(state, count);
   for (i= 0; i < count; i++) {
      position= typeof source === "number"? source : source[i];
      if (position >= minimum && position <= maximum)
         result= sequenceAdd(state, result, position, sequenceTrace(source, position, null), cursor);
   }
   return result;
}

// Repetition can stop at a fixed point, including zero-width matches below a
// very large minimum. Membership makes equality independent of traversal order.
function sequenceSame(state, left, right) {
   var i;
   if (typeof left === "number" || typeof right === "number")
      return left === right;
   if (left.length !== right.length)
      return false;
   charge(state, left.length);
   for (i= 0; i < left.length; i++)
      if (!owns(right, "$" + left[i]))
         return false;
   return true;
}

// Apply one child to every frontier position. A singleton avoids allocation
// and merging altogether. argument retains the child's diagnostic location.
function sequenceApply(state, expression, key, scope, depth, options, cursor, positions) {
   var i, result= -1, captures= state.captures;
   if (typeof positions === "number")
      return positions === -1? -1 : argument(state, expression, key, scope, depth,
         sequenceTerm, positions * 32 + options, cursor);
   charge(state, positions.length);
   for (i= 0; i < positions.length; i++) {
      state.captures= sequenceTrace(positions, positions[i], captures);
      result= sequenceMerge(state, result, argument(state, expression, key, scope, depth,
         sequenceTerm, positions[i] * 32 + options, cursor), 0, Infinity, cursor);
   }
   state.captures= captures;
   return result;
}

// Use the ordinary probe-error boundary for every branch. INVALID_TARGET and
// INVALID_OPERAND eliminate only this term's successors; fatal errors escape.
function sequenceTerm(state, expression, scope, depth, options, cursor) {
   var captures= state.captures, result, trace, i;
   try {
      result= match(state, expression, scope, depth, options, cursor, 2);
      if (typeof result === "number" && result !== -1)
         result= sequenceAdd(state, -1, result, state.captures || captures, cursor);
      else if (typeof result !== "number") {
         trace= state.captures || captures;
         if (trace && trace.previous) {
            charge(state, result.length);
            for (i= 0; i < result.length; i++)
               if (result["$" + result[i]] === true) result["$" + result[i]]= trace;
         }
      }
      return result;
   } finally {
      state.captures= captures;
   }
}

// Ordinary predicates consume one element (or zero for alternate-target
// comparisons). Record where a capture-producing substructure was applied so
// equal endpoint paths resolve independently of alternative traversal order.
function sequenceElement(state, expression, scope, depth, mode, cursor, position, width) {
   var captures= state.captures, event;
   if (!match(state, expression, scope, depth, mode, null, true)) return -1;
   if (captures && state.captures.count > captures.count) {
      event= make(state);
      event.cursor= cursor;
      event.position= position;
      state.captures= captureAppend(state, state.captures, event);
   }
   return position + width;
}

// Generate successors for one term. options packs its starting position above
// four matching bits and the active-sequence bit, avoiding per-position objects.
function sequenceValue(state, expression, scope, depth, options, cursor) {
   var position= Math.floor(options / 32), mode= options & 15, kind= type(expression);
   var id= null, next, offset, end, info, i, result, minimum, maximum, count, frontier, branches;
   var captures= state.captures;
   charge(state, 1, 0, 0, depth);
   end= sequencePosition(state, cursor, position);
   scope= cursor.scope;
   offset= sequenceLength(state, cursor);
   if (offset !== null && position > offset)
      return -1;
   if (!(mode & 2)) {
      id= kind === "array" && !(expression.length === 1 && type(get(expression, 0)) === "array")
         ? operation(state, expression, expressions) : null;
      if (id === -5)
         return sequenceTerm(state, macro(state, expression, scope, depth), scope, depth + 1,
            position * 32 + (mode | 4) + (options & 16), cursor);
      if (id === 12) {
         next= bindingScope(state, expression, scope, depth, false);
         cursor.scope= next;
         try {
            return argument(state, expression, expression.length - 1, next, depth, sequenceTerm,
               position * 32 + (mode & 1) + (options & 16), cursor);
         } finally {
            cursor.scope= scope;
         }
      }
      if (id >= 13 && id <= 15) {
         arity(state, expression, id === 13? 1 : 2, Infinity);
         if (id !== 13 && options & 16)
            fail(state, "INVALID_GRAFT", "Named sequences require an array specification root");
         result= sequenceTerms(state, expression, scope, depth,
            position * 32 + 16 + (mode & 1), cursor, id === 13? 1 : 2);
         return id === 13 || !captures? result
            : sequenceCapture(state, result, cursor, position);
      }
      if (!(options & 16))
         return sequenceElement(state, expression, scope, depth, mode, cursor, position, 1);
      options= 16 + (mode & 1);
      if (id >= 3 && id <= 5) {
         arity(state, expression, id === 3? 1 : 2, Infinity);
         result= -1;
         minimum= 0;
         if (id !== 5) state.captures= null;
         branches= id === 5 && captures? make(state, true) : null;
         charge(state, expression.length);
         for (i= 1; i < expression.length; i++) {
            next= argument(state, expression, i, scope, depth, sequenceTerm,
               position * 32 + options, cursor);
            if (branches) {
               charge(state, 0, 8);
               branches.push(next);
            }
            if (id === 3 && next !== -1 || id === 5 && next === -1)
               return -1;
            if (id === 5) {
               offset= typeof next === "number"? next : Infinity;
               if (typeof next !== "number") {
                  charge(state, next.length);
                  for (count= 0; count < next.length; count++)
                     offset= Math.min(offset, next[count]);
               }
               minimum= Math.max(minimum, offset);
            }
            result= sequenceMerge(state, result, next, 0, Infinity, cursor);
         }
         result= id === 3? position : id === 4? result
            : sequenceMerge(state, -1, result, minimum, Infinity, cursor);
         return branches && result !== -1? sequenceAll(state, result, branches, captures, cursor) : result;
      }
      if (id === 16) {
         arity(state, expression, 4, 4);
         minimum= argument(state, expression, 1, scope, depth, borrow);
         maximum= argument(state, expression, 2, scope, depth, borrow);
         if (!integer(minimum) || minimum < 0 || !integer(maximum) || maximum < -1
               || maximum > 0 && maximum < minimum)
            fail(state, "INVALID_OPERAND", "Invalid repetition bounds");
         maximum= maximum === -1? Infinity : maximum || minimum;
         state.captures= null;
         end= sequenceLength(state, cursor, true);
         result= minimum === 0? position : -1;
         frontier= position;
         count= 0;
         while (frontier !== -1 && count < maximum) {
            charge(state, 1);
            next= sequenceMerge(state, -1, sequenceApply(state, expression, 3,
               scope, depth, options, cursor, frontier), 0, end);
            count++;
            if (sequenceSame(state, frontier, next))
               return sequenceMerge(state, result, next, 0, end);
            if (count >= minimum)
               result= sequenceMerge(state, result, next, 0, end);
            frontier= next;
         }
         return result;
      }
      // A virtual string element exists exactly before the boundary; probing
      // it needs no path walk or per-character diagnostic array.
      if (id === 17 || id === 18 || cursor.info && id === 6) {
         arity(state, expression, 1, 1);
         return id === 6? end? -1 : position + 1
            : (id === 17? position === 0 : end)? position : -1;
      }
      // A one-argument comparison probes with the current sequence context but
      // consumes exactly one element. Alternate-target comparisons are assertions.
      if (id === 1 || id === 2) {
         arity(state, expression, 2, 3);
         if (expression.length === 2) {
            result= argument(state, expression, 1, scope, depth, sequenceTerm,
               position * 32 + 16 + (id === 2? 1 : 0), cursor);
            return sequenceResolve(state, result, cursor, 0)? position + 1 : -1;
         }
         return sequenceElement(state, expression, scope, depth, mode, cursor, position, 0);
      }
      if (cursor.info && (id === null || id < 1 || id > 18 || mode & 4 && (id < 6 || id > 12))) {
         if (id !== null || mode & 4) {
            expression= borrow(state, expression, scope, depth + 1);
            kind= type(expression);
         }
         id= null;
      }
   }
   if (cursor.info && (mode & 2 || id === null)) {
      if (kind === "string") {
         offset= stringOffset(state, cursor.info, cursor.start + position);
         next= offset + expression.length;
         charge(state, expression.length + 1);
         if (stringSlice.call(cursor.info.text, offset, next) !== expression
               || !stringBoundary(cursor.info.text, next, !!cursor.info.checkpoints))
            return -1;
         info= stringInfo(state, expression);
         stringOffset(state, info, Infinity);
         if (cursor.length !== null && position + info.length > cursor.length) return -1;
         return position + info.length;
      }
      return !end && kind === "number" && expression === cursor.value[0]? position + 1 : -1;
   }
   return sequenceElement(state, expression, scope, depth, mode, cursor, position, 1);
}

// Evaluate root sequence names from start before matching, with NODE missing.
// Suppressed/boolean matches never evaluate names or allocate descriptors.
function sequenceGroups(state, expression, scope, depth, start) {
   var i, term, id, level, groups= null, local, group, name;
   charge(state, expression.length);
   for (i= start || 0; i < expression.length; i++) {
      term= get(expression, i);
      level= depth;
      do {
         charge(state, 1, 0, 0, ++level);
         id= type(term) === "array" && !(term.length === 1 && type(get(term, 0)) === "array")
            ? operation(state, term, expressions) : null;
         if (id === -5) term= macro(state, term, scope, level);
      } while (id === -5);
      if (id === 14 || id === 15) {
         arity(state, term, 2, Infinity);
         if (!groups) {
            groups= make(state);
            local= valueScope(state, scope, make(state));
            local.node.keys.push(0);
         }
         state.graftPath.push(i);
         name= argument(state, term, 1, local, level, borrow);
         state.graftPath.pop();
         if (name !== null && typeof name !== "string" && !integer(name))
            fail(state, "INVALID_OPERAND", "Invalid capture name");
         group= make(state);
         group.name= name === null? null : String(name);
         group.maximum= id === 14;
         groups["$" + i]= group;
      }
   }
   return groups;
}

// Annotate every endpoint of a root named sequence, retaining inner captures.
function sequenceCapture(state, positions, cursor, start) {
   var count= typeof positions === "number"? 1 : positions.length, i, end, event, range, trace;
   var group= cursor.groups["$" + cursor.group], result= -1, root= state.captures.root;
   charge(state, count);
   for (i= 0; i < count; i++) {
      end= typeof positions === "number"? positions : positions[i];
      if (end < 0) continue;
      event= make(state);
      event.cursor= cursor;
      event.group= cursor.group;
      event.name= group.name;
      event.maximum= group.maximum;
      event.position= start;
      range= event.range= make(state);
      charge(state, cursor.node.keys.length, cursor.node.keys.length * 8 + 32, 1);
      range.path= cursor.node.keys.slice(cursor.node.tree === root.tree? root.keys.length : 0);
      range.ofs= start;
      range.len= end - start;
      range.lim= end;
      trace= captureAppend(state, sequenceTrace(positions, end, state.captures), event);
      result= sequenceAdd(state, result, end, trace, cursor);
   }
   return result;
}

// ALL chooses each argument's nearest endpoint at or before the output. Its
// independently resolved annotation suffixes are then merged onto one prefix.
function sequenceAll(state, positions, branches, prefix, cursor) {
   var result= -1, count= typeof positions === "number"? 1 : positions.length;
   var i, j, k, end, source, nearest, position, trace, merged, events, length;
   charge(state, count);
   for (i= 0; i < count; i++) {
      end= typeof positions === "number"? positions : positions[i];
      merged= prefix;
      charge(state, branches.length);
      for (j= 0; j < branches.length; j++) {
         source= branches[j];
         nearest= -1;
         length= typeof source === "number"? 1 : source.length;
         charge(state, length);
         for (k= 0; k < length; k++) {
            position= typeof source === "number"? source : source[k];
            if (position <= end && position > nearest) nearest= position;
         }
         trace= sequenceTrace(source, nearest, prefix);
         events= make(state, true);
         while (trace !== prefix) {
            charge(state, 1, 8);
            events.push(trace.event);
            trace= trace.previous;
         }
         charge(state, events.length);
         for (k= events.length - 1; k >= 0; k--)
            merged= captureAppend(state, merged, events[k]);
      }
      result= sequenceAdd(state, result, end, merged, cursor);
   }
   return result;
}

// Compose consecutive terms over their frontier sets. Structural arrays start
// at element zero; SEQ skips its opcode. Duplicate paths collapse by position.
// ARRAY skips two operands and explicitly marks a fresh capture-group root.
function sequenceTerms(state, expression, scope, depth, options, cursor, start, root) {
   var i, positions= Math.floor(options / 32), mode= options & 31;
   root= root || !start;
   if (root && state.captures && !(mode & 2))
      cursor.groups= sequenceGroups(state, expression, scope, depth, start);
   charge(state, expression.length);
   for (i= start; i < expression.length && positions !== -1; i++) {
      if (root) cursor.group= i;
      positions= sequenceApply(state, expression, i, scope, depth, mode, cursor, positions);
   }
   return positions;
}

// ARRAY has already borrowed an array target and has at least one operand.
// Reuse its cursor without constructing skipped EXISTS terms or slicing data.
// Prefix/suffix presence checks preserve the equivalent escaped-array behavior
// during pending MOVE deletions; matched terms may explicitly probe such holes.
function arrayMatch(state, expression, scope, depth, mode, value) {
   var offset= argument(state, expression, 1, scope, depth, borrow), minimum= 0, cursor, i;
   if (!integer(offset))
      fail(state, "INVALID_OPERAND", "ARRAY requires an integer length or offset");
   if (expression.length === 2)
      return mode & 1? value.length === offset : value.length >= offset;
   offset= offset < 0? value.length + offset : offset;
   if (offset < 0 || offset > value.length)
      return false;
   charge(state, offset);
   for (i= 0; i < offset; i++)
      if (!present(state, value, i)) return false;
   if (mode & 1) {
      charge(state, value.length - offset);
      for (minimum= value.length; minimum > offset && present(state, value, minimum - 1); minimum--) {}
   }
   cursor= sequenceCursor(state, scope, value);
   i= sequenceTerms(state, expression, scope, depth,
      offset * 32 + (mode & 1), cursor, 2, true);
   return sequenceResolve(state, i, cursor, minimum);
}

// NUM has borrowed a numeric target. Null/absent bounds omit comparisons;
// all supplied bounds are checked before comparing, including reversed ranges.
function numberMatch(state, expression, scope, depth, value) {
   var minimum= expression.length > 1? argument(state, expression, 1, scope, depth, borrow) : null;
   var maximum= expression.length > 2? argument(state, expression, 2, scope, depth, borrow) : null;
   if (minimum !== null && (typeof minimum !== "number" || !isFinite(minimum))
         || maximum !== null && (typeof maximum !== "number" || !isFinite(maximum))
         || minimum !== null && maximum !== null && minimum > maximum)
      fail(state, "INVALID_OPERAND", "NUM requires ordered finite numeric bounds or null");
   return (minimum === null || value >= minimum) && (maximum === null || value <= maximum);
}

// mode bits: 1 = exact, 2 = already-evaluated literal, 4 = EXPR definition
// with value-construction semantics unless rooted in a match expression.
// Bit 8 unwraps one escaped array while retaining syntax in its children.
// target delays rebinding NODE until after a direct function/reference (or
// constructing definition) has been evaluated in the original scope.
function matchValue(state, expression, scope, depth, mode, target) {
   var kind= type(expression), id, value, local, names, key, i, result;
   charge(state, 1, 0, 0, depth);
   if (!(mode & 10)) {
      id= kind === "array" && !(expression.length === 1 && type(get(expression, 0)) === "array")
         ? operation(state, expression, expressions) : null;
      if (id === -5)
         return match(state, macro(state, expression, scope, depth), scope, depth + 1, mode | 4, target);
      if (id === 12) {
         local= bindingScope(state, expression, target || scope, depth, false);
         return argument(state, expression, expression.length - 1, local, depth, match, mode & 1);
      }
      if (id === 11) {
         arity(state, expression, 1, 1);
         scope= target || scope;
         castDate(state, read(state, scope.node, depth));
         return true;
      }
      if (id >= 7 && id <= 10) {
         arity(state, expression, 1, id === 7? Infinity : id === 8? 2 : id === 9? 3 : 1);
         scope= target || scope;
         value= read(state, scope.node, depth);
         if (type(value) !== (id === 7? "array" : id === 8? "string" : id === 9? "number" : "boolean"))
            return false;
         if (expression.length === 1)
            return true;
         if (id === 7)
            return arrayMatch(state, expression, scope, depth, mode, value);
         if (id === 9)
            return numberMatch(state, expression, scope, depth, value);
         local= sequenceCursor(state, scope, value);
         i= 0;
         do {
            result= argument(state, expression, 1, scope, depth, sequenceTerm, i * 32 + 16 + (mode & 1), local);
            if (sequenceResolve(state, result, local, 0))
               return true;
         } while (!sequencePosition(state, local, i++));
         return false;
      }
      if (id === 17 || id === 18) {
         arity(state, expression, 1, 1);
         scope= target || scope;
         i= scope.node.keys.length - 1;
         if (i < 0)
            return false;
         local= parentReference(state, scope.node);
         value= read(state, local, depth);
         return type(value) === "array" && scope.node.keys[i] === (id === 17? 0 : value.length);
      }
      if (id !== null && id >= 1 && id <= 6) {
         scope= target || scope;
         if (id <= 2) {
            arity(state, expression, 2, 3);
            local= expression.length === 3? valueScope(state, scope,
               argument(state, expression, 1, scope, depth, borrow)) : scope;
            return argument(state, expression, expression.length - 1, scope, depth, match,
               id === 2? 1 : 0, local);
         }
         if (id === 6) {
            arity(state, expression, 1, 1);
            read(state, scope.node, depth);
            return true;
         }
         arity(state, expression, id === 3? 1 : 2, Infinity);
         charge(state, expression.length);
         for (i= 1; i < expression.length; i++) {
            result= argument(state, expression, i, scope, depth,
               id === 5? match : matchWithoutCaptures, mode & 1);
            if (result !== (id === 5))
               return id === 4;
         }
         return id !== 4;
      }
      if (id !== null || mode & 4) {
         expression= borrow(state, expression, scope, depth + 1);
         kind= type(expression);
         mode= mode & 1 | 2;
      } else if (kind === "array") {
         // An escaped array adds a structural level to diagnostics/depth.
         return argument(state, expression, 0, target || scope, depth, match, mode | 8);
      }
   }
   scope= target || scope;
   value= read(state, scope.node, depth);
   if (kind !== type(value))
      return false;
   if (kind !== "array" && kind !== "object") {
      charge(state, kind === "string"? (expression.length + value.length) * 0.001 : 1);
      return kind === "date"? dateEqual(state, expression, value, depth) : expression === value;
   }
   if (kind === "array") {
      local= sequenceCursor(state, scope, value);
      i= sequenceTerms(state, expression, scope, depth, mode & 3, local, 0);
      return sequenceResolve(state, i, local, mode & 1? value.length : 0);
   }
   names= keys(state, expression);
   if (mode & 1) {
      local= keys(state, value);
      charge(state, local.length);
      for (i= 0; i < local.length; i++)
         if (!owns(expression, local[i]))
            return false;
   }
   local= scopeCopy(state, scope);
   local.node= make(state);
   local.node.tree= scope.node.tree;
   charge(state, scope.node.keys.length, 32 + scope.node.keys.length * 8, 1);
   local.node.keys= scope.node.keys.slice(0);
   charge(state, names.length, 8);
   for (i= 0; i < names.length; i++) {
      key= names[i];
      local.node.keys.push(key);
      // Bit 4 accompanies only this EXPR root; literal children retain bit 2.
      result= argument(state, expression, key, local, depth, match, mode & 3);
      local.node.keys.pop();
      if (!result)
         return false;
   }
   return true;
}

// CASTSTR numbers use JSON's fractional spelling but decimal integer digits.
// Expand positive exponents without multiplying/rounding the stored number.
function scalarString(state, value) {
   var text, exponent, point;
   charge(state, 1, 64);
   text= integer(value) || !isFinite(value)? String(value) : JSON.stringify(value);
   exponent= text.indexOf("e");
   if (integer(value) && exponent !== -1) {
      exponent= Number(stringSlice.call(text, exponent + 1));
      text= stringSlice.call(text, 0, text.indexOf("e"));
      point= text.indexOf(".");
      if (point !== -1) {
         exponent-= text.length - point - 1;
         text= stringSlice.call(text, 0, point) + stringSlice.call(text, point + 1);
      }
      charge(state, exponent + text.length, exponent * 12 + text.length * 2 + 32, 1);
      text+= new Array(exponent + 1).join("0");
   }
   return text;
}

// Cast a borrowed scalar without consulting user coercion methods. Date JSON
// encoding receives a fresh native Date so input toJSON/valueOf are ignored.
function cast(state, id, value, depth) {
   var kind= type(value), text, year;
   if (id === 68) {
      if (kind === "boolean") return value;
      if (kind === "string") charge(state, value.length * 0.001);
      if (value === 0 || value === 1 || value === "true" || value === "false")
         return value === 1 || value === "true";
   } else if (id === 69) {
      if (kind === "number") return value;
      if (kind === "string") {
         charge(state, value.length * 3);
         if (regexpTest.call(jsonNumber, value)) {
            text= Number(value);
            if (!isFinite(text) || text === 0 && regexpTest.call(nonzeroMantissa, value))
               fail(state, "UNSUPPORTED_GRAFT", "Number is outside the host numeric range");
            return text;
         }
      }
   } else {
      if (kind === "string") return value;
      if (kind === "boolean") return value? "true" : "false";
      if (kind === "number") return scalarString(state, value);
      if (value instanceof DateValue) return dateString(state, value);
      if (kind === "date" && isFinite(dateTime.call(value))) {
         charge(state, 1, 128);
         year= dateYear.call(value);
         text= stringSlice.call(JSON.stringify(copy(state, value, depth)), 1, -1);
         // Old JSON/ISO encoders omit the sign and six-digit padding on years
         // outside 0000..9999. Native Date years always fit six digits.
         if (year < 0 || year > 9999) {
            charge(state, 1, 64);
            text= (year < 0? "-" : "+") + stringSlice.call("000000" + Math.abs(year), -6)
               + stringSlice.call(text, text.indexOf("-", year < 0? 1 : 0));
         }
         return text;
      }
   }
   fail(state, "INVALID_TARGET", "Cannot cast this value");
}

function evaluateValue(state, expression, scope, depth, borrowed) {
   var kind= type(expression), id, value, local, i, reference;
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
      return evaluate(state, macro(state, expression, scope, depth), scope, depth + 1, borrowed);
   if (id >= -4 && id <= 0) {
      reference= path(state, expression, scope, depth);
      value= read(state, reference, depth);
      value= borrowed? value : copy(state, value, depth);
      state.element= referenceElement(state, reference, depth);
      return value;
   }
   if (id >= 1 && id <= 12 || id === 17 || id === 18)
      return match(state, expression, scope, depth);
   if (id === 50) {
      arity(state, expression, 2, 2);
      return argument(state, expression, 1, scope, depth, captureMatch);
   }
   if (id === 52) {
      arity(state, expression, 2, Infinity);
      charge(state, expression.length);
      for (i= 1; i < expression.length; i++) {
         value= argument(state, expression, i, scope, depth, borrow);
         if (typeof value !== "boolean")
            fail(state, "INVALID_TARGET", "NOT requires boolean arguments");
         if (value)
            return false;
      }
      return true;
   }
   if (id === 55 || id >= 68 && id <= 71) {
      arity(state, expression, 1, 2);
      value= expression.length === 1? read(state, scope.node, depth)
         : argument(state, expression, 1, scope, depth, borrow);
      return id === 55? lengthOf(state, value) : id === 71? castDate(state, value) : cast(state, id, value, depth);
   }
   if (id === 57)
      return slice(state, expression, scope, depth);
   if (id === 58)
      return concat(state, expression, scope, depth);
   if (id === 65)
      return makeObject(state, expression, scope, depth);
   if (id === 62 || id === 63) {
      arity(state, expression, 2, 3);
      local= argument(state, expression, 1, scope, depth, splitConfig);
      value= expression.length === 2? read(state, scope.node, depth)
         : argument(state, expression, 2, scope, depth, borrow);
      return id === 62? splitString(state, value, local, depth) : joinArray(state, value, local);
   }
   if (id === 67) {
      arity(state, expression, 1, 1);
      fail(state, "INVALID_TARGET", "Explicit FAIL expression");
   }
   if (id === 51) {
      local= bindingScope(state, expression, scope, depth, true);
      return argument(state, expression, expression.length - 1, local, depth);
   }
   fail(state, "INVALID_GRAFT", "Unsupported value expression");
}

// Decode at a UTF-16 boundary. step returns the width instead of the numeric
// codepoint; lone surrogates always remain individual codepoints. Callers
// charge the bounded reads, and retain their cursor as index/offset numbers.
function character(info, offset, step) {
   var first, second;
   if (step && !info.checkpoints)
      return 1;
   first= stringCode.call(info.text, offset);
   if (info.checkpoints && first >= 0xD800 && first <= 0xDBFF) {
      second= stringCode.call(info.text, offset + 1);
      if (second >= 0xDC00 && second <= 0xDFFF)
         return step? 2 : 0x10000 + (first - 0xD800) * 1024 + second - 0xDC00;
   }
   return step? 1 : first;
}

// Keep immutable strings and small indexes per application. The fixed two-unit
// regex has no unbounded backtracking; charge its full linear scan beforehand.
// Strings without pairs need neither checkpoints nor per-character decoding.
function stringInfo(state, text) {
   var list= state.strings || (state.strings= make(state, true)), info, i;
   charge(state, list.length);
   for (i= 0; i < list.length; i++) {
      charge(state, (list[i].text.length + text.length) * 0.001);
      if (list[i].text === text)
         return list[i];
   }
   charge(state, text.length, 80);
   info= make(state);
   info.text= text;
   info.checkpoints= regexpTest.call(surrogatePair, text)? make(state, true) : null;
   info.length= info.checkpoints? null : text.length;
   info.index= info.offset= 0;
   if (info.checkpoints) {
      charge(state, 1, 8);
      info.checkpoints.push(0);
   }
   charge(state, 1, 8);
   list.push(info);
   return info;
}

// Map a nonnegative codepoint index to UTF-16, or seek Infinity to count the
// whole string. Reuse a forward cursor or begin at the nearest checkpoint.
// Checkpoints are built lazily every 256 codepoints; no character array is made.
// A seek beyond the end stops there and records the actual codepoint length.
function stringOffset(state, info, index) {
   var points= info.checkpoints, block, position, offset, count, i;
   if (!points)
      return index === Infinity? info.length : index;
   block= Math.min(Math.floor(index / 256), points.length - 1);
   position= block * 256;
   offset= points[block];
   if (info.index <= index && info.index >= position) {
      position= info.index;
      offset= info.offset;
   }
   while (position < index && offset < info.text.length) {
      count= Math.min(256 - position % 256, index - position, info.text.length - offset);
      charge(state, count * 2);
      for (i= 0; i < count && offset < info.text.length; i++) {
         offset+= character(info, offset, true);
         position++;
      }
      if (position % 256 === 0 && position / 256 === points.length) {
         charge(state, 1, 8);
         points.push(offset);
      }
   }
   info.index= position;
   info.offset= offset;
   if (offset === info.text.length)
      info.length= position;
   return offset;
}

// Literal matches must start and end at codepoint boundaries. paired may be
// inherited from a larger string; false means no surrogate checks are needed.
function stringBoundary(text, offset, paired) {
   var first, second;
   if (!paired || offset === 0 || offset === text.length)
      return true;
   first= stringCode.call(text, offset - 1);
   second= stringCode.call(text, offset);
   return !(first >= 0xD800 && first <= 0xDBFF && second >= 0xDC00 && second <= 0xDFFF);
}

function lengthOf(state, value) {
   var info;
   if (type(value) !== "array" && type(value) !== "string")
      fail(state, "INVALID_TARGET", "Expected an array or string");
   if (typeof value !== "string")
      return value.length;
   info= stringInfo(state, value);
   if (info.length === null)
      stringOffset(state, info, Infinity);
   return info.length;
}

// SLICE reads only its selected span, so pending deletions outside that span do
// not invalidate it. Returned elements are independent materialized values.
function slice(state, expression, scope, depth) {
   var value, offset, count, limit, config, names, reference, result, entries, i, kind, total, info;
   arity(state, expression, 2, 4);
   value= argument(state, expression, 1, scope, depth, borrow);
   if (expression.length === 2 && type(value) === "object") {
      config= value;
      if (owns(config, "path")) {
         if (type(get(config, "path")) !== "array")
            fail(state, "INVALID_OPERAND", "SLICE path must be an array");
         charge(state, 1, 80, 2);
         reference= path(state, ["NODE", [get(config, "path")]], scope, depth);
         value= read(state, reference, depth);
      } else
         value= read(state, scope.node, depth);
      total= lengthOf(state, value);
      offset= get(config, "ofs");
      count= get(config, "len");
      limit= get(config, "lim");
      names= [offset, count, limit];
      charge(state, 3, 56, 1);
      for (i= 0; i < names.length; i++)
         if (names[i] !== undefined && (!integer(names[i]) || names[i] < 0))
            fail(state, "INVALID_OPERAND", "Invalid SLICE range");
      if (offset === undefined)
         offset= count !== undefined && limit !== undefined? limit - count : 0;
      if (limit === undefined)
         limit= count !== undefined? offset + count : total;
      if (count !== undefined && offset + count !== limit)
         fail(state, "INVALID_OPERAND", "Inconsistent SLICE range");
   } else {
      total= lengthOf(state, value);
      arity(state, expression, 3, 4);
      offset= argument(state, expression, 2, scope, depth);
      count= expression.length === 4? argument(state, expression, 3, scope, depth) : undefined;
      if (!integer(offset) || count !== undefined && !integer(count))
         fail(state, "INVALID_OPERAND", "SLICE requires integer offsets/counts");
      offset= offset < 0? total + offset : offset;
      limit= count === undefined? total : count < 0? total + count : offset + count;
   }
   kind= type(value);
   if (offset < 0 || offset > limit || limit > total)
      fail(state, "INVALID_TARGET", "SLICE range is out of bounds");
   if (kind === "string") {
      info= stringInfo(state, value);
      offset= stringOffset(state, info, offset);
      limit= stringOffset(state, info, limit);
      charge(state, limit - offset, (limit - offset) * 2);
      return stringSlice.call(value, offset, limit);
   }
   charge(state, limit - offset, (limit - offset) * 8);
   result= make(state, true);
   entries= make(state, true);
   appendRange(state, entries, value, offset, limit, depth);
   rebuild(state, result, make(state), entries);
   return result;
}

function concat(state, expression, scope, depth) {
   var result, value, kind, entries= make(state, true), i;
   arity(state, expression, 2, Infinity);
   charge(state, expression.length);
   for (i= 1; i < expression.length; i++) {
      value= argument(state, expression, i, scope, depth, borrow);
      if (i === 1) {
         kind= type(value);
         result= kind === "array"? make(state, true) : "";
      }
      if (type(value) !== kind || kind !== "array" && kind !== "string")
         fail(state, "INVALID_TARGET", "CONCAT requires matching arrays or strings");
      if (kind === "string") {
         charge(state, result.length + value.length, (result.length + value.length) * 2);
         result+= value;
      } else {
         charge(state, value.length);
         appendRange(state, entries, value, 0, value.length, depth);
      }
   }
   if (kind === "array")
      rebuild(state, result, make(state), entries);
   return result;
}

// Materialize operands once in caller scope, then select alternating pairs,
// parallel arrays, or a pair list by their evaluated shapes. All values are
// independently owned; only string, unique own keys reach the safe writer.
function makeObject(state, expression, scope, depth) {
   var values= make(state, true), result= make(state), names, pairs, pair, name, value, count, i;
   charge(state, expression.length, expression.length * 8);
   for (i= 1; i < expression.length; i++)
      values.push(argument(state, expression, i, scope, depth));
   count= values.length;
   if (count === 1 && type(values[0]) === "array") {
      pairs= values[0];
      count= pairs.length;
   } else if (count === 2 && type(values[0]) === "array") {
      names= values[0];
      values= values[1];
      if (type(values) !== "array" || names.length !== values.length)
         fail(state, "INVALID_TARGET", "MKOBJ requires equally sized name and value arrays");
      count= names.length;
   } else {
      if (!count || count % 2)
         fail(state, "INVALID_TARGET", "MKOBJ requires name/value pairs");
      count/= 2;
   }
   charge(state, count);
   for (i= 0; i < count; i++) {
      pair= pairs? get(pairs, i) : null;
      if (pairs && (type(pair) !== "array" || pair.length !== 2))
         fail(state, "INVALID_TARGET", "MKOBJ property entries must be two-element arrays");
      name= pairs? get(pair, 0) : get(names || values, names? i : i * 2);
      value= pairs? get(pair, 1) : get(values, names? i : i * 2 + 1);
      if (typeof name !== "string" || owns(result, name))
         fail(state, "INVALID_TARGET", "MKOBJ requires unique string property names");
      put(state, result, name, value);
   }
   return result;
}

// Classify a pattern before evaluation: match roots retain regex syntax;
// function/reference roots resolve once to literal strings in the caller scope.
// Save the physical graft location for errors raised during deferred matching.
function splitPattern(state, source, scope, depth) {
   var result= make(state), expression= source, id= null;
   while (type(expression) === "array") {
      charge(state, 1, 0, 0, depth);
      id= expression.length === 1 && type(get(expression, 0)) === "array"? null
         : operation(state, expression, expressions);
      if (id !== -5) break;
      expression= macro(state, expression, scope, depth++);
   }
   result.regex= id !== null && id >= 1 && id <= 18;
   result.expression= result.regex? expression : borrow(state, source, scope, depth);
   if (!result.regex && typeof result.expression !== "string")
      fail(state, "INVALID_OPERAND", "SPLIT requires string or regex patterns");
   result.depth= depth;
   charge(state, state.graftPath.length, 32 + state.graftPath.length * 8, 1);
   result.path= state.graftPath.slice(0);
   result.length= result.regex? null : lengthOf(state, result.expression);
   return result;
}

function splitConfig(state, source, scope, depth) {
   var result= make(state), names, key, i, raw, simple= type(source) !== "object";
   result.scope= scope;
   if (simple) {
      raw= make(state);
      raw.sep= source;
      source= raw;
   }
   names= keys(state, source);
   charge(state, names.length);
   for (i= 0; i < names.length; i++) {
      key= names[i];
      if (key !== "sep" && key !== "default" && key !== "trim" && key !== "ltrim"
            && key !== "rtrim" && key !== "discard" && key !== "keep" && key !== "element")
         fail(state, "INVALID_OPERAND", "Unknown SPLIT option: " + key);
   }
   if (owns(source, "trim") && (owns(source, "ltrim") || owns(source, "rtrim")))
      fail(state, "INVALID_OPERAND", "SPLIT trim conflicts with ltrim/rtrim");
   if (!owns(source, "sep"))
      fail(state, "INVALID_OPERAND", "SPLIT requires a separator");
   result.keep= get(source, "keep");
   if (owns(source, "keep") && result.keep !== "<" && result.keep !== ">" && result.keep !== "@")
      fail(state, "INVALID_OPERAND", "Invalid SPLIT keep mode");
   result.pattern= simple? splitPattern(state, get(source, "sep"), scope, depth + 1)
      : argument(state, source, "sep", scope, depth, splitPattern);
   result.variable= result.pattern.regex && !result.keep;
   if (result.variable && !owns(source, "default"))
      fail(state, "INVALID_OPERAND", "A regex SPLIT separator requires a default");
   result.separator= result.keep? "" : result.variable
      ? argument(state, source, "default", scope, depth, borrow) : result.pattern.expression;
   if (typeof result.separator !== "string")
      fail(state, "INVALID_OPERAND", "A regex SPLIT separator requires a string default");
   if (owns(source, "trim"))
      result.left= result.right= argument(state, source, "trim", scope, depth, splitPattern);
   else {
      result.left= owns(source, "ltrim")? argument(state, source, "ltrim", scope, depth, splitPattern) : null;
      result.right= owns(source, "rtrim")? argument(state, source, "rtrim", scope, depth, splitPattern) : null;
   }
   result.element= owns(source, "element")? argument(state, source, "element", scope, depth, splitPattern) : null;
   result.discard= get(source, "discard") === true;
   if (owns(source, "discard") && typeof get(source, "discard") !== "boolean")
      fail(state, "INVALID_OPERAND", "SPLIT discard must be boolean");
   return result;
}

// Return the longest consumed length, or -1. Suffix matching scans starts in
// ascending order and requires an endpoint at the view end. Literal patterns
// avoid successor allocation and still enforce both Unicode/view boundaries.
function matchPattern(state, pattern, cursor, position, ending) {
   var length, start, offset, end, positions, i, count, best= -1;
   var path= state.graftPath, captures= state.captures;
   if (!pattern) return 0;
   state.graftPath= pattern.path;
   state.captures= null;
   try {
      length= sequenceLength(state, cursor, true);
      if (!pattern.regex) {
         start= ending? length - pattern.length : position;
         if (start < position || start + pattern.length > length) return -1;
         offset= stringOffset(state, cursor.info, cursor.start + start);
         end= offset + pattern.expression.length;
         charge(state, pattern.expression.length + 4, pattern.expression.length * 2);
         return stringSlice.call(cursor.info.text, offset, end) === pattern.expression
            && stringBoundary(cursor.info.text, end, !!cursor.info.checkpoints)? pattern.length : -1;
      }
      start= position;
      do {
         charge(state, 1);
         positions= sequenceTerm(state, pattern.expression, cursor.scope, pattern.depth,
            start * 32 + 16, cursor);
         count= typeof positions === "number"? 1 : positions.length;
         charge(state, count);
         for (i= 0; i < count; i++) {
            end= typeof positions === "number"? positions : positions[i];
            if (end >= start && end <= length && (!ending || end === length))
               best= Math.max(best, end - start);
         }
         if (best >= 0 || !ending) return best;
      } while (start++ < length);
      return -1;
   } finally {
      state.graftPath= path;
      state.captures= captures;
   }
}

// A reusable view supplies anchored element/trim matching without creating an
// index or scope for each substring. Metadata distinguishes a real empty
// separator from the final remainder, which inherits its predecessor's separator.
function splitAppend(state, result, split, view, start, end, separator, config) {
   var left, right, offset, limit, item, text= view.info.text;
   view.start= start;
   view.length= end - start;
   left= Math.max(0, matchPattern(state, config.left, view, 0, false));
   view.start+= left;
   view.length-= left;
   right= Math.max(0, matchPattern(state, config.right, view, 0, true));
   offset= stringOffset(state, view.info, start + left);
   limit= stringOffset(state, view.info, end - right);
   charge(state, end - start + 1, (limit - offset) * 2 + 8);
   result.push(stringSlice.call(text, offset, limit));
   if (split) {
      item= make(state);
      offset= stringOffset(state, view.info, start);
      limit= stringOffset(state, view.info, end);
      charge(state, 1, config.discard? 0 : (limit - offset) * 2);
      item.left= config.discard? "" : stringSlice.call(text, offset, stringOffset(state, view.info, start + left));
      item.right= config.discard? "" : stringSlice.call(text, stringOffset(state, view.info, end - right), limit);
      item.sep= separator !== null? separator : split.items.length
         ? split.items[split.items.length - 1].sep : config.separator;
      charge(state, 1, 8);
      split.items.push(item);
   }
}

function splitString(state, text, config, depth) {
   var result= make(state, true), info, split, cursor, view, length, matched, sep, offset;
   var start= 0, field= 0, position= 0;
   if (typeof text !== "string")
      fail(state, "INVALID_TARGET", "SPLIT requires a string");
   cursor= sequenceCursor(state, config.scope, text);
   view= sequenceCursor(state, config.scope, text);
   length= sequenceLength(state, cursor, true);
   if (config.variable || !config.discard && (config.left || config.right)) {
      info= arrayInfo(state, result, true);
      split= info.split= make(state);
      split.origin= make(state);
      split.origin.separator= config.separator;
      split.items= make(state, true);
   }
   while (position <= length) {
      charge(state, 3, 0, 0, depth);
      matched= matchPattern(state, config.pattern, cursor, position, false);
      if (matched >= 0 && !(matched === 0 && position === start) && config.element) {
         view.start= start;
         view.length= position - start;
         if (matchPattern(state, config.element, view, 0, false) !== view.length) matched= -1;
      }
      if (matched < 0 || matched === 0 && position === start) {
         if (position !== length) {
            position++;
            continue;
         }
         // Empty input has one empty field unless its separator matches empty.
         if (start < length || !length && matched < 0)
            splitAppend(state, result, split, view, field, length, null, config);
         break;
      }
      offset= stringOffset(state, cursor.info, position);
      charge(state, matched + 1, matched * 4);
      sep= stringSlice.call(text, offset, stringOffset(state, cursor.info, position + matched));
      // A zero-width end match only flushes the final field. Its metadata
      // inherits the preceding separator, and keep must not add a new element.
      splitAppend(state, result, split, view, field,
         position + (config.keep === "<"? matched : 0), position === length? null : config.keep? "" : sep, config);
      if (config.keep === "@" && position !== length)
         splitAppend(state, result, split, view, position, position + matched, "", config);
      field= config.keep === ">"? position : position + matched;
      start= position + matched;
      if (position === length) break;
      if (matched && start === length) {
         splitAppend(state, result, split, view, field, length, null, config);
         break;
      }
      position= matched? start : position + 1;
   }
   if (info && !result.length) info.split= null;
   return result;
}

function joinArray(state, array, config) {
   var info, item, pieces= make(state, true), value, length= 0, i;
   if (type(array) !== "array")
      fail(state, "INVALID_TARGET", "JOIN requires an array");
   info= arrayInfo(state, array);
   charge(state, array.length, array.length * 32);
   for (i= 0; i < array.length; i++) {
      value= get(array, i);
      if (!present(state, array, i) || typeof value !== "string")
         fail(state, "INVALID_TARGET", "A split array must contain strings");
      item= info && info.split? info.split.items[i] : null;
      pieces.push(item && !config.discard? item.left : "", value,
         item && !config.discard? item.right : "",
         i + 1 === array.length? "" : config.variable && item? item.sep : config.separator);
   }
   charge(state, pieces.length);
   for (i= 0; i < pieces.length; i++)
      length+= pieces[i].length;
   charge(state, length, length * 2);
   return pieces.join("");
}

function splitAction(state, expression, scope, depth) {
   var config, value, i;
   arity(state, expression, 2, Infinity);
   config= argument(state, expression, 1, scope, depth, splitConfig);
   value= splitString(state, read(state, scope.node, depth), config, depth);
   write(state, scope.node, value, depth, true);
   charge(state, expression.length - 2);
   for (i= 2; i < expression.length; i++)
      argument(state, expression, i, scope, depth, action);
   value= joinArray(state, read(state, scope.node, depth), config);
   write(state, scope.node, value, depth, true);
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
   var id, scope, metadata, reference, value, element, i;
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
            && (!integer(get(metadata, "v")) || get(metadata, "v") < 1))
         fail(state, "INVALID_GRAFT", "Invalid JGraft metadata or version");
      if (get(metadata, "v") > 1)
         fail(state, "UNSUPPORTED_GRAFT", "Unsupported JGraft version");
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
   } else if (id === 1) {
      arity(state, expression, 2, Infinity);
      value= argument(state, expression, 1, scope, depth, captureMatch);
      if (value === false) {
         state.graftPath.push(1);
         location(state, scope);
         fail(state, "NO_MATCH", "Current node does not match");
      }
      scope.cap= holder(state, value, true);
      i= 2;
   } else if (id === 2) {
      charge(state, expression.length);
      for (i= 1; i + 1 < expression.length; i+= 2)
         if ((value= argument(state, expression, i, scope, depth, captureMatch)) !== false) {
            scope.cap= holder(state, value, true);
            i++;
            break;
         }
      // A final singleton is the else action and retains inherited captures.
      if (i < expression.length)
         argument(state, expression, i, scope, depth, action);
      return;
   } else if (id === 3) {
      if (expression.length % 2 !== 1)
         fail(state, "INVALID_GRAFT", "COPY requires value/path pairs");
      charge(state, expression.length);
      for (i= 1; i < expression.length; i+= 2) {
         // Finish the source before resolving a destination that may overlap it.
         value= argument(state, expression, i, scope, depth);
         element= state.element;
         state.graftPath.push(i + 1);
         reference= path(state, get(expression, i + 1), scope, depth + 1, true);
         write(state, reference, value, depth + 1, true, element);
         state.graftPath.pop();
      }
      return;
   } else if (id === 4 || id === 5) {
      (id === 4? move : splice)(state, expression, scope, depth);
      return;
   } else if (id === 6) {
      splitAction(state, expression, scope, depth);
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
