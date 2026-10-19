package TestJS;
use strict;
use warnings;
use Cwd qw(abs_path);
use File::Basename qw(dirname);
use File::Spec;
use IO::Select;
use POSIX qw(WNOHANG _exit);
use TAP::Parser;
use Time::HiRes qw(time sleep);

# Keep engine order stable in reports, regardless of completion order.
my @engines= qw(phantomjs node);

# Tests are JavaScript files whose first line is also a Perl program:
# //; use lib do { (my $x= __FILE__) =~ s{[^/]+\z}{lib}; $x }; use TestJS;
# import runs the original file and exits before Perl parses the JavaScript.
# -load accepts a filename or array of filenames, relative to the test file.
# TESTJS selects phantomjs (the default), node, or all. TESTJS_TIMEOUT is a
# per-engine wall-clock limit in ms, including startup and synchronous code.
sub import {
   my ($class, @options)= @_;
   my (undef, $file)= caller;
   my @load;
   while (@options) {
      my $option= shift @options;
      @options or die "Missing value for TestJS option '$option'\n";
      my $value= shift @options;
      if ($option eq '-load') {
         push @load, ref($value) eq 'ARRAY'? @$value : $value;
      }
      elsif ($option ne '-js') {
         die "Unknown TestJS option '$option'\n";
      }
      # Legacy -js heredocs remain valid; execute the original file instead.
   }
   exit run_test($file, @load);
}

# Pipe-open supplies the child process. The small child branch only merges
# stderr and execs without a shell, so filenames need no shell quoting.
sub start_engine {
   my ($engine, $timeout, @scripts)= @_;
   my $pid= open my $pipe, '-|';
   defined $pid or die "Cannot start $engine: $!\n";
   if (!$pid) {
      open STDERR, '>&', STDOUT or _exit(127);
      no warnings 'exec';
      exec {$engine} $engine, @scripts;
      print "# Cannot start $engine: $!\n";
      _exit(127);
   }
   return {engine => $engine, pid => $pid, pipe => $pipe,
      deadline => time + $timeout / 1000, output => ''};
}

# Drain every pipe while polling child status. Reap before closing a pipe:
# Perl's pipe-close waits, even if a live child has already closed its stdout.
sub collect_engines {
   my ($timeout, @runs)= @_;
   my $select= IO::Select->new(map { $_->{pipe} } @runs);
   my %pipes= map { fileno($_->{pipe}) => $_ } @runs;
   while ($select->count || grep { !exists $_->{status} } @runs) {
      sleep 0.01 unless $select->count;
      for my $pipe ($select->can_read(0.01)) {
         my $run= $pipes{fileno($pipe)};
         my $length= sysread($pipe, my $text, 8192);
         if (defined $length && $length) {
            $run->{output} .= $text;
         } elsif (defined $length) {
            $select->remove($pipe);
         } elsif (!$!{EINTR}) {
            die "Cannot read $run->{engine} output: $!\n";
         }
      }
      for my $run (@runs) {
         unless (exists $run->{status}) {
            my $pid= waitpid($run->{pid}, WNOHANG);
            if ($pid == $run->{pid}) {
               $run->{status}= $?;
            } elsif ($pid == -1) {
               die "Cannot wait for $run->{engine}: $!\n";
            }
         }
         if (!exists $run->{status} && time >= $run->{deadline}) {
            if (!$run->{timed_out}) {
               kill 'TERM', $run->{pid};
               $run->{timed_out}= 1;
               $run->{deadline}= time + 0.1;
            } else {
               kill 'KILL', $run->{pid};
            }
         }
         # A descendant may still hold the output pipe after the engine exits.
         # Do not let that keep collection alive past the engine's deadline.
         if (exists $run->{status} && time >= $run->{deadline}
               && $select->exists($run->{pipe})) {
            $select->remove($run->{pipe});
            $run->{timed_out}= 1;
         }
      }
   }
   for my $run (@runs) {
      close $run->{pipe};
      $run->{exit}= $run->{timed_out}? 2
         : $run->{status} & 127? 128 + ($run->{status} & 127)
         : $run->{status} >> 8;
      if ($run->{timed_out}) {
         $run->{output} .= "\n" if $run->{output} !~ /\n\z/;
         $run->{output} .= "# Timeout (${timeout}ms) in $run->{engine} (Perl watchdog)\n";
      }
   }
}

# The original source preserves browser URLs and line numbers. Start all
# selected engines before collecting, then report in the configured order.
sub run_test {
   my ($file, @load)= @_;
   local $|= 1;
   $file= abs_path($file) or die "Cannot resolve test filename\n";
   my $lib= dirname(abs_path(__FILE__));
   my $dir= dirname($file);
   @load= map {
      my $path= File::Spec->rel2abs($_, $dir);
      -f $path or die "TestJS dependency does not exist: $path\n";
      $path;
   } @load;
   my $mode= $ENV{TESTJS} || 'phantomjs';
   $mode eq 'all' || grep { $_ eq $mode } @engines
      or die "Unknown TESTJS engine '$mode' (expected @engines or all)\n";
   my $timeout= defined $ENV{TESTJS_TIMEOUT}? $ENV{TESTJS_TIMEOUT} : 10000;
   $timeout =~ /\A[1-9][0-9]*\z/ or die "TESTJS_TIMEOUT must be a positive integer\n";
   my @runs= map {
      start_engine($_, $timeout, "$lib/run-test.js", "--timeout=$timeout",
         "$lib/tap.js", @load, $file);
   } $mode eq 'all'? @engines : ($mode);
   collect_engines($timeout, @runs);
   if ($mode ne 'all') {
      print $runs[0]{output};
      return $runs[0]{exit};
   }
   print "TAP version 13\n";
   my ($count, $failed)= (0, 0);
   for my $run (@runs) {
      my $parser= TAP::Parser->new({tap => $run->{output}});
      1 while $parser->next;
      my $ok= !$run->{exit} && !$parser->has_problems;
      my $output= $run->{output};
      $output .= "\n" if $output !~ /\n\z/;
      # Crashes and timeouts may leave no plan, or only half a TAP stream.
      # Preserve that output as diagnostics inside a valid failed subtest.
      if ($parser->parse_errors) {
         $output =~ s/^/# /gm;
         $output .= "not ok 1 - Engine did not produce valid TAP\n1..1\n";
      }
      $output =~ s/^/    /gm;
      print "# Subtest: $run->{engine}\n", $output;
      print "    # Engine exited with status $run->{exit}\n" if $run->{exit};
      print "    # Invalid or failing TAP output\n" if $parser->has_problems;
      print($ok? 'ok ' : 'not ok ', ++$count, " - $run->{engine}\n");
      $failed++ unless $ok;
   }
   print "1..$count\n";
   return $failed? 1 : 0;
}

1;
