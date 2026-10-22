//; use lib do { (my $x= __FILE__) =~ s{[^/]+\z}{lib}; $x }; use TestJGraft -load => '../src/JGraft.js';

TAP(function(t) {
   var files= ['08-any', '09-all', '10-none', '11-seq-any', '12-seq-all', '13-seq-none', '14-rep'], i;
   for (i= 0; i < files.length; i++)
      TestJGraft.runConformanceTests(t, '../jgraft-spec/conformance/' + files[i] + '.json');
   t.done_testing();
});
