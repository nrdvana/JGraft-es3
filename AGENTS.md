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
The jgraft-spec submodule supplies standard fixtures in jgraft-spec/conformance.
Read its README.md before adding fixtures; initialize a missing submodule with
`git submodule update --init`.

Read [IMPLEMENTATION.md](IMPLEMENTATION.md) for current coverage, the test-file map,
installed engine versions, focused regression commands, implementation notes, and
known failures. Keep those evolving details there when adding features or tests.

Run `prove` from the repository root, or pass the absolute t/ path from elsewhere.
Use `prove -v path/to/test.t` for detailed output. Engine selection is controlled by
TESTJS: unset/empty prefers PhantomJS and falls back to Node; explicit phantomjs or node
never falls back. `TESTJS=all prove` runs both in parallel and reports their output as
sequential TAP subtests. Engine names are resolved through PATH, so prepend a legacy
engine's bin directory to select its version. TESTJS_TIMEOUT is a per-engine wall-clock
limit in milliseconds (default 10000), enforced by Perl even for synchronous loops.

Most .t files are JavaScript with a one-line Perl preamble:

    //; use lib do { (my $x= __FILE__) =~ s{[^/]+\z}{lib}; $x }; use TestJGraft -load => '../src/JGraft.js';

The -load option accepts a filename or array of filenames relative to the test. The
Perl wrapper t/lib/TestJGraft.pm launches t/lib/run-node.js or t/lib/run-phantomjs.js,
preloads tap.js and TestJGraft.js, and executes original files to preserve filenames
and line numbers. Shared helpers live in TestJGraft.js; these are private project
utilities without a stable API. Plain Perl tests also work.

Use `TAP(function(t) { ...; t.done_testing(); });` and `t.subtest(name, callback)`.
`t.todo(reason, callback)` scopes expected failures to a synchronous callback and its
subtests. Use TODO only for intentionally pending behavior; do not hide regressions.
Use `TestJGraft.runConformanceTests(t, fileOrSuite[, apply])` for conformance suites.
The helper checks unchanged input on success and failure and validates outputs/error
codes. RESOURCE_LIMIT fixture flags require a resource failure even when an output is
also supplied. TestJGraft.readFile resolves fixture paths relative to the test file.
Test resource budgets and ownership behavior rather than exact counter totals.

Use conforming JSON parsing for arbitrary keys. Do not accommodate broken parsers by
trusting inherited properties, altering fixtures, or weakening output comparison.
Use the implementation's safe property helpers when investigating engine differences.

The optional Mojolicious::Lite app t/serve-tests supports manual browser testing:

    t/serve-tests daemon -l 'http://*:3000'

Mojolicious is not required by the normal suite; server checks skip when unavailable.
The repository is the server root: / lists tests, .t URLs render HTML, and ?raw=1 returns
source. Only Git-known files (including submodule files) are fetchable, with no other
directory indexes. New files must be added to Git's index before browser fetching;
do not bypass that restriction. Browser behavior shares tap.js, tap.css, and TestJGraft.js
with headless tests.
