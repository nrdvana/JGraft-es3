//; use lib do { (my $x= __FILE__) =~ s{[^/]+\z}{lib}; $x }; use TestJGraft -load => '../src/JGraft.js';

TAP(function(t) {
   function ownProto(value) {
      var result= {};
      Object.defineProperty(result, '__proto__', {
         value: value, writable: true, enumerable: true, configurable: true
      });
      return result;
   }
   function errorOf(instance, input, options) {
      try {
         instance.apply(input, options);
      } catch (error) {
         return error;
      }
      return {};
   }
   function spec(action) {
      return ['JGRAFT', {v: 1}, action];
   }
   function restricted(input, graft, limits) {
      return new JGraft(graft, {forbidProto: true, limits: limits}).apply(input);
   }
   function test(name, input, action) {
      return {name: name, input: input, jgraft: spec(action), errors: {UNSUPPORTED_GRAFT: true}};
   }

   t.subtest('parser detection and explicit configuration', function(t) {
      var parse= JSON.parse, config= {forbidProto: true}, instance, error;
      try {
         JSON.parse= function() {
            var result= ownProto(0);
            result.child= ownProto({probe: 1});
            return result;
         };
         t.is(new JGraft(spec(['COPY'])).forbidProto, false, 'a conforming parser leaves arbitrary property names enabled');
         JSON.parse= function() { return {child: ownProto({probe: 1})}; };
         t.is(new JGraft(spec(['COPY'])).forbidProto, true, 'silent scalar-key loss enables the restriction');
         JSON.parse= function() {
            var result= ownProto(0);
            result.child= {};
            result.child.__proto__= {probe: 1};
            return result;
         };
         t.is(new JGraft(spec(['COPY'])).forbidProto, true, 'a parser that sets the prototype enables the restriction');
         t.is(new JGraft(spec(['COPY']), {forbidProto: false}).forbidProto, false,
            'an explicit false overrides the parser default');
         instance= new JGraft(spec(['COPY', 1, '__proto__']), config);
         config.forbidProto= false;
         t.is(instance.forbidProto, true, 'the effective option is captured at construction');
         error= errorOf(instance, {});
         t.is(error.code, 'UNSUPPORTED_GRAFT', 'later configuration changes cannot allow the write');
      } finally {
         JSON.parse= parse;
      }
      var invalid= [null, 0, 'true', {}];
      for (var i= 0; i < invalid.length; i++) {
         error= null;
         try {
            new JGraft(spec(['COPY']), {forbidProto: invalid[i]});
         } catch (caught) {
            error= caught;
         }
         t.ok(error instanceof TypeError, 'forbidProto requires an actual boolean: ' + i);
      }
   });

   TestJGraft.runConformanceTests(t, {
      version: 1, name: 'Forbidden __proto__ operations', tests: [
         test('Read an existing __proto__ property', ownProto(1), ['COPY', ['NODE', '__proto__'], 'x']),
         test('Read an absent __proto__ property', {}, ['COPY', ['NODE', '__proto__'], 'x']),
         test('A forbidden selector after a missing parent', {}, ['COPY', ['NODE', 'missing', '__proto__'], 'x']),
         test('Write a literal destination', {}, ['COPY', 1, '__proto__']),
         test('Write a computed destination', {key: '__proto__'}, ['COPY', 1, ['NODE', ['NODE', 'key']]]),
         test('Write an expanded destination', {path: ['__proto__']}, ['COPY', 1, ['NODE', ['NODE', 'path']]]),
         test('Construct a forbidden property', {}, ['COPY', ownProto(1), 'x']),
         test('Copy a subtree with a forbidden property', {source: ownProto(1)}, ['COPY', ['NODE', 'source'], 'x']),
         test('Clone an input parent with a forbidden property', ownProto(1), ['COPY', 2, 'x']),
         test('Move from a forbidden property', ownProto(1), ['MOVE', '__proto__', 'x']),
         test('Move to a forbidden property', {x: 1}, ['MOVE', 'x', '__proto__']),
         test('Splice below a forbidden property', ownProto([1]), ['SPLICE', ['NODE', '__proto__', 0], 1]),
         test('Write a forbidden temporary property', {}, ['COPY', 1, ['TEMP', '__proto__']]),
         test('Read a forbidden constant property', {}, ['COPY', ['CONST', '__proto__'], 'x']),
         test('Read a forbidden common expression name', {}, ['COPY', ['EXPR', '__proto__'], 'x']),
         test('Match a forbidden pattern property', {}, ['MATCH', ownProto(['EXISTS'])]),
         test('Exact matching enumerates input properties', ownProto(1), ['MATCH', ['IS', {}]]),
         test('NONE cannot swallow an unsupported read', {}, ['MATCH', ['NONE', ['NODE', '__proto__']]]),
         test('ANY cannot skip an unsupported alternative', {}, ['MATCH', ['ANY', ['NODE', '__proto__'], {}]]),
         test('IF cannot fall through an unsupported condition', {}, ['IF', ['HAS', ['NODE', '__proto__'], 1],
            ['COPY', 1, 'x'], ['COPY', 2, 'x']]),
         test('A constructed comparison value cannot contain a forbidden property', {},
            ['COPY', ['IS', ownProto(1)], 'x'])
      ]
   }, restricted);

   t.subtest('restriction boundaries and input isolation', function(t) {
      var input= ownProto({x: 1}), output, error, instance;
      output= new JGraft(['JGRAFT', {v: 1}], {forbidProto: true}).apply(input);
      t.is(output, input, 'untouched input is not traversed or reparsed');
      error= errorOf(new JGraft(['JGRAFT', {v: 1}], {forbidProto: true}), input, {clone: true});
      t.is(error.code, 'UNSUPPORTED_GRAFT', 'final cloning enforces the restriction');
      output= new JGraft(spec(['COPY', '__proto__', 'value']), {forbidProto: true}).apply({});
      t.is(output.value, '__proto__', 'the spelling is permitted as ordinary string data');
      output= new JGraft(spec(['COPY', ['NODE', '__proto__'], 'copy']), {forbidProto: false}).apply(input);
      t.is(output.copy.x, 1, 'explicit opt-out supports descriptor-built input on every engine');
      instance= new JGraft(['JGRAFT', {v: 1}, ['COPY', 2, 'done'], ['COPY', 3, '__proto__']], {forbidProto: true});
      error= errorOf(instance, input);
      t.is(error.code, 'UNSUPPORTED_GRAFT', 'copy-on-write refuses to clone a forbidden property');
      t.is(Object.getOwnPropertyDescriptor(input, '__proto__').value.x, 1, 'input data remains unchanged');
      error= errorOf(instance, {});
      t.is(error.partial.done, 2, 'previous successful edits remain in the partial output');
      t.is(error.partial.__proto__, Object.prototype, 'a forbidden write has not changed the prototype');
      t.is(error.graftPath.join('.'), '3.2', 'an unsupported destination identifies its argument');
      t.is(error.counts, instance.counts, 'unsupported failures expose the attempt counters');
      error= errorOf(new JGraft(['JGRAFT', {v: 1, const: ['__proto__', 1]}], {forbidProto: true}), {});
      t.is(error.code, 'UNSUPPORTED_GRAFT', 'constant declarations enforce forbidden property names');
      error= errorOf(new JGraft(['JGRAFT', {v: 1, expr: ['__proto__', 1]}], {forbidProto: true}), {});
      t.is(error.code, 'UNSUPPORTED_GRAFT', 'common-expression declarations enforce forbidden names');
   });

   t.subtest('unsupported versus malformed versions', function(t) {
      var input= {}, error, i;
      error= errorOf(new JGraft(['JGRAFT', {v: 2}]), input);
      t.is(error.code, 'UNSUPPORTED_GRAFT', 'a future version is unsupported');
      t.is(error.partial, input, 'version rejection precedes edits');
      error= errorOf(new JGraft(['JGRAFT', {v: 1}, ['COPY', 1, 'done'],
         ['JGRAFT', {v: 2}, ['COPY', 2, 'done']]]), input);
      t.is(error.code, 'UNSUPPORTED_GRAFT', 'nested declarations check their version');
      t.is(error.partial.done, 1, 'nested version rejection retains previous edits');
      var invalid= [0, -1, 1.5, 2.5, '2', null, true];
      for (i= 0; i < invalid.length; i++) {
         error= errorOf(new JGraft(['JGRAFT', {v: invalid[i]}]), input);
         t.is(error.code, 'INVALID_GRAFT', 'malformed version remains invalid: ' + invalid[i]);
      }
      t.is(new JGraft(['JGRAFT', {}]).apply(input), input, 'omitted version metadata retains its existing behavior');
   });
   t.done_testing();
});
