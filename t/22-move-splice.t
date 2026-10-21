//; use lib do { (my $x= __FILE__) =~ s{[^/]+\z}{lib}; $x }; use TestJGraft -load => '../src/JGraft.js';

TAP(function(t) {
   function graft(actions, limits) {
      return new JGraft(['JGRAFT', {v: 1}].concat(actions), {limits: limits, forbidProto: false});
   }
   function errorOf(instance, input, options) {
      try {
         instance.apply(input, options);
      } catch (error) {
         return error;
      }
      return {};
   }
   function own(object, key) {
      return Object.getOwnPropertyDescriptor(object, key).value;
   }

   t.subtest('MOVE transfers ownership without copying values', function(t) {
      var input= {source: {nested: {value: 1}}, keep: {}}, output;
      output= graft([['MOVE', 'source', 'dest']]).apply(input);
      t.is(output.dest, input.source, 'a moved shared subtree retains its identity');
      t.is(output.keep, input.keep, 'untouched siblings remain shared');
      t.is(output.source, undefined, 'source is removed from output');
      t.is(input.source.nested.value, 1, 'source remains in the original input');
      output= graft([
         ['COPY', {}, 'owned'],
         ['MOVE', 'source', ['NODE', 'owned', 'child']],
         ['COPY', 9, ['NODE', 'owned', 'child', 'nested', 'value']]
      ]).apply(input);
      t.is(output.owned.child.nested.value, 9, 'moved subtree can be edited inside an owned parent');
      t.is(input.source.nested.value, 1, 'ownership transfer does not authorize changing shared input');
      t.ok(output.owned.child !== input.source, 'later edits clone moved shared ancestors');
      output= graft([
         ['COPY', [[null]], 'owned'],
         ['MOVE', 'source', ['NODE', 'owned', 0]],
         ['SPLICE', ['NODE', 'owned', 0], 1, ['NODE', 'owned', 0]],
         ['COPY', 8, ['NODE', 'owned', 0, 'nested', 'value']]
      ]).apply(input);
      t.is(output.owned[0].nested.value, 8, 'SPLICE can follow a move into an owned array');
      t.is(input.source.nested.value, 1, 'rebuilt array retains correct ownership markers');
      var deep= {value: 1};
      for (var i= 0; i < 100; i++)
         deep= {child: deep};
      output= graft([['MOVE', 'source', 'dest']], {depth: 20}).apply({source: deep});
      t.is(output.dest, deep, 'MOVE does not traverse the moved subtree');
      var date= new Date(1234);
      output= graft([['MOVE', 'date', 'dest']]).apply({date: date});
      t.is(output.dest, date, 'MOVE preserves a Date identity');
      output= graft([['MOVE', 'date', 'dest']]).apply({date: date}, {clone: true});
      t.ok(output.dest !== date && output.dest.getTime() === 1234, 'clone option detaches moved Dates');
   });

   t.subtest('pending edits follow arrays and preserve their ownership', function(t) {
      var input= {list: [{x: 1}, {x: 2}, {x: 3}]};
      var output= graft([
         ['MOVE', ['NODE', 'list', 0], ['TEMP', 0], 'list', ['STASH', 0],
            ['TEMP', 0], ['STASH', 0, 1.5], ['STASH', 0], 'result'],
         ['COPY', 9, ['NODE', 'result', 1, 'x']]
      ]).apply(input);
      t.is(output.result.length, 3, 'pending deletion and insertion are both finalized');
      t.is(output.result[0], input.list[1], 'surviving element identity is preserved');
      t.is(output.result[1].x, 9, 'queued moved element can be edited by a later action');
      t.is(input.list[0].x, 1, 'queued shared element was still protected by copy-on-write');
      output= graft([['MOVE', 0, null, null, ['NODE', ['LENGTH', ['NODE']]]]]).apply([1, 2]);
      t.is(JSON.stringify(output), '[2,null]', 'LENGTH can inspect an array with pending deletions');
      output= graft([['MOVE', 2, null, null, ['NODE', ['SLICE', ['NODE'], 0, 1]]]]).apply([0, 1, 2]);
      t.is(JSON.stringify(output), '[null,1]', 'SLICE can inspect a span outside the pending deletion');
      output= graft([
         ['MOVE', 0, 1.5, 1, -0.5],
         ['COPY', 9, ['NODE', 1, 'x']]
      ]).apply([{x: 1}, {x: 2}, {x: 3}]);
      t.is(output[1].x, 9, 'ownership markers follow reordered elements');
      t.is(output[0].x, 2, 'half-index insertions use their final numeric order');
   });

   t.subtest('SPLICE snapshots values and shares untouched data', function(t) {
      var input= {list: [{x: 1}, {x: 2}], keep: {}}, output;
      output= graft([['SPLICE', ['NODE', 'list', 0], 1]]).apply(input);
      t.is(output.list[0], input.list[1], 'surviving array values remain shared');
      t.is(output.keep, input.keep, 'unrelated objects remain shared');
      t.ok(output.list !== input.list, 'the changed array is detached');
      t.is(input.list.length, 2, 'input array is unchanged');
      output= graft([
         ['SPLICE', ['NODE', 'list', 0], 1, ['NODE', 'list', 0], ['NODE', 'list', 0]],
         ['COPY', 9, ['NODE', 'list', 0, 'x']]
      ]).apply(input);
      t.is(output.list[0].x, 9, 'an inserted reference can be modified');
      t.is(output.list[1].x, 1, 'repeated inserted references are independent');
      t.is(input.list[0].x, 1, 'inserted references are independent of the input');
      output= graft([['SPLICE', ['NODE', 'list', false], 0]]).apply(input);
      t.is(output, input, 'a no-op splice does not clone the tree');
      var error= errorOf(graft([['SPLICE', ['NODE', 'list', 0], 1, 9, ['FAIL']]]), input);
      t.is(error.code, 'INVALID_TARGET', 'replacement failure aborts the splice');
      t.is(error.partial, input, 'replacement failure precedes all target edits');
      t.is(error.graftPath.join('.'), '2.4', 'replacement error points to the failing argument');
   });

   t.subtest('prototype-safe editing and failed MOVE pairs', function(t) {
      var input= {source: {x: 1}, bad: 7}, error, output;
      error= errorOf(graft([['MOVE', 'source', ['NODE', 'bad', 'child']]]), input);
      t.is(error.code, 'INVALID_TARGET', 'invalid destination fails');
      t.is(error.partial, input, 'destination is checked before removing the source');
      error= errorOf(graft([['MOVE', 'missing', 'target']]), input);
      t.is(error.graftPath.join('.'), '2.1', 'missing MOVE source identifies its argument');
      var special= {}, array= [1, 2];
      Object.defineProperty(special, '__proto__', {
         value: array, writable: true, enumerable: true, configurable: true
      });
      output= graft([['SPLICE', ['NODE', '__proto__', 0], 1, 9]]).apply(special);
      t.is(own(output, '__proto__')[0], 9, 'SPLICE replaces a cloned __proto__ array');
      t.is(array[0], 1, 'prototype-key input array remains unchanged');
      t.is(Object.getPrototypeOf(output), Object.prototype, 'actual prototype is unchanged');
      output= graft([
         ['MOVE', '__proto__', 'saved'],
         ['MOVE', 'saved', '__proto__'],
         ['COPY', 7, ['NODE', '__proto__', 0]]
      ]).apply(special);
      t.is(own(output, '__proto__')[0], 7, 'MOVE round-trip preserves safe property access and ownership');
      t.is(array[0], 1, 'MOVE round-trip still protects the original array');
      error= errorOf(graft([['MOVE', 0, 1.5, 1, null, 1, null]]), [1, 2, 3]);
      t.is(error.code, 'INVALID_TARGET', 'reading a pending deletion fails');
      t.is(JSON.stringify(error.partial), '[null,null,3]', 'failed MOVE leaves null slots and discards queued inserts');
      t.is(error.partial.length, 3, 'partial array preserves pre-compaction positions');
   });

   t.subtest('SPLIT metadata construction and basic expressions', function(t) {
      var output= graft([
         ['SPLIT', {sep: ['ANY', ',', ';'], default: ',', trim: ' '},
            ['COPY', [[['NODE', 1], ['NODE', 0]]], ['NODE']]]
      ]).apply(' a ; b ');
      t.is(output, ' b ; a ', 'constructed arrays preserve direct-reference trimming and separators');
      output= graft([['COPY', ['SLICE', {ofs: 1, lim: 3}], ['NODE']]]).apply([0, 1, 2, 3]);
      t.is(JSON.stringify(output), '[1,2]', 'SLICE supports range objects');
      output= graft([['COPY', ['CONCAT', [[1]], [[2, 3]]], ['NODE']]]).apply(null);
      t.is(JSON.stringify(output), '[1,2,3]', 'CONCAT constructs arrays');
      output= graft([['COPY', ['NOT', false, true, ['FAIL']], ['NODE']]]).apply(null);
      t.is(output, false, 'NOT short-circuits at the first true argument');
      var error= errorOf(graft([['COPY', ['NOT', 1], ['NODE']]]), null);
      t.is(error.code, 'INVALID_TARGET', 'NOT does not silently coerce non-booleans');
      error= errorOf(graft([['COPY', ['SLICE', null, 0], ['NODE']]]), null);
      t.is(error.code, 'INVALID_TARGET', 'SLICE rejects a scalar with a structured error');
   });

   t.subtest('resource accounting and large replacement lists', function(t) {
      var actions= [
         ['MOVE', 0, 2.5, 1, -0.5],
         ['SPLICE', 1, 1, {x: 9}]
      ];
      var input= [{x: 1}, {x: 2}, {x: 3}], instance= graft(actions), output, error, limits, kind;
      instance.apply(input);
      for (kind in instance.counts) {
         limits= {};
         limits[kind]= Math.max(0, instance.counts[kind] / 2);
         error= errorOf(graft(actions, limits), input);
         t.is(error.code, 'RESOURCE_LIMIT', kind + ': budget is enforced during edits');
         t.is(error.resource, kind, kind + ': correct counter is identified');
      }
      t.is(JSON.stringify(input), '[{"x":1},{"x":2},{"x":3}]', 'resource failures do not change input');
      // Deliberately exceed old engines' native Function.apply argument limit.
      // The implementation must use bounded loops rather than spreading args.
      var large= ['SPLICE', 0, 0];
      for (var i= 0; i < 66000; i++)
         large.push(i);
      output= graft([large], {ops: Infinity, mem: Infinity, new_obj: Infinity}).apply([]);
      t.is(output.length, 66000, 'large replacement list is not constrained by native call arity');
      t.is(output[65999], 65999, 'last large replacement is present');
   });
   t.done_testing();
});
