//; use lib do { (my $x= __FILE__) =~ s{[^/]+\z}{lib}; $x }; use TestJGraft -load => '../src/JGraft.js';

TAP(function(t) {
   var graft= new JGraft(['JGRAFT', {v: 1}, ['COPY', 2, 'value']]);
   var input= {branch: {value: 1}}, output, previous, error;
   t.is(graft.counts, null, 'no application counts before the first attempt');
   output= graft.apply(input);
   t.is(output.value, 2, 'apply returns the edited tree');
   t.ok(output !== input && output.branch === input.branch, 'output can share untouched subtrees');
   t.is(input.value, undefined, 'apply does not modify input');
   previous= graft.counts;
   output= graft.apply(input, {clone: true});
   t.ok(output.branch !== input.branch, 'clone option detaches untouched subtrees');
   t.ok(graft.counts !== previous, 'each attempt publishes independent counts');
   t.ok(graft.counts.ops > previous.ops, 'final cloning is included in counts');

   graft= new JGraft(['JGRAFT', {v: 1}, ['COPY', 2, 'value', ['NODE', 'missing'], 'bad']]);
   try {
      graft.apply(input);
   } catch (caught) {
      error= caught;
   }
   t.ok(error instanceof Error, 'failed application throws an Error');
   t.is(error.code, 'INVALID_TARGET', 'error carries a specification code');
   t.is(error.partial.value, 2, 'error exposes the preceding edits');
   t.is(error.counts, graft.counts, 'error retains counts for this attempt');
   t.is(error.graftPath.join('.'), '2.3', 'error identifies the failing expression');
   t.is(error.inputPath.join('.'), 'missing', 'error identifies the missing source');
   t.is(input.value, undefined, 'partial edits do not escape into input');
   previous= error;
   // The same instance can succeed on compatible input after a failed attempt.
   output= graft.apply({missing: 3});
   t.is(output.bad, 3, 'instance remains usable after failure');
   t.ok(previous.counts !== graft.counts, 'previous error retains independent counters');
   t.is(previous.partial.bad, undefined, 'previous partial output is not changed by reuse');

   var limits= {ops: 0};
   graft= new JGraft(['JGRAFT', {v: 1}], {limits: limits});
   limits.ops= Infinity;
   try {
      graft.apply(input);
   } catch (caughtLimit) {
      error= caughtLimit;
   }
   t.is(error.code, 'RESOURCE_LIMIT', 'constructor captures configured resource limits');
   t.is(error.resource, 'ops', 'limit error identifies the counter');
   t.is(error.counts, graft.counts, 'early failures publish their counters');
   t.is(error.partial, input, 'early failure retains the original root');
   t.done_testing();
});
