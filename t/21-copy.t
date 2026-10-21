//; use lib do { (my $x= __FILE__) =~ s{[^/]+\z}{lib}; $x }; use TestJGraft -load => '../src/JGraft.js';

TAP(function(t) {
   function run(input, action, options) {
      return new JGraft(['JGRAFT', {v: 1}, action]).apply(input, options);
   }
   function errorOf(graft, input, options) {
      try {
         graft.apply(input, options);
      } catch (error) {
         return error;
      }
      return {};
   }
   function own(value, key) {
      return Object.getOwnPropertyDescriptor(value, key).value;
   }

   TestJGraft.runConformanceTests(t, {
      version: 1,
      name: 'Native Date COPY',
      tests: [
         {
            name: 'COPY a Date without changing the original',
            input: {source: new Date(1234567890123)},
            jgraft: ['JGRAFT', {v: 1}, ['COPY', ['NODE', 'source'], 'copy']],
            output: {source: new Date(1234567890123), copy: new Date(1234567890123)}
         },
         {
            name: 'COPY a subtree containing Dates',
            input: {source: {dates: [new Date(0), new Date(-1234567890123)]}},
            jgraft: ['JGRAFT', {v: 1}, ['COPY', ['NODE', 'source'], 'copy']],
            output: {
               source: {dates: [new Date(0), new Date(-1234567890123)]},
               copy: {dates: [new Date(0), new Date(-1234567890123)]}
            }
         }
      ]
   });

   t.subtest('copy-on-write and output ownership', function(t) {
      var input= {branch: {a: 1, b: 2}, keep: {date: new Date(0)}};
      var output= run(input, ['COPY', 3, ['NODE', 'branch', 'a'], 4, ['NODE', 'branch', 'b']]);
      t.ok(output !== input && output.branch !== input.branch, 'changed ancestors are cloned');
      t.is(output.keep, input.keep, 'untouched branch remains shared');
      t.is(input.branch.a, 1, 'first input value is unchanged');
      t.is(input.branch.b, 2, 'second input value is unchanged');
      t.is(output.branch.a, 3, 'first write is retained');
      t.is(output.branch.b, 4, 'second write is retained');
      output= run(input, ['COPY', ['NODE', 'keep'], 'other']);
      t.ok(output.other !== input.keep && output.other.date !== input.keep.date,
         'COPY materializes referenced objects and Dates');
      output.other.date.setTime(99);
      t.is(input.keep.date.getTime(), 0, 'editing a copied Date leaves source unchanged');
      output= run(input, ['COPY', 3, ['NODE', 'branch', 'a']], {clone: true});
      t.ok(output.keep !== input.keep && output.keep.date !== input.keep.date,
         'clone option also detaches untouched objects and Dates');
      var literal= {items: [[1, 2]], date: new Date(0)};
      var graft= new JGraft(['JGRAFT', {v: 1}, ['COPY', literal, 'a']]);
      output= graft.apply({});
      output.a.items[0]= 9;
      output.a.date.setTime(10);
      t.is(literal.items[0][0], 1, 'output edits cannot change graft array literals');
      t.is(literal.date.getTime(), 0, 'output edits cannot change graft Date literals');
      t.is(graft.apply({}).a.items[0], 1, 'reusing a graft reconstructs its literals');
      var date= new Date(1234);
      date.getTime= function() { throw new Error('external Date method was invoked'); };
      output= run({date: date}, ['COPY', ['NODE', 'date'], 'other']);
      t.is(Date.prototype.getTime.call(output.other), 1234, 'Date copying uses the trusted built-in method');
   });

   t.subtest('own properties and prototype safety', function(t) {
      function Input() {}
      Input.prototype= {inherited: {x: 1}};
      var input= new Input(), output, error;
      input.own= 2;
      error= errorOf(new JGraft(['JGRAFT', {v: 1}, ['COPY', ['NODE', 'inherited'], 'copy']]), input);
      t.is(error.code, 'INVALID_TARGET', 'inherited input values are never readable');
      output= run(input, ['COPY', 3, ['NODE', 'inherited', 'x']]);
      t.is(output.inherited.x, 3, 'write auto-vivifies an own container');
      t.is(Input.prototype.inherited.x, 1, 'write does not alter the external prototype');
      error= errorOf(new JGraft(['JGRAFT', {v: 1}, ['COPY', ['NODE', '__proto__'], 'copy']]), {});
      t.is(error.code, 'INVALID_TARGET', 'magic __proto__ accessor is not input data');
      output= run({}, ['COPY', {safe: 1}, '__proto__', 2, ['NODE', '__proto__', 'x'],
         ['NODE', '__proto__'], 'copy']);
      t.is(Object.getPrototypeOf(output), Object.prototype, 'writing __proto__ preserves the real prototype');
      t.is(own(output, '__proto__').x, 2, 'nested writes use the own __proto__ data property');
      t.is(output.copy.safe, 1, 'reading __proto__ uses the own data property');
      t.is(Object.prototype.x, undefined, 'Object.prototype remains unchanged');
      var poison= function() { throw new Error('external method was invoked'); };
      input= {toString: poison, hasOwnProperty: poison, valueOf: poison};
      output= run(input, ['COPY', 1, 'value']);
      t.is(output.value, 1, 'input methods are never invoked');
   });

   t.subtest('scopes, macros, and computed paths', function(t) {
      var graft= new JGraft(['JGRAFT', {v: 1, const: ['x', 1],
         expr: ['value', {a: ['CONST', 'x']}, 'target', ['NODE', 'result']]},
         ['COPY', ['EXPR', 'value'], ['EXPR', 'target']],
         ['JGRAFT', {const: ['x', 2]}, ['COPY', ['EXPR', 'value'], 'inner']],
         ['COPY', ['EXPR', 'value'], 'outer']]);
      var output= graft.apply({});
      t.is(output.result.a, 1, 'macro constructs a value and supplies a destination');
      t.is(output.inner.a, 2, 'inherited macro uses inner constants');
      t.is(output.outer.a, 1, 'outer constant scope is restored');
      graft= new JGraft(['JGRAFT', {v: 1},
         ['COPY', 1, ['STASH', 'x']],
         ['JGRAFT', {}, ['COPY', ['STASH'], 'inner']],
         ['COPY', ['STASH', 'x'], 'outer'],
         ['AT', 'inner', ['COPY', 2, 'a'], ['COPY', 3, 'b']],
         ['COPY', ['LOCAL', 'x', 7, null, {value: ['TEMP', 'x']}, ['NODE', 'value']], 'local']]);
      output= graft.apply({});
      t.is(output.outer, 1, 'nested JGRAFT restores the outer stash');
      t.is(output.inner.a, 2, 'AT selects the child');
      t.is(output.inner.b, 3, 'subsequent AT action sees earlier edits');
      t.is(output.local, 7, 'LOCAL bindings are sequential and can rebind NODE');
      t.is(output.a, undefined, 'AT does not change the outer current node');
      output= run({}, ['COPY', 1, ['NODE', [[]]]]);
      t.is(output, 1, 'an empty expanded path selects the current node');
      t.is(run('hello', ['COPY', ['LENGTH'], ['NODE']]), 5, 'LENGTH can read the current node');
      t.is(run({}, ['COPY', ['LOCAL', 0.5, 9, ['TEMP', '0.5']], ['NODE']]), 9,
         'LOCAL numeric binding names are coerced to strings');
      t.is(run({}, ['COPY', [[1]], ['NODE'], 2, false]).length, 2, 'root replacement precedes append resolution');
      var error= errorOf(new JGraft(['JGRAFT', {v: 1}, ['AT', ['STASH'], ['COPY', 1, 'a']]]), {});
      t.is(error.code, 'INVALID_GRAFT', 'AT cannot select an external namespace');
      error= errorOf(new JGraft(['JGRAFT', {v: 1}, ['COPY', 1, 'a', ['FAIL'], 'b']]), {});
      t.is(error.inputPath.length, 0, 'expression failure does not retain the previous destination path');
   });

   t.subtest('resource limits', function(t) {
      var kinds= ['mem', 'ops', 'new_obj', 'depth'], i, limits, graft, error;
      for (i= 0; i < kinds.length; i++) {
         limits= {};
         limits[kinds[i]]= 0;
         graft= new JGraft(['JGRAFT', {v: 1}, ['COPY', 1, 'a']], {limits: limits});
         error= errorOf(graft, {});
         t.is(error.code, 'RESOURCE_LIMIT', kinds[i] + ': limit is enforced');
         t.is(error.resource, kinds[i], kinds[i] + ': failed counter is identified');
         t.is(error.counts, graft.counts, kinds[i] + ': counts are retained');
      }
      // No exact counter totals are assumed: final cloning must exceed the
      // budget measured from applying the identical graft without that option.
      var input= {keep: {list: [1, 2, 3]}}, spec= ['JGRAFT', {v: 1}, ['COPY', 1, 'a']];
      graft= new JGraft(spec);
      graft.apply(input);
      error= errorOf(new JGraft(spec, {limits: {new_obj: graft.counts.new_obj}}), input, {clone: true});
      t.is(error.code, 'RESOURCE_LIMIT', 'final cloning consumes the same resource budget');
      t.is(input.a, undefined, 'clone failure leaves input unchanged');
      graft= new JGraft(['JGRAFT', {v: 1, expr: ['loop', ['EXPR', 'loop']]},
         ['COPY', ['EXPR', 'loop'], 'a']], {limits: {depth: 20}});
      error= errorOf(graft, {});
      t.is(error.code, 'RESOURCE_LIMIT', 'recursive expression stops at the depth limit');
      t.is(error.resource, 'depth', 'recursion is charged to depth');
      var nested= 1;
      for (i= 0; i < 30; i++)
         nested= {child: nested};
      graft= new JGraft(['JGRAFT', {v: 1}, ['COPY', ['NODE', 'a'], 'b']], {limits: {depth: 15}});
      error= errorOf(graft, {a: nested});
      t.is(error.code, 'RESOURCE_LIMIT', 'deep referenced data also consumes depth');
      var bad= false;
      try {
         new JGraft(spec, {limits: {ops: -1}});
      } catch (invalid) {
         bad= invalid instanceof TypeError;
      }
      t.ok(bad, 'negative resource limits are rejected');
   });
   t.done_testing();
});
