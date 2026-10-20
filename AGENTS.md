# JGraft ECMAScript 3 Implementation

The goal of this library is to create an implementation of JGraft which prioritizes correctness,
and then code size after minification, and can run on fairly old JavaScript implementations,
not strictly limited to ES3 but within the capabilities of the common implementations of the
early 2010s.

The full specification for JGraft is available at `jgraft-spec/SpecV1.md`.
The implementation should be able to apply every conceivable JGraft (within resource limits),
but may disregard optional features (fuzzy matching, generating an "undo") to keep the code size
down.  However, it should include the optional support for JavaScript Date objects.

Some ECMAScript5 features may be polyfilled, and the implementation may assume that a JSON
library exists.  The implementation should also run un-altered in a full ES5 environment, and
use "strict" mode.

## Resource Counters

These are the counts that I envision are important to track.  We might need to modify this list
to catch an excess of expensive operations or be permissive of cheaper operations to not count
too heavily against the limits.

  - mem:
      Maximum estimated number of bytes which can be allocated above the starting size of the data
      structure.
  - ops:
      Total count of operations performed.  Any iterative behavior anywhere in the implementation
      must contribute to this limit (ideally by adding a known count prior to iteration rather
      than incrementing it on every iteration).  Even things like comparing two extremely long
      strings must add a scalar to the ops count, though it could be something like the string
      length multiplied by .001
  - new_obj:
      Total count of times the library may create a new object or array
  - depth:
      Maximum recursion depth of any expression, including the recursive structural iteration of
      expressions even if not implemented as recursive function calls.

## Implementation Notes

The library should be made available as window.JGraft, which should be both a constructor and
a namespace for global functions.

JGraft permits arbitrary property names on objects, including `__proto__`.  An ES3 implementation
will need to be continuously guarding against this, possibly just by using a helper function to
read or write paths.  Additionally, old JS engines may have a JSON module that incorrectly adds
external data to the prototype of an object when it contains a `__proto__` property.  We must
guard against that by never using methods on objects that came from the input.

  * Treat all input subtrees as external, including those moved into temporary storage.
  * Read only own properties and use safe property-writing helpers.
  * Call trusted built-in methods explicitly, never methods obtained from input objects.
  * Keep internal bookkeeping separate from user-controlled properties.

No operations should be inlined for speed in a parent function unless the size change to the code
is negligible.  The library should have a collection of helper functions that perform most of the
error checking and JGraft semantics, and these should be used liberally instead of writing
one-off tests in each action and expression.  After each pass of development, look for
opportunities to collapse common patterns into helper functions, and also look for ways to
combine helper functions into a single function that can vary its behavior using a few optional
call-site parameters.  Whatever results in the smallest post-minification size is preferred.
But, don't pre-minimize the identifiers in the code; use natural variable names on the assumption
they will be replaced by a minification tool.  Also try to main complete but concise
documentatinon on the semantics of each helper function.

There should be an object enclosing the state that applies a JGraft, but aside from that not many
custom classes are likely required for the implementation.  Don't necessarily avoid object
oriented design, but consider whether adding a class will increase or decrease the overall code
size.

To isolate edits from the original input, the library should use the copy-on-write approach of
shallow-cloning parents of a change up to the root element.  To avoid doing this repeatedly, a
parallel tree should be built to track which elements have been previously cloned. So, a write
to "a.b.c" in the main data tree should check for a true value along the path of "cloned.a.b"
with `true` meaning the whole subtree is unshared, and objects meaning that this node is cloned
but sub-properties need checked.  If it is still shared, shallow clone "a.b= clone(a.b)" and
create "cloned.a.b= {}" and then proceed with modifying property 'c'.  This also needs tracked
for the shared and temp namespace if shared data ends up there.  Actually, if you have better
ideas for handling copy-on-write, feel free to use that instead and notify me in the prompt so
I can update these instructions.

## Code Style

By example, code should look roughly like:

    // This function requires precondition blah, and computes whatever.
    // It always results in X but does not check Y.
    function foo(arg1, arg2) {
       var x;
       // this loop does etc. etc.
       // because of reasons.
       while (something) {
          x = condition? x+1 : x+2;
       }
       return x;
    }

Ternary expressions should be used whenever they can reduce code size.  The usual criteria for
"pretty code" take a lower priority than code size or even execution speed.  If you think a
human would find a snippet of code confusing, add more comments.

Traditional for loops should probably be preferred over the more modern callback style, unless
the modern style can actually reduce code size.  (needing the "function" keyword in each loop
body in ES3 is a hinderance to that).  Feel free to declare variables upfront and re-use them
throughout a function for additional savings that a minifier might not be able to make.

The entire library should be wrapped within a function evaluation to avoid polluting external
namespaces, but don't add a level of indent for this.

## Testing

The suite is self-contained Perl TAP plus JavaScript; no npm packages are required.
The `jgraft-spec` git submodule supplies the specification and JSON fixtures in
`jgraft-spec/conformance`. Read its `README.md` before adding fixtures. Initialize the
submodule with `git submodule update --init` if it is missing.

From the repository root:

    prove
    TESTJS=node prove
    TESTJS=all prove
    TESTJS=all prove -v t/21-copy.t

With TESTJS unset or empty, PhantomJS is preferred and Node is the fallback. An explicit
engine selection never falls back. `TESTJS=all` launches PhantomJS and Node concurrently
and re-emits their captured output as sequential TAP subtests in that order. It means
those two executable names, not every installed engine version. `TESTJS_TIMEOUT` is a
per-engine timeout in milliseconds (default 10000); Perl's watchdog also interrupts tight
synchronous loops. Paths are resolved independently of the working directory; from
elsewhere, use e.g. `prove /absolute/path/to/JGraft-es3/t`.

The Dockerfile installs PhantomJS 1.9.2 at `/usr/local/bin/phantomjs` and Node 0.10.48
at `/opt/node-0.10/bin/node`, with `/usr/local/bin/node-0.10` as a convenience symlink.
The legacy Node download is checksum-verified and only its binary is installed, without
npm. Both archived engine downloads target Linux x86-64. Legacy Node does not replace
the normal `node` executable. Select it by prepending its directory to PATH:

    PATH=/opt/node-0.10/bin:$PATH TESTJS=node prove
    PATH=/opt/node-0.10/bin:$PATH TESTJS=node prove t/10-api.t t/21-copy.t

The second command checks the API and implementation without the known JSON-parser
failure described below. `TESTJS=node-0.10` is not a supported selection; the harness
launches the `node` found in PATH. Prefixing PATH also changes the Node used by
`TESTJS=all` and by the harness's own engine regression tests.

### Test files and helper APIs

| File | Purpose |
| --- | --- |
| `t/00-load.t` | Library loading |
| `t/01-perl-test-util.t` | Engine selection, paths/line numbers, parallel execution, timeout/reaping |
| `t/02-js-test-util.t` | Conformance helper, comparison, mutation detection, fixture/error handling |
| `t/03-serve-tests.t` | Optional HTTP server security and browser rendering |
| `t/04-tap.t` | Scoped TODO semantics and browser presentation |
| `t/10-api.t` | Constructor/apply API, counters, partial errors, reuse |
| `t/20-act-basic.t` | COPY/MOVE/SPLICE conformance and pending Date cases |
| `t/21-copy.t` | COPY ownership, Dates, prototype safety, scopes, resource limits |

Most `.t` files are original JavaScript preceded by one Perl-compatible line:

    //; use lib do { (my $x= __FILE__) =~ s{[^/]+\z}{lib}; $x }; use TestJS -load => '../src/JGraft.js';

`-load` accepts one path or an array of paths, relative to the test file. The wrapper
`t/lib/TestJS.pm` launches `t/lib/run-test.js`, which preloads `tap.js` and executes the
original test file to preserve filenames and line numbers. Literal `-js` heredocs are
supported for compatibility but are not needed for new tests. Plain Perl tests run
normally through prove.

Use `TAP(function(t) { ...; t.done_testing(); });` and `t.subtest(name, callback)`.
`t.todo(reason, callback)` scopes expected failures to a synchronous callback, including
its subtests. Those failures emit `# TODO`, render yellow, and do not fail the suite;
failures outside the scope still count. Entirely skipped subtests render grey.

Load `lib/test-util.js` for `TestJS.runConformanceTests(t, fileOrSuite[, apply])`.
Its default adapter calls `new JGraft(graft, {limits: limits}).apply(input)`. An override
receives `(input, graft, limits)` for testing the helper independently. The helper checks
input identity and values (including Dates and prototype contents) after both successful
and failed applications, and validates permitted error codes. Fixture RESOURCE_LIMIT
flags require a resource failure even if output is also provided. `TestJS.readFile`
resolves fixture paths relative to the test; ordinary browsers use synchronous XHR.

COPY's 121 standard cases currently run as ordinary tests. MOVE, SPLICE, and their
Date cases remain explicitly TODO until implemented. Do not hide new COPY failures in
those TODO scopes. Read `README.md` for the current implementation subset, constructor
ownership contract, configuration, and resource-counter semantics. Tests should check
budgets and ownership behavior rather than depend on exact counter totals.

### Old-engine quirks

Node 0.10's native JSON parser puts `"__proto__"` data into the actual prototype instead
of an own property. With that parser, the full suite currently has one known COPY
fixture failure: `Write arbitrary object property names` in `t/20-act-basic.t`, because
the expected JSON output loses that property while JGraft correctly creates an own
data property. A conforming replacement JSON parser is needed for that fixture and
for applications needing arbitrary JSON keys. Do not fix the mismatch by treating
inherited properties as data, changing the fixture, or weakening output comparison.

Old V8 can also ignore an own `__proto__` data property during bracket reads, and old
JavaScriptCore can report the magic accessor as an own property. Use descriptors to
inspect actual data properties when debugging these cases; use the library's own
property helpers in implementation code. A bare hasOwnProperty or bracket read is not
sufficient across the supported engines.

Keep Node VM filenames as strings: Node 0.10 coerces an options object to the filename
`[object Object]`. Its caught syntax errors omit source locations; the runner's fallback
uses a compile-only child to capture native diagnostics as TAP comments without rerunning
test code. PhantomJS 1.9 also omits syntax-error traces; its fallback reparses without
executing. Preserve the harness regression tests when changing either path.

### Manual browser testing

`t/serve-tests` is an optional Mojolicious::Lite app; Mojolicious is not a dependency
of the normal suite. Server regression tests skip when it is unavailable. For example:

    t/serve-tests daemon -l 'http://*:3000'

The server root is the repository. `/` lists test links, and `/t/*.t` URLs render HTML
around the original JavaScript; `?raw=1` returns source. Only Git-known files are served,
including tracked submodule files, with no other directory indexes. Newly created files
must be added to Git's index before they can be fetched. Do not bypass that restriction
to make local browser testing work. Browser behavior lives in `tap.js`, `tap.css`, and
`test-util.js`, shared with the headless tests.

