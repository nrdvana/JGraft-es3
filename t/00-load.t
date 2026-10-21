//; use lib do { (my $x= __FILE__) =~ s{[^/]+\z}{lib}; $x }; use TestJGraft -load => '../src/JGraft.js';

TAP(function(t) {
   t.is(typeof JGraft, 'function', 'JGraft library loaded');
   t.done_testing();
});
