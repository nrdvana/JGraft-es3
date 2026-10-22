//; use lib do { (my $x= __FILE__) =~ s{[^/]+\z}{lib}; $x }; use TestJGraft -load => '../src/JGraft.js';

TAP(function(t) {
   function check(input, pattern, expected, name, metadata) {
      t.subtest(name, function(t) {
         var original= JSON.stringify(input), output, error;
         try {
            output= new JGraft(['JGRAFT', metadata || {v: 1}, ['MATCH', pattern]]).apply(input);
         } catch (caught) { error= caught; }
         if ((error? error.code : true) !== expected) name += " (" + (error? String(error) : "unexpected success") + ")";
         t.is(error? error.code : true, expected, name);
         t.is(JSON.stringify(input), original, name + ': input preserved');
         if (!error)
            t.is(output, input, name + ': borrowed input identity');
      });
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
   check('ab', ['STR',['SEQ',['IS',['IS','a'],true],'a','b']], true, 'function inner matches retain regex character semantics');
   check('ab', ['STR',['SEQ',['IS',['IS',['SEQ','a','b']],true],'a','b']], true, 'a function submatch restores its calling character');
   check('\u0001b', ['STR',['SEQ',['LENGTH',[[['IS',['SEQ',1,98]]]]],'b']], true, 'numeric function results compare at the original character');
   check('a', ['STR',['SEQ','a',['IS',['END'],true]]], true, 'function inner anchors retain the string cursor');
   check('a', ['STR',['IS','a','a']], true, 'alternate scalar target uses ordinary string equality');
   check('ab', ['STR',['SEQ',true,'b']], 'NO_MATCH', 'booleans cannot match virtual characters');
   check(face, ['STR',0xD83D], 'NO_MATCH', 'numeric surrogate cannot match half a pair');
   check('ab', ['STR',['SEQ',['NODE'],'b']], true, 'reference results compare as literal codepoints');
   check([1,2], [[['SEQ',['IS',['NODE'],1],1,2]]], true, 'array predicates see the current element');
   check([1], ['SEQ',1], 'INVALID_GRAFT', 'SEQ cannot begin at the current array itself');
   check('abc', ['STR',['SEQ',['REP',0,1,'a']]], true, 'optional repetition');
   check('abc', ['STR',['SEQ',['ANY','a','b']]], true, 'sequence alternatives');
   check('abc', ['STR',['END',1]], 'INVALID_GRAFT', 'anchor arity is checked');
   check(face+face+'z', ['STR',['SEQ',['REP',2,0,face],'z',['END']]], true, 'repetition consumes supplementary codepoints');
   check('x'+face+face+'z', ['STR',['SEQ',['ANY','x',face],['ALL',face,['REP',2,0,face]],'z',['END']]], true, 'ALL and ANY share Unicode cursor positions');
   check([1,1,2], ['IS',[[['SEQ',['REP',0,-1,1],2]]]], true, 'array repetition composes with exact matching');
   check([1,1,2], ['IS',[[['SEQ',['ALL',1,['REP',2,0,1]],2]]]], true, 'array ALL accepts unequal constraint lengths');
   check([], [[['SEQ',['REP',1,0,['HAS',['SEQ']]]]]], 'NO_MATCH', 'repetition discards successors beyond the array length');
   check('aab', ['STR',['SEQ',['START'],['ANY','a','aa'],'b',['END']]], true, 'later terms can require a longer alternative');
   check('aab', ['STR',['SEQ',['START'],['ANY','aa','a'],'ab',['END']]], true, 'later terms can require a shorter alternative');
   check([1,2,3], ['IS',[[['SEQ',['ANY',1,['SEQ',1,2]],3]]]], true, 'array exactness considers every alternative');
   check([1,2], ['IS',[[['SEQ',['ANY',['SEQ',1,2],1],2]]]], true, 'short alternative can reach exact array end');
   check('aaab', ['STR',['SEQ',['START'],['REP',0,-1,'a'],'ab',['END']]], true, 'repetition keeps shorter endpoints for a following suffix');
   check('aaab', ['STR',['SEQ',['START'],['REP',3,0,'a'],'b',['END']]], true, 'zero maximum aliases the minimum');
   check('aab', ['STR',['SEQ',['START'],['REP',3,0,'a'],'b',['END']]], 'NO_MATCH', 'minimum repetition count is enforced');
   check('aaaab', ['STR',['SEQ',['START'],['REP',1,3,'a'],'b',['END']]], 'NO_MATCH', 'finite repetition maximum is enforced');
   check('aaaaab', ['STR',['SEQ',['START'],['REP',2,0,['ANY','a','aa']],'ab',['END']]], true, 'repetition composes variable-length alternatives');
   check('aaaab', ['STR',['SEQ',['REP',1,-1,['REP',1,2,'a']],'b',['END']]], true, 'nested repetition composes successor sets');
   check([], ['IS',[[['SEQ',['REP',0,0,['UNKNOWN']]]]]], true, 'zero repetitions do not evaluate the body');
   check('', ['STR',['SEQ',['REP',1000000000,0,['SEQ']],['END']]], true, 'large exact repetition of an empty sequence terminates');
   check('ab', ['STR',['SEQ',['START'],['REP',1000000000,-1,['ANY',['SEQ'],'a']],'b',['END']]], true, 'zero-width choices satisfy large minimums after stabilization');
   check('', ['STR',['REP',1000000000,0,['EXISTS']]], 'NO_MATCH', 'large consuming minimum fails at the subject end');
   check('ab', ['STR',['SEQ',['REP',0,-1,['SEQ']],'ab',['END']]], true, 'unbounded empty repetition terminates');
   check('ab', ['STR',['SEQ',['REP',0,-1,['ANY',['SEQ'],'a']],'b',['END']]], true, 'mixed empty and consuming repetition terminates');
   check([2,2,2,9], ['IS',[[['SEQ',['REP',['NODE'],0,2],2,9]]]], true, 'repetition bounds evaluate at the initial element');
   check('aa', ['STR',['SEQ',['REP',['EXPR','minimum'],['EXPR','maximum'],'a'],['END']]], true, 'repetition bounds use value expressions', {v:1,expr:['minimum',2,'maximum',0]});
   check('a', ['STR',['ANY',['REP',-1,1,'a'],'a']], true, 'an invalid operand eliminates only its alternative');
   check('a', ['STR',['ANY',['NODE','missing'],'a']], true, 'a missing reference eliminates only its alternative');
   check('a', ['STR',['ALL','a','b']], 'NO_MATCH', 'ALL rejects an unsatisfied constraint');
   check('abc', ['STR',['SEQ',['START'],['ALL','a','abc'],['END']]], true, 'ALL combines constraints of unequal lengths');
   check('abc', ['STR',['SEQ',['START'],['ALL','abc','a'],['END']]], true, 'ALL is independent of argument order');
   check('ab', ['STR',['SEQ',['ALL',['SEQ'],'a'],'b',['END']]], true, 'ALL can combine empty and consuming constraints');
   check('', ['STR',['ALL',['SEQ'],['SEQ']]], true, 'ALL of empty constraints is empty');
   check('ab', ['STR',['SEQ',['NONE','b'],'a','b',['END']]], true, 'NONE is a zero-width negative assertion');
   check('ab', ['STR',['SEQ',['NONE','a'],'a']], 'NO_MATCH', 'NONE rejects a matching successor');
   check('', ['STR',['SEQ',['NONE',['EXISTS']],['END']]], true, 'negative EXISTS asserts the missing end element');
   check('a', ['STR',['NONE']], true, 'empty NONE succeeds without consuming');
   check('a', ['STR',['ANY']], 'INVALID_GRAFT', 'ANY requires an argument');
   check('a', ['STR',['ALL']], 'INVALID_GRAFT', 'ALL requires an argument');
   check('a', ['STR',['REP',0,1]], 'INVALID_GRAFT', 'REP requires bounds and a body');
   check([1], [[['REP',0,1,1]]], 'INVALID_GRAFT', 'REP cannot initiate array sequence context');
   check([1], ['REP',0,1,1], 'INVALID_GRAFT', 'REP is illegal outside sequence context');
   check('a', ['STR',['ANY','a',['UNKNOWN']]], 'INVALID_GRAFT', 'syntax errors escape alternative probes');
   check('a', ['STR',['ANY',['FAIL'],'a']], true, 'failed value probes do not poison a later branch');
   var all= ['ALL',['ANY',['REP',1,0,'a'],['REP',3,0,'a'],['REP',7,0,'a']],
         ['ANY',['REP',2,0,'a'],['REP',4,0,'a']]], i;
   for (i= 0; i <= 8; i++)
         check(new Array(i+1).join('a'), ['STR',['SEQ',['START'],all,['END']]],
            i === 2 || i === 3 || i === 4 || i === 7? true : 'NO_MATCH',
            'ALL admits exactly the specified successor ' + i);
   var pairs= [[-1,1],[1,-2],[2,1],[0.5,1],[0,1.5],['1',1],[0,null]], i;
   for (i= 0; i < pairs.length; i++)
         check('aaa', ['STR',['REP',pairs[i][0],pairs[i][1],'a']], 'NO_MATCH', 'invalid bounds ' + i);

   function captureCheck(input, pattern, expected, name, metadata) {
      t.subtest(name, function(t) {
         var original= JSON.stringify(input);
         t.is(new JGraft(['JGRAFT',metadata || {v:1},
            ['COPY',['CAPTURE',pattern],['NODE']]]).apply(input),expected,'selected captures');
         t.is(JSON.stringify(input),original,'input preserved');
      });
   }
   function range(offset, length, path) {
      return {path:path || [],ofs:offset,len:length,lim:offset+length};
   }
   var many= ['REP',0,-1,['EXISTS']];
   captureCheck([1,2,3],[[['SEQMIN','a',many],['SEQMIN','b',many]]],
      {a:range(0,0),b:range(0,0)},'partial captures prefer shortest groups independently of total consumption');
   captureCheck([1,2,3],['IS',[[['SEQMIN','a',many],['SEQMIN','b',many]]]],
      {a:range(0,0),b:range(0,3)},'capture preferences resolve after the entire exact match');
   captureCheck([1,2,3],['IS',[[['SEQMAX','a',many],['SEQMAX','b',many]]]],
      {a:range(0,3),b:range(3,0)},'earlier group length preferences take priority');
   captureCheck([1,2,3],['IS',[[['SEQMAX',null,many],['SEQMAX','b',many]]]],
      {b:range(3,0)},'unnamed groups retain their length preference');
   captureCheck([1,1,1],[[['SEQ',many],['SEQMIN','a',1]]],
      {a:range(0,1)},'equal capture lengths prefer the earliest start');
   captureCheck([1,2,3],[[['SEQMAX','a',many],['SEQMIN','b',many]]],
      {a:range(0,3),b:range(3,0)},'partial captures can select a later endpoint');
   captureCheck([1,2],[[['EXPR','group']]],{a:range(0,2)},
      'common expressions expose root named sequences',{v:1,expr:['group',[14,'a',many]]});
   captureCheck([{a:[1],b:[2]},{a:[3],b:[4]},{a:[5],b:[6]}],
      [[['SEQ',many,{a:[[['SEQMAX','a',many]]]},many,{b:[[['SEQMAX','b',many]]]},many]]],
      {a:range(0,1,[0,'a']),b:range(0,1,[1,'b'])},
      'substructure captures select earliest placements in specification order');
   captureCheck([1],[[['SEQMIN',null],['SEQMAX','a',many]]],
      {a:range(0,1)},'empty unnamed groups do not create a capture');
   captureCheck([1],['IS',[[['SEQMAX','a',2]]]],false,
      'failed CAPTURE returns false');
   captureCheck([{x:[1]},{x:[2]},{x:[3]}],['IS',[[
      ['SEQ',['ANY',['REP',2,0,['EXISTS']],['SEQ'],['EXISTS']]],
      {x:[[ ['SEQMAX','a',['EXISTS']] ]]},['SEQ',many]]]],
      {a:range(0,1,[0,'x'])},'root substructure placement is independent of frontier order');
   t.subtest('capture namespaces and ownership',function(t) {
      var input= {nested:[1,2]}, pattern= {nested:[[ ['SEQMAX','a',many] ]]};
      var graft= new JGraft(['JGRAFT',{v:1},['MATCH',pattern,
         ['COPY',['SLICE',['CAP','a']],'saved',['CAP'],'bounds']]]);
      var output= graft.apply(input);
      t.is(output.saved,[1,2],'captured paths can be sliced relative to the match node');
      t.is(output.bounds,{a:range(0,2,['nested'])},'MATCH publishes its capture namespace');
      output.saved[0]= 9;
      t.is(input,{nested:[1,2]},'captured slices retain input isolation');
      t.is(graft.apply(input).saved,[1,2],'reusing an instance starts a new match state');
      output= new JGraft(['JGRAFT',{v:1},['IF',pattern,
         ['COPY',['CAP'],['NODE']]]]).apply(input);
      t.is(output,{a:range(0,2,['nested'])},'IF publishes the selected condition captures');
      output= new JGraft(['JGRAFT',{v:1},['COPY',
         ['HAS',[[['SEQMAX',['FAIL'],many]]]],['NODE']]]).apply([1]);
      t.is(output,true,'boolean function matches do not evaluate capture names');
   });
   t.subtest('capture annotation resource budgets',function(t) {
      var input= new Array(33), i, error, graft, output;
      for (i= 0; i < input.length; i++) input[i]= i;
      graft= ['JGRAFT',{v:1},['COPY',['CAPTURE',[[['SEQMAX','a',many]]]],['NODE']]];
      output= new JGraft(graft).apply(input);
      t.is(output,{a:range(0,input.length)},'all annotated endpoints are considered');
      try {new JGraft(graft,{limits:{new_obj:100,ops:Infinity}}).apply(input);}
      catch (caught) {error=caught;}
      t.is(error && error.code,'RESOURCE_LIMIT','annotation allocations consume the object budget');
      t.is(error && error.resource,'new_obj','the exhausted annotation budget is identified');
      t.is(error && error.partial,input,'allocation failure leaves the input untouched');
   });

   t.subtest('branching resource and iteration bounds', function(t) {
      var text= new Array(4097).join('a'), instance, error, output;
      var pattern= ['STR',['SEQ',['START'],['REP',0,-1,['ANY','a','a','a']],['END']]];
      instance= new JGraft(['JGRAFT',{v:1},['MATCH',pattern]],
         {limits:{ops:Infinity,mem:1048576,new_obj:100,depth:24}});
      output= instance.apply(text);
      t.is(output, text, 'long repetition deduplicates alternatives and uses iteration rather than recursive calls');
      pattern= ['STR',['SEQ',['START'],['ALL',['REP',0,-1,'a'],['REP',2,0,'a']],['END']]];
      instance= new JGraft(['JGRAFT',{v:1},['MATCH',pattern]],{limits:{mem:4096,ops:Infinity}});
      try { instance.apply(text); } catch (caughtMem) { error= caughtMem; }
      t.is(error && error.code, 'RESOURCE_LIMIT', 'successor-set growth is charged');
      t.is(error && error.resource, 'mem', 'successor sets consume the memory budget');
      t.is(error && error.partial, text, 'set allocation failure preserves input');
      error= null;
      instance= new JGraft(['JGRAFT',{v:1},['MATCH',['STR',['REP',0,-1,'a']]]],{limits:{ops:500}});
      try { instance.apply(new Array(101).join('a')); } catch (caughtOps) { error= caughtOps; }
      t.is(error && error.code, 'RESOURCE_LIMIT', 'repetition work consumes the operation budget');
      t.is(error && error.resource, 'ops', 'iteration trips the operation limit');
      error= null;
      instance= new JGraft(['JGRAFT',{v:1},['MATCH',['STR',['ANY',['UNKNOWN'],'a']]]]);
      try { instance.apply('a'); } catch (caughtSyntax) { error= caughtSyntax; }
      t.is(error && error.graftPath.join('.'), '2.1.1.1', 'branch syntax errors retain their graft location');
   });
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
