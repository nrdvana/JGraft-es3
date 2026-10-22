//; use lib do { (my $x= __FILE__) =~ s{[^/]+\z}{lib}; $x }; use TestJGraft -load => '../src/JGraft.js';

TAP(function(t) {
   function expression(value, limits, metadata, forbidProto) {
      var options= {limits:limits};
      if (forbidProto !== undefined) options.forbidProto= forbidProto;
      return new JGraft(['JGRAFT',metadata || {v:1},['COPY',value,['NODE']]],options);
   }
   function errorOf(instance, input) {
      try {instance.apply(input);} catch (error) {return error;}
      return {};
   }
   function repeat(text, count) {return new Array(count+1).join(text);}
   var face= '\uD83D\uDE00';

   t.subtest('bounded element and trimming cursors',function(t) {
      var value, fields= ['SEQ',['START'],['REP',1,0,['EXISTS']],['END']];
      value= expression(['SPLIT',{sep:',',element:fields}]).apply('a,b,cc,d');
      t.is(value,['a','b','cc,d'],'element anchors use each field boundary rather than the entire source');
      value= expression(['SPLIT',{sep:',',element:['SEQ','a',['NONE',['EXISTS']]]}]).apply('a,b');
      t.is(value,['a','b'],'the virtual node is missing at the field end even when a separator follows');
      value= expression(['SPLIT',{sep:',',element:['SEQ','a',['IS',['END'],true]]}]).apply('a,b');
      t.is(value,['a','b'],'function matches retain and restore the bounded cursor');
      value= expression(['SPLIT',{sep:',',ltrim:['SEQ',['START'],face],
         rtrim:['SEQ',face,['END']]}]).apply(face+'a'+face+','+face+'b'+face);
      t.is(value,['a','b'],'trim views share the Unicode index but have independent anchors');
      value= expression(['SPLIT',{sep:',',ltrim:['REP',0,-1,'a'],
         rtrim:['SEQ','b',['NONE',['EXISTS']]]}]).apply('aaab');
      t.is(value,[''],'right trimming sees only the remainder after left trimming');
      value= expression(['SPLIT',{sep:['ANY',',',';'],keep:'@',default:['FAIL']}]).apply('a,b');
      t.is(value,['a',',','b'],'keep ignores default without evaluating intentional failures');
      value= expression(['SPLIT',{sep:'b',keep:'@',trim:'b'}]).apply('aba');
      t.is(value,['a','','a'],'separator elements retained by keep participate in trimming');
      value= new JGraft(['JGRAFT',{v:1},['SPLIT',{sep:'b',keep:'@',trim:'b'}]]).apply('aba');
      t.is(value,'aba','separator-element trimming metadata restores the round trip');
   });

   t.subtest('zero-width separator boundaries and metadata',function(t) {
      var value= expression(['SPLIT',{sep:['SEQ'],keep:'@'}]).apply('ab');
      t.is(value,['a','','b'],'keep emits an interior empty separator without a synthetic terminal separator');
      value= new JGraft(['JGRAFT',{v:1},['SPLIT',
         {sep:['ANY',',',''],default:'!'},['COPY','c',2]]]).apply('a,b');
      t.is(value,'a,b,c','the final field inherits its predecessor separator when an empty match flushes the remainder');
      value= new JGraft(['JGRAFT',{v:1},['SPLIT',
         {sep:['ANY',':',''],default:'!'},['COPY','x',4]]]).apply('a:bcd');
      t.is(value,'a:bcdx','actual interior zero-width separators remain empty in metadata');
   });

   t.subtest('shared indexes and allocation bounds',function(t) {
      var limits= {new_obj:100,mem:262144,ops:Infinity}, text= repeat('a',4096), value;
      value= expression(['SPLIT',''],limits).apply(text);
      t.is(value.length,4096,'splitting characters does not allocate cursor objects per character');
      value= expression(['SPLIT',{sep:['SEQ',','],default:','}],limits).apply(text);
      t.is(value,[text],'deterministic regex scanning reuses its scope and cursor');
      var input= [], expected= [], i, field;
      for (i= 0; i < 1024; i++) {
         field= ('0000'+i.toString(16)).slice(-4);
         input.push('_'+field+'_');
         expected.push(field);
      }
      value= expression(['SPLIT',{sep:',',element:['SEQ',['EXISTS'],['EXISTS'],['EXISTS'],
         ['EXISTS'],['EXISTS'],['EXISTS']],trim:'_',discard:true}],limits).apply(input.join(','));
      t.is(value,expected,'distinct fields reuse one bounded view without per-substring indexes or scopes');
   });

   t.subtest('resource failures are charged and recoverable across applications',function(t) {
      var text= repeat('a,',128), instance, error;
      instance= expression(['SPLIT',{sep:['ANY',',',';'],default:','}],
         {new_obj:80,ops:Infinity});
      error= errorOf(instance,text);
      t.is(error.code,'RESOURCE_LIMIT','per-element metadata allocations consume the object budget');
      t.is(error.resource,'new_obj','metadata growth identifies the exhausted budget');
      t.is(error.partial,text,'allocation fails before replacing the input');
      t.is(instance.apply('a,b'),['a','b'],'a failed attempt does not retain metadata or cursor state');
      instance= expression(['JOIN',','],{mem:4096,ops:Infinity});
      var input= [repeat('a',4096),repeat('b',4096)];
      error= errorOf(instance,input);
      t.is(error.code,'RESOURCE_LIMIT','JOIN charges the assembled string before allocation');
      t.is(error.resource,'mem','JOIN reports the output memory limit');
      t.ok(error.partial === input,'JOIN allocation failure retains the original input identity');
      instance= expression(['SPLIT',{sep:',',rtrim:['SEQ',['REP',0,-1,'a'],'z']}],{ops:5000});
      error= errorOf(instance,repeat('a',64));
      t.is(error.code,'RESOURCE_LIMIT','suffix searches charge unsuccessful start positions and repetition work');
      t.is(error.resource,'ops','suffix matching exhausts the operation budget');
      t.is(instance.apply('az'),[''],'a later application resets operation and view state');
      var pattern= 'a', i;
      for (i= 0; i < 40; i++) pattern= ['SEQ',pattern];
      error= errorOf(expression(['SPLIT',{sep:',',trim:pattern}],{depth:20}),'a');
      t.is(error.code,'RESOURCE_LIMIT','deferred regex matching enforces expression depth');
      t.is(error.resource,'depth','trim recursion reports the depth budget');
      t.ok(error.graftPath.indexOf('trim') >= 0,'resource diagnostics retain the deferred pattern location');
      error= errorOf(expression(['NONE',['SPLIT',{sep:['REP',0,-1,'a'],default:','}]],
         {ops:5000}),repeat('a',256));
      t.is(error.code,'RESOURCE_LIMIT','enclosing negative probes cannot swallow matching resource errors');
   });

   t.subtest('ownership, partial output, and instance reuse',function(t) {
      var input= {text:'a,b',keep:{}}, instance= new JGraft(['JGRAFT',{v:1},
         ['AT',['NODE','text'],['SPLIT',',',['COPY','X',0],['COPY',['FAIL'],1]]]]);
      var error= errorOf(instance,input);
      t.is(error.code,'INVALID_TARGET','subaction failures propagate');
      t.is(input.text,'a,b','the temporary array never replaces the original input property');
      t.is(error.partial.text,['X','b'],'partial output retains completed array edits on failure');
      t.ok(error.partial.keep === input.keep,'untouched input branches remain shared');
      instance= expression(['SPLIT',{sep:['ANY',':','|'],default:'/',trim:' '}]);
      var first= instance.apply(' a : b | c '), counts= instance.counts;
      first[0]= 'changed';
      t.is(instance.apply(' a : b | c '),['a','b','c'],'output edits do not affect a later application');
      t.ok(instance.counts !== counts,'each application owns its counters');
      t.is(instance.apply(' x | y '),['x','y'],'different subjects do not reuse stale offsets or metadata');
   });

   t.subtest('deferred pattern diagnostics and arbitrary keys',function(t) {
      var error= errorOf(expression(['SPLIT',{sep:['ANY',',',['UNKNOWN']],default:','}]),'a,b');
      t.is(error.code,'INVALID_GRAFT','syntax errors escape regex probes');
      t.is(error.graftPath,[2,1,1,'sep',2],'separator errors identify the encoded child');
      error= errorOf(expression(['SPLIT',{sep:',',rtrim:['SEQ',['UNKNOWN']]}]),'a');
      t.is(error.graftPath,[2,1,1,'rtrim',1],'trim errors identify the deferred child');
      var instance= new JGraft(['JGRAFT',{v:1},
         ['SPLIT',{sep:['ANY',['FAIL'],','],default:','}],
         ['COPY',['NODE','missing'],['NODE']]]);
      error= errorOf(instance,'a,b');
      t.is(error.graftPath,[3,1],'completed pattern probes restore the outer graft path');
      var value= expression(['SPLIT',{sep:['EXPR','__proto__'],default:','}],null,
         {v:1,expr:['__proto__',['SEQ',',']]},false).apply('a,b');
      t.is(value,['a','b'],'common patterns use safe own-property access even on legacy engines');
   });
   t.done_testing();
});
