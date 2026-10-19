//; use lib do { (my $x= __FILE__) =~ s{[^/]+\z}{lib}; $x }; use TestJS -load => '../src/JGraft.js';

TAP(function(t) {
   t.is(typeof JGraft, 'function', 'JGraft library loaded');
   t.done_testing();
});
