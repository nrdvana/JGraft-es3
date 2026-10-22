//; use lib do { (my $x= __FILE__) =~ s{[^/]+\z}{lib}; $x }; use TestJGraft -load => '../src/JGraft.js';

TAP(function(t) {
   TestJGraft.runConformanceTests(t, '../jgraft-spec/conformance/16-jgraft-namespaces.json');
   t.done_testing();
});
