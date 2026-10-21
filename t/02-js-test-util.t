//; use lib do { (my $x= __FILE__) =~ s{[^/]+\z}{lib}; $x }; use TestJGraft -load => ['../src/JGraft.js', 'lib/TestJGraft.js'];

TAP(function(t) {
   t.subtest('shared TestJGraft namespace', function(t) {
      var namespace= TestJGraft, reader= TestJGraft.readFile;
      // Re-evaluation must extend the host namespace without replacing its
      // filesystem bridge (or its browser HTTP reader).
      (0, eval)(reader('lib/TestJGraft.js'));
      t.ok(TestJGraft === namespace, 'preserves the namespace object');
      t.ok(TestJGraft.readFile === reader, 'preserves the installed file reader');
      t.is(typeof TestJGraft.runConformanceTests, 'function', 'exports the descriptive runner name');
   });
   // Exercise the real TAP objects without emitting intentionally failing TAP
   // into this test's output. The captured results remain available to inspect.
   function capture(source, apply) {
      var root= new TAP(), emit= TAP.prototype.emit;
      TAP.prototype.emit= function() {};
      try {
         TestJGraft.runConformanceTests(root, source, apply);
      } finally {
         TAP.prototype.emit= emit;
      }
      return root.results[0];
   }
   function fixture(input, output, errors) {
      var test= {name: 'example', input: input, jgraft: ['JGRAFT', {v: 1}]};
      if (arguments.length > 1)
         test.output= output;
      if (errors)
         test.errors= errors;
      return test;
   }
   function check(test, apply) {
      return capture({version: 1, name: 'Example suite', tests: [test]}, apply);
   }
   function failsMutation(t, name, input, mutate, error) {
      var test= fixture(input, 'result');
      if (error) {
         delete test.output;
         test.errors= {INVALID_TARGET: true};
      }
      var result= check(test, function(input) {
         mutate(input);
         if (error)
            throw {code: 'INVALID_TARGET'};
         return 'result';
      });
      t.ok(!result.success, name);
      t.ok(!result.results[0].results[0].success, 'input assertion detects the mutation');
   }

   t.subtest('result comparison', function(t) {
      t.ok(check(fixture(null, null), function() { return null; }).success, 'null output is present');
      t.ok(check(fixture({}, {a: [1, false, null]}), function() { return {a: [1, false, null]}; }).success, 'nested JSON matches');
      t.ok(!check(fixture({}, []), function() { return {}; }).success, 'objects differ from arrays');
      t.ok(!check(fixture({}, 0), function() { return false; }).success, 'false differs from zero');
      t.ok(!check(fixture({}, null), function() { return {}; }).success, 'objects differ from null');
      t.ok(check(fixture({}, new Date(1234)), function() { return new Date(1234); }).success, 'Date values compare by time');
      t.ok(!check(fixture({}, new Date(1234)), function() { return new Date(5678); }).success, 'different Dates do not compare equal');
      t.ok(!check(fixture({}, new Date(0)), function() { return {}; }).success, 'Date differs from an empty object');
      t.ok(!check(fixture({}, new Date(0)), function() { return '1970-01-01T00:00:00.000Z'; }).success, 'Date differs from its JSON string');
      t.ok(!check(fixture({}, '1970-01-01T00:00:00.000Z'), function() { return new Date(0); }).success, 'Date/string distinction is symmetric');
      t.ok(!check(fixture({}, [1]), function() { return [2]; }).success, 'wrong output fails');
      var special= JSON.parse('{"__proto__":{"x":1},"constructor":2}');
      t.ok(check(fixture(special, special), function(input) { return input; }).success, 'special property names survive comparison and snapshotting');
      var sparse= [];
      sparse.length= 1;
      t.ok(!check(fixture({}, sparse), function() { return []; }).success, 'array lengths are compared even without keys');
   });

   t.subtest('input preservation', function(t) {
      failsMutation(t, 'detect a nested scalar change', {a: {b: 1}}, function(input) { input.a.b= 2; });
      failsMutation(t, 'detect array growth', [1], function(input) { input.push(2); });
      failsMutation(t, 'detect property deletion', {a: 1}, function(input) { delete input.a; });
      failsMutation(t, 'detect property creation', {}, function(input) { input.a= 1; });
      failsMutation(t, 'detect a renamed property', {a: 1}, function(input) { delete input.a; input.b= 1; });
      failsMutation(t, 'detect replaced but equal subtrees', {a: {b: 1}}, function(input) { input.a= {b: 1}; });
      failsMutation(t, 'detect Date mutation', {date: new Date(0)}, function(input) { input.date.setTime(1); });
      failsMutation(t, 'detect Date mutation before an allowed error', {date: new Date(0)}, function(input) { input.date.setTime(1); }, true);
      failsMutation(t, 'detect nested mutation before an allowed error', {a: {b: 1}}, function(input) { input.a.b= 2; }, true);
      failsMutation(t, 'detect mutation under a special property name', JSON.parse('{"__proto__":{"x":1}}'), function(input) { input['__proto__'].x= 2; });
      if (Object.getPrototypeOf) {
         // Reproduce old V8's JSON.parse behavior on modern engines too.
         var InheritedInput= function() {};
         InheritedInput.prototype= {nested: {x: 1}};
         t.ok(check(fixture(new InheritedInput(), 1), function() { return 1; }).success,
            'an unchanged custom prototype remains unchanged');
         failsMutation(t, 'detect mutation inside a custom prototype', new InheritedInput(),
            function(input) { Object.getPrototypeOf(input).nested.x= 2; });
         InheritedInput.prototype= {nested: {x: 1}};
         failsMutation(t, 'detect replacement of an equal inherited subtree', new InheritedInput(),
            function(input) { Object.getPrototypeOf(input).nested= {x: 1}; });
      }
      t.ok(check(fixture({date: new Date(0)}, 1), function() { return 1; }).success, 'an unchanged Date remains unchanged');
      var result= check(fixture({a: 1}, 1), function(input) { input.a= 2; throw new Error('unexpected'); });
      t.ok(!result.results[0].results[0].success, 'input is checked even after an unclassified exception');
   });

   t.subtest('permitted errors and limits', function(t) {
      var errors= {INVALID_TARGET: true, INVALID_GRAFT: true};
      var test= fixture({}, 1, errors);
      t.ok(check(test, function() { return 1; }).success, 'expected output may coexist with permitted errors');
      t.ok(check(test, function() { throw {code: 'INVALID_TARGET'}; }).success, 'a permitted runtime error passes');
      t.ok(check(test, function() { throw {code: 'INVALID_GRAFT'}; }).success, 'a permitted static diagnosis passes');
      t.ok(check(test, function() { throw 'INVALID_TARGET'; }).success, 'string error codes are supported');
      t.ok(!check(test, function() { throw {code: 'NO_MATCH'}; }).success, 'an unlisted error fails');
      t.ok(!check(test, function() { throw new TypeError('INVALID_TARGET'); }).success, 'an ordinary exception is not mistaken for a JGraft error');
      t.ok(!check(test, function() { throw null; }).success, 'throw null is still an exception');
      t.ok(!check(test, function() { throw undefined; }).success, 'throw undefined is still an exception');
      test= fixture({});
      test.errors= {INVALID_TARGET: true};
      t.ok(!check(test, function() {}).success, 'success is forbidden when no output is specified');
      test.errors.INVALID_TARGET= false;
      t.ok(!check(test, function() { throw {code: 'INVALID_TARGET'}; }).success, 'false error flags do not permit an error');
      test= fixture({}, 1, {RESOURCE_LIMIT: true});
      t.ok(!check(test, function() { return 1; }).success, 'RESOURCE_LIMIT must fail even if output is present');
      t.ok(check(test, function() { throw {code: 'RESOURCE_LIMIT'}; }).success, 'a permitted resource failure passes');
      test.errors.INVALID_TARGET= true;
      t.ok(!check(test, function() { throw {code: 'INVALID_TARGET'}; }).success, 'RESOURCE_LIMIT is required even when another error flag is true');
      test= fixture({}, 1);
      test.limits= {ops: 7};
      var input, graft, limits;
      var result= check(test, function(a, b, c) { input= a; graft= b; limits= c; return 1; });
      t.ok(result.success && input === test.input && graft === test.jgraft && limits === test.limits,
         'the executor receives input, graft, and per-case limits');
   });

   t.subtest('file loading and complete iteration', function(t) {
      var paths= [
         '../jgraft-spec/conformance/01-copy.json',
         '../jgraft-spec/conformance/02-move.json',
         '../jgraft-spec/conformance/03-splice.json'
      ];
      for (var i= 0; i < paths.length; i++) {
         var suite= JSON.parse(TestJGraft.readFile(paths[i]));
         var result= capture(paths[i], function() { throw 'INVALID_TARGET'; });
         t.is(result.results.length, suite.tests.length, suite.name + ': every case runs despite failures');
      }
      t.ok(!capture('missing-conformance.json', function() {}).success, 'missing files fail instead of being skipped');
      t.ok(!capture({version: 1, name: 'Empty', tests: []}, function() {}).success, 'empty suites fail');
      t.ok(!capture({version: 99, name: 'Future', tests: [{}]}, function() {}).success, 'unsupported fixture versions fail');
   });

   t.subtest('default adapter and pending implementation', function(t) {
      var saved= JGraft, input= {a: 1}, test= fixture(input, 7);
      var result, instance, args, specification, config;
      test.limits= {ops: 9};
      try {
         JGraft= function(graft, options) {
            specification= graft;
            config= options;
         };
         JGraft.prototype.apply= function(a) {
            instance= this;
            args= arguments;
            return 7;
         };
         result= check(test);
         t.ok(result.success && instance instanceof JGraft, 'default adapter constructs a JGraft');
         t.ok(args.length === 1 && args[0] === input && specification === test.jgraft
            && config.limits === test.limits, 'default adapter forwards the case');
         delete JGraft.prototype.apply;
         result= check(test);
         t.ok(result.success && result._plan === 0 && !result.results.length, 'missing implementation produces an explicit skipped plan');
      } finally {
         JGraft= saved;
      }
   });

   t.subtest('conditional host-restriction skips', function(t) {
      var saved= JGraft, test= fixture({}, {}), result, called= false, forbidden= true;
      try {
         JGraft= function(graft, config) {
            return new saved(graft, {limits: config && config.limits, forbidProto: forbidden});
         };
         JGraft.prototype= saved.prototype;
         test.name= 'A property test';
         test.needProto= true;
         result= check(test);
         t.ok(result.success && result.results[0].skipped, 'the default adapter skips an explicit requirement when restricted');
         result= check(test, function(input) { called= true; return input; });
         t.ok(called && result.success && !result.results[0].skipped, 'custom executors run flagged rejection tests normally');
         forbidden= false;
         result= check(test);
         t.ok(result.success && !result.results[0].skipped, 'flagged cases still run when the restriction is disabled');
         forbidden= true;
         delete test.needProto;
         test.name= 'Property names except __proto__';
         test.desc= 'No __proto__ support needed';
         result= check(test);
         t.ok(result.success && !result.results[0].skipped, 'names and descriptions do not imply a requirement');
         test.needProto= false;
         result= check(test);
         t.ok(result.success && !result.results[0].skipped, 'an explicit false requirement does not skip');
         test.needProto= 'true';
         result= check(test);
         t.ok(result.success && !result.results[0].skipped, 'only boolean true enables a skip');
         delete test.needProto;
         test.jgraft.push(['COPY', 1, '__proto__']);
         result= check(test);
         t.ok(!result.success && !result.results[0].skipped, 'an unflagged unsupported operation remains a failure');
         test.needProto= true;
         delete test.input;
         result= check(test);
         t.ok(!result.success && !result.results[0].skipped, 'skip flags do not hide malformed fixture records');
      } finally {
         JGraft= saved;
      }
   });
   t.done_testing();
});
