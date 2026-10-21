//; use lib do { (my $x= __FILE__) =~ s{[^/]+\z}{lib}; $x }; use TestJGraft -load => '../src/JGraft.js';

TAP(function(t) {
   function check(input, pattern, expected, name, metadata) {
      var original= JSON.stringify(input), output, error;
      try {
         output= new JGraft(['JGRAFT', metadata || {v: 1}, ['MATCH', pattern]]).apply(input);
      } catch (caught) { error= caught; }
      if ((error? error.code : true) !== expected) name += " (" + (error? String(error) : "unexpected success") + ")";
      t.is(error? error.code : true, expected, name);
      t.is(JSON.stringify(input), original, name + ': input preserved');
      if (!error)
         t.is(output, input, name + ': borrowed input identity');
   }
   var face= '\uD83D\uDE00';
   check([1,2,3], [[['SEQ',1,2],3]], true, 'sequence consumes adjacent array elements');
   check([1,2,3], ['IS', [[['SEQ',1,2]]]], 'NO_MATCH', 'exact mode checks the final successor');
   check([1,2], ['IS', [[['SEQ',1,2]]]], true, 'exact mode accepts a complete sequence');
   check([1,3], [[['SEQ',1,2],3]], 'NO_MATCH', 'failed term rejects a sequence');
   check([1,2,3], [[['SEQ',1,['SEQ'],['SEQ',2]],3]], true, 'nested and empty sequences compose');
   check([], ['IS', [[['SEQ']]]], true, 'empty sequence matches an empty array');
   check([], [[['SEQ',['EXISTS']]]], 'NO_MATCH', 'EXISTS fails at array end');
   check([1], [[['SEQ',['START'],1,['END']]]], true, 'anchors do not consume elements in sequence context');
   check([1], [[['SEQ',1,['START']]]], 'NO_MATCH', 'START tests the absolute cursor');
   check([[1,2],3], [[['SEQ', [[1,2]], 3]]], true, 'structural child arrays have their own cursor');
   check(['ab'], [[['SEQ','ab']]], true, 'strings are atomic array elements');
   check([1], [[['ANY',0,1]]], true, 'ordinary array predicates retain nonsequence alternatives');
   check([1,2], [[['EXPR','s']]], true, 'EXPR expands a root sequence', {v:1,expr:['s',['SEQ',1,2]]});
   check([1,2], [[[13,1,2]]], true, 'numeric SEQ opcode');
   check([1,2], [[[13,[17],1,2,[18]]]], true, 'numeric anchor opcodes');
   check([1], [[['SEQ',1,['END'],['END']]]], true, 'multiple zero-width assertions share the end position');
   check([1], [[['SEQ',1,['SEQ']]]], true, 'empty sequence can follow the last element');
   check([1,2], [[['SEQ',1],['NODE']]], true, 'ordinary terms resume at the sequence successor');
   check({a:[1,2]}, {a:[[ ['SEQ',1,2] ]]}, true, 'sequence cursor preserves a nested input path');
   check('abc', ['STR'], true, 'STR recognizes strings');
   check(12, ['STR'], 'NO_MATCH', 'STR rejects other types');
   check('zabcx', ['STR',['SEQ','a','bc']], true, 'STR searches unanchored consecutive terms');
   check('zabcx', ['STR',['SEQ',['START'],'abc']], 'NO_MATCH', 'START anchors the string');
   check('abc', ['STR',['SEQ',['START'],'abc',['END']]], true, 'both anchors match a whole string');
   check('abc', ['STR',['SEQ','bc',['END']]], true, 'END anchors an unanchored suffix');
   check('abc', ['STR',''], true, 'empty string is an empty sequence');
   check('', ['STR',['SEQ',['START'],['END']]], true, 'empty subject has one cursor position');
   check('', ['STR',['EXISTS']], 'NO_MATCH', 'virtual end element is absent');
   check('a'+face+'z', ['STR',['SEQ',97,0x1F600,'z',['END']]], true, 'numeric codepoints and strings share a cursor');
   check(face, ['STR','\uD83D'], 'NO_MATCH', 'high surrogate cannot match half a pair');
   check(face, ['STR','\uDE00'], 'NO_MATCH', 'low surrogate cannot match half a pair');
   check('a\uD800b', ['STR',['SEQ','\uD800',98]], true, 'lone surrogates are individual codepoints');
   check(face+'x', ['STR',['SEQ',face,['IS',['NODE'],0x78]]], true, 'alternate target leaves regex context');
   check('ab', ['STR',['SEQ',['HAS','a'],['IS','b']]], true, 'one-argument comparison preserves regex context');
   check('zabc', ['STR',['EXPR','s']], true, 'EXPR expands regex sequences', {v:1,expr:['s',['SEQ','ab','c']]});
   check('zabc', ['STR',['EXPR','s']], true, 'value-defined string becomes a regex literal', {v:1,expr:['s','abc']});
   check('ab', ['STR',['SEQ',['IS',['IS','a'],true],'b']], true, 'function inner matches retain regex character semantics');
   check('ab', ['STR',['SEQ',['IS',['IS',['SEQ','a','b']],true],'b']], true, 'a function submatch restores its calling character');
   check('\u0001b', ['STR',['SEQ',['LENGTH',[[['IS',['SEQ',1,98]]]]],'b']], true, 'numeric function results compare at the original character');
   check('a', ['STR',['SEQ','a',['IS',['END'],true]]], true, 'function inner anchors retain the string cursor');
   check('a', ['STR',['IS','a','a']], true, 'alternate scalar target uses ordinary string equality');
   check('ab', ['STR',['SEQ',true,'b']], 'NO_MATCH', 'booleans cannot match virtual characters');
   check(face, ['STR',0xD83D], 'NO_MATCH', 'numeric surrogate cannot match half a pair');
   check('ab', ['STR',['SEQ',['NODE'],'b']], true, 'reference results compare as literal codepoints');
   check([1,2], [[['SEQ',['IS',['NODE'],1],2]]], true, 'array predicates see the current element');
   check([1], ['SEQ',1], 'INVALID_GRAFT', 'SEQ cannot begin at the current array itself');
   check('abc', ['STR',['SEQ',['REP',0,1,'a']]], 'INVALID_GRAFT', 'repetition is explicitly pending');
   check('abc', ['STR',['SEQ',['ANY','a','b']]], 'INVALID_GRAFT', 'sequence alternatives are explicitly pending');
   check('abc', ['STR',['END',1]], 'INVALID_GRAFT', 'anchor arity is checked');
   t.subtest('resource limits and long string cursors', function(t) {
      var text= new Array(2049).join(face)+'z', error, input= [1], i, term= 1;
      t.is(new JGraft(['JGRAFT',{v:1},['MATCH',['STR',['SEQ',face,'z',['END']]]]],
         {limits:{mem:131072,ops:1000000,new_obj:100}}).apply(text), text,
         'unanchored scan reuses scopes and checkpoints without character arrays');
      try {
         new JGraft(['JGRAFT',{v:1},['MATCH',['STR','z']]],{limits:{ops:100}}).apply(text);
      } catch (caught) { error= caught; }
      t.is(error && error.code, 'RESOURCE_LIMIT', 'string searching charges operation work');
      t.is(error && error.partial, text, 'resource failure preserves the subject');
      for (i= 0; i < 30; i++) term= ['SEQ',term];
      error= null;
      try {
         new JGraft(['JGRAFT',{v:1},['MATCH',[[term]]]],{limits:{depth:20}}).apply(input);
      } catch (caughtDepth) { error= caughtDepth; }
      t.is(error && error.code, 'RESOURCE_LIMIT', 'nested sequence depth is bounded');
   });
   t.done_testing();
});
