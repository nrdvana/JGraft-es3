//; use lib do { (my $x= __FILE__) =~ s{[^/]+\z}{lib}; $x }; use TestJGraft -load => '../src/JGraft.js';

TAP(function(t) {
   function graft(actions, limits, metadata) {
      return new JGraft(['JGRAFT', metadata || {v: 1}].concat(actions), {limits: limits, forbidProto: false});
   }
   function errorOf(instance, input) {
      try {
         instance.apply(input);
      } catch (error) {
         return error;
      }
      return {};
   }
   var suite= JSON.parse(TestJGraft.readFile('../jgraft-spec/conformance/04-match.json'));
   TestJGraft.runConformanceTests(t, suite);

   t.subtest('matching borrows data and preserves copy-on-write ownership', function(t) {
      var input= {branch: {x: 1}, keep: {}}, output, instance;
      instance= graft([['MATCH', ['IS', ['NODE', 'branch'], {x: 1}]]]);
      output= instance.apply(input);
      t.is(output, input, 'a successful assertion preserves the input identity');
      output= graft([['MATCH', {branch: {x: 1}}, ['COPY', 2, ['NODE', 'branch', 'x']]]]).apply(input);
      t.is(output.branch.x, 2, 'subactions edit the original current node');
      t.is(input.branch.x, 1, 'subactions protect matched input data');
      t.is(output.keep, input.keep, 'untouched siblings remain shared');
      t.ok(output.branch !== input.branch, 'changed matched ancestors are cloned');
      // Borrowing EXISTS must not walk the subtree or materialize a copy.
      var deep= {};
      for (var i= 0; i < 100; i++)
         deep= {child: deep};
      output= graft([['MATCH', ['EXISTS']]], {depth: 10}).apply(deep);
      t.is(output, deep, 'EXISTS does not traverse its current subtree');
   });

   t.subtest('match errors, short-circuiting, and diagnostic paths', function(t) {
      var input= {a: 1}, error, output;
      output= graft([['MATCH', ['NONE', ['NODE', 'missing']], ['COPY', 2, 'a']]]).apply(input);
      t.is(output.a, 2, 'NONE treats a missing reference as a failed alternative');
      output= graft([['MATCH', ['ANY', ['NODE', 'missing'], {a: 1}, ['FAIL']]]]).apply(input);
      t.is(output, input, 'ANY recovers from a failed probe and stops at a match');
      output= graft([['COPY', ['ALL', false, ['UNKNOWN']], ['NODE']]]).apply(true);
      t.is(output, false, 'ALL stops after its first failed constraint');
      error= errorOf(graft([['MATCH', ['NONE', ['UNKNOWN']]]]), input);
      t.is(error.code, 'INVALID_GRAFT', 'NONE does not swallow invalid syntax');
      error= errorOf(graft([['MATCH', ['NONE', ['FAIL']], ['COPY', ['NODE', 'later'], 'a']]]), input);
      t.is(error.code, 'INVALID_TARGET', 'subaction failures escape MATCH');
      t.is(error.graftPath.join('.'), '2.2.1', 'a recovered probe does not pollute the subaction graft path');
      t.is(error.inputPath.join('.'), 'later', 'a recovered probe does not pollute the subaction input path');
      error= errorOf(graft([['AT', 'a', ['MATCH', 2]]]), input);
      t.is(error.code, 'NO_MATCH', 'a failed guard reports NO_MATCH');
      t.is(error.graftPath.join('.'), '2.2.1', 'NO_MATCH identifies the match specification');
      t.is(error.inputPath.join('.'), 'a', 'NO_MATCH retains the current action input path');
      t.is(error.partial, input, 'a failed assertion preserves the input identity');
      var foreign= new Error('application getter failure');
      foreign.code= 'INVALID_TARGET';
      Object.defineProperty(input, 'getter', {enumerable: true, get: function() { throw foreign; }});
      error= errorOf(graft([['MATCH', ['NONE', {getter: ['EXISTS']}]]]), input);
      t.is(error, foreign, 'an application exception is not mistaken for a library probe failure');
   });

   t.subtest('own properties and external prototypes', function(t) {
      function Input() {}
      Input.prototype= {inherited: 1};
      var input= new Input(), output, error, pattern;
      input.a= 1;
      output= graft([['MATCH', ['IS', {a: 1}]]]).apply(input);
      t.is(output, input, 'exact matching ignores inherited properties');
      error= errorOf(graft([['MATCH', {inherited: ['EXISTS']}]]), input);
      t.is(error.code, 'NO_MATCH', 'inherited properties do not satisfy EXISTS');
      // Build own __proto__ data without depending on the host JSON parser.
      input= {};
      pattern= {};
      Object.defineProperty(input, '__proto__', {value: {x: 1}, enumerable: true});
      Object.defineProperty(pattern, '__proto__', {value: {x: 1}, enumerable: true});
      output= graft([['MATCH', ['IS', pattern]]]).apply(input);
      t.is(output, input, 'exact matching reads own __proto__ data safely');
      pattern= {};
      Object.defineProperty(pattern, '__proto__', {value: {x: 2}, enumerable: true});
      error= errorOf(graft([['MATCH', ['IS', pattern]]]), input);
      t.is(error.code, 'NO_MATCH', 'a mismatch inside own __proto__ data is detected');
      t.is(Object.getOwnPropertyDescriptor(input, '__proto__').value.x, 1,
         'matching does not modify the own __proto__ subtree');
   });

   t.subtest('native Date matching', function(t) {
      var date= new Date(1234), input= {a: date, b: new Date(1234)}, output, error;
      date.getTime= function() { throw new Error('external Date method invoked'); };
      output= graft([['MATCH', ['IS', ['NODE', 'a'], ['NODE', 'b']]]]).apply(input);
      t.is(output, input, 'Dates compare by instant using the trusted built-in');
      output= graft([['MATCH', ['IS', new Date(1234)]]]).apply(date);
      t.is(output, date, 'a Date literal matches a native Date');
      error= errorOf(graft([['MATCH', ['HAS', new Date(1235)]]]), date);
      t.is(error.code, 'NO_MATCH', 'different instants do not match');
      error= errorOf(graft([['MATCH', {}]]), date);
      t.is(error.code, 'NO_MATCH', 'Dates do not match plain objects');
   });

   t.subtest('matching resource limits remain fatal', function(t) {
      var input= {a: [{b: {c: [1, 2, 3]}}]}, actions= [
         ['MATCH', ['NONE', ['NONE', ['IS', {a: [[{b: {c: [[1, 2, 3]]}}]]}]]]]
      ];
      var full= graft(actions), baseline= graft([]), limits, error, kind;
      full.apply(input);
      baseline.apply(input);
      for (kind in full.counts) {
         limits= {};
         limits[kind]= (full.counts[kind] + baseline.counts[kind]) / 2;
         error= errorOf(graft(actions, limits), input);
         t.is(error.code, 'RESOURCE_LIMIT', kind + ': NONE cannot turn resource exhaustion into a successful match');
         t.is(error.resource, kind, kind + ': the limiting counter is reported');
         t.is(error.partial, input, kind + ': a failed assertion has not cloned or edited the input');
         t.is(error.graftPath[0], 2, kind + ': the limit is reached inside MATCH');
      }
      var text= new Array(200001).join('x');
      full= graft([['MATCH', 'x']]);
      full.apply('x');
      error= errorOf(graft([['MATCH', text]], {ops: full.counts.ops + text.length * 0.001}), text);
      t.is(error.code, 'RESOURCE_LIMIT', 'comparing long equal strings consumes an operation budget');
      t.is(error.resource, 'ops', 'long-string matching charges ops');
      error= errorOf(graft([['MATCH', ['EXPR', 'loop']]], {depth: 20},
         {v: 1, expr: ['loop', ['EXPR', 'loop']]}), null);
      t.is(error.code, 'RESOURCE_LIMIT', 'recursive match macros respect the depth limit');
      t.is(error.resource, 'depth', 'macro expansion contributes to expression depth');
   });

   TestJGraft.runConformanceTests(t, '../jgraft-spec/conformance/05-if.json');
   t.done_testing();
});
