//; use lib do { (my $x= __FILE__) =~ s{[^/]+\z}{lib}; $x }; use TestJGraft -load => '../src/JGraft.js';

TAP(function(t) {
   TestJGraft.runConformanceTests(t,'../jgraft-spec/conformance/23-with.json');
   t.done_testing();
});
