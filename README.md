# JGraft for older JavaScript engines

Load `src/JGraft.js` to make the `JGraft` constructor available on `window`
(or the host global when running without a browser). The implementation uses
strict mode and ES3 syntax, with some ES5 runtime facilities.

```javascript
var graft= new JGraft(
   ['JGRAFT', {v: 1}, ['COPY', 42, 'answer']],
   {limits: {ops: 100000}}
);
var output= graft.apply(input);
var independentOutput= graft.apply(input, {clone: true});
```

Ownership of the specification and its descendants transfers to the instance.
A caller retaining references must not modify them. The implementation may
cache information in that structure. Configuration limits are copied during
construction; application options are borrowed for the synchronous call.

`apply` does not modify its input. Changed ancestors are shallow-cloned once,
while untouched input subtrees can be shared with the result. COPY constructs
new values and deep-copies referenced objects, arrays, and native Dates. The
MOVE action transfers values and their ownership markers without traversing
the moved subtree. SPLICE materializes its replacement values before editing
the target array, while surviving elements can remain shared with the input.
The `clone` option additionally detaches any untouched shared subtrees. Shared
objects remain mutable in JavaScript: callers wanting independent ownership
of the entire result should request cloning.

`graft.counts` is initially null and is replaced on every application, including
failed attempts. Previous counter objects remain available to their holders.
The resource limits and defaults are:

| Counter | Meaning | Default |
| --- | --- | --- |
| `mem` | Conservative estimated allocation bytes, assuming no reclamation | 67,108,864 |
| `ops` | Work charged for evaluation, iteration, copying, and bookkeeping | 1,000,000 |
| `new_obj` | Allocated objects and arrays, including execution bookkeeping | 100,000 |
| `depth` | Maximum action, expression, path, or copied-data traversal depth | 128 |

Pass overrides in `config.limits`; `Infinity` disables an individual limit.
Final output cloning uses the same budget. These are implementation accounting
units, not exact heap measurements. Raising the depth limit beyond the host
engine's available stack can cause a native stack overflow.

Failures throw an `Error` with `code`, `graftPath`, `inputPath`, `partial`, and
`counts`. Resource failures additionally identify the counter in `resource`.
`partial` contains preceding edits and can share untouched input subtrees;
diagnostic trees are not defensively cloned. Paths inside temporary or constant
namespaces describe the location in that namespace. Invalid resource
configuration throws a `TypeError` during construction.

`UNSUPPORTED_GRAFT` reports a valid positive integer version newer than this
implementation supports, or a property operation forbidden by the host
configuration. It always terminates the graft, including inside MATCH, IF,
and logical matching expressions. Malformed version declarations remain
`INVALID_GRAFT`.

During MOVE, array deletions and half-index insertions are deferred until the
action finishes. If it fails before final rebuilding, pending deletions appear
as `null` at their original positions in `partial`, and queued half-index
insertions are omitted.
SPLICE evaluates every replacement before changing its target. A resource
failure while committing an edit can still leave a partially edited result.

Currently implemented: COPY, MOVE, SPLICE, JGRAFT scopes, AT, MATCH, IF,
HAS, IS, NONE, ANY, ALL, EXISTS, NODE/TEMP/STASH/CONST/CAP references,
EXPR expansion, LOCAL, NOT, LENGTH,
SLICE, CONCAT, and FAIL. There is supporting SPLIT action/expression and JOIN
expression behavior for literal separators/trimming and ANY lists of literal
alternatives, including separator/trim metadata carried by array edits.
The full SPLIT regex language and its `keep`/`element` options are pending;
sequence matching, captures, and the remaining expressions are also pending.
Strings use Unicode codepoints: valid UTF-16 surrogate pairs form one
character, while lone surrogates remain individual codepoints. LENGTH, SLICE,
and literal SPLIT use these boundaries. This policy is fixed for this
implementation. Native Dates can be copied; the specification's other date
operations and virtual date properties are pending.

String indexing retains the original string and first tests for surrogate
pairs. Strings without pairs use direct code-unit offsets. Other strings use
a cursor and UTF-16 offsets recorded every 256 codepoints, built as needed.
The indexes are shared within an application; no decoded character array is
allocated. LENGTH and slice-bound normalization can require scanning the whole
string. Scanning, checkpoint growth, and repeated seeks consume the normal
resource budgets.

## Engine and JSON requirements

`config.forbidProto` is a boolean option that forbids accessing, enumerating,
or producing an own property named `__proto__`, including in paths, match
patterns, constructed values, and namespace declarations. Rejection uses
`UNSUPPORTED_GRAFT`. The spelling is still allowed as ordinary string data.
The instance's `forbidProto` property reports its effective setting.

By default, each constructor probes the currently installed JSON parser and
enables this restriction if it drops `__proto__` data or changes prototypes.
For example, Node 0.10's parser discards scalar values and installs object
values as actual prototypes. Set `{forbidProto: true}` to apply the restriction
on any engine. Set `{forbidProto: false}` to allow the name explicitly, for
example when supplying descriptor-built data or using a conforming replacement
parser. A parser installed before construction affects the detected default.

The restriction is checked during visited property operations; it does not
scan untouched input subtrees. A copy-on-write parent clone or final output
cloning can encounter and reject a forbidden own property. It cannot identify
properties already discarded from input or graft JSON by a broken parser.
Use a conforming parser when arbitrary property names must be preserved.
JGraft ignores inherited data and never calls methods obtained from input
objects; it does not reconstruct data lost by a broken parser.

Engines with a magic `__proto__` setter need working
`Object.defineProperty` and `Object.getOwnPropertyDescriptor` implementations
for safe arbitrary-key support. The latter also handles old V8's incorrect
bracket reads of own `__proto__` data properties. Objects containing accessors,
functions, cycles, or other non-JSON extensions beyond Date are outside the
supported input model.

## Tests

Run `prove` from the repository or pass its test directory from another working
directory. The default engine is PhantomJS when available, otherwise Node.
`TESTJS=node`, `TESTJS=phantomjs`, and `TESTJS=all` select engines explicitly;
`all` runs both in parallel. All 1,149 COPY/MOVE/SPLICE/MATCH/IF/LENGTH/SLICE
conformance cases and local implementation tests are active without TODO markers.
The default adapter explicitly skips the ten cases with `needProto: true`
when `forbidProto` is enabled. Names and descriptions do not affect skipping.
Unrestricted runs execute all cases. Descriptor-built support tests explicitly disable the
restriction; host-restriction tests separately verify rejection on every engine.
Cases that require lone-surrogate preservation carry `needLoneSurrogate: true`;
this implementation runs all of them under its fixed codepoint policy.

The optional Mojolicious app `t/serve-tests daemon -l http://*:3000` serves the
Git-tracked repository files and browser test pages. Mojolicious is not needed
for `prove`.
