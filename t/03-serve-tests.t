use strict;
use warnings;
use Test::More;
BEGIN {
   eval { require Test::Mojo; 1 }
      or plan skip_all => 'Mojolicious is optional (manual browser server only)';
}
use Cwd qw(abs_path getcwd);
use File::Basename qw(dirname);
use File::Path qw(make_path);
use File::Spec;
use File::Temp qw(tempdir);
use Mojo::URL;
use Mojo::File qw(path);

plan skip_all => 'git is required for the optional manual server' unless grep {
   -x File::Spec->catfile($_, 'git')
} File::Spec->path;

my $source= abs_path(dirname(__FILE__) . '/..');
my $repo= tempdir(CLEANUP => 1);
my $cwd= getcwd;

sub write_file {
   my ($name, $content)= @_;
   my $file= "$repo/$name";
   make_path(dirname($file));
   open my $fh, '>', $file or die "Cannot write $file: $!";
   print {$fh} $content;
   close $fh or die "Cannot close $file: $!";
}
sub copy_file {
   my ($name)= @_;
   open my $fh, '<', "$source/$name" or die "Cannot read $name: $!";
   local $/;
   write_file($name, <$fh>);
}
sub git {
   my ($dir, @args)= @_;
   open my $pipe, '-|', 'git', '-C', $dir, @args or die "Cannot start git: $!";
   local $/;
   my $text= <$pipe>;
   close $pipe or die "git @args failed\n";
   return $text;
}

for my $file (qw(t/serve-tests t/lib/tap.js t/lib/test-util.js src/JGraft.js)) {
   copy_file($file);
}
write_file('t/lib/tap.css', '.pass { color: green; }');
write_file('t/10-web.t', <<'JS');
//; use lib do { (my $x= __FILE__) =~ s{[^/]+\z}{lib}; $x }; use TestJS -load => ['../src/JGraft.js', 'lib/helper.js', 'lib/test-util.js'];
TAP(function(t) {
   t.is(typeof JGraft, 'function', 'library loaded');
   t.is(manualHelper, 42, 'dependency loaded');
   t.is(typeof TestJS.runConformanceTests, 'function', 'shared namespace loaded');
   t.is(JSON.parse(TestJS.readFile('../jgraft-spec/data.json')).answer, 42, 'fixture loaded over HTTP');
   t.done_testing();
});
JS
write_file('t/nested/10-web.t', <<'JS');
//; use TestJS -load => ['../../src/JGraft.js', '../lib/helper.js'];
TAP(function(t) {
   t.is(typeof JGraft, 'function', 'library loaded');
   t.is(manualHelper, 42, 'dependency loaded');
   t.is(typeof TestJS.runConformanceTests, 'function', 'shared namespace loaded');
   t.is(JSON.parse(TestJS.readFile('../../jgraft-spec/data.json')).answer, 42, 'nested fixture loaded over HTTP');
   t.done_testing();
});
JS
write_file('t/lib/helper.js', 'var manualHelper= 42;');
write_file('t/11-perl.t', 'use strict; die "must not execute";');
write_file('t/12-dynamic.t', '//; use TestJS -load => do { die "must not execute" };');
write_file('t/a & "quote.t', '//; use TestJS;' . "\nTAP(function(t){t.pass('quoted');t.done_testing();});\n");
write_file('t/secret.txt', 'untracked secret');
write_file('t/untracked.t', 'untracked test');
write_file('t/public/leak.txt', 'untracked public file');
write_file('private.txt', 'untracked root secret');
write_file('tracked.txt', 'tracked root file');
write_file('t/replaced.txt', 'original regular file');
write_file('t/binary.dat', "\0\1\2\377");
git($repo, 'init', '-q');
git($repo, 'add', qw(t/serve-tests t/lib/tap.js t/lib/tap.css t/lib/helper.js t/lib/test-util.js src/JGraft.js),
   qw(t/10-web.t t/nested/10-web.t t/11-perl.t t/12-dynamic.t), 't/a & "quote.t',
   qw(tracked.txt t/replaced.txt t/binary.dat));

# Build an actual submodule so the recursive allowlist is exercised.
write_file('jgraft-spec/data.json', '{"answer":42}');
git("$repo/jgraft-spec", 'init', '-q');
git("$repo/jgraft-spec", 'add', 'data.json');
git("$repo/jgraft-spec", '-c', 'user.name=Tests', '-c', 'user.email=tests@example.invalid',
   'commit', '-qm', 'fixture');
git($repo, 'submodule', 'add', './jgraft-spec', 'jgraft-spec');
write_file('jgraft-spec/private.txt', 'untracked submodule secret');

symlink 'secret.txt', "$repo/t/untracked-link.txt" or die $!;
symlink '/etc/passwd', "$repo/t/outside-link.txt" or die $!;
symlink '../tracked.txt', "$repo/t/tracked-link.txt" or die $!;
git($repo, 'add', qw(t/untracked-link.txt t/outside-link.txt t/tracked-link.txt));
unlink "$repo/t/replaced.txt" or die $!;
symlink '../private.txt', "$repo/t/replaced.txt" or die $!;

# Loading the app from elsewhere must still locate its own Git root.
local $0= abs_path($0);
chdir '/' or die $!;
my $t= Test::Mojo->new(path("$repo/t/serve-tests"));
$t->app->log->level('warn');
$t->get_ok('/')->status_is(200)
   ->element_exists('a[href="/t/10-web.t"]')
   ->element_exists('a[href="/t/11-perl.t"]')
   ->element_exists_not('a[href="/t/untracked.t"]')
   ->content_unlike(qr/secret\.txt|tracked\.txt|helper\.js/);
$t->get_ok('/t/10-web.t')->status_is(200)->content_type_like(qr{text/html})
   ->element_exists('script[src="/t/lib/tap.js"]')
   ->element_exists('script[src="/src/JGraft.js"]')
   ->element_exists('script[src="/t/lib/test-util.js"]')
   ->element_exists('script[src="/t/lib/helper.js"]')
   ->element_exists('script[src="/t/10-web.t?raw=1"]')
   ->element_exists('base[href="/t/"]')
   ->element_exists_not('script:not([src])')
   ->content_unlike(qr/XMLHttpRequest|window\.TestJS=/);
is($t->tx->res->dom->find('script[src="/t/lib/test-util.js"]')->size, 1,
   'automatic helper loading does not duplicate a declared dependency');
$t->get_ok('/t/10-web.t?firebug=1')->status_is(200)
   ->element_exists('script[src="/t/lib/firebug-lite.min.js#startOpened=true,overrideConsole=true"]');
$t->get_ok('/t/nested/10-web.t')->status_is(200)
   ->element_exists('base[href="/t/nested/"]')
   ->element_exists('script[src="/src/JGraft.js"]');
$t->get_ok('/t/10-web.t?raw=1')->status_is(200)
   ->content_type_like(qr{application/javascript})->content_like(qr/fixture loaded over HTTP/);
$t->get_ok('/src/JGraft.js')->status_is(200)->content_like(qr/function JGraft/);
$t->get_ok('/jgraft-spec/data.json')->status_is(200)->json_is({answer => 42});
$t->get_ok('/tracked.txt')->status_is(200)->content_is('tracked root file');
$t->get_ok('/t/lib/tap.css')->status_is(200)->content_type_like(qr{text/css});
$t->get_ok('/t/lib/helper.js')->status_is(200)->content_like(qr/manualHelper/);
$t->get_ok('/t/binary.dat')->status_is(200)->content_is("\0\1\2\377");
$t->get_ok('/t/tracked-link.txt')->status_is(200)->content_is('tracked root file');
$t->get_ok('/t/11-perl.t')->status_is(200)->content_like(qr/Perl-only test/)
   ->element_exists_not('script[src]');
$t->get_ok('/t/12-dynamic.t')->status_is(400)->content_like(qr/literal -load filenames/);
my $url= Mojo::URL->new;
$url->path->parts(['', 't', 'a & "quote.t']);
$t->get_ok("$url")->status_is(200)->element_exists('script[src]');
for my $path (qw(/t/secret.txt /t/untracked.t /t/untracked.t?raw=1 /t/public/leak.txt
      /private.txt /jgraft-spec/private.txt /.git/config
      /t/ /t/lib/ /src/ /jgraft-spec/ /favicon.ico /t/untracked-link.txt
      /10-web.t /lib/tap.js
      /t/outside-link.txt /t/replaced.txt /../../etc/passwd)) {
   $t->get_ok($path)->status_is(404);
}
# Index membership is refreshed without restarting the server.
git($repo, 'add', 't/untracked.t');
$t->get_ok('/t/untracked.t?raw=1')->status_is(200)->content_is('untracked test');
$t->get_ok('/')->element_exists('a[href="/t/untracked.t"]');
git($repo, 'rm', '--cached', '-q', 't/untracked.t');
$t->get_ok('/t/untracked.t?raw=1')->status_is(404);

SKIP: {
   skip 'PhantomJS is not installed', 1 unless grep {
      -x File::Spec->catfile($_, 'phantomjs')
   } File::Spec->path;
   write_file('browser-smoke.js', <<'JS');
var page= require('webpage').create();
page.onError= function(message) { console.error(message); phantom.exit(1); };
page.open(require('system').args[1], function(status) {
   if (status !== 'success') phantom.exit(1);
   function finished() {
      var state= page.evaluate(function() {
         return typeof TAP !== 'undefined' && TAP.root.finished
            ? TAP.root.success && TAP.root.results.length === 4 : null;
      });
      if (state !== null) phantom.exit(state? 0 : 1);
      setTimeout(finished, 10);
   }
   finished();
});
setTimeout(function() { console.error('Browser smoke test timed out'); phantom.exit(1); }, 5000);
JS
   my @urls= map { '' . $t->ua->server->url->clone->path($_) }
      qw(/t/10-web.t /t/nested/10-web.t);
   # Keep the HTTP server's event loop running while the browser fetches files
   # and performs its synchronous fixture request from another process.
   Mojo::IOLoop->subprocess->run(sub {
      for my $url (@urls) {
         system 'phantomjs', "$repo/browser-smoke.js", $url;
         return $? if $?;
      }
      return 0;
   }, sub {
      my ($subprocess, $error, $status)= @_;
      ok(!$error && !$status, 'PhantomJS runs root and nested pages and reads fixtures without inline JavaScript');
      Mojo::IOLoop->stop;
   });
   Mojo::IOLoop->start;
}
chdir $cwd or die $!;
done_testing();
