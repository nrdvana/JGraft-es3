//; use lib do { (my $x= __FILE__) =~ s{[^/]+\z}{lib}; $x }; use TestJGraft;

TAP(function(t) {
   // Inspect deliberately failing transcripts without failing this test file.
   function capture(code) {
      var root= new TAP(), lines= [], emit= TAP.prototype.emit;
      TAP.prototype.emit= function(line, node) {
         lines.push(this.prefix + line);
         if (this.output_el && node)
            this.output_el.appendChild(node);
      };
      try {
         root.run(code);
         root.done_testing();
      } finally {
         TAP.prototype.emit= emit;
      }
      return {root: root, text: lines.join('\n')};
   }

   // These real TODO failures also exercise prove and TESTJS=all's TAP parser.
   t.todo('pending assertion', function(t) {
      t.fail('an expected failure');
   });
   t.todo('pending subtest', function(t) {
      t.subtest('unfinished feature', function(t) {
         t.fail('expected nested failure');
      });
   });
   t.pass('normal assertions continue after TODO');

   t.subtest('scoped TODO results', function(t) {
      var assertion, returned, context;
      var result= capture(function(t) {
         returned= t.todo('not ready', function(test) {
            context= this === t && test === t;
            assertion= t.fail('expected');
            return 42;
         });
         t.pass('outside scope');
      });
      t.ok(result.root.success, 'expected failure preserves effective success');
      t.ok(!result.root.actual_success, 'actual failure remains recorded');
      t.is(result.root.failed_count, 0, 'expected failures do not count as real failures');
      t.ok(!assertion, 'assertion return value still reports actual failure');
      t.ok(context && returned === 42, 'callback receives this, its test argument, and returns its value');
      t.is(result.root.results[0].todo_reason, 'not ready', 'reason is stored on the result');
      t.ok(result.root.results[1].todo_reason === undefined, 'scope ends at callback return');
      t.ok(/not ok 1 - expected # TODO not ready/.test(result.text), 'TAP retains not ok and adds the TODO directive');
      t.ok(/^ok 2 - outside scope$/m.test(result.text), 'normal TAP has no TODO directive');

      result= capture(function(t) {
         t.todo('works already', function(t) { t.pass('unexpected success'); });
      });
      t.ok(result.root.success && result.root.actual_success, 'unexpected TODO successes still pass');
      t.ok(/ok 1 - unexpected success # TODO works already/.test(result.text), 'unexpected successes remain recognizable to TAP consumers');

      result= capture(function(t) {
         t.todo('', function(t) { t.fail('no reason'); });
      });
      t.ok(result.root.success && /# TODO$/m.test(result.text), 'empty TODO reasons are supported');
      result= capture(function(t) {
         t.todo('first\nsecond\rthird', function(t) { t.fail('one line'); });
      });
      t.ok(/# TODO first second third$/m.test(result.text), 'multiline reasons cannot inject TAP lines');
   });

   t.subtest('nested scopes and subtests', function(t) {
      var returned;
      var result= capture(function(t) {
         t.todo('outer', function(t) {
            t.fail('outer before');
            t.todo('inner', function(t) { t.fail('inner'); });
            returned= t.subtest('child', function(t) { t.fail('inherited'); });
            t.fail('outer after');
         });
      });
      t.ok(result.root.success, 'all expected failures are tolerated');
      t.is(result.root.results[1].todo_reason, 'inner', 'inner scope uses its reason');
      t.is(result.root.results[3].todo_reason, 'outer', 'outer scope is restored');
      var child= result.root.results[2];
      t.is(child.results[0].todo_reason, 'outer', 'subtests inherit the active reason');
      t.ok(child.success && !child.actual_success, 'subtest retains effective and actual outcomes');
      t.ok(!returned, 'subtest return value reports actual failure');
      t.ok(/not ok 3 - Subtest: child # TODO outer/.test(result.text), 'TODO subtest summary reflects its actual failure');

      result= capture(function(t) {
         t.subtest('partially implemented', function(t) {
            t.todo('one pending assertion', function(t) { t.fail('pending'); });
            t.pass('implemented assertion');
         });
      });
      t.ok(result.root.success, 'TODO inside a normal subtest does not fail its parent');
      t.ok(/^ok 1 - Subtest: partially implemented$/m.test(result.text), 'normal subtest summary passes without a TODO directive');
   });

   t.subtest('unexpected failures remain failures', function(t) {
      var result= capture(function(t) {
         t.todo('pending', function(t) { t.fail('expected'); });
         t.fail('unexpected');
      });
      t.ok(!result.root.success && result.root.failed_count === 1, 'failure after TODO is real');
      result= capture(function(t) {
         t.fail('unexpected');
         t.todo('pending', function(t) { t.fail('expected'); });
      });
      t.ok(!result.root.success && result.root.failed_count === 1, 'TODO cannot repair an earlier real failure');
      result= capture(function(t) {
         t.todo('pending', function() { throw new Error('unexpected exception'); });
      });
      t.ok(!result.root.success && !result.root.actual_success, 'unhandled callback exceptions remain fatal');
      t.ok(result.root._todo === undefined, 'scope is restored after an exception');

      result= capture(function(t) {
         t.todo('pending subtest', function(t) {
            t.subtest('throws', function(t) {
               t.pass('before exception');
               throw new Error('subtest failure');
            });
         });
      });
      t.ok(result.root.success && !result.root.results[0].success, 'an entire TODO subtest may fail with an exception');
      result= capture(function(t) {
         t.plan(2);
         t.todo('pending', function(t) { t.fail('only one assertion'); });
      });
      t.ok(!result.root.success, 'TODO does not excuse an incorrect plan');
   });

   t.subtest('HTML TODO state', function(t) {
      if (typeof document === 'undefined') {
         t.plan(0, 'Browser DOM only');
         return;
      }
      var result= capture(function(t) {
         t.todo('pending', function(t) {
            t.fail('expected assertion failure');
            t.pass('unexpected assertion success');
            t.subtest('pending group', function(t) { t.fail('expected group failure'); });
            t.subtest('skipped group', function(t) { t.plan(0, 'not applicable'); });
         });
         t.subtest('mixed failures', function(t) {
            t.todo('pending', function(t) { t.fail('expected'); });
            t.fail('real failure');
         });
      });
      t.ok(result.root.output_el.querySelector('.result.todo > .flag'), 'TODO failures use the yellow result class');
      var group= result.root.results[2];
      t.ok(/\btodo\b/.test(group.output_el.className), 'expected subtest failures use yellow borders');
      t.ok(!/\bcollapse\b/.test(group.output_el.className), 'expected failures remain expanded');
      t.ok(/\(TODO: pending\)/.test(group.output_el.firstChild.textContent), 'group heading includes the TODO reason');
      t.ok(result.root.output_el.querySelector('.result.pass > .message').textContent.indexOf('unexpected assertion success') >= 0, 'unexpected TODO success retains passing styling');
      t.ok(/\bskipped\b/.test(result.root.results[3].output_el.className), 'skipped TODO groups retain grey styling');
      t.ok(/\bfail\b/.test(result.root.results[4].output_el.className), 'real failures retain red styling');
   });
   t.subtest('structural difference diagnostics', function(t) {
      var count, result= capture(function(test) {
         count= test.noteDifferences({a:[1,{x:2}],b:{c:3},same:true}, {a:[1,{x:9}],b:{c:4},same:true});
      });
      t.is(count, 2, 'visits independent differing branches');
      t.ok(result.root.success && !result.root.results.length, 'notes create no assertions and do not change test status');
      t.ok(/Difference at \$\["a"\]\[1\]\["x"\] \(value\)/.test(result.text), 'numeric array indices and object keys identify a leaf');
      t.ok(/Difference at \$\["b"\]\["c"\]/.test(result.text), 'a second path is retained');
      t.ok(/old: 2/.test(result.text) && /new: 9/.test(result.text), 'old and new values are labeled');
      t.ok(!/same/.test(result.text), 'unchanged branches are omitted');
      result= capture(function(test) {
         test.noteDifferences({a:{x:1},b:2}, {a:{y:3},b:4});
      });
      t.ok(/\$\["a"\] \(properties\)/.test(result.text), 'different property sets stop descent at their common parent');
      t.ok(/old: \{"x": 1\}/.test(result.text) && /new: \{"y": 3\}/.test(result.text), 'prints both divergent subtrees');
      t.ok(/\$\["b"\] \(value\)/.test(result.text), 'a changed shape does not hide a sibling difference');
      result= capture(function(test) { test.noteDifferences([], {}); });
      t.ok(/Difference at \$ \(type\)/.test(result.text), 'root type changes are explicit');
      result= capture(function(test) { count= test.noteDifferences({x:1}, {x:1}); });
      t.is(count, 0, 'equal trees have no differences');
      t.ok(!/Difference at/.test(result.text), 'equal trees produce no diagnostic noise');
      result= capture(function(test) { test.is({a:2}, {a:1}, 'intentional mismatch'); });
      t.ok(!result.root.success && /old: 1/.test(result.text) && /new: 2/.test(result.text), 'is uses expected then actual for automatic differences');
   });

   t.subtest('diagnostics preserve JavaScript value distinctions', function(t) {
      var hole= new Array(1), actual= [undefined], result;
      result= capture(function(test) { test.noteDifferences(hole, actual); });
      t.ok(/properties/.test(result.text) && /<hole>/.test(result.text) && /undefined/.test(result.text), 'holes differ from present undefined values');
      t.ok(!TAP.deep_compare(hole, actual), 'assertions use the same sparse-array semantics');
      actual.extra= 1;
      t.ok(!TAP.deep_compare([undefined], actual), 'extra own array properties participate in comparison');
      var special= [], other= [];
      special['-1']= 1; other['-1']= 2;
      result= capture(function(test){test.noteDifferences(special, other);});
      t.ok(/\$\["-1"\]/.test(result.text), 'non-index array properties retain string path components');
      t.ok(!TAP.deep_compare(new Date(1), new Date(2)), 'Date times participate in comparison');
      t.ok(!TAP.deep_compare(new Date(1), {}), 'Date and object types remain distinct');
      t.ok(TAP.deep_compare(new Date(NaN), new Date(NaN)), 'equally invalid Dates compare equal');
      t.ok(TAP.deep_compare(NaN, NaN) && !TAP.deep_compare(Infinity, NaN), 'NaN is preserved rather than serialized as null');
      t.ok(!TAP.deep_compare(/a/i, /a/), 'regular expression flags participate in comparison');
      t.is(TAP.format(new Date(123)), 'Date(123)', 'Date diagnostics do not erase their type');
      t.is(TAP.format({a:undefined,b:NaN}), '{"a": undefined, "b": NaN}', 'undefined and nonfinite numbers stay visible');
      var old= {}, newer= {};
      Object.defineProperty(old, '__proto__', {value:1, enumerable:true});
      Object.defineProperty(newer, '__proto__', {value:2, enumerable:true});
      result= capture(function(test) { test.noteDifferences(old, newer); });
      t.ok(!TAP.deep_compare(old, newer), 'own __proto__ values differ even on old V8');
      t.ok(/\$\["__proto__"\]/.test(result.text) && /old: 1/.test(result.text) && /new: 2/.test(result.text), 'prototype-like data properties are read and printed safely');
      var calls= 0, getter= function() { calls++; throw new Error('must not execute'); };
      old= {}; newer= {};
      Object.defineProperty(old, 'x', {get:getter, enumerable:true});
      Object.defineProperty(newer, 'x', {get:getter, enumerable:true});
      t.ok(TAP.deep_compare(old, newer), 'identical accessors compare without execution');
      t.ok(/Accessor get/.test(TAP.format(old)), 'formatting identifies accessors');
      t.is(calls, 0, 'comparison and formatting never call getters');
      old= {toJSON:function(){calls++;return 'hidden';},data:1};
      TAP.format(old);
      t.is(calls, 0, 'formatting does not call toJSON');
   });

   t.subtest('cyclic, deep, and bounded diagnostics', function(t) {
      var old= {n:1}, newer= {n:1}, result, count, i;
      old.self= old; newer.self= newer;
      t.ok(TAP.deep_compare(old, newer), 'equivalent cycles terminate');
      newer.n= 2;
      result= capture(function(test) { count= test.noteDifferences(old, newer); });
      t.is(count, 1, 'cycles do not duplicate a differing leaf indefinitely');
      t.ok(/Circular \$/.test(TAP.format(old)), 'cycles are labeled when rendering a subtree');
      old= {}; newer= {};
      for (i= 0; i < 25; i++) { old['k'+i]= i; newer['k'+i]= i+1; }
      result= capture(function(test) { count= test.noteDifferences(old, newer); });
      t.is(count, 20, 'the default report bounds the number of differing paths');
      t.ok(/Further differences omitted/.test(result.text), 'truncation is explicit');
      result= capture(function(test) { count= test.noteDifferences(old, newer, 2); });
      t.is(count, 2, 'callers can choose the number of displayed differences');
      t.ok(/truncated/.test(TAP.format({long:'abcdefghijk'}, 10)), 'large subtree rendering has an explicit length limit');
      result= capture(function(test) { test.noteDifferences({'a\nnot ok 99':1}, {'a\nnot ok 99':2}); });
      t.ok(!/^not ok 99/m.test(result.text) && /\\nnot ok 99/.test(result.text), 'newlines in keys cannot inject TAP syntax');
      old= 1; newer= 1;
      for (i= 0; i < 1200; i++) { old= {child:old}; newer= {child:newer}; }
      t.ok(TAP.deep_compare(old, newer), 'deep comparison uses a work stack instead of host recursion');
   });

   t.subtest('subtest execution filtering', function(t) {
      var called= [], result= capture(function(test) {
         test.filterSubtests('^keep$');
         test.subtest('drop', function() {throw new Error('unselected callback ran');});
         test.subtest('keep', function(child) {
            called.push('keep');
            child.subtest('descendant', function(grandchild) {called.push('descendant');grandchild.pass('nested assertion');});
         });
      });
      t.is(called, ['keep','descendant'], 'selecting a group executes all descendants');
      t.ok(result.root.success, 'unselected failing code is never invoked');
      t.ok(result.root.results[0].skipped && result.root.results[0]._plan === 0, 'unselected subtest has an explicit skipped plan');
      t.ok(/1\.\.0 # SKIP Filtered out by subtest filter/.test(result.text), 'skip is visible to TAP consumers');
      t.ok(/^ok 2 - Subtest: keep$/m.test(result.text) && /^1\.\.2$/m.test(result.text), 'sibling numbering and parent plan stay unchanged');
      t.ok(/Subtest filter: "\^keep\$"/.test(result.text), 'active filter is recorded');
      result= capture(function(test) {
         test.filterSubtests('^keep$');
         test.subtest('drop',function(child){child.fail('unselected failure');});
         test.subtest('keep',function(child){child.fail('selected failure');});
      });
      t.ok(!result.root.success && result.root.failed_count === 1 && !result.root.results[1].skipped, 'selected failures remain real failures');
      called= [];
      result= capture(function(test) {
         test.filterSubtests('^suite / wanted$');
         test.subtest('suite',function(group) {
            group.subtest('unwanted',function(){called.push('unwanted');});
            group.subtest('wanted',function(child){called.push('wanted');child.pass('selected');});
         },{container:true});
      });
      t.is(called,['wanted'],'an unfiltered container makes matching descendants reachable');
      t.ok(!result.root.results[0].skipped && result.root.results[0].results[0].skipped, 'container retains both selected and skipped children');
      result= capture(function(test) {
         test.filterSubtests('^wanted$');
         test.subtest('suite',function(group){group.subtest('wanted',function(child){child.pass('local name matches');});},{container:true});
      });
      t.ok(!result.root.results[0].results[0].skipped,'anchored patterns can also select a local case name');
      result= capture(function(test) {
         test.filterSubtests('^suite$');
         test.subtest('suite',function(group){group.subtest('child',function(child){child.pass('runs');});},{container:true});
      });
      t.ok(!result.root.results[0].results[0].skipped,'selecting a container selects its complete subtree');
      result= capture(function(test) {
         test.filterSubtests('never matches');
         test.subtest('suite',function(group){group.subtest('case',function(){throw new Error('must not run');});},{container:true});
      });
      t.ok(result.root.success && result.root.skipped, 'an unmatched file can be skipped during a multi-file run');
      result= capture(function(test) {
         test.filterSubtests('never matches');
         test.pass('root assertions still execute');
         test.subtest('case',function(){throw new Error('must not run');});
      });
      t.ok(result.root.results[0].success && !result.root.skipped, 'filtering affects subtests rather than root assertions');
      result= capture(function(test) {
         test.filterSubtests('never matches');
         test.filterSubtests('');
         test.subtest('case',function(child){child.pass('filter disabled');});
      });
      t.ok(!result.root.results[0].skipped,'empty patterns disable filtering');
      result= capture(function(test) {
         test.filterSubtests(/case/g);
         test.subtest('case one',function(child){child.pass('first');});
         test.subtest('case two',function(child){child.pass('second');});
      });
      t.ok(!result.root.results[0].skipped && !result.root.results[1].skipped,'stateful regexes do not alternate between matching and skipping');
      result= capture(function(test) {test.filterSubtests('[');});
      t.ok(!result.root.success && /Invalid subtest filter/.test(result.text), 'invalid regexes fail with a useful message');
   });

   t.done_testing();
});
