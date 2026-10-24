use strict;
use warnings;
use Test::More;
use File::Basename qw(dirname);
use File::Spec;

my $tests= dirname(__FILE__);
my $fixtures= File::Spec->catdir($tests, '..', 'jgraft-spec', 'conformance');
opendir my $fixture_dir, $fixtures or die "Cannot read $fixtures: $!";
my @fixtures= sort grep { /\.json\z/ && -f File::Spec->catfile($fixtures, $_) } readdir $fixture_dir;
closedir $fixture_dir;
my %runners;
opendir my $test_dir, $tests or die "Cannot read $tests: $!";
for my $name (sort grep { /\.t\z/ } readdir $test_dir) {
   # Harness unit tests deliberately load fragments; they are not suite runners.
   next if $name eq '02-js-test-util.t';
   open my $fh, '<', File::Spec->catfile($tests, $name) or die "Cannot read $name: $!";
   local $/;
   my $source= <$fh>;
   next unless $source =~ /use TestJGraft/ && $source =~ /TestJGraft\.runConformanceTests\(/
      && $source =~ m{jgraft-spec/conformance/};
   # Accept full literal paths and the quoted stems used by the grouped matcher
   # runner. This audits registration, while the runner tests execute each suite.
   while ($source =~ /(['"])([^'"\n]+)\1/g) {
      my $value= $2;
      if ($value =~ m{(?:\A|/)([0-9]+-[a-z0-9-]+)(?:\.json)?\z}) {
         push @{$runners{"$1.json"}}, $name;
      }
   }
}
closedir $test_dir;
ok(@fixtures > 0, 'conformance fixtures are available');
for my $file (@fixtures) {
   ok($runners{$file}, "$file has a conformance runner");
}
for my $file (sort keys %runners) {
   ok(-f File::Spec->catfile($fixtures, $file), "registered fixture $file exists");
}
done_testing;
