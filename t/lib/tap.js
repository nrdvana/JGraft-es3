/* This is an implementation of the Test Anything Protocol - TAP.
 * https://testanything.org/
 * (this implementation is not official or affiliated with testanything.org)
 *
 * This file defines a global function / namespace named 'TAP' if it wasn't already
 * defined.  Callers can use it as:
 *
 *   TAP(function(t){
 *     t.is(...)
 *     t.like(...)
 *     t.subtest(function(t){
 *       t.note(...)
 *       t.is(...)
 *     })
 *     t.todo('Not implemented yet', function(t) {
 *       t.is(...)
 *     })
 *   })
 *
 * to queue additional tests to be executed.  Execution is delayed until the document is loaded.
 * This library can be loaded using:
 *
 *   eval(require('fs').readFileSync('./tap.js', 'utf8'))
 *
 * or in a broswer as:
 *
 *   <script src="tap.js"></script>
 *
 */
(function(){
   "use strict";

   // utility function for generating DOM nodes
   function _node(tag, cls, content) {
      var n= document.createElement(tag)
      n.className= Array.isArray(cls)? cls.join(' ') : cls
      if (content != null) {
         if (!Array.isArray(content)) content= [ content ]
         for (var i= 0; i < content.length; i++) {
            n.appendChild(
               (typeof content[i] == 'object')? content[i]
               : document.createTextNode(content[i])
            )
         }
      }
      return n
   }
   // are we running in a browser or in Node.js ?
   var use_dom_output= typeof document !== 'undefined' && typeof window !== 'undefined';

   var g = typeof globalThis !== 'undefined' ? globalThis
         : typeof global !== 'undefined' ? global
         : typeof window !== 'undefined' ? window
         : typeof self !== 'undefined' ? self
         : this;
   // This file can be eval'd multiple times.  Only generate the TAP object on the first eval.
   if (!g.TAP) {

      var TAP; TAP= function() {
         // ()              root TAP object
         // (function)      assign test script of root TAP object
         // (parent, name)  create a subtest
         if (arguments.length == 1 && typeof arguments[0] == 'function') {
            g.TAP.root.run_when_loaded(arguments[0])
            // Not running as a constructor
            return;
         }
         this.results= []
         this.success= true
         this.actual_success= true
         this.failed_count= 0
         this.prefix= ''
         this.subtest_level= 0
         this.subtestPath= []
         this.subtestFilter= null
         this._subtestSelected= false
         if (!arguments.length) {
            if (use_dom_output)
               this.output_el= _node('div', ['tap-output','root'], '')
         }
         else if (arguments.length == 2) {
            var parent= arguments[0]
            this._todo= parent._todo
            this.subtestPath= parent.subtestPath.concat(String(arguments[1]))
            this.subtestFilter= parent.subtestFilter
            this._subtestSelected= parent._subtestSelected
            this.name= arguments[1]
            this.message= 'Subtest: ' + this.name
            this.prefix= parent.prefix + '    '
            this.subtest_level= parent.subtest_level + 1
            if (use_dom_output) {
               var el= this.output_el= _node('div', ['tap-output','subtest'], [ _node('span','name',this.name) ])
               this.output_el.addEventListener('click', function(ev) {
                  el.classList.toggle('collapse')
                  ev.stopPropagation()
               });
               parent.output_el.appendChild(el)
            }
         }
      }

      // run a test script when page is loaded
      TAP.prototype.run_when_loaded= function(code) {
         if (!use_dom_output || document.readyState === 'complete' || document.readyState === 'interactive')
            this.run(code) // Node.js mode
         else {// Wait for DOM to load
            var self= this;
            document.addEventListener('DOMContentLoaded', function() { self.run(code) })
         }
      }

      // utility function for flattening things into a string
      TAP.stringify= function(content) {
         if (content === null)
            return '(null)';
         if (typeof content == 'object') {
            if (Array.isArray(content) || (content.length && typeof content[0] !== 'undefined')) {
               var txt= ''
               for (var i=0; i < content.length; i++)
                  txt += TAP.stringify(content[i])
               return txt
            }
            else if ('message' in content && 'lineNumber' in content)
               return content.message + ' at ' + content.fileName.replace(/[^\/]+\/\/[^\/]+\//, '') + ' line ' + content.lineNumber
            else {
               var json= JSON.stringify(content)
               if (json != '{}') // if JSON isn't useful, fall back to normal stringification
                  return json
            }
         }
         return ''+content
      }

      var own= Object.prototype.hasOwnProperty;
      var objectTag= Object.prototype.toString;
      var descriptor= Object.getOwnPropertyDescriptor;
      var dateTime= Date.prototype.getTime;
      var regexpString= RegExp.prototype.toString;
      var functionString= Function.prototype.toString;

      // Read descriptors rather than calling accessors, and avoid old V8's
      // broken bracket reads of own __proto__ data properties.
      var ownDescriptor= function(value, key) {
         return descriptor? descriptor(value, key) : {value: value[key]};
      };
      var kind= function(value) {
         return value === null? 'null' : typeof value === 'object'
            ? objectTag.call(value) : typeof value;
      };
      var sameScalar= function(a, b) {
         return a === b || a !== a && b !== b;
      };
      var pathText= function(path) {
         var text= '$', i;
         for (i= 0; i < path.length; i++)
            text+= '[' + JSON.stringify(path[i]) + ']';
         return text;
      };

      var arrayIndex= function(key, length) {
         var index= Number(key);
         return index >= 0 && index < length && Math.floor(index) === index && String(index) === key;
      };

      // Stable, bounded diagnostics without invoking user toJSON or getters.
      // Sparse slots, special numbers, Dates, and cycles remain distinguishable.
      TAP.format= function(value, maximum) {
         var remaining= maximum === undefined? 4096 : maximum, truncated= false, text= '', parents= [], paths= [];
         function write(part) {
            if (part.length > remaining) truncated= true;
            if (remaining > 0) {
               text+= part.slice(0, remaining);
               remaining-= part.length;
            }
         }
         function property(value, key, path) {
            var d= ownDescriptor(value, key);
            if (own.call(d, 'value'))
               visit(d.value, path);
            else
               write('[Accessor' + (d.get? ' get: ' + JSON.stringify(functionString.call(d.get)) : '')
                  + (d.set? ' set: ' + JSON.stringify(functionString.call(d.set)) : '') + ']');
         }
         function visit(value, path) {
            var type= kind(value), keys, extras, key, i;
            if (value === null || typeof value !== 'object') {
               write(typeof value === 'string'? JSON.stringify(value)
                  : typeof value === 'function'? '[Function ' + JSON.stringify(functionString.call(value)) + ']'
                  : String(value));
               return;
            }
            for (i= 0; i < parents.length; i++)
               if (parents[i] === value) {
                  write('[Circular ' + pathText(paths[i]) + ']');
                  return;
               }
            if (parents.length >= 32) {
               write('[Depth limit]');
               return;
            }
            parents.push(value);
            paths.push(path);
            if (type === '[object Date]')
               write('Date(' + dateTime.call(value) + ')');
            else if (type === '[object RegExp]')
               write(regexpString.call(value));
            keys= Object.keys(value).sort();
            if (type === '[object Array]') {
               write('[');
               for (i= 0; i < value.length && remaining > 0; i++) {
                  if (i) write(', ');
                  if (own.call(value, i)) property(value, String(i), path.concat(i));
                  else write('<hole>');
               }
               write(']');
               extras= [];
               for (i= 0; i < keys.length; i++) {
                  key= keys[i];
                  if (!arrayIndex(key, value.length))
                     extras.push(key);
               }
               keys= extras;
            }
            if (keys.length || type !== '[object Array]' && type !== '[object Date]' && type !== '[object RegExp]') {
               write('{');
               for (i= 0; i < keys.length && remaining > 0; i++) {
                  if (i) write(', ');
                  key= keys[i];
                  write(JSON.stringify(key) + ': ');
                  property(value, key, path.concat(key));
               }
               write('}');
            }
            parents.pop();
            paths.pop();
         }
         visit(value, []);
         return text + (truncated? ' ... [truncated]' : '');
      };

      // Compare all branches, stopping at a node whose type, own enumerable
      // keys, array length, accessor, or scalar value differs. An explicit work
      // stack avoids recursion limits; ancestor pairs terminate cyclic input.
      var differences= function(a, b, report, maximum) {
         var pending= [{a: a, b: b, path: [], parent: null}], count= 0;
         var node, type, keys, other, i, parent, left, right, reason, cyclic;
         while (pending.length && count < maximum) {
            node= pending.pop();
            a= node.a; b= node.b;
            if (sameScalar(a, b)) continue;
            type= kind(a);
            reason= type !== kind(b)? 'type' : null;
            if (!reason && (a === null || typeof a !== 'object'))
               reason= 'value';
            if (!reason && type === '[object Date]' && !sameScalar(dateTime.call(a), dateTime.call(b))
                  || !reason && type === '[object RegExp]' && regexpString.call(a) !== regexpString.call(b))
               reason= 'value';
            if (!reason) {
               keys= Object.keys(a).sort();
               other= Object.keys(b).sort();
               if (type === '[object Array]' && a.length !== b.length)
                  reason= 'length';
               if (keys.length !== other.length)
                  reason= 'properties';
               for (i= 0; i < keys.length && !reason; i++) {
                  if (keys[i] !== other[i]) reason= 'properties';
                  else {
                     left= ownDescriptor(a, keys[i]); right= ownDescriptor(b, keys[i]);
                     if (own.call(left, 'value') !== own.call(right, 'value')
                           || left.get !== right.get || left.set !== right.set)
                        reason= 'accessors';
                  }
               }
            }
            if (reason) {
               count++;
               if (report) report(node.path, a, b, reason, count);
               continue;
            }
            cyclic= false;
            for (parent= node.parent; parent; parent= parent.parent)
               if (parent.a === a && parent.b === b) { cyclic= true; break; }
            if (cyclic) continue;
            for (i= keys.length - 1; i >= 0; i--) {
               left= ownDescriptor(a, keys[i]); right= ownDescriptor(b, keys[i]);
               if (own.call(left, 'value'))
                  pending.push({a: left.value, b: right.value, parent: node,
                     path: node.path.concat(type === '[object Array]' && arrayIndex(keys[i], a.length)
                        ? Number(keys[i]) : keys[i])});
            }
         }
         return count;
      };

      TAP.deep_compare= function(a, b) {
         return differences(a, b, null, 1) === 0;
      };

      // Diagnostic only: it creates no assertions and changes no TAP status.
      // Arguments are old/expected then new/actual. Return the number printed;
      // an optional maximum defaults to 20, with an explicit truncation notice.
      TAP.prototype.noteDifferences= function(a, b, maximum) {
         var self= this, limit= maximum === undefined? 20 : maximum;
         if (typeof limit !== 'number' || limit < 0 || Math.floor(limit) !== limit)
            throw new TypeError('Difference limit must be a nonnegative integer or Infinity');
         var count= differences(a, b, function(path, oldValue, newValue, reason, index) {
            if (index > limit) {
               self.note('Further differences omitted');
               return;
            }
            self.note('Difference at ' + pathText(path) + ' (' + reason + ')');
            self.note('  old: ' + TAP.format(oldValue));
            self.note('  new: ' + TAP.format(newValue));
         }, limit + 1);
         return Math.min(count, limit);
      };

      // Emit a line of TAP syntax at current indent level
      TAP.prototype.emit= function(text, node) {
         if (!TAP.declared_version) {
            TAP.declared_version= 13
            this.emit('TAP version 13')
         }
         if (typeof process !== 'undefined' && process.stdout)
            process.stdout.write(this.prefix + text + "\n")
         else
            console.log(this.prefix + text)
         if (this.output_el && node)
            this.output_el.appendChild(node)
      }
      // Emit a comment at current indent level
      TAP.prototype.note= function() {
         var txt= ''
         for (var i=0; i < arguments.length; i++)
            txt += TAP.stringify(arguments[i])
         this.emit('# ' + txt, this.output_el == null? null : _node('div','note', '# ' + txt));
      }
      TAP.prototype.emit_exception= function(e) {
         var msg= '# Caught exception' + (this.subtest_level? ' in subtest: ' : ': ')
         this.emit(msg + (e && e.stack? String(e) : TAP.stringify(e)), this.output_el == null? null
            : _node('div', 'exception', [ msg, this.render_exception(e) ])
         )
         // Preserve source locations for engines whose Error objects only
         // expose them through stack, emitting each line as TAP commentary.
         if (e && e.stack) {
            var lines= String(e.stack).split(/\r?\n/)
            for (var i= 0; i < lines.length; i++)
               this.emit('# ' + lines[i])
         }
      }

      // Declare number of tests, before or after execution of tests
      TAP.prototype.plan= function(count, skipReason) {
         if (this._plan != null)
            throw "Plan was already declared";
         this._plan= count;
         this.skipped= count === 0 && !!skipReason;
         this.emit('1..' + count + (skipReason? ' # SKIP ' + skipReason : ''));
      }
      // Check plan, or declare the plan to be whatever number of tests ran
      TAP.prototype.done_testing= function(count) {
         var i;
         if (this._plan == null)
            this.plan(this.results.length)
         else if (this._plan != this.results.length) {
            this.note('Expected ' + this._plan + ' tests but ran ' + this.results.length)
            this.success= false
            this.actual_success= false
         }
         // A group is entirely skipped only if it explicitly skips its plan
         // or every child is skipped. Failures always retain their failure UI.
         if (!this.success)
            this.skipped= false
         else if (this.results.length) {
            this.skipped= true
            for (i= 0; i < this.results.length; i++)
               if (!this.results[i].skipped) {
                  this.skipped= false
                  break
               }
         }
         this.finished= true
      }

      // Add a pass/fail result
      TAP.prototype.add_result= function(result) {
         var actual= result.actual_success == null? result.success : result.actual_success
         if (this._todo !== undefined)
            result.todo_reason= this._todo
         var todo= result.todo_reason !== undefined
         var success= result.success || todo
         var reported= todo? actual : result.success
         var status= result.skipped? 'skipped':!success? 'fail':!actual? 'todo':'pass'
         var suffix= result.skipped? ' (skipped)' : todo || status === 'todo'
            ? ' (TODO' + (todo && result.todo_reason? ': ' + result.todo_reason : '') + ')' : ''
         this.results.push(result)
         var msg= (reported? 'ok ':'not ok ') + this.results.length
         if (result.message != null) msg+= ' - ' + result.message
         if (todo) msg+= ' # TODO' + (result.todo_reason? ' ' + result.todo_reason : '')
         this.emit(msg, this.output_el == null? null
            : _node('div', ['result', status], [
               _node('span', 'flag', reported? 'ok':'not ok'),
               _node('span', 'test-id', this.results.length),
               _node('span', 'message', (result.message != null ? result.message : '') + suffix),
            ])
         )
         if (result.subtest_level) {
            // Collapse fully passed/skipped subtests; keep TODO failures visible.
            if (result.output_el != null) {
               result.output_el.className += ' ' + status + (status === 'pass' || status === 'skipped'? ' collapse' : '')
               if (suffix)
                  result.output_el.firstChild.appendChild(document.createTextNode(suffix))
            }
            if (result.failed_count)
               this.note('Failed ' + result.failed_count + '/' + result.results.length + ' tests in subtest')
            if (result.exception != null)
               this.emit_exception(result.exception)
         }
         if (!actual)
            this.actual_success= false
         if (!success) {
            this.success= false
            this.failed_count++
         }
         return actual
      }
      // render an exception as DOM nodes.  TODO
      TAP.prototype.render_exception= function(e) {
         return _node('div', ['exception'], TAP.stringify(e))
      }
      // run a function of test script, setting this TAP object as the global default
      TAP.prototype.run= function(code) {
         var prev= TAP.current;
         try {
            TAP.current= this
            code.apply(this, [this])
         }
         catch(e) {
            this.success= false
            this.actual_success= false
            if (this.subtest_level)
               this.exception= e
            else // need to log imediately because no caller will report the exception
               this.emit_exception(e)
         }
         TAP.current= prev
         return this
      }
      // Select named groups by their name or complete "suite / case" path. Once a
      // group matches, execute all its descendants. Empty patterns disable it.
      TAP.prototype.filterSubtests= function(pattern) {
         try {
            this.subtestFilter= pattern == null || pattern === ''? null : new RegExp(pattern);
         } catch (error) {
            throw new Error('Invalid subtest filter: ' + error.message);
         }
         this._subtestSelected= false;
         this.note('Subtest filter: ' + TAP.format(pattern));
         return this;
      };

      // Containers discover descendants even when their own name does not
      // match. Other unmatched callbacks are never invoked; keep a real SKIP
      // plan and the original sibling numbering in both TAP and browser output.
      TAP.prototype.subtest= function(name, code, options) {
         var subtest= new TAP(this, name), filter= subtest.subtestFilter;
         this.emit('# Subtest: ' + name);
         if (filter && !subtest._subtestSelected) {
            filter.lastIndex= 0;
            subtest._subtestSelected= filter.test(String(name));
            if (!subtest._subtestSelected) {
               filter.lastIndex= 0;
               subtest._subtestSelected= filter.test(subtest.subtestPath.join(' / '));
            }
         }
         if (filter && !subtest._subtestSelected && !(options && options.container))
            subtest.plan(0, 'Filtered out by subtest filter');
         else
            subtest.run(code);
         subtest.done_testing();
         return this.add_result(subtest);
      };
      // Scope TODO to synchronous assertions/subtests in this callback. Nested
      // scopes restore their predecessor, even when the callback throws. Keep
      // exceptions propagating so an unhandled callback error is still fatal.
      TAP.prototype.todo= function(reason, code) {
         if (typeof reason !== 'string' || typeof code !== 'function')
            throw new TypeError('todo requires a reason and callback');
         var previous= this._todo;
         this._todo= reason.replace(/[\r\n]+/g, ' ');
         try {
            return code.call(this, this);
         } finally {
            this._todo= previous;
         }
      }
      // declare a test passed
      TAP.prototype.pass= function(message) {
         return this.add_result({ success: true, message: message })
      }
      // declare a test failed
      TAP.prototype.fail= function(message) {
         return this.add_result({ success: false, message: message })
      }
      // check two values for equality
      TAP.prototype.is= function(actual, expected, message) {
         var success= this.add_result({
            success: TAP.deep_compare(actual, expected),
            actual: actual,
            expected: expected,
            message: message
         });
         if (!success) this.noteDifferences(expected, actual);
         return success;
      }
      // check a value for boolean truth
      TAP.prototype.ok= function(success, message) {
         return this.add_result({
            success: !!success,
            actual: success,
            message: message
         });
      }

      // Initialize the global TAP instance
      TAP.current= TAP.root= new TAP()
      g.TAP= TAP
      // If rendering to DOM and DOM isn't loaded yet, attach the output_el as soon as it is
      if (use_dom_output) {
         var attach_global= function() {
            var parent_el= document.getElementById('tap-output')
            if (parent_el == null)
               parent_el= document.getElementsByTagName("BODY")[0];
            parent_el.appendChild(TAP.root.output_el);
         }
         if (document.readyState === 'interactive' || document.readyState == 'complete')
            attach_global()
         else
            document.addEventListener('DOMContentLoaded', attach_global)
      }
   }
})()
