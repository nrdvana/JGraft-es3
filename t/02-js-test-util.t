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
      function leafCount(node, results) {
         var children= results? node.results : node.tests, count= 0, i;
         if (results? node._jgraftCase : !children) return 1;
         for (i= 0; i < children.length; i++) count+= leafCount(children[i], results);
         return count;
      }
      var paths= [
         '../jgraft-spec/conformance/01-copy.json',
         '../jgraft-spec/conformance/02-move.json',
         '../jgraft-spec/conformance/03-splice.json'
      ];
      for (var i= 0; i < paths.length; i++) {
         var suite= JSON.parse(TestJGraft.readFile(paths[i]));
         var result= capture(paths[i], function() { throw 'INVALID_TARGET'; });
         t.is(leafCount(result,true), leafCount(suite,false), suite.name + ': every leaf case runs despite failures');
      }
      t.ok(!capture('missing-conformance.json', function() {}).success, 'missing files fail instead of being skipped');
      t.ok(!capture({version: 1, name: 'Empty', tests: []}, function() {}).success, 'empty suites fail');
      t.ok(!capture({version: 99, name: 'Future', tests: [{}]}, function() {}).success, 'unsupported fixture versions fail');
   });

   t.subtest('nested conformance groups and failure descriptions', function(t) {
      var bad= fixture(1,9), good= fixture(0,0), permitted= fixture(-1);
      bad.name= 'bad';bad.desc= 'Case purpose\nnot ok 999 - description text';
      good.name= 'good';good.desc= 'Passing case purpose';
      permitted.name= 'allowed error';permitted.errors= {INVALID_TARGET:true};
      permitted.desc= 'Permitted error purpose';
      var suite= {version:1,name:'Nested suite',desc:'Collection purpose',tests:[
         {name:'outer',desc:'Outer purpose',tests:[
            {name:'inner',desc:'Inner purpose',tests:[good,bad]}
         ]},
         {name:'passing',desc:'Passing group purpose',tests:[permitted]},
         fixture(2,2)
      ]};
      function run(pattern, todo) {
         var root= new TAP(), emit= TAP.prototype.emit, lines= [], calls= [];
         TAP.prototype.emit= function(line) {lines.push(this.prefix+line);};
         try {
            if (pattern) root.filterSubtests(pattern);
            function execute(t) {
               TestJGraft.runConformanceTests(t,suite,function(input) {
                  calls.push(input);
                  if (input === -1) throw {code:'INVALID_TARGET'};
                  return input;
               });
            }
            if (todo) root.todo('pending',execute);else execute(root);
            root.done_testing();
         } finally {TAP.prototype.emit= emit;}
         return {root:root,text:lines.join('\n'),calls:calls};
      }
      var result= run();
      t.ok(!result.root.success,'a nested failure fails the collection');
      t.is(result.calls,[0,1,-1,2],'all leaf cases run, including later siblings');
      t.ok(/# Case purpose\n\s*# not ok 999 - description text/.test(result.text),'multiline case descriptions remain TAP notes');
      t.ok(!/^not ok 999/m.test(result.text),'descriptions cannot inject assertions');
      t.ok(/# Inner purpose/.test(result.text) && /# Outer purpose/.test(result.text)
         && /# Collection purpose/.test(result.text),'every failing ancestor reports its description');
      t.ok(!/# Passing case purpose|# Passing group purpose|# Permitted error purpose/.test(result.text),
         'passing cases and groups, including permitted errors, omit descriptions');
      t.ok(/Conformance total: 4 cases; 3 passed, 1 failed, 0 skipped/.test(result.text),'totals count leaves rather than groups');
      result= run('^Nested suite / outer / inner / good$');
      t.is(result.calls,[0],'full paths select cases through multiple container groups');
      t.ok(result.root.success && /Conformance total: 4 cases; 1 passed, 0 failed, 3 skipped/.test(result.text),'nested filtered leaves count as skips');
      t.ok(!/# Collection purpose|# Inner purpose|# Case purpose/.test(result.text),'filtered failures emit no descriptions');
      result= run('^inner$');
      t.is(result.calls,[0,1],'selecting a group executes its complete subtree');
      result= run('^nothing matches$');
      t.ok(result.root.success && /Conformance total: 4 cases; 0 passed, 0 failed, 4 skipped/.test(result.text),'unmatched nested collections report every leaf skipped');
      result= run(null,true);
      t.ok(result.root.success && !result.root.actual_success,'nested TODO failures preserve effective passing status');
      t.ok(/# Case purpose/.test(result.text) && /# Collection purpose/.test(result.text),'TODO failures also report their descriptions');
      t.ok(/Conformance total: 4 cases; 0 passed, 0 failed, 0 skipped, 1 TODO failed, 3 TODO passed/.test(result.text),
         'TODO totals count each nested leaf exactly once');
      var input= {};
      Object.defineProperty(input,'x',{enumerable:true,get:function(){throw new Error('snapshot failure');}});
      suite= {version:1,name:'Throwing suite',desc:'Throwing collection purpose',tests:[
         {name:'throwing group',desc:'Throwing group purpose',tests:[
            {name:'throwing case',desc:'Throwing case purpose',input:input,jgraft:[],output:0},
            good
         ]}
      ]};
      result= run();
      t.ok(/# Throwing case purpose/.test(result.text) && /# Throwing group purpose/.test(result.text)
         && /# Throwing collection purpose/.test(result.text),'unexpected callback exceptions also report case and ancestor descriptions');
      t.ok(/Conformance total: 2 cases; 1 passed, 1 failed/.test(result.text),'a callback exception counts as one failed leaf and does not stop siblings');
   });

   t.subtest('conformance group validation', function(t) {
      var invalid= [
         {name:'empty',tests:[]},
         {name:'wrong children',tests:{}},
         {name:'inherited limits',limits:{ops:10},tests:[fixture(0,0)]},
         {name:'mixed case and group',input:0,tests:[fixture(0,0)]},
         {name:'bad description',desc:1,tests:[fixture(0,0)]},
         {tests:[fixture(0,0)]}
      ], i;
      for (i= 0; i < invalid.length; i++)
         t.ok(!capture({version:1,name:'Invalid group',tests:[invalid[i]]},function(input){return input;}).success,
            'rejects invalid group '+i);
      t.ok(capture({version:1,name:'Optional descriptions',tests:[
         {name:'group',tests:[fixture(0,0)]}
      ]},function(input){return input;}).success,'group descriptions are optional');
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
   t.subtest('descriptor-backed prototype properties', function(t) {
      function object(value) {
         var result= {};
         Object.defineProperty(result, '__proto__', {value:value, enumerable:true, configurable:true});
         return result;
      }
      t.ok(!check(fixture(null, object(1)), function(){return object(2);}).success,
         'comparison detects different own __proto__ data even on old V8');
      failsMutation(t, 'snapshot detects edits inside an own __proto__ subtree', object({keep:1}), function(input) {
         Object.getOwnPropertyDescriptor(input, '__proto__').value.keep= 2;
      });
   });

   t.subtest('JGraft error state diagnostics', function(t) {
      function notes(code) {
         var test= new TAP(), emit= TAP.prototype.emit, lines= [];
         TAP.prototype.emit= function(line) {lines.push(this.prefix+line);};
         try { code(test); } finally { TAP.prototype.emit= emit; }
         t.ok(test.success && !test.results.length, 'error reporting is diagnostic only');
         return lines.join('\n');
      }
      var error, graft= ['JGRAFT',{v:1},['COPY',2,'edited',['NODE','absent'],'bad']];
      var input= {keep:1};
      try {new JGraft(graft).apply(input);} catch (caught) {error=caught;}
      var text= notes(function(test) {TestJGraft.noteError(test,error,{input:input,jgraft:graft,output:7});});
      t.ok(/JGraftError INVALID_TARGET/.test(text), 'starts with the error class and code');
      t.ok(/graftPath: \[2, 3\]/.test(text) && /inputPath: \["absent"\]/.test(text), 'prints both recorded paths');
      t.ok(/counts:/.test(text) && /limits:/.test(text), 'includes counters and effective limits');
      t.ok(/Graft at recorded path: \["NODE", "absent"\]/.test(text), 'locates the failing graft subtree');
      t.ok(/Original input at recorded path missing; nearest path: \[\]/.test(text), 'a missing input path is explicit');
      t.ok(/Partial output: \{"edited": 2, "keep": 1\}/.test(text), 'preceding edits remain visible');
      t.ok(/Expected output: 7/.test(text), 'optional context includes the expected result');
      text= notes(function(test) {TestJGraft.noteError(test,{code:'CUSTOM',message:'first\nsecond',graftPath:[2,9]}, {jgraft:graft});});
      t.ok(/Graft at recorded path missing; nearest path: \[2\]/.test(text), 'an expanded or missing graft path reports the nearest original node');
      t.ok(!/^second$/m.test(text), 'multiline messages cannot inject raw TAP lines');
      text= notes(function(test) {TestJGraft.noteError(test,'NO_MATCH');TestJGraft.noteError(test,null);});
      t.ok(/Thrown: "NO_MATCH"/.test(text) && /Thrown: null/.test(text), 'non-object exceptions are supported');
      try {new JGraft(['JGRAFT',{v:1}],{limits:{ops:0}}).apply(null);} catch (caughtLimit) {error=caughtLimit;}
      text= notes(function(test) {TestJGraft.noteError(test,error);});
      t.ok(/resource: "ops"/.test(text) && /"ops": 0/.test(text), 'resource errors show the exhausted counter and its budget');
      var calls= 0, accessorInput= {};
      Object.defineProperty(accessorInput,'x',{get:function(){calls++;throw new Error('must not run');},enumerable:true});
      text= notes(function(test) {TestJGraft.noteError(test,{code:'CUSTOM',inputPath:['x']},{input:accessorInput});});
      t.ok(/accessor at path/.test(text) && calls === 0,'path diagnostics do not re-execute a failing input getter');
   });

   t.subtest('conformance diagnostics use shared helpers', function(t) {
      var differences= 0, errors= 0, originalDiff= TAP.prototype.noteDifferences, originalError= TestJGraft.noteError;
      try {
         TAP.prototype.noteDifferences= function(a,b) {differences++;t.is(a,{x:1},'difference old value is expected');t.is(b,{x:2},'difference new value is actual');};
         TestJGraft.noteError= function(test,error,context) {errors++;t.is(error.code,'CUSTOM','forwards the error');t.ok(context.jgraft && context.input === 1,'forwards fixture context');};
         check(fixture(null,{x:1}),function(){return {x:2};});
         check(fixture(1,2),function(){throw {code:'CUSTOM'};});
      } finally {
         TAP.prototype.noteDifferences= originalDiff;
         TestJGraft.noteError= originalError;
      }
      t.is(differences,1,'output mismatch uses noteDifferences');
      t.is(errors,1,'unexpected errors use noteError');
   });

   t.subtest('conformance totals at root completion', function(t) {
      var emit= TAP.prototype.emit, lines= [], root= new TAP(), calls= 0;
      var suite= {version:1, name:'Counted suite', tests:[fixture(null,1),fixture(null,2)]};
      suite.tests[0].name= 'pass';
      suite.tests[1].name= 'fail';
      TAP.prototype.emit= function(line) {lines.push(this.prefix + line);};
      try {
         TestJGraft.runConformanceTests(root,suite,function(){calls++;return 1;});
         root.todo('pending',function(t) {
            t.subtest('TODO parent',function(t) {
               TestJGraft.runConformanceTests(t,suite,function(){return 1;});
            });
         });
         t.ok(!/Conformance total:/.test(lines.join('\n')),'does not summarize before root completion');
         var results= root.results.length, success= root.success;
         root.done_testing();
         t.is(root.results.length,results,'notes add no assertions');
         t.is(root.success,success,'notes preserve failure status');
         t.ok(/Conformance total: 4 cases; 1 passed, 1 failed, 0 skipped, 1 TODO failed, 1 TODO passed \(unexpected\), 0 not run/.test(lines.join('\n')),
            'counts fixtures once and distinguishes TODO outcomes inherited from ancestors');
         root.done_testing();
         t.is(lines.join('\n').split('Conformance total:').length-1,1,'repeated completion does not duplicate totals');
         lines= [];
         root= new TAP();
         root.filterSubtests('^pass$');
         TestJGraft.runConformanceTests(root,suite,function(){calls++;return 1;});
         root.done_testing();
         t.ok(/Conformance total: 2 cases; 1 passed, 0 failed, 1 skipped/.test(lines.join('\n')),'filtered cases count as skips');
         t.is(calls,3,'filtered fixture never executes');
         lines= [];
         root= new TAP();
         var saved= JGraft;
         try {
            JGraft= function(){this.forbidProto=true;};
            JGraft.prototype.apply= function(){return 1;};
            var restricted= fixture(null,1);
            restricted.needProto= true;
            TestJGraft.runConformanceTests(root,{version:1,name:'Restricted',tests:[restricted]});
            delete JGraft.prototype.apply;
            TestJGraft.runConformanceTests(root,suite);
            // A constructor error aborts a loaded suite before its cases run.
            JGraft.prototype.apply= function(){};
            JGraft= function(){throw new Error('construction failed');};
            JGraft.prototype.apply= function(){};
            TestJGraft.runConformanceTests(root,suite);
            root.done_testing();
         } finally { JGraft= saved; }
         t.ok(/Conformance total: 5 cases; 0 passed, 0 failed, 3 skipped, 0 TODO failed, 0 TODO passed \(unexpected\), 2 not run/.test(lines.join('\n')),
            'distinguishes host and missing-implementation skips from an aborted suite');
         t.ok(!root.success,'an aborted suite still fails the run');
         lines= [];
         root= new TAP();
         root.pass('ordinary assertion');
         root.done_testing();
         t.ok(!/Conformance total:/.test(lines.join('\n')),'ordinary unit tests have no fixture totals');
      } finally {
         TAP.prototype.emit= emit;
      }
   });

   t.done_testing();
});
