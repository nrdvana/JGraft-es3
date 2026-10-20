use strict;
use warnings;
use Test::More;
use Cwd qw(abs_path getcwd);
use File::Basename qw(dirname);
use File::Spec;
use File::Temp qw(tempdir);
use IPC::Open3;
use Symbol qw(gensym);
use TAP::Parser;

my $lib= abs_path(dirname(__FILE__) . '/lib');
my $dir= tempdir(CLEANUP => 1);
my $cwd= getcwd;

sub perl_string {
   my ($value)= @_;
   $value =~ s/([\\'])/\\$1/g;
   return "'$value'";
}

# Exercise a real Perl -> engine -> TAP invocation. Fixtures have small bounded
# output, so collecting stdout and stderr sequentially cannot fill either pipe.
sub run_fixture {
   my ($engine, $name, $source, $options, $timeout)= @_;
   my $file= File::Spec->catfile($dir, "$name.t");
   open my $fh, '>', $file or die "Cannot write $file: $!";
   print {$fh} '//; use lib ', perl_string($lib), '; use TestJS',
      ($options || ''), ";\n", $source;
   close $fh or die "Cannot close $file: $!";
   local $ENV{TESTJS}= $engine;
   local $ENV{TESTJS_TIMEOUT}= $timeout || 1000;
   my $err= gensym;
   my $pid= open3(undef, my $out, $err, $^X, $file);
   local $/;
   my $text= (<$out> || '') . (<$err> || '');
   waitpid($pid, 0);
   return ($?, $text, $file);
}

# Running elsewhere also checks paths with spaces and shell metacharacters.
chdir $dir or die "Cannot chdir to $dir: $!";
my $dependency= "helper with ' and spaces.js";
open my $fh, '>', $dependency or die "Cannot write helper: $!";
print {$fh} "var testJSHelper= 42;\n";
close $fh or die "Cannot close helper: $!";

for my $engine (qw(phantomjs node)) {
   subtest $engine => sub {
      plan skip_all => "$engine is not installed" unless grep {
         -x File::Spec->catfile($_, $engine)
      } File::Spec->path;
      my ($status, $output, $file)= run_fixture($engine, "pass with ' and spaces",
         "TAP(function(t) { t.is(testJSHelper, 42, 'relative dependency'); t.done_testing(); });\n",
         ' -load => ' . perl_string($dependency));
      is($status, 0, 'loads a relative dependency from another working directory');
      like($output, qr/^ok 1 - relative dependency$/m, 'reports TAP results');

      ($status, $output)= run_fixture($engine, 'legacy',
         "TAP(function(t) { t.pass('legacy'); t.done_testing(); });\n//END_JS\n",
         " -js => <<'//END_JS'");
      is($status, 0, 'legacy literal heredoc preambles still work');

      ($status, $output)= run_fixture($engine, 'failure',
         "TAP(function(t) { t.fail('expected failure'); t.done_testing(); });\n");
      isnt($status, 0, 'failed assertions return a nonzero status');
      like($output, qr/^not ok 1 - expected failure$/m, 'reports failed assertion');

      ($status, $output, $file)= run_fixture($engine, 'caught',
         "\nTAP(function(t) {\n   t.pass('before exception');\n   throw new Error('expected exception');\n});\nTAP(function(t) { t.done_testing(); });\n");
      isnt($status, 0, 'a caught exception fails even with a complete passing plan');
      like($output, qr/\Q$file\E:5\b/, 'caught exception preserves filename and line');

      ($status, $output, $file)= run_fixture($engine, 'uncaught',
         "\nthrow new Error('outside TAP');\n");
      isnt($status, 0, 'an uncaught exception fails');
      like($output, qr/\Q$file\E:3\b/, 'uncaught exception preserves filename and line');

      ($status, $output, $file)= run_fixture($engine, 'syntax',
         "\nvar broken= ;\n");
      isnt($status, 0, 'a syntax error fails');
      like($output, qr/\Q$file\E:3\b/, 'syntax error preserves filename and line');

      ($status, $output)= run_fixture($engine, 'unfinished',
         "TAP(function(t) { t.pass('unfinished'); });\n", '', 100);
      is($status >> 8, 2, 'timeout exit status reaches Perl');
      like($output, qr/Timeout \(100ms\)/, 'unfinished tests report the timeout');

      ($status, $output)= run_fixture($engine, 'synchronous hang',
         "while (true) {}\n", '', 100);
      is($status >> 8, 2, 'Perl interrupts synchronous infinite loops');
      like($output, qr/Perl watchdog/, 'identifies the external watchdog');

      ($status, $output)= run_fixture($engine, 'async',
         "TAP(function(t) { setTimeout(function() { t.pass('async'); t.done_testing(); }, 10); });\n");
      is($status, 0, 'waits for asynchronous completion');

      ($status, $output)= run_fixture($engine, 'missing',
         "TAP(function(t) { t.done_testing(); });\n", " -load => 'missing.js'");
      isnt($status, 0, 'a missing dependency fails');
      like($output, qr/dependency does not exist/, 'explains the missing dependency');
   };
}

subtest 'all engines' => sub {
   plan skip_all => 'both engines are required' if grep {
      my $engine= $_;
      !grep { -x File::Spec->catfile($_, $engine) } File::Spec->path;
   } qw(phantomjs node);
   my ($status, $output)= run_fixture('all', 'all pass',
      "TAP(function(t) { t.pass('both engines'); t.done_testing(); });\n");
   is($status, 0, 'both engines pass');
   my $parser= TAP::Parser->new({tap => $output});
   1 while $parser->next;
   ok(!$parser->has_problems, 'aggregated output is valid nested TAP');
   is($parser->tests_run, 2, 'one top-level subtest per engine');
   like($output, qr/^# Subtest: phantomjs\n.*^ok 1 - phantomjs\n# Subtest: node\n.*^ok 2 - node\n1\.\.2\n\z/ms,
      'results are indented and sequential');

   ($status, $output)= run_fixture('all', 'one engine fails',
      "TAP(function(t) { t.ok(typeof window !== 'undefined', 'browser only'); t.done_testing(); });\n");
   isnt($status, 0, 'one failing engine fails the combined run');
   like($output, qr/^ok 1 - phantomjs$/m, 'preserves successful engine result');
   like($output, qr/^not ok 2 - node$/m, 'identifies failing engine');

   ($status, $output)= run_fixture('all', 'all hang', "while (true) {}\n", '', 100);
   isnt($status, 0, 'timeouts fail the combined run');
   $parser= TAP::Parser->new({tap => $output});
   1 while $parser->next;
   is(scalar($parser->parse_errors), 0, 'timeouts still produce well-formed nested TAP');
   like($output, qr/^not ok 1 - phantomjs$/m, 'reports the PhantomJS timeout');
   like($output, qr/^not ok 2 - node$/m, 'reports the Node timeout');
};

# Stand-in commands use a barrier, so a sequential launcher would time out.
# Enough output to fill pipes also checks concurrent draining and stderr capture.
subtest 'parallel launch and process cleanup' => sub {
   my $bin= File::Spec->catdir($dir, 'engines');
   mkdir $bin or die "Cannot create $bin: $!";
   for my $engine (qw(phantomjs node)) {
      my $command= File::Spec->catfile($bin, $engine);
      open my $fh, '>', $command or die "Cannot write $command: $!";
      print {$fh} "#!$^X\n", <<'ENGINE';
use strict;
use warnings;
use FindBin qw($Bin $Script);
if ($ENV{TESTJS_FAKE_HANG}) {
   $SIG{TERM}= 'IGNORE';
   open my $pid, '>', "$Bin/hung.pid" or die $!;
   print {$pid} "$$\n";
   close $pid;
   close STDOUT;
   close STDERR;
   sleep 1 while 1;
}
$|= 1;
open my $marker, '>', "$Bin/$Script.started" or die $!;
close $marker;
print "TAP version 13\n", ('# padding to exercise pipe buffering' . "\n") x 2048;
select undef, undef, undef, 0.01
   until -e "$Bin/phantomjs.started" && -e "$Bin/node.started";
select undef, undef, undef, 0.05 if $Script eq 'phantomjs';
print STDERR "# stderr from $Script\n";
print "ok 1 - result from $Script\n1..1\n";
ENGINE
      close $fh or die "Cannot close $command: $!";
      chmod 0755, $command or die "Cannot chmod $command: $!";
   }
   local $ENV{PATH}= $bin;
   my ($status, $output)= run_fixture('all', 'parallel barrier', '', '', 3000);
   is($status, 0, 'both processes reach the barrier and drain their output');
   like($output, qr/^    # stderr from phantomjs$/m, 'captures PhantomJS stderr');
   like($output, qr/^    # stderr from node$/m, 'captures Node stderr');
   like($output, qr/^ok 1 - phantomjs\n# Subtest: node$/m,
      'reports configured order even when Node finishes first');

   {
      local $ENV{TESTJS_FAKE_HANG}= 1;
      ($status, $output)= run_fixture('node', 'ignores termination', '', '', 100);
      is($status >> 8, 2, 'kills a child that closes output and ignores TERM');
      open my $pid, '<', "$bin/hung.pid" or die "Cannot read child PID: $!";
      my $child= <$pid>;
      close $pid;
      chomp $child;
      ok(!kill(0, $child), 'timed-out child was reaped');
   }

   unlink "$bin/node" or die "Cannot remove stand-in Node: $!";
   ($status, $output)= run_fixture('all', 'missing engine', '', '', 1000);
   isnt($status, 0, 'all does not silently skip a missing engine');
   like($output, qr/Cannot start node/, 'explains the missing engine');
   like($output, qr/^not ok 2 - node$/m, 'reports missing engine as a failed subtest');
   my $parser= TAP::Parser->new({tap => $output});
   1 while $parser->next;
   is(scalar($parser->parse_errors), 0, 'missing engines still produce well-formed nested TAP');
};

chdir $cwd or die "Cannot restore working directory: $!";
done_testing();
