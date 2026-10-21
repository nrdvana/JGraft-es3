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

During MOVE, array deletions and half-index insertions are deferred until the
action finishes. If it fails before final rebuilding, pending deletions appear
as `null` at their original positions in `partial`, and queued half-index
insertions are omitted.
SPLICE evaluates every replacement before changing its target. A resource
failure while committing an edit can still leave a partially edited result.

Currently implemented: COPY, MOVE, SPLICE, JGRAFT scopes, AT,
NODE/TEMP/STASH/CONST/CAP references, EXPR expansion, LOCAL, NOT, LENGTH,
SLICE, CONCAT, and FAIL. There is supporting SPLIT action/expression and JOIN
expression behavior for literal separators/trimming and ANY lists of literal
alternatives, including separator/trim metadata carried by array edits.
The full SPLIT regex language and its `keep`/`element` options are pending;
matching actions and the remaining expressions are also pending.
LENGTH counts JavaScript UTF-16 code units. Native Dates can be copied; the specification's other date
operations and virtual date properties are pending.

## Engine and JSON requirements

Use a conforming JSON parser for arbitrary property names. In particular,
Node 0.10's native parser interprets `"__proto__"` as the object's actual
prototype, losing an ordinary data property before JGraft receives it. Use a
replacement parser on affected engines. JGraft ignores inherited data and
never calls methods obtained from input objects; it does not reconstruct data
lost by a broken parser.

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
`all` runs both in parallel. All 444 COPY/MOVE/SPLICE conformance cases and
the local implementation tests are active without TODO markers. Node 0.10's
native JSON parser causes four known conformance failures involving
`__proto__`; the descriptor-built local ownership and property tests pass.

The optional Mojolicious app `t/serve-tests daemon -l http://*:3000` serves the
Git-tracked repository files and browser test pages. Mojolicious is not needed
for `prove`.
