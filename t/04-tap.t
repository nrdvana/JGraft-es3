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
   t.done_testing();
});
