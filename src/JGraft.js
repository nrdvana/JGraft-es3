(function(global) {
"use strict";
// Shared error-code strings retain their public values after minification.
var invalidTarget= "INVALID_TARGET",
   invalidOperand= "INVALID_OPERAND",
   invalidGraft= "INVALID_GRAFT",
   unsupportedGraft= "UNSUPPORTED_GRAFT";

// All execution is synchronous. Helpers share this private attempt binding;
// apply() restores it in finally, including after reentrant host calls.
var activeState;

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
// Private numeric constants are deliberately immutable so Terser can fold
// names and exclusive bounds such as HAS - 1 back into literal digits.
var ACT_JGRAFT= -1,
   ACT_AT= 0,
   ACT_MATCH= 1,
   ACT_IF= 2,
   ACT_COPY= 3,
   ACT_MOVE= 4,
   ACT_SPLICE= 5,
   ACT_SPLIT= 6,
   ACT_LOG= 10;
var EXPR= -5,
   CAP= -4,
   TEMP= -3,
   STASH= -2,
   CONST= -1,
   NODE= 0,
   HAS= 1,
   IS= 2,
   NONE= 3,
   ANY= 4,
   ALL= 5,
   EXISTS= 6,
   ARRAY= 7,
   STR= 8,
   NUM= 9,
   BOOL= 10,
   DATE= 11,
   WITH= 12,
   SEQ= 13,
   SEQMAX= 14,
   SEQMIN= 15,
   REP= 16,
   START= 17,
   END= 18,
   CHARS= 19,
   CAPTURE= 50,
   LOCAL= 51,
   NOT= 52,
   AND= 53,
   OR= 54,
   LENGTH= 55,
   CURPROP= 56,
   SLICE= 57,
   CONCAT= 58,
   REDUCE= 59,
   FILTER= 60,
   MAP= 61,
   SPLIT= 62,
   JOIN= 63,
   PROPS= 64,
   MKOBJ= 65,
   CASE= 66,
   FAIL= 67,
   CASTBOOL= 68,
   CASTNUM= 69,
   CASTSTR= 70,
   CASTDATE= 71,
   LESS= 72,
   LESSEQ= 73,
   ADD= 74,
   SUB= 75,
   MUL= 76,
   DIV= 77,
   MOD= 78;
var TYPE_NULL= 0, TYPE_BOOLEAN= 1, TYPE_NUMBER= 2, TYPE_STRING= 3, TYPE_ARRAY= 4, TYPE_OBJECT= 5, TYPE_DATE= 6;
var actions= {JGRAFT: ACT_JGRAFT, AT: ACT_AT, MATCH: ACT_MATCH, IF: ACT_IF, COPY: ACT_COPY, MOVE: ACT_MOVE, SPLICE: ACT_SPLICE, SPLIT: ACT_SPLIT, LOG: ACT_LOG};
var expressions= {EXPR: EXPR, CAP: CAP, TEMP: TEMP, STASH: STASH, CONST: CONST, NODE: NODE,
   HAS: HAS, IS: IS, NONE: NONE, ANY: ANY, ALL: ALL, EXISTS: EXISTS, ARRAY: ARRAY, STR: STR, NUM: NUM, BOOL: BOOL, DATE: DATE, WITH: WITH,
   SEQ: SEQ, SEQMAX: SEQMAX, SEQMIN: SEQMIN,
   REP: REP, START: START, END: END, CHARS: CHARS, CAPTURE: CAPTURE,
   LOCAL: LOCAL, NOT: NOT, AND: AND, OR: OR, LENGTH: LENGTH, CURPROP: CURPROP, SLICE: SLICE, CONCAT: CONCAT,
   REDUCE: REDUCE, FILTER: FILTER, MAP: MAP, SPLIT: SPLIT, JOIN: JOIN, PROPS: PROPS, MKOBJ: MKOBJ, CASE: CASE, FAIL: FAIL,
   CASTBOOL: CASTBOOL, CASTNUM: CASTNUM, CASTSTR: CASTSTR, CASTDATE: CASTDATE, LESS: LESS, LESSEQ: LESSEQ,
   ADD: ADD, SUB: SUB, MUL: MUL, DIV: DIV, MOD: MOD};
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
   return !isNull(value) && value !== undefined && (key === "__proto__"
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

// Internal type tags: 0=null, 1=boolean, 2=number, 3=string, 4=array, 5=object, 6=date.
// Unsupported primitive categories retain their native typeof names.
// Use trusted built-ins once per object, never an input constructor or method.
function type(value) {
   var kind= typeof value;
   if (isNull(value)) return TYPE_NULL;
   if (kind !== "object")
      return kind === "boolean"? TYPE_BOOLEAN : kind === "number"? TYPE_NUMBER : kind === "string"? TYPE_STRING : kind;
   kind= objectTag.call(value);
   return kind === "[object Array]"? TYPE_ARRAY
      : value instanceof DateValue || kind === "[object Date]"? TYPE_DATE : TYPE_OBJECT;
}

// Shared predicates amortize repeated primitive and logical-array tests.
function isNull(value) {return value === null;}
function isBoolean(value) {return typeof value === "boolean";}
function isNumber(value) {return typeof value === "number";}
function isString(value) {return typeof value === "string";}
function isArray(value) {return type(value) === TYPE_ARRAY;}

function integer(value) {
   return isNumber(value) && isFinite(value) && Math.floor(value) === value;
}

// Private immutable date values retain calendar precision, leap seconds, and
// the original minute offset. They are never exposed in the target tree.
function DateValue(parts, count) {
   charge(1, 48, 1);
   this.parts= parts;
   this.count= count;
   activeState.dates= true;
}

function monthDays(year, month) {
   return month === 2? year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)? 29 : 28
      : month === 4 || month === 6 || month === 9 || month === 11? 30 : 31;
}

// Truncate decimal digits before numeric conversion, avoiding binary rounding
// of a millisecond-exact field or a carry into the next second/day.
function dateSecond(whole, fraction) {
   var removed= stringSlice.call(fraction, activeState.dateDigits);
   if (!activeState.truncateDateResolution && regexpTest.call(nonzeroMantissa, removed))
      fail(unsupportedGraft, "Date resolution would lose fractional seconds");
   return activeState.dateDigits && fraction? Number(whole + "." + stringSlice.call(fraction, 0, activeState.dateDigits)) : whole;
}

// Borrow internal values, or extract a native Date using trusted UTC methods.
// Native Dates represent timestamps; their mutability stays outside expressions.
function dateRecord(value) {
   var parts, i;
   if (value instanceof DateValue) return value;
   if (type(value) !== TYPE_DATE || !isFinite(dateTime.call(value)))
      fail(invalidTarget, "Expected a valid date");
   parts= make(true);
   charge(24, 96);
   for (i= 0; i < 6; i++) parts[i]= dateGetters[i].call(value);
   parts[1]++;
   parts[5]= Number(parts[5] + "." + datePad(dateGetters[6].call(value), 3));
   parts[6]= 0;
   return new DateValue(parts, 7);
}

function dateProperty(value, key) {
   var record= dateRecord(value), i;
   charge(record.count);
   for (i= 0; i < record.count; i++)
      if (dateFields[i] === key) return record.parts[i];
   fail(invalidTarget, "Missing virtual date property");
}

// Parse only unambiguous required forms and numeric field objects. Validation
// precedes resolution loss, so truncation cannot repair an invalid date/time.
function castDate(value) {
   var kind= type(value), parts, count= 3, matched, i, second, fraction= "", text;
   if (value instanceof DateValue) return value;
   if (kind === TYPE_DATE) {
      if (!isFinite(dateTime.call(value))) fail(invalidTarget, "Invalid native Date");
      return copy(value, 1);
   }
   parts= make(true);
   charge(7, 56);
   if (kind === TYPE_STRING) {
      charge(value.length * 5, value.length * 4 + 512, 1);
      matched= datePattern.exec(value);
      text= matched? matched[1] : "";
      if (!matched || text.length - (stringCode.call(text, 0) === 43 || stringCode.call(text, 0) === 45? 1 : 0) > 4 && !matched[2])
         fail(invalidTarget, "Invalid date string");
      parts[0]= Number(matched[1]);
      if (!isFinite(parts[0])) fail(unsupportedGraft, "Date year is outside the host numeric range");
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
               fail(invalidTarget, "Invalid timezone offset");
            parts[6]= Number(matched[11]) * 60 + Number(matched[12] || 0);
            if (matched[10] !== "+") {
               if (!parts[6]) fail(invalidTarget, "Negative zero timezone");
               parts[6]= -parts[6];
            }
         }
      }
   } else if (kind === TYPE_OBJECT) {
      for (i= 0; i < 7; i++) {
         parts[i]= owns(value, dateFields[i])? get(value, dateFields[i]) : i === 1 || i === 2? 1 : i? 0 : undefined;
         if (i >= 3 && owns(value, dateFields[i])) count= i === 6? 7 : Math.max(count, 6);
      }
   } else
      fail(invalidTarget, "Cannot infer a date from this value");
   for (i= 0; i < 7; i++) {
      if (i === 5? !isNumber(parts[i]) || !isFinite(parts[i]) : !integer(parts[i]))
         fail(invalidTarget, "Date fields must be numeric");
   }
   if (parts[1] < 1 || parts[1] > 12 || parts[2] < 1 || parts[2] > monthDays(parts[0], parts[1])
         || parts[3] < 0 || parts[3] > 23 || parts[4] < 0 || parts[4] > 59
         || parts[5] < 0 || parts[5] >= 61 || Math.abs(parts[6]) > 1439)
      fail(invalidTarget, "Date fields are out of range");
   second= Math.floor(parts[5]);
   if (kind === TYPE_OBJECT && parts[5] !== second) {
      charge(1, 64);
      // Nonzero scientific spellings here are below one millisecond.
      text= String(parts[5]);
      fraction= text.indexOf("e") !== -1? "0001" : stringSlice.call(text, text.indexOf(".") + 1);
   }
   parts[5]= dateSecond(second, fraction);
   return new DateValue(parts, count);
}

// Native Date years fit six digits; internal years can use the whole supported
// numeric range. Padding never removes digits or changes calendar fields.
function datePad(value, width) {
   var text= String(value);
   while (text.length < width) text= "0" + text;
   return text;
}

function dateString(value) {
   var parts= value.parts, year= Math.abs(parts[0]), text, second, offset= parts[6];
   charge(128, 1024);
   text= year >= 1e21? scalarString(year) : String(year);
   charge(text.length * 10, text.length * 20);
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
function dateComparable(value, depth) {
   var parts= value.parts, minute, day;
   if (value.count !== 7 || !parts[6]) return parts;
   parts= copy(parts, depth, true);
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

// Only parents containing private dates change. Such parents are owned:
// expressions copy containers, and inserting a private date into shared input
// first clones its parents. MOVE retains array identity/pending metadata here.
function exportDates(value, depth) {
   var kind= type(value), names, key, child, converted, info, queue, i, j;
   charge(1, 0, 0, depth);
   if (value instanceof DateValue) return dateString(value);
   if (kind !== TYPE_ARRAY && kind !== TYPE_OBJECT) return value;
   names= keys(value);
   charge(names.length);
   for (i= 0; i < names.length; i++) {
      key= names[i];
      child= get(value, key);
      converted= exportDates(child, depth + 1);
      if (converted !== child) put(value, key, converted);
   }
   info= kind === TYPE_ARRAY && activeState.moving? arrayInfo(value) : null;
   if (info && info.inserts) {
      names= keys(info.inserts);
      charge(names.length);
      for (i= 0; i < names.length; i++) {
         queue= get(info.inserts, names[i]);
         charge(queue.length);
         for (j= 0; j < queue.length; j++)
            queue[j].value= exportDates(queue[j].value, depth + 1);
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

// A function fallback is lazy, so explicit options never invoke host probes.
function booleanOption(config, name, fallback) {
   var value= owns(config, name)? get(config, name) : typeof fallback === "function"? fallback() : fallback;
   if (!isBoolean(value)) throw new TypeError("Invalid JGraft " + name + " option");
   return value;
}

// new JGraft(graft[, config]) takes ownership of graft and its descendants.
// Retained references must not be modified; future versions may cache analysis.
// config.limits overrides the defaults above; Infinity disables a limit.
function JGraft(graft, config) {
   var supplied= get(config, "limits"), key, value;
   this._graft= graft;
   this._limits= {};
   this.forbidProto= booleanOption(config, "forbidProto", brokenJSON);
   this._dateDigits= dateTime.call(new Date(1)) === 1? 3 : 0;
   this.truncateDateResolution= booleanOption(config, "truncateDateResolution", this._dateDigits >= 3);
   // Copy scalar limits so later changes to config cannot change this budget.
   for (key in defaults) {
      value= owns(supplied, key)? get(supplied, key) : defaults[key];
      if (!isNumber(value) || value < 0 || value !== value)
         throw new TypeError("Invalid JGraft resource limit: " + key);
      this._limits[key]= value;
   }
   this.counts= null;
   this.logs= null;
}

// Each attempt owns its counters. mem is a conservative allocation estimate,
// assuming no reclamation during the call; depth records the maximum reached.
function charge(ops, mem, objects, depth) {
   var counts= activeState.counts, key;
   // Charge before allocating/iterating; failed counts include rejected work.
   // Include the fixed work of checking all four counters.
   counts.ops+= 4 + (ops || 0);
   counts.mem+= mem || 0;
   counts.new_obj+= objects || 0;
   counts.depth= Math.max(counts.depth, depth || 0);
   for (key in defaults)
      if (counts[key] > activeState.limits[key]) {
         activeState.resource= key;
         fail("RESOURCE_LIMIT", "JGraft resource limit exceeded: " + key);
      }
}

// Diagnostics retain the partial output, which may share input subtrees.
// No tree cloning or serialization is needed while handling an error.
function fail(code, message) {
   var error= new Error(message);
   error.name= "JGraftError";
   error.code= code;
   error.graftPath= activeState.graftPath.slice(0);
   error.inputPath= activeState.inputPath.slice(0);
   error.partial= activeState.tree? activeState.tree.value : activeState.input;
   // Keep this attempt's counters even after the instance is applied again.
   error.counts= activeState.counts;
   error.logs= activeState.logs;
   error.limits= {mem: activeState.limits.mem, ops: activeState.limits.ops,
      new_obj: activeState.limits.new_obj, depth: activeState.limits.depth};
   if (activeState.resource)
      error.resource= activeState.resource;
   throw error;
}

function make(array) {
   charge(1, 32, 1);
   return array? [] : {};
}

// Called at charged property accesses/enumerations, including absent paths.
// This is a host/configuration restriction, never a malformed-graft diagnosis.
function property(key) {
   if (activeState.forbidProto && key === "__proto__")
      fail(unsupportedGraft, "Host configuration forbids __proto__ properties");
}

// Account for enumeration, including inherited keys which must be ignored.
function keys(value) {
   var result= make(true), key;
   for (key in value) {
      charge(1);
      if (owns(value, key)) {
         property(key);
         charge(0, 8 + key.length * 2);
         result.push(key);
      }
   }
   return result;
}

// Assign arbitrary own keys without invoking the legacy prototype setter.
function put(object, key, value) {
   property(key);
   charge(1 + String(key).length * 0.001,
      owns(object, key)? 0 : 16 + String(key).length * 2);
   if (key === "__proto__" && !ordinaryProto) {
      if (!defineProperty || !getDescriptor)
         fail(unsupportedGraft, "This engine cannot safely store __proto__ properties");
      charge(1, 48, 1);
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
function holder(value, cloned) {
   var result= make();
   result.value= value;
   result.cloned= cloned;
   return result;
}

function createState(instance, input) {
   var state= {input: input, limits: instance._limits, forbidProto: instance.forbidProto,
      dateDigits: instance._dateDigits, truncateDateResolution: instance.truncateDateResolution,
      counts: {mem: 0, ops: 0, new_obj: 0, depth: 0},
      graftPath: [], inputPath: [], logs: []};
   activeState= state;
   // Publish before any limit check so failed attempts expose counts and logs.
   instance.counts= state.counts;
   instance.logs= state.logs;
   charge(1, 288, 5);
   state.tree= holder(input, false);
   state.arrays= make(true);
   return state;
}

// Copy JSON/Date data without interpreting arrays as expressions. shallow is
// used only for copy-on-write parents; deep copies become wholly owned trees.
// Supplying scope instead evaluates children in value context for construction.
function copy(value, depth, shallow, scope) {
   var kind= type(value), result, names, i, key, info, target;
   charge(1, 0, 0, depth);
   if (kind === TYPE_DATE) {
      if (value instanceof DateValue) return value;
      // Dates are mutable in JavaScript, so a copied value needs its own Date.
      charge(1, 48, 1);
      result= dateTime.call(value);
      if (!activeState.dateDigits && isFinite(result) && result % 1000) {
         if (!activeState.truncateDateResolution)
            fail(unsupportedGraft, "Date resolution would lose milliseconds");
         result= Math.floor(result / 1000) * 1000;
      }
      return new Date(result);
   }
   if (kind === TYPE_ARRAY || kind === TYPE_OBJECT) {
      result= make(kind === TYPE_ARRAY);
      names= keys(value);
      charge(names.length);
      if (kind === TYPE_ARRAY) {
         // Preserve length independently of enumeration, including sparse data.
         charge(0, value.length * 8);
         result.length= value.length;
      }
      for (i= 0; i < names.length; i++) {
         key= names[i];
         if (!shallow && !present(value, key))
            fail(invalidTarget, "Cannot enumerate a pending deletion");
         put(result, key, scope? argument(value, key, scope, depth) : shallow? get(value, key)
            : copy(get(value, key), depth + 1));
         if (scope && kind === TYPE_ARRAY)
            receiveElement(result, Number(key), activeState.element, true);
      }
      if (kind === TYPE_ARRAY && !scope) {
         info= arrayInfo(value);
         if (info && info.split) {
            target= arrayInfo(result, true);
            target.split= make();
            target.split.origin= info.split.origin;
            target.split.items= copyPath(info.split.items);
         }
      }
      return result;
   }
   if (kind !== TYPE_NULL && kind !== TYPE_BOOLEAN && kind !== TYPE_STRING
         && (kind !== TYPE_NUMBER || !isFinite(value)))
      fail(invalidTarget, "Expected JSON data or a Date");
   charge(kind === TYPE_STRING? value.length * 0.001 : 0);
   return value;
}

// Visit a child while retaining its location in the graft for diagnostics.
// Optional handlers select action/path/construction contexts without wrappers.
// Matching can also supply the scope to use after operand evaluation.
function argument(source, key, scope, depth, handler, parameter, target) {
   var result;
   charge(1, 8);
   activeState.graftPath.push(key);
   result= (handler || evaluate)(get(source, key), scope, depth + 1, parameter, target);
   activeState.graftPath.pop();
   return result;
}

// Resolve names and prove integer type. Each dispatcher validates its own
// opcode set before relying on implied bounds in its decision tree.
function operation(expression, table, code) {
   var id= get(expression, 0);
   if (isString(id))
      id= get(table, id);
   if (!integer(id))
      fail(code || invalidGraft, "Unknown action or expression");
   return id;
}

function arity(expression, minimum, maximum) {
   if (expression.length < minimum || expression.length > maximum)
      fail(invalidGraft, "Invalid argument count");
}

// Return encoded syntax; the caller evaluates it in the current lexical scope.
function macro(expression, scope, depth) {
   var name;
   arity(expression, 2, 2);
   name= argument(expression, 1, scope, depth);
   if (!isString(name) && !integer(name))
      fail(invalidOperand, "Invalid common expression name");
   property(String(name));
   if (!owns(scope.expr, String(name)))
      fail(invalidTarget, "Missing common expression");
   return get(scope.expr, String(name));
}

// Copy internal diagnostic/reference paths with traversal/allocation accounting.
function copyPath(path) {
   charge(path.length, 32 + path.length * 8, 1);
   return path.slice(0);
}

// Begin evaluation at the current node. Reference walks refine this location;
// otherwise a previous pair's destination must not leak into diagnostics.
function location(scope) {
   activeState.inputPath= copyPath(scope.node.keys);
}

// Flatten path arguments once. Literal selector faults are INVALID_GRAFT;
// invalid results of computed expressions are INVALID_OPERAND.
function path(expression, scope, depth, writing) {
   var id, tree, selectors= make(true), item, expanded, i, j, code;
   location(scope);
   charge(1, 0, 0, depth);
   if (type(expression) === TYPE_OBJECT || type(expression) === TYPE_DATE)
      fail(writing >= 2 && writing <= 3? invalidTarget : invalidGraft,
         "Expected an implicit selector or reference expression");
   if (!isArray(expression)) {
      charge(1, 48, 1);
      expression= ["NODE", expression];
   }
   id= operation(expression, expressions,
      writing >= 2 && writing <= 3? invalidTarget : invalidGraft);
   if (id === EXPR)
      return path(macro(expression, scope, depth), scope, depth + 1, writing);
   tree= id === NODE? scope.node.tree : id === CONST? scope.constants
      : id === STASH? scope.stash : id === TEMP? scope.temp : id === CAP? scope.cap : null;
   if (!tree || writing && (id === CONST || id === CAP))
      fail(writing >= 2 && writing <= 3? tree? invalidOperand : invalidTarget
         : invalidGraft, "Invalid reference namespace");
   if (id === NODE) {
      selectors= copyPath(scope.node.keys);
   }
   charge(expression.length);
   for (i= 1; i < expression.length; i++) {
      item= get(expression, i);
      code= isArray(item)? invalidOperand : invalidGraft;
      item= argument(expression, i, scope, depth);
      if (isArray(item))
         expanded= item;
      else {
         charge(1, 40, 1);
         expanded= [item];
      }
      charge(expanded.length, expanded.length * 8);
      for (j= 0; j < expanded.length; j++) {
         item= get(expanded, j);
         property(item);
         if (!isString(item) && item !== false && !integer(item)
               && !(writing === 3 && isNumber(item) && integer(item * 2)))
            fail(code, "Invalid path selector");
         // These namespaces permit a leading integer as an object key.
         selectors.push(selectors.length === 0 && id < CONST + 1 && id !== CAP && integer(item)? String(item) : item);
      }
   }
   if (id === TEMP && !selectors.length || writing && id !== NODE && !selectors.length)
      fail(writing >= 2 && writing <= 3? invalidOperand : invalidGraft,
         "Namespace root cannot be accessed this way");
   charge(1, 48, 1);
   return {tree: tree, keys: selectors, namespace: id};
}

// Resolve aliases against the current parent. No inherited value is readable.
function selector(parent, key, writing) {
   var kind= type(parent);
   charge(1);
   property(key);
   if (kind === TYPE_ARRAY && writing === 2 && isNumber(key)
         && integer(key * 2) && !integer(key)) {
      key= key < -0.5? parent.length + key : key;
      if (key >= -0.5 && key < parent.length)
         return key;
   } else if (kind === TYPE_ARRAY && (integer(key) || key === false)) {
      key= key === false? parent.length : key < 0? parent.length + key : key;
      if (key >= 0 && key < parent.length + (writing? 1 : 0))
         return key;
   } else if (kind === TYPE_OBJECT && isString(key))
      return key;
   else if (kind === TYPE_DATE && !writing && isString(key))
      return key;
   fail(invalidTarget, "Path selector does not address this container");
}

function read(reference, depth) {
   var value= reference.tree.value, i, key;
   activeState.inputPath= make(true);
   if (reference.tree.deleted)
      fail(invalidTarget, "Current node is temporarily deleted");
   charge(reference.keys.length, reference.keys.length * 8);
   for (i= 0; i < reference.keys.length; i++) {
      charge(1, 0, 0, depth + i);
      key= selector(value, reference.keys[i], false);
      activeState.inputPath.push(key);
      if (type(value) === TYPE_DATE)
         value= dateProperty(value, key);
      else {
         if (!present(value, key))
            fail(invalidTarget, "Missing or pending-deletion source property");
         value= get(value, key);
      }
      // AT retains these concrete indices rather than re-resolving aliases.
      reference.keys[i]= key;
   }
   return value;
}

// Metadata is kept outside user arrays. Linear identity searches are charged;
// moving an array therefore carries its pending edits without visiting its data.
function arrayInfo(array, create) {
   var i, info;
   charge(activeState.arrays.length);
   for (i= 0; i < activeState.arrays.length; i++)
      if (activeState.arrays[i].array === array)
         return activeState.arrays[i];
   if (!create)
      return null;
   info= make();
   info.array= array;
   info.split= null;
   charge(1, 8);
   activeState.arrays.push(info);
   return info;
}

// During MOVE, deleted array slots hold null in the diagnostic tree while a
// separate map makes them inaccessible. This keeps partial results JSON-shaped.
function present(object, key) {
   var info= activeState.moving && isArray(object)? arrayInfo(object) : null;
   return owns(object, key) && !(info && get(info.deleted, "$" + key));
}

function childOwnership(mark, key) {
   return mark === true? true : owns(mark, "$" + key)? get(mark, "$" + key) : !!get(mark, "all");
}

function parentReference(reference) {
   var result= make();
   charge(reference.keys.length, reference.keys.length * 8 + 32, 1);
   result.tree= reference.tree;
   result.keys= reference.keys.slice(0, -1);
   return result;
}

// Return a writable container and its ownership map. all=true supplies the
// default for untouched children of an owned subtree; explicit false markers
// let MOVE attach shared input data without incorrectly claiming ownership.
// nextKey is the selector just beyond this reference when auto-vivifying.
function edit(reference, depth, create, nextKey) {
   var tree= reference.tree, node= tree.value, mark= tree.cloned;
   var parent, parentMark, parentKey, key, child, i, result;
   activeState.inputPath= make(true);
   if (tree.deleted) {
      if (!create)
         fail(invalidTarget, "Current node is temporarily deleted");
      node= make(!isString(reference.keys.length? reference.keys[0] : nextKey));
      tree.deleted= false;
      tree.value= node;
      mark= true;
   }
   charge(reference.keys.length + 1, reference.keys.length * 8);
   for (i= 0; i <= reference.keys.length; i++) {
      charge(1, 0, 0, depth + i);
      if (type(node) !== TYPE_OBJECT && !isArray(node))
         fail(invalidTarget, "Expected a writable container");
      if (!mark || mark === true) {
         if (!mark)
            node= copy(node, depth + i, true);
         child= make();
         child.all= mark === true;
         mark= child;
         if (i === 0) {
            tree.value= node;
            tree.cloned= mark;
         } else {
            put(parent, parentKey, node);
            put(parentMark, "$" + parentKey, mark);
         }
      }
      if (i === reference.keys.length) {
         result= make();
         result.value= node;
         result.mark= mark;
         return result;
      }
      key= selector(node, reference.keys[i], create);
      activeState.inputPath.push(key);
      child= childOwnership(mark, key);
      if (!present(node, key)) {
         if (!create)
            fail(invalidTarget, "Missing parent property");
         put(node, key, make(!isString(i + 1 < reference.keys.length? reference.keys[i + 1] : nextKey)));
         put(mark, "$" + key, true);
         revive(node, key);
         child= true;
      }
      parent= node;
      parentMark= mark;
      parentKey= key;
      node= get(node, key);
      mark= child;
   }
}

function revive(array, key) {
   var info= activeState.moving && isArray(array)? arrayInfo(array) : null;
   if (info && info.deleted)
      delete info.deleted["$" + key];
}

// Assign a value with its ownership marker. COPY supplies true; MOVE transfers
// the original marker, so modifying a moved shared branch still shallow-clones.
function write(reference, value, depth, owned, element) {
   var parent, key, inserting;
   if (activeState.dates && reference.tree === activeState.tree)
      value= exportDates(value, depth);
   if (owned === undefined)
      owned= true;
   if (!reference.keys.length) {
      reference.tree.value= value;
      reference.tree.cloned= owned;
      reference.tree.deleted= false;
      return;
   }
   key= reference.keys[reference.keys.length - 1];
   parent= edit(parentReference(reference), depth, true, key);
   key= selector(parent.value, key, true);
   activeState.inputPath.push(key);
   inserting= key === parent.value.length || !present(parent.value, key);
   put(parent.value, key, value);
   if (isArray(parent.value))
      receiveElement(parent.value, key, element, inserting, parent.mark);
   put(parent.mark, "$" + key, owned);
   revive(parent.value, key);
}

// Validate the destination against a virtual source removal before detaching
// anything. Only absent containers are synthesized; scalars are never coerced.
function destination(reference, source, depth) {
   var value= reference.tree.value, absent= reference.tree.deleted, i, j, same, key;
   activeState.inputPath= make(true);
   charge(reference.keys.length);
   for (i= 0; i < reference.keys.length; i++) {
      same= source && source.tree === reference.tree && source.keys.length === i;
      if (same) {
         charge(i);
         for (j= 0; j < i; j++)
            if (source.keys[j] !== reference.keys[j])
               same= false;
      }
      if (absent || same)
         value= make(!isString(reference.keys[i]));
      charge(1, 0, 0, depth + i);
      key= selector(value, reference.keys[i], i === reference.keys.length - 1? 2 : true);
      reference.keys[i]= key;
      activeState.inputPath.push(key);
      absent= !present(value, key);
      value= get(value, key);
   }
}

function sameReference(a, b) {
   var i;
   if (!a || !b || a.tree !== b.tree || a.keys.length !== b.keys.length)
      return false;
   charge(a.keys.length);
   for (i= 0; i < a.keys.length; i++)
      if (a.keys[i] !== b.keys[i])
         return false;
   return true;
}

// Register the writable array once for end-of-MOVE rebuilding. Queued inserts
// and deleted positions belong to this instance even after it changes namespace.
function pending(array, mark) {
   var info= arrayInfo(array, true);
   if (!info.deleted) {
      info.deleted= make();
      info.inserts= make();
      info.mark= mark;
      charge(1, 8);
      activeState.moving.push(info);
   }
   return info;
}

function detach(reference, depth) {
   var result= make(), parent, key, info, replacement, names, i;
   if (!reference.keys.length) {
      result.value= reference.tree.value;
      result.owned= reference.tree.cloned;
      reference.tree.value= null;
      reference.tree.deleted= true;
   } else {
      parent= edit(parentReference(reference), depth, false);
      key= reference.keys[reference.keys.length - 1];
      result.value= get(parent.value, key);
      result.owned= childOwnership(parent.mark, key);
      result.element= elementAt(parent.value, key);
      if (isArray(parent.value)) {
         info= pending(parent.value, parent.mark);
         put(parent.value, key, null);
         put(info.deleted, "$" + key, true);
         if (info.split)
            info.split.items[key]= null;
      } else if (key === "__proto__" && !deleteProto) {
         // V8 0.10 cannot delete this own property. Replace the writable
         // container, preserving its other child identities and ownership map.
         replacement= make();
         names= keys(parent.value);
         charge(names.length);
         for (i= 0; i < names.length; i++)
            if (names[i] !== key)
               put(replacement, names[i], get(parent.value, names[i]));
         write(parentReference(reference), replacement, depth, parent.mark);
      } else
         delete parent.value[key];
      put(parent.mark, "$" + key, false);
   }
   return result;
}

function move(expression, scope, depth) {
   var source, target, item, parent, key, info, queue, i;
   if (expression.length % 2 !== 1)
      fail(invalidGraft, "MOVE requires source/destination pairs");
   activeState.moving= make(true);
   charge(expression.length);
   for (i= 1; i < expression.length; i+= 2) {
      source= isNull(get(expression, i))? null : argument(expression, i, scope, depth, path, 2);
      target= isNull(get(expression, i + 1))? null : argument(expression, i + 1, scope, depth, path, 3);
      if (source) {
         activeState.graftPath.push(i);
         read(source, depth);
         activeState.graftPath.pop();
      }
      if (target) {
         activeState.graftPath.push(i + 1);
         destination(target, source, depth);
         activeState.graftPath.pop();
      }
      if (sameReference(source, target))
         continue;
      activeState.graftPath.push(i);
      if (source)
         item= detach(source, depth);
      else {
         item= make();
         item.value= null;
         item.owned= true;
      }
      activeState.graftPath[activeState.graftPath.length - 1]= i + 1;
      if (target) {
         key= target.keys[target.keys.length - 1];
         if (isNumber(key) && !integer(key)) {
            if (activeState.dates && target.tree === activeState.tree)
               item.value= exportDates(item.value, depth);
            parent= edit(parentReference(target), depth, true, key);
            info= pending(parent.value, parent.mark);
            if (item.element && !acceptElement(info, item.element))
               item.element= null;
            queue= get(info.inserts, "$" + key);
            if (!queue) {
               queue= make(true);
               put(info.inserts, "$" + key, queue);
            }
            charge(1, 8);
            queue.push(item);
         } else
            write(target, item.value, depth, item.owned, item.element);
      }
      activeState.graftPath.pop();
   }
   // A temporarily detached current node must be restored before returning.
   read(scope.node, depth);
   charge(activeState.moving.length);
   for (i= 0; i < activeState.moving.length; i++)
      finishMove(activeState.moving[i], depth);
   activeState.moving= null;
}

// Element metadata only accompanies direct references. Primitive strings need
// this parallel annotation because strings cannot carry an origin themselves.
function elementAt(array, key) {
   var info= isArray(array)? arrayInfo(array) : null, result;
   if (!info || !info.split || !info.split.items[key])
      return null;
   result= make();
   result.origin= info.split.origin;
   result.item= info.split.items[key];
   return result;
}

function referenceElement(reference, depth) {
   return reference.keys.length? elementAt(read(parentReference(reference), depth), reference.keys[reference.keys.length - 1]) : null;
}

function entry(list, value, owned, element) {
   var item= make();
   item.value= value;
   item.owned= owned;
   item.element= element;
   charge(1, 8);
   list.push(item);
}

// Shared spans preserve child ownership; expression results instead materialize
// each value. Both paths preserve source element metadata and reject deletions.
function appendRange(entries, array, start, limit, depth, mark) {
   var i;
   charge(limit - start);
   for (i= start; i < limit; i++) {
      if (!present(array, i))
         fail(invalidTarget, "Cannot enumerate a missing or pending-deletion element");
      entry(entries, isNull(depth)? get(array, i) : copy(get(array, i), depth + 1),
         isNull(depth)? childOwnership(mark, i) : true, elementAt(array, i));
   }
}

// Fill metadata gaps in final array order. New values inherit the preceding
// left trim and separator; at the start only a following separator is inherited.
function normalizeMetadata(split, length) {
   var items= split.items, previous= null, item, next, i, j;
   charge(length);
   for (i= 0; i < length; i++) {
      item= items[i];
      if (!item) {
         next= null;
         if (!previous) {
            charge(length - i);
            for (j= i + 1; j < length && !next; j++)
               next= items[j];
         }
         item= make();
         item.left= previous? previous.left : "";
         item.right= "";
         item.sep= previous? previous.sep : next? next.sep : split.origin.separator;
         items[i]= item;
      }
      previous= item;
   }
}

function acceptElement(info, element) {
   if (!info.split && element) {
      info.split= make();
      info.split.origin= element.origin;
      info.split.items= make(true);
   }
   return element && info.split && element.origin === info.split.origin? element.item : null;
}

function receiveElement(array, key, element, inserting, mark) {
   var info= arrayInfo(array), split, item;
   if (!inserting || !element && (!info || !info.split))
      return;
   info= info || arrayInfo(array, true);
   item= acceptElement(info, element);
   split= info.split;
   split.items[key]= item;
   if (activeState.moving && mark)
      pending(array, mark);
   else
      normalizeMetadata(split, array.length);
}

// Rebuild one writable array without native splice/apply argument-count limits.
// Ownership travels with values and metadata travels with surviving elements.
function rebuild(array, mark, entries) {
   var info= arrayInfo(array), origin= null, fallback= null, split, item, i;
   charge(entries.length * 3, entries.length * 8);
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
      info= info || arrayInfo(array, true);
      split= make();
      split.origin= origin;
      split.items= make(true);
      for (i= 0; i < entries.length; i++) {
         item= entries[i].element;
         split.items.push(item && item.origin === origin? item.item : null);
      }
      normalizeMetadata(split, entries.length);
      info.split= split;
   } else if (info)
      info.split= null;
   for (i= 0; i < entries.length; i++) {
      put(array, i, entries[i].value);
      put(mark, "$" + i, entries[i].owned);
   }
   array.length= entries.length;
}

function finishMove(info, depth) {
   var entries= make(true), array= info.array, queue, i, j;
   charge(array.length + 1, 0, 0, depth);
   for (i= 0; i <= array.length; i++) {
      queue= get(info.inserts, "$" + (i - 0.5));
      if (queue) {
         charge(queue.length, queue.length * 8);
         for (j= 0; j < queue.length; j++)
            entries.push(queue[j]);
      }
      if (i < array.length && !get(info.deleted, "$" + i))
         entry(entries, get(array, i), childOwnership(info.mark, i), elementAt(array, i));
   }
   info.deleted= null;
   info.inserts= null;
   rebuild(array, info.mark, entries);
}

function splice(expression, scope, depth) {
   var reference, parent, array, offset, count, replacements, entries, i;
   arity(expression, 3, Infinity);
   reference= argument(expression, 1, scope, depth, path, true);
   if (!reference.keys.length)
      fail(invalidTarget, "SPLICE requires an array element path");
   parent= parentReference(reference);
   array= read(parent, depth);
   if (!isArray(array))
      fail(invalidTarget, "SPLICE requires an array");
   offset= selector(array, reference.keys[reference.keys.length - 1], true);
   count= argument(expression, 2, scope, depth);
   if (!isNull(count) && !integer(count))
      fail(invalidOperand, "SPLICE count must be an integer or null");
   count= isNull(count)? array.length - offset : count < 0? array.length + count - offset : count;
   if (count < 0 || count > array.length - offset)
      fail(invalidTarget, "SPLICE removal range is out of bounds");
   replacements= make(true);
   charge(expression.length);
   for (i= 3; i < expression.length; i++) {
      entries= argument(expression, i, scope, depth);
      if (activeState.dates && reference.tree === activeState.tree)
         entries= exportDates(entries, depth);
      entry(replacements, entries, true, activeState.element);
   }
   // Every replacement was captured before cloning or altering the array.
   if (!count && !replacements.length)
      return;
   parent= edit(parent, depth, false);
   array= parent.value;
   entries= make(true);
   charge(array.length + replacements.length, replacements.length * 8);
   appendRange(entries, array, 0, offset, null, parent.mark);
   for (i= 0; i < replacements.length; i++)
      entries.push(replacements[i]);
   appendRange(entries, array, offset + count, array.length, null, parent.mark);
   rebuild(array, parent.mark, entries);
}

// Construct literal objects/escaped arrays recursively. Referenced values are
// materialized, so subsequent writes cannot create aliases or cycles.
function construct(source, scope, depth) {
   return copy(source, depth, false, scope);
}

// A direct reference can carry one element's SPLIT metadata. Derived functions
// deliberately clear it; array metadata instead lives in the identity table.
function evaluate(expression, scope, depth, borrowed) {
   var captures= activeState.captures, result, id;
   // Function expressions start independent matches, including beneath a
   // capture-suppressing ANY/NONE/REP. Restore the caller even on probe errors.
   activeState.captures= null;
   try {
      result= evaluateValue(expression, scope, depth, borrowed);
   } finally {
      activeState.captures= captures;
   }
   id= isArray(expression)? get(expression, 0) : undefined;
   id= isString(id)? get(expressions, id) : id;
   if (!isNumber(id) || id < EXPR || id > HAS - 1)
      activeState.element= null;
   return result;
}

// Internal consumers such as LENGTH and SLICE may inspect a reference without
// enumerating it. In particular LENGTH remains legal during pending deletions.
function borrow(expression, scope, depth) {
   return evaluate(expression, scope, depth, true);
}

// A temporary current node borrows its value. Expressions cannot mutate it,
// and writes to data subsequently returned by an expression still copy it.
function valueScope(scope, value) {
   var result= scopeCopy(scope);
   result.regex= null;
   result.node= make();
   result.node.tree= holder(value, false);
   result.node.keys= make(true);
   return result;
}

// Position is independent of value existence. Regex cursors use a virtual
// one-slot array, so report their logical codepoint index directly instead.
function currentProperty(scope, depth) {
   var keys= scope.node.keys, parent, key, kind;
   if (scope.regex) return scope.regex.position;
   if (!keys.length) return null;
   key= keys[keys.length - 1];
   parent= read(parentReference(scope.node), depth);
   kind= type(parent);
   if (kind === TYPE_ARRAY) return key === false? parent.length : key < 0? parent.length + key : key;
   return kind === TYPE_OBJECT || kind === TYPE_DATE? key : null;
}

// LOCAL evaluates binding names and can rebind NODE with null. WITH accepts
// only literal string/integer TEMP names. Both assign sequentially into a
// private shallow TEMP root, leaving caller holders and nested data untouched.
function bindingScope(expression, scope, depth, local) {
   var result, name, value, i;
   if (expression.length < (local? 2 : 4) || expression.length % 2)
      fail(invalidGraft, "Expected binding pairs and a final expression");
   result= scopeCopy(scope);
   result.temp= holder(copy(scope.temp.value, depth, true), true);
   charge(expression.length);
   for (i= 1; i < expression.length - 1; i+= 2) {
      name= local? argument(expression, i, result, depth) : get(expression, i);
      if (!(local && isNull(name)) && !isString(name)
            && !(local? isNumber(name) : integer(name)))
         fail(local? invalidOperand : invalidGraft, "Invalid lexical binding name");
      value= argument(expression, i + 1, result, depth);
      if (isNull(name))
         result= valueScope(result, value);
      else
         put(result.temp.value, String(name), value);
   }
   return result;
}

// Probe errors mean false; syntax/resource errors and application exceptions
// escape. Discard diagnostic path segments left by a failed argument walk so
// another alternative or a later action gets its own correct location.
// element bypasses regex entry when a cursor is already positioned; 2
// dispatches a successor-set probe rather than a boolean match. Inner
// function matches retain regex context, but restore the calling character.
function match(expression, scope, depth, mode, target, element) {
   var pathLength= activeState.graftPath.length, inputPath= activeState.inputPath;
   var regex= !element && !target && scope.regex, position= regex && regex.position, result;
   var captures= activeState.captures;
   try {
      if (element === 2)
         return sequenceValue(expression, scope, depth, mode, target);
      if (regex) {
         result= sequenceTerm(expression, scope, depth,
            position * 32 + 16 + (mode || 0), regex);
         sequencePosition(regex, position);
         return sequenceResolve(result, regex, 0);
      }
      result= matchValue(expression, scope, depth, mode || 0, target);
      if (!result) activeState.captures= captures;
      return result;
   } catch (error) {
      activeState.captures= captures;
      if (!error || error.counts !== activeState.counts
            || error.code !== invalidTarget && error.code !== invalidOperand)
         throw error;
      activeState.graftPath.length= pathLength;
      activeState.inputPath= inputPath;
      activeState.element= null;
      if (regex)
         sequencePosition(regex, position);
      return element === 2? -1 : false;
   }
}

function matchWithoutCaptures(expression, scope, depth, mode) {
   var captures= activeState.captures;
   activeState.captures= null;
   try {
      return match(expression, scope, depth, mode);
   } finally {
      activeState.captures= captures;
   }
}

// Observable matches keep immutable annotation chains. Alternatives can share
// prefixes, while failed probes simply restore the previous chain. Functions
// and actions start new chains; only their resulting capture objects escape.
function captureMatch(expression, scope, depth) {
   var previous= activeState.captures, trace= make(), result, event;
   trace.root= scope.node;
   trace.count= 0;
   activeState.captures= trace;
   try {
      if (!match(expression, scope, depth)) return false;
      result= make();
      for (trace= activeState.captures; trace.previous; trace= trace.previous) {
         charge(1);
         event= trace.event;
         if (event.name !== undefined && !isNull(event.name))
            put(result, event.name, event.range);
      }
      return result;
   } finally {
      activeState.captures= previous;
   }
}

// Append one rank/capture, enforcing name uniqueness against the entire match.
function captureAppend(trace, event) {
   var previous= trace, result;
   if (event.name !== undefined && !isNull(event.name)) {
      property(event.name);
      while (previous.previous) {
         charge(1);
         if (previous.event.name === event.name)
            fail(invalidOperand, "Duplicate capture name");
         previous= previous.previous;
      }
   }
   result= make();
   result.previous= trace;
   result.event= event;
   result.root= trace.root;
   result.count= trace.count + (event.name !== undefined && !isNull(event.name)? 1 : 0);
   return result;
}

// Ranks for deeper arrays have already been resolved. At this array compare
// all named-group lengths first, then starts, then substructure placements.
function captureRanks(trace, cursor, groups) {
   var result= make(true), event;
   while (trace && trace.previous) {
      charge(1);
      event= trace.event;
      if (event.cursor === cursor && (event.group !== undefined) === groups) {
         charge(0, 8);
         result.push(event);
      }
      trace= trace.previous;
   }
   return result;
}

function captureBetter(left, right, cursor) {
   var a, b, i, pass, x, y;
   if (!left || left === right) return false;
   if (!right) return true;
   for (pass= 0; pass < 3; pass++) {
      a= captureRanks(left, cursor, pass < 2);
      b= captureRanks(right, cursor, pass < 2);
      charge(a.length + b.length);
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
   var trace= !isNumber(positions) && positions["$" + position];
   return trace && trace !== true? trace : fallback;
}

// Select a complete array match without discarding its annotations. An exact
// match accepts the boundary (including predicates on the missing end node).
function sequenceResolve(positions, cursor, minimum) {
   var i, position, trace, best= null, found= false;
   var count= isNumber(positions)? 1 : positions.length;
   charge(count);
   for (i= 0; i < count; i++) {
      position= isNumber(positions)? positions : positions[i];
      if (position >= minimum) {
         trace= sequenceTrace(positions, position, activeState.captures);
         if (!found || captureBetter(trace, best, cursor)) best= trace;
         found= true;
      }
   }
   if (found) activeState.captures= best;
   return found;
}

// A sequence cursor borrows an array location or a string index. Its element
// scope is reused; a virtual one-slot array makes end-of-string genuinely
// missing (including for EXISTS and references), without decoding an array.
function sequenceCursor(scope, value) {
   var cursor= make();
   cursor.node= scope.node;
   cursor.scope= scopeCopy(scope);
   cursor.scope.node= make();
   cursor.info= isString(value)? stringInfo(value) : null;
   cursor.start= 0;
   cursor.length= null;
   cursor.value= cursor.info? make(true) : value;
   if (cursor.info)
      cursor.scope.regex= cursor;
   cursor.scope.node.tree= cursor.info? holder(cursor.value, false) : scope.node.tree;
   charge(scope.node.keys.length, 32 + scope.node.keys.length * 8, 1);
   cursor.scope.node.keys= cursor.info? [] : scope.node.keys.slice(0);
   cursor.scope.node.keys.push(0);
   return cursor;
}

// Position one cursor without allocating per-element scopes. Return whether
// the position is at the end; indices beyond it cannot generate successors.
function sequencePosition(cursor, position) {
   var offset;
   charge(1);
   cursor.position= position;
   if (cursor.info) {
      offset= stringOffset(cursor.info, cursor.start + position);
      if (offset < cursor.info.text.length && (isNull(cursor.length) || position < cursor.length))
         cursor.value[0]= character(cursor.info, offset);
      else if (owns(cursor.value, 0))
         delete cursor.value[0];
      return offset >= cursor.info.text.length || !isNull(cursor.length) && position >= cursor.length;
   }
   cursor.scope.node.keys[cursor.scope.node.keys.length - 1]= position;
   return position >= cursor.value.length;
}

// String views share the original index/checkpoints, but anchors, missing-node
// probes, literals, and repetition must respect the view's logical boundaries.
function sequenceLength(cursor, complete) {
   if (!cursor.info) return cursor.value.length;
   if (!isNull(cursor.length)) return cursor.length;
   if (complete && isNull(cursor.info.length)) stringOffset(cursor.info, Infinity);
   return cursor.info.length;
}

// Successors use -1 for the empty set, a number for a singleton, or an
// internal array with prefixed membership keys holding true or annotations.
// Unannotated deterministic paths allocate nothing; branching sets grow once
// per distinct position, resolving annotation ties without sorting.
function sequenceAdd(result, position, trace, cursor) {
   var previous, key;
   trace= trace && trace.previous? trace : null;
   if (position < 0 || result === position && !trace)
      return result;
   if (result === -1 && !trace)
      return position;
   if (isNumber(result)) {
      previous= result;
      result= make(true);
      if (previous !== -1) result= sequenceAdd(result, previous);
   }
   key= "$" + position;
   charge(1);
   if (!owns(result, key)) {
      charge(1, 16 + key.length * 2);
      result[key]= trace || true;
      result.push(position);
   } else if (trace && captureBetter(trace, result[key] === true? null : result[key], cursor))
      result[key]= trace;
   return result;
}

// Merge (and optionally filter) successor sets without sharing a mutable set.
function sequenceMerge(result, source, minimum, maximum, cursor) {
   var i, position, count= isNumber(source)? 1 : source.length;
   charge(count);
   for (i= 0; i < count; i++) {
      position= isNumber(source)? source : source[i];
      if (position >= minimum && position <= maximum)
         result= sequenceAdd(result, position, sequenceTrace(source, position, null), cursor);
   }
   return result;
}

// Repetition can stop at a fixed point, including zero-width matches below a
// very large minimum. Membership makes equality independent of traversal order.
function sequenceSame(left, right) {
   var i;
   if (isNumber(left) || isNumber(right))
      return left === right;
   if (left.length !== right.length)
      return false;
   charge(left.length);
   for (i= 0; i < left.length; i++)
      if (!owns(right, "$" + left[i]))
         return false;
   return true;
}

// Apply one child to every frontier position. A singleton avoids allocation
// and merging altogether. argument retains the child's diagnostic location.
function sequenceApply(expression, key, scope, depth, options, cursor, positions) {
   var i, result= -1, captures= activeState.captures;
   if (isNumber(positions))
      return positions === -1? -1 : argument(expression, key, scope, depth,
         sequenceTerm, positions * 32 + options, cursor);
   charge(positions.length);
   for (i= 0; i < positions.length; i++) {
      activeState.captures= sequenceTrace(positions, positions[i], captures);
      result= sequenceMerge(result, argument(expression, key, scope, depth,
         sequenceTerm, positions[i] * 32 + options, cursor), 0, Infinity, cursor);
   }
   activeState.captures= captures;
   return result;
}

// Use the ordinary probe-error boundary for every branch. INVALID_TARGET and
// INVALID_OPERAND eliminate only this term's successors; fatal errors escape.
function sequenceTerm(expression, scope, depth, options, cursor) {
   var captures= activeState.captures, result, trace, i;
   try {
      result= match(expression, scope, depth, options, cursor, 2);
      if (isNumber(result) && result !== -1)
         result= sequenceAdd(-1, result, activeState.captures || captures, cursor);
      else if (!isNumber(result)) {
         trace= activeState.captures || captures;
         if (trace && trace.previous) {
            charge(result.length);
            for (i= 0; i < result.length; i++)
               if (result["$" + result[i]] === true) result["$" + result[i]]= trace;
         }
      }
      return result;
   } finally {
      activeState.captures= captures;
   }
}

// Ordinary predicates consume one element (or zero for alternate-target
// comparisons). Record where a capture-producing substructure was applied so
// equal endpoint paths resolve independently of alternative traversal order.
function sequenceElement(expression, scope, depth, mode, cursor, position, width) {
   var captures= activeState.captures, event;
   if (!match(expression, scope, depth, mode, null, true)) return -1;
   if (captures && activeState.captures.count > captures.count) {
      event= make();
      event.cursor= cursor;
      event.position= position;
      activeState.captures= captureAppend(activeState.captures, event);
   }
   return position + width;
}

// Generate successors for one term. options packs its starting position above
// four matching bits and the active-sequence bit, avoiding per-position objects.
function sequenceValue(expression, scope, depth, options, cursor) {
   var position= Math.floor(options / 32), mode= options & 15, kind= type(expression);
   var id= null, next, offset, end, info, i, result, minimum, maximum, count, frontier, branches;
   var captures= activeState.captures;
   charge(1, 0, 0, depth);
   end= sequencePosition(cursor, position);
   scope= cursor.scope;
   offset= sequenceLength(cursor);
   if (!isNull(offset) && position > offset)
      return -1;
   if (!(mode & 2)) {
      id= kind === TYPE_ARRAY && !(expression.length === 1 && isArray(get(expression, 0)))
         ? operation(expression, expressions) : null;
      if (id === EXPR)
         return sequenceTerm(macro(expression, scope, depth), scope, depth + 1,
            position * 32 + (mode | 4) + (options & 16), cursor);
      if (id === WITH) {
         next= bindingScope(expression, scope, depth, false);
         cursor.scope= next;
         try {
            return argument(expression, expression.length - 1, next, depth, sequenceTerm,
               position * 32 + (mode & 1) + (options & 16), cursor);
         } finally {
            cursor.scope= scope;
         }
      }
      if (id > SEQ - 1 && id < SEQMIN + 1) { // SEQ=13, SEQMAX=14, SEQMIN=15
         arity(expression, id < SEQ + 1? 1 : 2, Infinity);
         if (id > SEQMAX - 1 && options & 16)
            fail(invalidGraft, "Named sequences require an array specification root");
         result= sequenceTerms(expression, scope, depth,
            position * 32 + 16 + (mode & 1), cursor, id < SEQ + 1? 1 : 2);
         return id < SEQ + 1 || !captures? result
            : sequenceCapture(result, cursor, position);
      }
      if (!(options & 16))
         return sequenceElement(expression, scope, depth, mode, cursor, position, 1);
      options= 16 + (mode & 1);
      if (id > NONE - 1 && id < ALL + 1) { // NONE=3, ANY=4, ALL=5
         arity(expression, id < NONE + 1? 1 : 2, Infinity);
         result= -1;
         minimum= 0;
         if (id < ANY + 1) activeState.captures= null;
         branches= id > ALL - 1 && captures? make(true) : null;
         charge(expression.length);
         for (i= 1; i < expression.length; i++) {
            next= argument(expression, i, scope, depth, sequenceTerm,
               position * 32 + options, cursor);
            if (branches) {
               charge(0, 8);
               branches.push(next);
            }
            if (id < NONE + 1 && next !== -1 || id > ALL - 1 && next === -1)
               return -1;
            if (id > ALL - 1) {
               offset= isNumber(next)? next : Infinity;
               if (!isNumber(next)) {
                  charge(next.length);
                  for (count= 0; count < next.length; count++)
                     offset= Math.min(offset, next[count]);
               }
               minimum= Math.max(minimum, offset);
            }
            result= sequenceMerge(result, next, 0, Infinity, cursor);
         }
         result= id < NONE + 1? position : id === ANY? result
            : sequenceMerge(-1, result, minimum, Infinity, cursor);
         return branches && result !== -1? sequenceAll(result, branches, captures, cursor) : result;
      }
      if (id === REP) {
         arity(expression, 4, 4);
         minimum= argument(expression, 1, scope, depth, borrow);
         maximum= argument(expression, 2, scope, depth, borrow);
         if (!integer(minimum) || minimum < 0 || !integer(maximum) || maximum < -1
               || maximum > 0 && maximum < minimum)
            fail(invalidOperand, "Invalid repetition bounds");
         maximum= maximum === -1? Infinity : maximum || minimum;
         activeState.captures= null;
         end= sequenceLength(cursor, true);
         result= minimum === 0? position : -1;
         frontier= position;
         count= 0;
         while (frontier !== -1 && count < maximum) {
            charge(1);
            next= sequenceMerge(-1, sequenceApply(expression, 3,
               scope, depth, options, cursor, frontier), 0, end);
            count++;
            if (sequenceSame(frontier, next))
               return sequenceMerge(result, next, 0, end);
            if (count >= minimum)
               result= sequenceMerge(result, next, 0, end);
            frontier= next;
         }
         return result;
      }
      // A virtual string element exists exactly before the boundary; probing
      // it needs no path walk or per-character diagnostic array.
      if (id > START - 1 && id < END + 1 || cursor.info && id === EXISTS) { // START=17, END=18, virtual EXISTS=6
         arity(expression, 1, 1);
         return id === EXISTS? end? -1 : position + 1
            : (id < START + 1? position === 0 : end)? position : -1;
      }
      // A one-argument comparison probes with the current sequence context but
      // consumes exactly one element. Alternate-target comparisons are assertions.
      if (id > HAS - 1 && id < IS + 1) { // HAS=1, IS=2
         arity(expression, 2, 3);
         if (expression.length === 2) {
            result= argument(expression, 1, scope, depth, sequenceTerm,
               position * 32 + 16 + (id > IS - 1? 1 : 0), cursor);
            return sequenceResolve(result, cursor, 0)? position + 1 : -1;
         }
         return sequenceElement(expression, scope, depth, mode, cursor, position, 0);
      }
      if (cursor.info && (isNull(id) || id < NODE + 1 || id > CHARS || mode & 4 && (id < ALL + 1 || id > SEQ - 1 && id !== CHARS))) {
         if (!isNull(id) || mode & 4) {
            expression= borrow(expression, scope, depth + 1);
            kind= type(expression);
         }
         id= null;
      }
   }
   if (cursor.info && (mode & 2 || isNull(id))) {
      if (kind === TYPE_STRING) {
         offset= stringOffset(cursor.info, cursor.start + position);
         next= offset + expression.length;
         charge(expression.length + 1);
         if (stringSlice.call(cursor.info.text, offset, next) !== expression
               || !stringBoundary(cursor.info.text, next, !!cursor.info.checkpoints))
            return -1;
         info= stringInfo(expression);
         stringOffset(info, Infinity);
         if (!isNull(cursor.length) && position + info.length > cursor.length) return -1;
         return position + info.length;
      }
      return !end && kind === TYPE_NUMBER && expression === cursor.value[0]? position + 1 : -1;
   }
   return sequenceElement(expression, scope, depth, mode, cursor, position, 1);
}

// Evaluate root sequence names from start before matching, with NODE missing.
// Suppressed/boolean matches never evaluate names or allocate descriptors.
function sequenceGroups(expression, scope, depth, start) {
   var i, term, id, level, groups= null, local, group, name;
   charge(expression.length);
   for (i= start || 0; i < expression.length; i++) {
      term= get(expression, i);
      level= depth;
      do {
         charge(1, 0, 0, ++level);
         id= isArray(term) && !(term.length === 1 && isArray(get(term, 0)))
            ? operation(term, expressions) : null;
         if (id === EXPR) term= macro(term, scope, level);
      } while (id === EXPR);
      if (id > SEQMAX - 1 && id < SEQMIN + 1) { // SEQMAX=14, SEQMIN=15
         arity(term, 2, Infinity);
         if (!groups) {
            groups= make();
            local= valueScope(scope, make());
            local.node.keys.push(0);
         }
         activeState.graftPath.push(i);
         name= argument(term, 1, local, level, borrow);
         activeState.graftPath.pop();
         if (!isNull(name) && !isString(name) && !integer(name))
            fail(invalidOperand, "Invalid capture name");
         group= make();
         group.name= isNull(name)? null : String(name);
         group.maximum= id < SEQMAX + 1;
         groups["$" + i]= group;
      }
   }
   return groups;
}

// Annotate every endpoint of a root named sequence, retaining inner captures.
function sequenceCapture(positions, cursor, start) {
   var count= isNumber(positions)? 1 : positions.length, i, end, event, range, trace;
   var group= cursor.groups["$" + cursor.group], result= -1, root= activeState.captures.root;
   charge(count);
   for (i= 0; i < count; i++) {
      end= isNumber(positions)? positions : positions[i];
      if (end < 0) continue;
      event= make();
      event.cursor= cursor;
      event.group= cursor.group;
      event.name= group.name;
      event.maximum= group.maximum;
      event.position= start;
      range= event.range= make();
      charge(cursor.node.keys.length, cursor.node.keys.length * 8 + 32, 1);
      range.path= cursor.node.keys.slice(cursor.node.tree === root.tree? root.keys.length : 0);
      range.ofs= start;
      range.len= end - start;
      range.lim= end;
      trace= captureAppend(sequenceTrace(positions, end, activeState.captures), event);
      result= sequenceAdd(result, end, trace, cursor);
   }
   return result;
}

// ALL chooses each argument's nearest endpoint at or before the output. Its
// independently resolved annotation suffixes are then merged onto one prefix.
function sequenceAll(positions, branches, prefix, cursor) {
   var result= -1, count= isNumber(positions)? 1 : positions.length;
   var i, j, k, end, source, nearest, position, trace, merged, events, length;
   charge(count);
   for (i= 0; i < count; i++) {
      end= isNumber(positions)? positions : positions[i];
      merged= prefix;
      charge(branches.length);
      for (j= 0; j < branches.length; j++) {
         source= branches[j];
         nearest= -1;
         length= isNumber(source)? 1 : source.length;
         charge(length);
         for (k= 0; k < length; k++) {
            position= isNumber(source)? source : source[k];
            if (position <= end && position > nearest) nearest= position;
         }
         trace= sequenceTrace(source, nearest, prefix);
         events= make(true);
         while (trace !== prefix) {
            charge(1, 8);
            events.push(trace.event);
            trace= trace.previous;
         }
         charge(events.length);
         for (k= events.length - 1; k >= 0; k--)
            merged= captureAppend(merged, events[k]);
      }
      result= sequenceAdd(result, end, merged, cursor);
   }
   return result;
}

// Compose consecutive terms over their frontier sets. Structural arrays start
// at element zero; SEQ skips its opcode. Duplicate paths collapse by position.
// ARRAY skips two operands and explicitly marks a fresh capture-group root.
function sequenceTerms(expression, scope, depth, options, cursor, start, root) {
   var i, positions= Math.floor(options / 32), mode= options & 31;
   root= root || !start;
   if (root && activeState.captures && !(mode & 2))
      cursor.groups= sequenceGroups(expression, scope, depth, start);
   charge(expression.length);
   for (i= start; i < expression.length && positions !== -1; i++) {
      if (root) cursor.group= i;
      positions= sequenceApply(expression, i, scope, depth, mode, cursor, positions);
   }
   return positions;
}

// ARRAY has already borrowed an array target and has at least one operand.
// Reuse its cursor without constructing skipped EXISTS terms or slicing data.
// Prefix/suffix presence checks preserve the equivalent escaped-array behavior
// during pending MOVE deletions; matched terms may explicitly probe such holes.
function arrayMatch(expression, scope, depth, mode, value) {
   var offset= argument(expression, 1, scope, depth, borrow), minimum= 0, cursor, i;
   if (!integer(offset))
      fail(invalidOperand, "ARRAY requires an integer length or offset");
   if (expression.length === 2)
      return mode & 1? value.length === offset : value.length >= offset;
   offset= offset < 0? value.length + offset : offset;
   if (offset < 0 || offset > value.length)
      return false;
   charge(offset);
   for (i= 0; i < offset; i++)
      if (!present(value, i)) return false;
   if (mode & 1) {
      charge(value.length - offset);
      for (minimum= value.length; minimum > offset && present(value, minimum - 1); minimum--) {}
   }
   cursor= sequenceCursor(scope, value);
   i= sequenceTerms(expression, scope, depth,
      offset * 32 + (mode & 1), cursor, 2, true);
   return sequenceResolve(i, cursor, minimum);
}

// NUM has borrowed a numeric target. Null/absent bounds omit comparisons;
// all supplied bounds are checked before comparing, including reversed ranges.
function numberMatch(expression, scope, depth, value) {
   var minimum= expression.length > 1? argument(expression, 1, scope, depth, borrow) : null;
   var maximum= expression.length > 2? argument(expression, 2, scope, depth, borrow) : null;
   if (!isNull(minimum) && (!isNumber(minimum) || !isFinite(minimum))
         || !isNull(maximum) && (!isNumber(maximum) || !isFinite(maximum))
         || !isNull(minimum) && !isNull(maximum) && minimum > maximum)
      fail(invalidOperand, "NUM requires ordered finite numeric bounds or null");
   return (isNull(minimum) || value >= minimum) && (isNull(maximum) || value <= maximum);
}

// mode bits: 1 = exact, 2 = already-evaluated literal, 4 = EXPR definition
// with value-construction semantics unless rooted in a match expression.
// Bit 8 unwraps one escaped array while retaining syntax in its children.
// target delays rebinding NODE until after a direct function/reference (or
// constructing definition) has been evaluated in the original scope.
function matchValue(expression, scope, depth, mode, target) {
   var kind= type(expression), id, value, local, names, key, i, result;
   charge(1, 0, 0, depth);
   if (!(mode & 10)) {
      id= kind === TYPE_ARRAY && !(expression.length === 1 && isArray(get(expression, 0)))
         ? operation(expression, expressions) : null;
      // Positive match IDs are 1..19; null denotes literal structure. Partition
      // once so child nodes can use the implied bounds rather than repeat ranges.
      if (id > HAS - 1 && id < CHARS + 1) {
         if (id < EXISTS + 1) { // HAS=1 through EXISTS=6
            scope= target || scope;
            if (id < IS + 1) { // HAS=1, IS=2
               arity(expression, 2, 3);
               local= expression.length === 3? valueScope(scope,
                  argument(expression, 1, scope, depth, borrow)) : scope;
               return argument(expression, expression.length - 1, scope, depth, match,
                  id > IS - 1? 1 : 0, local);
            }
            if (id > EXISTS - 1) { // EXISTS=6
               arity(expression, 1, 1);
               read(scope.node, depth);
               return true;
            }
            // NONE=3, ANY=4, ALL=5; only ANY has the middle ID.
            arity(expression, id < NONE + 1? 1 : 2, Infinity);
            charge(expression.length);
            for (i= 1; i < expression.length; i++) {
               result= argument(expression, i, scope, depth,
                  id > ALL - 1? match : matchWithoutCaptures, mode & 1);
               if (result !== (id > ALL - 1))
                  return id === ANY;
            }
            return id !== ANY;
         } else if (id < WITH + 1) { // ARRAY=7 through WITH=12
            if (id < BOOL + 1) { // ARRAY=7, STR=8, NUM=9, BOOL=10
               arity(expression, 1, id < ARRAY + 1? Infinity : id < STR + 1? 2 : id < NUM + 1? 3 : 1);
               scope= target || scope;
               value= read(scope.node, depth);
               if (type(value) !== (id < ARRAY + 1? TYPE_ARRAY : id < STR + 1? TYPE_STRING : id < NUM + 1? TYPE_NUMBER : TYPE_BOOLEAN))
                  return false;
               if (expression.length === 1)
                  return true;
               if (id < ARRAY + 1)
                  return arrayMatch(expression, scope, depth, mode, value);
               if (id > NUM - 1) // BOOL=10 returned above; only STR=8/NUM=9 remain.
                  return numberMatch(expression, scope, depth, value);
               local= sequenceCursor(scope, value);
               i= 0;
               do {
                  result= argument(expression, 1, scope, depth, sequenceTerm, i * 32 + 16 + (mode & 1), local);
                  if (sequenceResolve(result, local, 0))
                     return true;
               } while (!sequencePosition(local, i++));
               return false;
            } else if (id < DATE + 1) { // DATE=11
               arity(expression, 1, 1);
               scope= target || scope;
               castDate(read(scope.node, depth));
               return true;
            } else { // WITH=12
               local= bindingScope(expression, target || scope, depth, false);
               return argument(expression, expression.length - 1, local, depth, match, mode & 1);
            }
         } else if (id > START - 1) { // SEQ=13..REP=16 retain the fallback below.
            if (id < END + 1) { // START=17, END=18
               arity(expression, 1, 1);
               scope= target || scope;
               i= scope.node.keys.length - 1;
               if (i < 0)
                  return false;
               local= parentReference(scope.node);
               value= read(local, depth);
               return isArray(value) && scope.node.keys[i] === (id < START + 1? 0 : value.length);
            }
            return charsMatch(expression, target || scope, depth); // CHARS=19
         }
      } else if (id === EXPR) // EXPR=-5
         return match(macro(expression, scope, depth), scope, depth + 1, mode | 4, target);
      if (!isNull(id) || mode & 4) {
         expression= borrow(expression, scope, depth + 1);
         kind= type(expression);
         mode= mode & 1 | 2;
      } else if (kind === TYPE_ARRAY) {
         // An escaped array adds a structural level to diagnostics/depth.
         return argument(expression, 0, target || scope, depth, match, mode | 8);
      }
   }
   scope= target || scope;
   value= read(scope.node, depth);
   if (kind !== type(value))
      return false;
   if (kind !== TYPE_ARRAY && kind !== TYPE_OBJECT) {
      charge(kind === TYPE_STRING? (expression.length + value.length) * 0.001 : 1);
      return kind === TYPE_DATE? compare(expression, value, depth) === 0 : expression === value;
   }
   if (kind === TYPE_ARRAY) {
      local= sequenceCursor(scope, value);
      i= sequenceTerms(expression, scope, depth, mode & 3, local, 0);
      return sequenceResolve(i, local, mode & 1? value.length : 0);
   }
   names= keys(expression);
   if (mode & 1) {
      local= keys(value);
      charge(local.length);
      for (i= 0; i < local.length; i++)
         if (!owns(expression, local[i]))
            return false;
   }
   local= scopeCopy(scope);
   local.node= make();
   local.node.tree= scope.node.tree;
   local.node.keys= copyPath(scope.node.keys);
   charge(names.length, 8);
   for (i= 0; i < names.length; i++) {
      key= names[i];
      local.node.keys.push(key);
      // Bit 4 accompanies only this EXPR root; literal children retain bit 2.
      result= argument(expression, key, local, depth, match, mode & 3);
      local.node.keys.pop();
      if (!result)
         return false;
   }
   return true;
}

// CASTSTR numbers use JSON's fractional spelling but decimal integer digits.
// Expand positive exponents without multiplying/rounding the stored number.
function scalarString(value) {
   var text, exponent, point;
   charge(1, 64);
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
      charge(exponent + text.length, exponent * 12 + text.length * 2 + 32, 1);
      text+= new Array(exponent + 1).join("0");
   }
   return text;
}

// Cast a borrowed scalar without consulting user coercion methods. Date JSON
// encoding receives a fresh native Date so input toJSON/valueOf are ignored.
// Caller restricts id to CASTBOOL=68, CASTNUM=69, or CASTSTR=70.
function cast(id, value, depth) {
   var kind= type(value), text, year;
   if (id < CASTBOOL + 1) {
      if (kind === TYPE_BOOLEAN) return value;
      if (kind === TYPE_STRING) charge(value.length * 0.001);
      if (value === 0 || value === 1 || value === "true" || value === "false")
         return value === 1 || value === "true";
   } else if (id < CASTNUM + 1) {
      if (kind === TYPE_NUMBER) return value;
      if (kind === TYPE_STRING) {
         charge(value.length * 3);
         if (regexpTest.call(jsonNumber, value)) {
            text= Number(value);
            if (!isFinite(text) || text === 0 && regexpTest.call(nonzeroMantissa, value))
               fail(unsupportedGraft, "Number is outside the host numeric range");
            return text;
         }
      }
   } else {
      if (kind === TYPE_STRING) return value;
      if (kind === TYPE_BOOLEAN) return value? "true" : "false";
      if (kind === TYPE_NUMBER) return scalarString(value);
      if (value instanceof DateValue) return dateString(value);
      if (kind === TYPE_DATE && isFinite(dateTime.call(value))) {
         charge(1, 128);
         year= dateYear.call(value);
         text= stringSlice.call(JSON.stringify(copy(value, depth)), 1, -1);
         // Old JSON/ISO encoders omit the sign and six-digit padding on years
         // outside 0000..9999. Native Date years always fit six digits.
         if (year < 0 || year > 9999) {
            charge(1, 64);
            text= (year < 0? "-" : "+") + stringSlice.call("000000" + Math.abs(year), -6)
               + stringSlice.call(text, text.indexOf("-", year < 0? 1 : 0));
         }
         return text;
      }
   }
   fail(invalidTarget, "Cannot cast this value");
}

// Borrow an explicit operand, or NODE when the argument is omitted.
// Comparisons use a distinct implicit arity because their bound is mandatory.
function operand(expression, scope, depth, index, implicit) {
   return expression.length === (implicit || index)? read(scope.node, depth)
      : argument(expression, index, scope, depth, borrow);
}

function evaluateValue(expression, scope, depth, borrowed) {
   var kind= type(expression), id, value, local, i, reference;
   location(scope);
   charge(1, 0, 0, depth);
   if (kind === TYPE_OBJECT)
      return construct(expression, scope, depth);
   if (kind !== TYPE_ARRAY)
      return copy(expression, depth);
   if (expression.length === 1 && isArray(get(expression, 0)))
      return argument(expression, 0, scope, depth, construct);
   id= operation(expression, expressions);
   // operation() proves integer type. These bounds also exclude unknown IDs:
   // references/matches are -5..19, functions are 50..78; 20..49 is reserved.
   if (id < CHARS + 1) {
      if (id < NODE + 1) {
         if (id === EXPR) // EXPR=-5
            return evaluate(macro(expression, scope, depth), scope, depth + 1, borrowed);
         if (id > CAP - 1) { // CAP=-4 through NODE=0
            reference= path(expression, scope, depth);
            value= read(reference, depth);
            value= borrowed? value : copy(value, depth);
            activeState.element= referenceElement(reference, depth);
            return value;
         }
      } else if (id < WITH + 1 || id > START - 1) // HAS=1..WITH=12, START=17..CHARS=19
         return match(expression, scope, depth);
   } else if (id > CAPTURE - 1 && id < MOD + 1) {
      if (id < JOIN + 1) {
         if (id < CONCAT + 1) {
            if (id < LENGTH + 1) {
               if (id < LOCAL + 1) {
                  if (id < CAPTURE + 1) { // CAPTURE=50
                     arity(expression, 2, 2);
                     return argument(expression, 1, scope, depth, captureMatch);
                  } else { // LOCAL=51
                     local= bindingScope(expression, scope, depth, true);
                     return argument(expression, expression.length - 1, local, depth);
                  }
               } else if (id < OR + 1) { // NOT=52, AND=53, OR=54
                  arity(expression, 2, Infinity);
                  charge(expression.length);
                  for (i= 1; i < expression.length; i++) {
                     value= argument(expression, i, scope, depth, borrow);
                     if (!isBoolean(value))
                        fail(invalidTarget, "Boolean functions require boolean arguments");
                     // AND stops at false; OR and NOT/NOR stop at true.
                     if (value === (id !== AND))
                        return id > OR - 1;
                  }
                  return id < AND + 1;
               }
               // LENGTH=55 falls through to the unary source reader below.
            } else if (id < CURPROP + 1) { // CURPROP=56
               arity(expression, 1, 1);
               return currentProperty(scope, depth);
            } else if (id < SLICE + 1) // SLICE=57
               return slice(expression, scope, depth);
            else // CONCAT=58
               return concat(expression, scope, depth);
         } else if (id < MAP + 1) // REDUCE=59, FILTER=60, MAP=61
            return iterate(expression, scope, depth, id);
         else { // SPLIT=62, JOIN=63
            arity(expression, 2, 3);
            local= argument(expression, 1, scope, depth, splitConfig);
            value= operand(expression, scope, depth, 2);
            return id < SPLIT + 1? splitString(value, local, depth) : joinArray(value, local);
         }
      } else if (id < CASTDATE + 1) {
         if (id < FAIL + 1) {
            if (id < MKOBJ + 1) {
               if (id < PROPS + 1) // PROPS=64
                  return objectProperties(expression, scope, depth);
               return makeObject(expression, scope, depth); // MKOBJ=65
            }
            // CASE=66, FAIL=67
            arity(expression, id < CASE + 1? 3 : 1, id < CASE + 1? Infinity : 1);
            if (id < CASE + 1) {
               // Conditions use match context; only one result is constructed.
               // A selected result's failure propagates rather than trying a fallback.
               charge(expression.length);
               for (i= 1; i < expression.length - 1; i+= 2)
                  if (argument(expression, i, scope, depth, match))
                     return argument(expression, i + 1, scope, depth);
               if (!(expression.length % 2))
                  return argument(expression, expression.length - 1, scope, depth);
            }
            fail(invalidTarget, id < CASE + 1? "No CASE condition matched" : "Explicit FAIL expression");
         }
         // CASTBOOL=68 through CASTDATE=71 share the LENGTH source reader.
      } else if (id < LESSEQ + 1) { // LESS=72, LESSEQ=73
         arity(expression, 2, 3);
         value= operand(expression, scope, depth, 1, 2);
         value= compare(value, argument(expression, expression.length - 1, scope, depth, borrow), depth);
         return id < LESS + 1? value < 0 : value <= 0;
      } else // ADD=74 through MOD=78
         return math(expression, scope, depth, id);
      // Only LENGTH=55 and CASTBOOL=68..CASTDATE=71 can reach this point.
      arity(expression, 1, 2);
      value= operand(expression, scope, depth, 1);
      return id < LENGTH + 1? lengthOf(value) : id > CASTDATE - 1? castDate(value) : cast(id, value, depth);
   }
   fail(invalidGraft, "Unsupported value expression");
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

// Return -1/0/1 for orderable same-type values. Arrays visit each required
// pair once, stopping at the first difference; unsupported visited elements
// still fail even when identical. Date precision is part of its logical type.
function compare(left, right, depth) {
   var kind= type(left), a, b, info, other, result, i= 0, j= 0;
   charge(1, 0, 0, depth);
   if (kind !== type(right)) fail(invalidTarget, "Comparison requires matching types");
   if (kind === TYPE_DATE) {
      a= dateRecord(left);
      b= dateRecord(right);
      if (a.count !== b.count) fail(invalidTarget, "Comparison requires matching date precision");
      left= dateComparable(a, depth);
      right= dateComparable(b, depth);
      kind= TYPE_ARRAY;
   }
   if (kind === TYPE_STRING) {
      info= stringInfo(left);
      other= stringInfo(right);
      charge((left.length + right.length) * 0.001);
   }
   // Native code-unit order agrees with codepoint order when neither string
   // has a surrogate pair. Otherwise decode only the compared prefix.
   if (kind === TYPE_ARRAY || info && (info.checkpoints || other.checkpoints)) {
      while (i < left.length && j < right.length) {
         charge(1);
         if (info) {
            a= character(info, i);
            b= character(other, j);
         } else {
            if (!present(left, i) || !present(right, j))
               fail(invalidTarget, "Cannot compare a missing or pending-deletion element");
            a= get(left, i);
            b= get(right, j);
         }
         result= info? a - b : compare(a, b, depth + 1);
         if (result) return result < 0? -1 : 1;
         i+= info? character(info, i, true) : 1;
         j+= info? character(other, j, true) : 1;
      }
      left= left.length - i;
      right= right.length - j;
   } else if (kind !== TYPE_NUMBER && kind !== TYPE_BOOLEAN && kind !== TYPE_STRING)
      fail(invalidTarget, "This type is not orderable");
   if (left !== left || right !== right) fail(invalidTarget, "NaN is not orderable");
   return left < right? -1 : left > right? 1 : 0;
}

// Enumerate only own keys, sorted by the same Unicode order as LESS/LESSEQ.
// Names need no value traversal; value-bearing forms own independent copies.
function objectProperties(expression, scope, depth) {
   var option= get(expression, 2), source, names, values, value, i;
   arity(expression, 1, 3);
   if (expression.length === 3 && option !== 1 && option !== 2)
      fail(invalidGraft, "PROPS requires literal option 1 or 2");
   source= operand(expression, scope, depth, 1);
   if (type(source) !== TYPE_OBJECT)
      fail(invalidTarget, "PROPS requires an object");
   names= keys(source);
   charge(names.length * (1 + Math.log(names.length || 1) / Math.LN2), names.length * 16);
   names.sort(function(left, right) {return compare(left, right, depth);});
   if (expression.length < 3) return names;
   values= make(true);
   charge(names.length, names.length * 8);
   for (i= 0; i < names.length; i++) {
      value= copy(get(source, names[i]), depth + 1);
      values.push(option === 1? makePair(names[i], value) : value);
   }
   return option === 1? values : makePair(names, values);
}

// Allocate an owned two-element array with one combined resource charge.
function makePair(left, right) {
   charge(2, 48, 1);
   return [left, right];
}

// Fold explicit value operands, or ADD/MUL's sole array operand as numeric
// data. Every operand is checked, including factors after zero. Math returns
// only finite numbers; MOD corrects remainder signs without a second division.
// Caller restricts id to ADD=74, SUB=75, MUL=76, DIV=77, or MOD=78.
function math(expression, scope, depth, id) {
   // Only ADD/MUL use the initializer; SUB/DIV/MOD replace it at i=0.
   var fold= id < ADD + 1 || id === MUL, single= expression.length === 2;
   var source, array= false, count= expression.length - 1, result= id > MUL - 1? 1 : 0, value, i;
   arity(expression, fold? 1 : 3, fold? Infinity : 3);
   if (single) {
      source= argument(expression, 1, scope, depth, borrow);
      array= isArray(source);
      if (array) count= source.length;
   }
   charge(count);
   for (i= 0; i < count; i++) {
      if (array && !present(source, i))
         fail(invalidTarget, "Cannot enumerate a missing or pending-deletion element");
      value= array? get(source, i) : single? source : argument(expression, i + 1, scope, depth, borrow);
      if (!isNumber(value)) fail(invalidTarget, "Math requires numeric operands");
      if (!fold && !i)
         result= value;
      else {
         if (id > DIV - 1 && value === 0) fail(invalidTarget, "Division by zero");
         result= id < ADD + 1? result + value : id < SUB + 1? result - value
            : id < MUL + 1? result * value : id < DIV + 1? result / value : result % value;
         if (id > MOD - 1 && result && (result < 0) !== (value < 0)) {
            result+= value;
            // Floating correction may round to the excluded divisor boundary.
            if (result === value && isFinite(value)) result= 0;
         }
         if (!isFinite(result)) fail(result !== result? invalidTarget : unsupportedGraft, "Nonfinite arithmetic result");
      }
   }
   return result;
}

// A singleton operand is a codepoint, one-codepoint string, or null (maximum).
// Other strings and operand categories return -1 for the class parser.
function charPoint(value) {
   var info;
   if (isNull(value)) return 1114111;
   if (isNumber(value)) {
      if (!integer(value) || value < 0 || value > 1114111)
         fail(invalidOperand, "Invalid Unicode codepoint");
      return value;
   }
   if (isString(value)) {
      info= stringInfo(value);
      if (character(info, 0, true) === value.length) return character(info, 0);
   }
   return -1;
}

function numericOrder(left, right) {return left - right;}

// Sorted toggle boundaries describe half-open intervals. Decode a list once,
// then coalesce duplicates/adjacent points without enumerating any ranges.
function charList(text) {
   var info= stringInfo(text), points= make(true), result= make(true), i, point;
   charge(text.length * 3, text.length * 24);
   for (i= 0; i < text.length; i+= character(info, i, true)) points.push(character(info, i));
   charge(points.length * (1 + Math.log(points.length || 1) / Math.LN2));
   points.sort(numericOrder);
   for (i= 0; i < points.length; i++) {
      point= points[i];
      if (!result.length || point > result[result.length - 1]) result.push(point, point + 1);
      else if (point === result[result.length - 1]) result[result.length - 1]++;
   }
   return result;
}

// Merge inversion lists as union (include) or subtraction (exclude). Inputs
// remain immutable, allowing imported/cached classes to share boundary arrays.
function charCombine(left, right, include) {
   var result= make(true), i= 0, j= 0, a= false, b= false, previous= false, point, inside;
   charge((left.length + right.length) * 2, (left.length + right.length) * 8);
   while (i < left.length || j < right.length) {
      point= Math.min(i < left.length? left[i] : Infinity, j < right.length? right[j] : Infinity);
      if (left[i] === point) {a= !a; i++;}
      if (right[j] === point) {b= !b; j++;}
      inside= include? a || b : a && !b;
      if (inside !== previous) result.push(point);
      previous= inside;
   }
   return result;
}

// Compile literal classes per application and common-expression namespace.
// Computed EXPR names (including aliases) disable caching for their parents;
// they may depend on the current character or a lexical TEMP binding.
function charClass(expression, scope, depth) {
   var cache= activeState.charsets || (activeState.charsets= make(true)), result, value, child, source, level;
   var include= true, first, last, i, id;
   charge(cache.length, 0, 0, depth);
   for (i= 0; i < cache.length; i++)
      if (cache[i].source === expression && cache[i].scope === scope.expr) return cache[i];
   result= make();
   result.source= expression;
   result.scope= scope.expr;
   result.dynamic= false;
   result.points= make(true);
   charge(expression.length);
   for (i= 1; i < expression.length; i++) {
      value= get(expression, i);
      if (isBoolean(value)) {
         include= value;
         if (i === 1 && !value) {
            charge(1, 16);
            result.points.push(0, 1114112);
         }
         continue;
      }
      if (isArray(value)) {
         activeState.graftPath.push(i);
         source= value;
         level= depth;
         do {
            charge(1, 0, 0, ++level);
            id= get(source, 0);
            if (id !== "EXPR" && id !== EXPR)
               fail(invalidOperand, "CHARS operands must reference a CHARS expression");
            if (isArray(get(source, 1))) result.dynamic= true;
            source= macro(source, scope, level);
         } while (isArray(source) && (get(source, 0) === "EXPR" || get(source, 0) === -5));
         if (!isArray(source) || get(source, 0) !== "CHARS" && get(source, 0) !== CHARS)
            fail(invalidOperand, "Common expression must resolve to CHARS");
         child= charClass(source, scope, level);
         result.dynamic= result.dynamic || child.dynamic;
         child= child.points;
         activeState.graftPath.pop();
      } else {
         if (!isNull(value) && !isNumber(value) && !isString(value))
            fail(invalidOperand, "Invalid CHARS operand");
         first= argument(expression, i, scope, depth, charPoint);
         if (first < 0)
            child= charList(value);
         else {
            last= i + 1 < expression.length? argument(expression, i + 1, scope, depth, charPoint) : -1;
            if (last < 0) last= first;
            else i++;
            if (first > last) fail(invalidOperand, "Descending character range");
            child= make(true);
            charge(1, 16);
            child.push(first, last + 1);
         }
      }
      result.points= charCombine(result.points, child, include);
   }
   if (!result.dynamic) {
      charge(1, 8);
      cache.push(result);
   }
   return result;
}

function charsMatch(expression, scope, depth) {
   var points= charClass(expression, scope, depth).points, value= read(scope.node, depth);
   var low= 0, high= points.length, middle;
   if (!isNumber(value) && !isString(value)) return false;
   value= charPoint(value);
   if (value < 0) return false;
   charge(1 + Math.log(high + 1) / Math.LN2);
   while (low < high) {
      middle= Math.floor((low + high) / 2);
      if (points[middle] <= value) low= middle + 1;
      else high= middle;
   }
   return !!(low % 2);
}

// Keep immutable strings and small indexes per application. The fixed two-unit
// regex has no unbounded backtracking; charge its full linear scan beforehand.
// Strings without pairs need neither checkpoints nor per-character decoding.
function stringInfo(text) {
   var list= activeState.strings || (activeState.strings= make(true)), info, i;
   charge(list.length);
   for (i= 0; i < list.length; i++) {
      charge((list[i].text.length + text.length) * 0.001);
      if (list[i].text === text)
         return list[i];
   }
   charge(text.length, 80);
   info= make();
   info.text= text;
   info.checkpoints= regexpTest.call(surrogatePair, text)? make(true) : null;
   info.length= info.checkpoints? null : text.length;
   info.index= info.offset= 0;
   if (info.checkpoints) {
      charge(1, 8);
      info.checkpoints.push(0);
   }
   charge(1, 8);
   list.push(info);
   return info;
}

// Map a nonnegative codepoint index to UTF-16, or seek Infinity to count the
// whole string. Reuse a forward cursor or begin at the nearest checkpoint.
// Checkpoints are built lazily every 256 codepoints; no character array is made.
// A seek beyond the end stops there and records the actual codepoint length.
function stringOffset(info, index) {
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
      charge(count * 2);
      for (i= 0; i < count && offset < info.text.length; i++) {
         offset+= character(info, offset, true);
         position++;
      }
      if (position % 256 === 0 && position / 256 === points.length) {
         charge(1, 8);
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

function lengthOf(value) {
   var info;
   if (!isArray(value) && !isString(value))
      fail(invalidTarget, "Expected an array or string");
   if (!isString(value))
      return value.length;
   info= stringInfo(value);
   if (isNull(info.length))
      stringOffset(info, Infinity);
   return info.length;
}

// SLICE reads only its selected span, so pending deletions outside that span do
// not invalidate it. Returned elements are independent materialized values.
function slice(expression, scope, depth) {
   var value, offset, count, limit, config, names, reference, result, entries, i, kind, total, info;
   arity(expression, 2, 4);
   value= argument(expression, 1, scope, depth, borrow);
   if (expression.length === 2 && type(value) === TYPE_OBJECT) {
      config= value;
      if (owns(config, "path")) {
         if (!isArray(get(config, "path")))
            fail(invalidOperand, "SLICE path must be an array");
         charge(1, 80, 2);
         reference= path(["NODE", [get(config, "path")]], scope, depth);
         value= read(reference, depth);
      } else
         value= read(scope.node, depth);
      total= lengthOf(value);
      offset= get(config, "ofs");
      count= get(config, "len");
      limit= get(config, "lim");
      names= [offset, count, limit];
      charge(3, 56, 1);
      for (i= 0; i < names.length; i++)
         if (names[i] !== undefined && (!integer(names[i]) || names[i] < 0))
            fail(invalidOperand, "Invalid SLICE range");
      if (offset === undefined)
         offset= count !== undefined && limit !== undefined? limit - count : 0;
      if (limit === undefined)
         limit= count !== undefined? offset + count : total;
      if (count !== undefined && offset + count !== limit)
         fail(invalidOperand, "Inconsistent SLICE range");
   } else {
      total= lengthOf(value);
      arity(expression, 3, 4);
      offset= argument(expression, 2, scope, depth);
      count= expression.length === 4? argument(expression, 3, scope, depth) : undefined;
      if (!integer(offset) || count !== undefined && !integer(count))
         fail(invalidOperand, "SLICE requires integer offsets/counts");
      offset= offset < 0? total + offset : offset;
      limit= count === undefined? total : count < 0? total + count : offset + count;
   }
   kind= type(value);
   if (offset < 0 || offset > limit || limit > total)
      fail(invalidTarget, "SLICE range is out of bounds");
   if (kind === TYPE_STRING) {
      info= stringInfo(value);
      offset= stringOffset(info, offset);
      limit= stringOffset(info, limit);
      charge(limit - offset, (limit - offset) * 2);
      return stringSlice.call(value, offset, limit);
   }
   charge(limit - offset, (limit - offset) * 8);
   result= make(true);
   entries= make(true);
   appendRange(entries, value, offset, limit, depth);
   rebuild(result, make(), entries);
   return result;
}

function concat(expression, scope, depth) {
   var result, value, kind, entries= make(true), i;
   arity(expression, 2, Infinity);
   charge(expression.length);
   for (i= 1; i < expression.length; i++) {
      value= argument(expression, i, scope, depth, borrow);
      if (i === 1) {
         kind= type(value);
         result= kind === TYPE_ARRAY? make(true) : "";
      }
      if (type(value) !== kind || kind !== TYPE_ARRAY && kind !== TYPE_STRING)
         fail(invalidTarget, "CONCAT requires matching arrays or strings");
      if (kind === TYPE_STRING) {
         charge(result.length + value.length, (result.length + value.length) * 2);
         result+= value;
      } else {
         charge(value.length);
         appendRange(entries, value, 0, value.length, depth);
      }
   }
   if (kind === TYPE_ARRAY)
      rebuild(result, make(), entries);
   return result;
}

// Iterate with NODE aliasing source[index]. REDUCE borrows each read-only
// accumulator and materializes only its final result. FILTER copies selected
// source values; MAP constructs one result per element. Both carry source
// metadata, never metadata from a transform's returned element reference.
// Caller restricts id to REDUCE=59, FILTER=60, or MAP=61.
function iterate(expression, scope, depth, id) {
   var reduce= id < REDUCE + 1, map= id > MAP - 1, minimum= reduce? 4 : 2;
   var name, accumulator, source, local, entries, value, result, i;
   arity(expression, minimum, minimum + 1);
   if (reduce) {
      name= get(expression, 2);
      if (!isString(name) && !isNumber(name))
         fail(invalidOperand, "REDUCE requires a literal string or number accumulator name");
      name= String(name);
      accumulator= argument(expression, 3, scope, depth, borrow);
   }
   source= operand(expression, scope, depth, minimum);
   if (!isArray(source)) fail(invalidTarget, "Iteration requires an array");
   local= valueScope(scope, source);
   local.node.keys.push(0);
   if (reduce)
      local.temp= holder(copy(scope.temp.value, depth, true), true);
   else
      entries= make(true);
   charge(source.length);
   for (i= 0; i < source.length; i++) {
      if (!present(source, i)) fail(invalidTarget, "Cannot iterate a missing or pending-deletion element");
      local.node.keys[0]= i;
      if (reduce) put(local.temp.value, name, accumulator);
      value= argument(expression, 1, local, depth, reduce? borrow : map? evaluate : match);
      if (reduce)
         accumulator= value;
      else if (map || value)
         entry(entries, map? value : copy(get(source, i), depth + 1), true, elementAt(source, i));
   }
   if (reduce) return copy(accumulator, depth);
   result= make(true);
   rebuild(result, make(), entries);
   return result;
}

// Materialize operands once in caller scope, then select alternating pairs,
// parallel arrays, or a pair list by their evaluated shapes. All values are
// independently owned; only string, unique own keys reach the safe writer.
function makeObject(expression, scope, depth) {
   var values= make(true), result= make(), names, pairs, pair, name, value, count, i;
   charge(expression.length, expression.length * 8);
   for (i= 1; i < expression.length; i++)
      values.push(argument(expression, i, scope, depth));
   count= values.length;
   if (count === 1 && isArray(values[0])) {
      pairs= values[0];
      count= pairs.length;
   } else if (count === 2 && isArray(values[0])) {
      names= values[0];
      values= values[1];
      if (!isArray(values) || names.length !== values.length)
         fail(invalidTarget, "MKOBJ requires equally sized name and value arrays");
      count= names.length;
   } else {
      if (!count || count % 2)
         fail(invalidTarget, "MKOBJ requires name/value pairs");
      count/= 2;
   }
   charge(count);
   for (i= 0; i < count; i++) {
      pair= pairs? get(pairs, i) : null;
      if (pairs && (!isArray(pair) || pair.length !== 2))
         fail(invalidTarget, "MKOBJ property entries must be two-element arrays");
      name= pairs? get(pair, 0) : get(names || values, names? i : i * 2);
      value= pairs? get(pair, 1) : get(values, names? i : i * 2 + 1);
      if (!isString(name) || owns(result, name))
         fail(invalidTarget, "MKOBJ requires unique string property names");
      put(result, name, value);
   }
   return result;
}

// Classify a pattern before evaluation: match roots retain regex syntax;
// function/reference roots resolve once to literal strings in the caller scope.
// Save the physical graft location for errors raised during deferred matching.
function splitPattern(source, scope, depth) {
   var result= make(), expression= source, id= null;
   while (isArray(expression)) {
      charge(1, 0, 0, depth);
      id= expression.length === 1 && isArray(get(expression, 0))? null
         : operation(expression, expressions);
      if (id !== EXPR) break;
      expression= macro(expression, scope, depth++);
   }
   result.regex= !isNull(id) && id > HAS - 1 && id < CHARS + 1; // HAS=1 through CHARS=19
   result.expression= result.regex? expression : borrow(source, scope, depth);
   if (!result.regex && !isString(result.expression))
      fail(invalidOperand, "SPLIT requires string or regex patterns");
   result.depth= depth;
   result.path= copyPath(activeState.graftPath);
   result.length= result.regex? null : lengthOf(result.expression);
   return result;
}

function splitConfig(source, scope, depth) {
   var result= make(), names, key, i, raw, simple= type(source) !== TYPE_OBJECT;
   result.scope= scope;
   if (simple) {
      raw= make();
      raw.sep= source;
      source= raw;
   }
   names= keys(source);
   charge(names.length);
   for (i= 0; i < names.length; i++) {
      key= names[i];
      if (key !== "sep" && key !== "default" && key !== "trim" && key !== "ltrim"
            && key !== "rtrim" && key !== "discard" && key !== "keep" && key !== "element")
         fail(invalidOperand, "Unknown SPLIT option: " + key);
   }
   if (owns(source, "trim") && (owns(source, "ltrim") || owns(source, "rtrim")))
      fail(invalidOperand, "SPLIT trim conflicts with ltrim/rtrim");
   if (!owns(source, "sep"))
      fail(invalidOperand, "SPLIT requires a separator");
   result.keep= get(source, "keep");
   if (owns(source, "keep") && result.keep !== "<" && result.keep !== ">" && result.keep !== "@")
      fail(invalidOperand, "Invalid SPLIT keep mode");
   result.pattern= simple? splitPattern(get(source, "sep"), scope, depth + 1)
      : argument(source, "sep", scope, depth, splitPattern);
   result.variable= result.pattern.regex && !result.keep;
   if (result.variable && !owns(source, "default"))
      fail(invalidOperand, "A regex SPLIT separator requires a default");
   result.separator= result.keep? "" : result.variable
      ? argument(source, "default", scope, depth, borrow) : result.pattern.expression;
   if (!isString(result.separator))
      fail(invalidOperand, "A regex SPLIT separator requires a string default");
   if (owns(source, "trim"))
      result.left= result.right= argument(source, "trim", scope, depth, splitPattern);
   else {
      result.left= owns(source, "ltrim")? argument(source, "ltrim", scope, depth, splitPattern) : null;
      result.right= owns(source, "rtrim")? argument(source, "rtrim", scope, depth, splitPattern) : null;
   }
   result.element= owns(source, "element")? argument(source, "element", scope, depth, splitPattern) : null;
   result.discard= get(source, "discard") === true;
   if (owns(source, "discard") && !isBoolean(get(source, "discard")))
      fail(invalidOperand, "SPLIT discard must be boolean");
   return result;
}

// Return the longest consumed length, or -1. Suffix matching scans starts in
// ascending order and requires an endpoint at the view end. Literal patterns
// avoid successor allocation and still enforce both Unicode/view boundaries.
function matchPattern(pattern, cursor, position, ending) {
   var length, start, offset, end, positions, i, count, best= -1;
   var path= activeState.graftPath, captures= activeState.captures;
   if (!pattern) return 0;
   activeState.graftPath= pattern.path;
   activeState.captures= null;
   try {
      length= sequenceLength(cursor, true);
      if (!pattern.regex) {
         start= ending? length - pattern.length : position;
         if (start < position || start + pattern.length > length) return -1;
         offset= stringOffset(cursor.info, cursor.start + start);
         end= offset + pattern.expression.length;
         charge(pattern.expression.length + 4, pattern.expression.length * 2);
         return stringSlice.call(cursor.info.text, offset, end) === pattern.expression
            && stringBoundary(cursor.info.text, end, !!cursor.info.checkpoints)? pattern.length : -1;
      }
      start= position;
      do {
         charge(1);
         positions= sequenceTerm(pattern.expression, cursor.scope, pattern.depth,
            start * 32 + 16, cursor);
         count= isNumber(positions)? 1 : positions.length;
         charge(count);
         for (i= 0; i < count; i++) {
            end= isNumber(positions)? positions : positions[i];
            if (end >= start && end <= length && (!ending || end === length))
               best= Math.max(best, end - start);
         }
         if (best >= 0 || !ending) return best;
      } while (start++ < length);
      return -1;
   } finally {
      activeState.graftPath= path;
      activeState.captures= captures;
   }
}

// A reusable view supplies anchored element/trim matching without creating an
// index or scope for each substring. Metadata distinguishes a real empty
// separator from the final remainder, which inherits its predecessor's separator.
function splitAppend(result, split, view, start, end, separator, config) {
   var left, right, offset, limit, item, text= view.info.text;
   view.start= start;
   view.length= end - start;
   left= Math.max(0, matchPattern(config.left, view, 0, false));
   view.start+= left;
   view.length-= left;
   right= Math.max(0, matchPattern(config.right, view, 0, true));
   offset= stringOffset(view.info, start + left);
   limit= stringOffset(view.info, end - right);
   charge(end - start + 1, (limit - offset) * 2 + 8);
   result.push(stringSlice.call(text, offset, limit));
   if (split) {
      item= make();
      offset= stringOffset(view.info, start);
      limit= stringOffset(view.info, end);
      charge(1, config.discard? 0 : (limit - offset) * 2);
      item.left= config.discard? "" : stringSlice.call(text, offset, stringOffset(view.info, start + left));
      item.right= config.discard? "" : stringSlice.call(text, stringOffset(view.info, end - right), limit);
      item.sep= !isNull(separator)? separator : split.items.length
         ? split.items[split.items.length - 1].sep : config.separator;
      charge(1, 8);
      split.items.push(item);
   }
}

function splitString(text, config, depth) {
   var result= make(true), info, split, cursor, view, length, matched, sep, offset;
   var start= 0, field= 0, position= 0;
   if (!isString(text))
      fail(invalidTarget, "SPLIT requires a string");
   cursor= sequenceCursor(config.scope, text);
   view= sequenceCursor(config.scope, text);
   length= sequenceLength(cursor, true);
   if (config.variable || !config.discard && (config.left || config.right)) {
      info= arrayInfo(result, true);
      split= info.split= make();
      split.origin= make();
      split.origin.separator= config.separator;
      split.items= make(true);
   }
   while (position <= length) {
      charge(3, 0, 0, depth);
      matched= matchPattern(config.pattern, cursor, position, false);
      if (matched >= 0 && !(matched === 0 && position === start) && config.element) {
         view.start= start;
         view.length= position - start;
         if (matchPattern(config.element, view, 0, false) !== view.length) matched= -1;
      }
      if (matched < 0 || matched === 0 && position === start) {
         if (position !== length) {
            position++;
            continue;
         }
         // Empty input has one empty field unless its separator matches empty.
         if (start < length || !length && matched < 0)
            splitAppend(result, split, view, field, length, null, config);
         break;
      }
      offset= stringOffset(cursor.info, position);
      charge(matched + 1, matched * 4);
      sep= stringSlice.call(text, offset, stringOffset(cursor.info, position + matched));
      // A zero-width end match only flushes the final field. Its metadata
      // inherits the preceding separator, and keep must not add a new element.
      splitAppend(result, split, view, field,
         position + (config.keep === "<"? matched : 0), position === length? null : config.keep? "" : sep, config);
      if (config.keep === "@" && position !== length)
         splitAppend(result, split, view, position, position + matched, "", config);
      field= config.keep === ">"? position : position + matched;
      start= position + matched;
      if (position === length) break;
      if (matched && start === length) {
         splitAppend(result, split, view, field, length, null, config);
         break;
      }
      position= matched? start : position + 1;
   }
   if (info && !result.length) info.split= null;
   return result;
}

function joinArray(array, config) {
   var info, item, pieces= make(true), value, length= 0, i;
   if (!isArray(array))
      fail(invalidTarget, "JOIN requires an array");
   info= arrayInfo(array);
   charge(array.length, array.length * 32);
   for (i= 0; i < array.length; i++) {
      value= get(array, i);
      if (!present(array, i) || !isString(value))
         fail(invalidTarget, "A split array must contain strings");
      item= info && info.split? info.split.items[i] : null;
      pieces.push(item && !config.discard? item.left : "", value,
         item && !config.discard? item.right : "",
         i + 1 === array.length? "" : config.variable && item? item.sep : config.separator);
   }
   charge(pieces.length);
   for (i= 0; i < pieces.length; i++)
      length+= pieces[i].length;
   charge(length, length * 2);
   return pieces.join("");
}

function splitAction(expression, scope, depth) {
   var config, value, i;
   arity(expression, 2, Infinity);
   config= argument(expression, 1, scope, depth, splitConfig);
   value= splitString(read(scope.node, depth), config, depth);
   write(scope.node, value, depth, true);
   charge(expression.length - 2);
   for (i= 2; i < expression.length; i++)
      argument(expression, i, scope, depth, action);
   value= joinArray(read(scope.node, depth), config);
   write(scope.node, value, depth, true);
}

// Copy lexical bindings while sharing holders whose data must remain visible.
function scopeCopy(scope) {
   var result= make(), key;
   for (key in scope) {
      charge(1);
      if (owns(scope, key))
         result[key]= scope[key];
   }
   return result;
}

// Metadata constants are evaluated sequentially; macros retain their encoded
// expression form and are expanded lazily when referenced.
function declarations(metadata, key, scope, depth) {
   var source= get(metadata, key), name, value, i;
   if (!owns(metadata, key))
      return;
   if (!isArray(source) || source.length % 2)
      fail(invalidGraft, "Metadata declarations require name/value pairs");
   activeState.graftPath.push(1, key);
   charge(source.length);
   for (i= 0; i < source.length; i+= 2) {
      name= get(source, i);
      if (!isString(name) && !integer(name))
         fail(invalidGraft, "Invalid metadata declaration name");
      value= key === "const"? argument(source, i + 1, scope, depth) : get(source, i + 1);
      put(key === "const"? scope.constants.value : scope.expr, String(name), value);
   }
   activeState.graftPath.pop();
   activeState.graftPath.pop();
}

// Retain one complete diagnostic only after all operands succeed. Value
// evaluation owns its data; export private dates before exposing the snapshot.
// Unicode scalar decoding permits paired surrogates but rejects lone ones.
function logAction(expression, scope, depth) {
   var level= get(expression, 1), message, info, point, entry, code, i;
   arity(expression, 3, 4);
   if (isString(level))
      level= level === "info"? 0 : level === "warn"? 1 : level === "fail"? 2 : -1;
   if (level !== 0 && level !== 1 && level !== 2)
      fail(invalidGraft, "Invalid LOG level");
   code= isArray(get(expression, 2))? invalidTarget : invalidGraft;
   message= argument(expression, 2, scope, depth);
   if (!isString(message))
      fail(code, "LOG requires a string message");
   info= stringInfo(message);
   charge(message.length);
   for (i= 0; i < message.length; i+= character(info, i, true)) {
      point= character(info, i);
      if (point < 32 || point >= 127 && point < 160
            || point >= 0xD800 && point <= 0xDFFF
            || point >= 0xFDD0 && point <= 0xFDEF || (point & 65535) >= 65534)
         fail(code, "Forbidden LOG message codepoint");
   }
   entry= make();
   entry.level= level;
   entry.message= message;
   if (expression.length === 4)
      entry.data= exportDates(argument(expression, 3, scope, depth), depth);
   location(scope);
   entry.graftPath= copy(activeState.graftPath, depth);
   entry.inputPath= copy(activeState.inputPath, depth);
   charge(1, 72);
   activeState.logs.push(entry);
   if (level === 2)
      fail("NO_MATCH", message);
}

function action(expression, inherited, depth) {
   var id, scope, metadata, reference, value, element, i;
   location(inherited);
   charge(1, 0, 0, depth);
   if (!isArray(expression))
      fail(invalidGraft, "Expected an action array");
   id= operation(expression, actions);
   scope= scopeCopy(inherited);
   // TEMP lasts for exactly this action, including all pairs of one COPY.
   scope.temp= holder(make(), true);
   // Integer IDs are -1..6 or LOG=10. Validate the gaps once so every
   // decision below needs only its partition's upper bound.
   if (id < ACT_JGRAFT || id > ACT_SPLIT && id !== ACT_LOG)
      fail(invalidGraft, "Unsupported action");
   if (id < ACT_COPY + 1) {
      if (id < ACT_AT + 1) {
         if (id < ACT_JGRAFT + 1) { // JGRAFT=-1
            arity(expression, 2, Infinity);
            metadata= get(expression, 1);
            if (type(metadata) !== TYPE_OBJECT || owns(metadata, "v")
                  && (!integer(get(metadata, "v")) || get(metadata, "v") < 1))
               fail(invalidGraft, "Invalid JGraft metadata or version");
            if (get(metadata, "v") > 1)
               fail(unsupportedGraft, "Unsupported JGraft version");
            scope.constants= holder(copy(scope.constants.value, depth, true), true);
            scope.expr= copy(scope.expr, depth, true);
            declarations(metadata, "const", scope, depth);
            declarations(metadata, "expr", scope, depth);
            // Constant declarations can see the parent's stash before this reset.
            scope.stash= holder(make(), true);
            i= 2;
         } else { // AT=0
            arity(expression, 2, Infinity);
            reference= argument(expression, 1, scope, depth, path);
            if (reference.namespace !== 0)
               fail(invalidGraft, "AT requires a NODE reference");
            read(reference, depth);
            scope.node= reference;
            i= 2;
         }
      } else if (id < ACT_MATCH + 1) { // MATCH=1
         arity(expression, 2, Infinity);
         value= argument(expression, 1, scope, depth, captureMatch);
         if (value === false) {
            activeState.graftPath.push(1);
            location(scope);
            fail("NO_MATCH", "Current node does not match");
         }
         scope.cap= holder(value, true);
         i= 2;
      } else if (id < ACT_IF + 1) { // IF=2
         charge(expression.length);
         for (i= 1; i + 1 < expression.length; i+= 2)
            if ((value= argument(expression, i, scope, depth, captureMatch)) !== false) {
               scope.cap= holder(value, true);
               i++;
               break;
            }
         // A final singleton is the else action and retains inherited captures.
         if (i < expression.length)
            argument(expression, i, scope, depth, action);
         return;
      } else { // COPY=3
         if (expression.length % 2 !== 1)
            fail(invalidGraft, "COPY requires value/path pairs");
         charge(expression.length);
         for (i= 1; i < expression.length; i+= 2) {
            // Finish the source before resolving a destination that may overlap it.
            value= argument(expression, i, scope, depth);
            element= activeState.element;
            activeState.graftPath.push(i + 1);
            reference= path(get(expression, i + 1), scope, depth + 1, true);
            write(reference, value, depth + 1, true, element);
            activeState.graftPath.pop();
         }
         return;
      }
   } else if (id < ACT_SPLICE + 1) { // MOVE=4, SPLICE=5
      (id < ACT_MOVE + 1? move : splice)(expression, scope, depth);
      return;
   } else if (id < ACT_SPLIT + 1) { // SPLIT=6
      splitAction(expression, scope, depth);
      return;
   } else { // LOG=10; 7..9 and >10 were rejected above.
      logAction(expression, scope, depth);
      return;
   }
   charge(expression.length - i);
   for (; i < expression.length; i++)
      argument(expression, i, scope, depth, action);
}

// apply(input[, {clone:true}]) leaves input unchanged and returns the new tree.
// clone requests independence from all input/graft objects, including Dates.
// Counts/logs are replaced for each attempt, including failures. Config limits are
// copied at construction; apply options are borrowed for this synchronous call.
JGraft.prototype.apply= function(input, options) {
   var previousState= activeState, state, scope;
   try {
      state= createState(this, input);
      scope= make();
      scope.node= make();
      scope.node.tree= state.tree;
      scope.node.keys= make(true);
      scope.constants= holder(make(), true);
      scope.stash= holder(make(), true);
      scope.temp= holder(make(), true);
      scope.cap= holder(make(), true);
      scope.expr= make();
      if (!isArray(this._graft) || get(this._graft, 0) !== "JGRAFT")
         fail(invalidGraft, "The root action must be JGRAFT");
      action(this._graft, scope, 1);
      // Detach untouched branches only after execution, using the same counters.
      if (get(options, "clone") === true)
         state.tree.value= copy(state.tree.value, 1);
      return state.tree.value;
   } finally {
      activeState= previousState;
   }
};

global.JGraft= JGraft;

// Resolve the host global outside the strict-mode function.
})(typeof window !== "undefined"? window
   : typeof global !== "undefined"? global
   : typeof self !== "undefined"? self
   : this);
