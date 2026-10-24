//; use lib do { (my $x= __FILE__) =~ s{[^/]+\z}{lib}; $x }; use TestJGraft -load => '../src/JGraft.js';

TAP(function(t) {
   function engine(expr,config) {
      return new JGraft(['JGRAFT',{v:1},['COPY',expr,['NODE']]],config);
   }
   function errorOf(instance,input) {
      try {instance.apply(input);} catch (error) {return error;}
      return {};
   }
   function regex(expr) {return ['IS',['STR',['SEQ',['START'],expr,['END']]]];}

   t.subtest('full Unicode boundaries and fixed surrogate decoding',function(t) {
      var points= [0,0xD7FF,0xD800,0xDBFF,0xDC00,0xDFFF,0xE000,0xFDD0,0xFFFE,0xFFFF,0x10000,0x10FFFE,0x10FFFF], i, cp, text;
      for (i=0;i<points.length;i++) {
         cp=points[i];
         text= cp>65535?String.fromCharCode(0xD800+Math.floor((cp-65536)/1024),0xDC00+(cp-65536)%1024):String.fromCharCode(cp);
         t.is(engine(['CHARS',cp]).apply(text),true,'ordinary strings expose U+'+cp.toString(16));
         t.is(engine(regex(['CHARS',cp])).apply(text),true,'regex strings expose U+'+cp.toString(16));
      }
      t.is(engine(['CHARS',0,null],{limits:{ops:2000,mem:10000}}).apply(0x10FFFF),true,
         'a full Unicode range does not allocate or enumerate its codepoints');
      t.is(engine(['CHARS',false,0,0x10FFFE],{limits:{ops:2000,mem:10000}}).apply(0x10FFFF),true,
         'subtracting nearly the universe also stays compact');
      t.is(engine(regex(['CHARS',0xD800,0xDFFF])).apply(String.fromCharCode(0xD83D,0xDE42)),false,
         'a valid surrogate pair is not matched as either half');
   });

   t.subtest('large class lists compile once within an application',function(t) {
      var list= '',input= '',i;
      for (i=0;i<512;i++) list+=String.fromCharCode(32+i*2);
      for (i=0;i<200;i++) input+=' ';
      var instance= engine(regex(['REP',200,0,['CHARS',list]]),{limits:{ops:50000}});
      t.is(instance.apply(input),true,'repetition can reuse a large literal class under a bounded budget');
      t.is(instance.apply(input),true,'per-application compilation is reusable on the next application');
      var expr= ['CHARS'];
      for (i=0;i<150;i++) expr.push(i*2,true);
      instance= engine(expr,{limits:{depth:16}});
      t.is(instance.apply(298),true,'many disjoint intervals do not create deep membership recursion');
      t.is(instance.apply(297),false,'binary membership preserves gaps between intervals');
   });

   t.subtest('computed names and lexical class namespaces remain dynamic',function(t) {
      var classExpr= ['CHARS',['EXPR',['TEMP','class']]];
      var instance= new JGraft(['JGRAFT',{v:1,expr:['a',['CHARS','a'],'b',['CHARS','b']]},['COPY',{
         a:['LOCAL','class','a',['IS','a',classExpr]],
         b:['LOCAL','class','b',['IS','b',classExpr]],
         notA:['LOCAL','class','b',['IS','a',classExpr]]
      },['NODE']]]);
      t.is(instance.apply(null),{a:true,b:true,notA:false},'one class expression can resolve different TEMP names');
      instance= new JGraft(['JGRAFT',{v:1,expr:[
         'a',['CHARS','a'],'b',['CHARS','b'],
         'alias',['EXPR',['TEMP','class']],
         'outer',['CHARS',['EXPR','alias']]
      ]},['COPY',{
         a:['LOCAL','class','a',['IS','a',['EXPR','outer']]],
         b:['LOCAL','class','b',['IS','b',['EXPR','outer']]]
      },['NODE']]]);
      t.is(instance.apply(null),{a:true,b:true},'dynamic aliases prevent caching every enclosing class');
      var input= {value:'a',data:{x:1}};
      instance= engine(['LOCAL',null,['NODE','value'],['CHARS','a']]);
      t.is(instance.apply(input),true,'a localized NODE supports ordinary class matching');
      t.is(input,{value:'a',data:{x:1}},'compilation and matching leave input untouched');
   });

   t.subtest('prototype names and forbidden operations',function(t) {
      var graft= ['JGRAFT',{v:1,expr:['__proto__',['CHARS','a']]},
         ['COPY',regex(['CHARS',['EXPR','__proto__']]),['NODE']]];
      t.is(new JGraft(graft,{forbidProto:false}).apply('a'),true,'common class names use safe own properties');
      t.is(errorOf(new JGraft(graft,{forbidProto:true}),'a').code,'UNSUPPORTED_GRAFT',
         'forbidden class names retain host rejection semantics');
      graft= ['JGRAFT',{v:1,expr:['class',['CHARS','a']]},['COPY',regex(['CHARS',['EXPR',
         ['CASE',['EXISTS'],['NODE','__proto__'],'class']]]),['NODE']]];
      t.is(errorOf(new JGraft(graft,{forbidProto:true}),'a').code,'UNSUPPORTED_GRAFT',
         'computed-name host failures cannot be swallowed as class mismatches');
   });

   t.subtest('resource limits, recursion, and clean reuse',function(t) {
      var large= ['CHARS'],i;
      for (i=0;i<200;i++) large.push(i*2,true);
      var graft= ['JGRAFT',{v:1,expr:['small',['CHARS','a'],'large',large]},
         ['COPY',['LOCAL','class',['NODE','name'],null,['NODE','value'],['CHARS',['EXPR',['TEMP','class']]]],['NODE']]];
      var configurations= [{ops:3000},{mem:10000},{new_obj:150}], counter;
      for (i=0;i<configurations.length;i++) {
         var instance= new JGraft(graft,{limits:configurations[i]});
         var error= errorOf(instance,{name:'large',value:'a'});
         for (counter in configurations[i]) break;
         t.is(error.code,'RESOURCE_LIMIT','large classes exhaust '+counter+' rather than native resources');
         t.is(error.resource,counter,'the exhausted counter is identified');
         t.is(instance.apply({name:'small',value:'a'}),true,'the instance works after '+counter+' failure');
         t.ok(error.counts!==instance.counts,'previous '+counter+' failure counts stay independent');
      }
      instance= new JGraft(['JGRAFT',{v:1,expr:['loop',['CHARS',['EXPR','loop']]]},
         ['COPY',['NONE',['CHARS',['EXPR','loop']]],['NODE']]],{limits:{depth:24}});
      error= errorOf(instance,97);
      t.is(error.code,'RESOURCE_LIMIT','recursive sets cannot be hidden in a negative probe');
      t.is(error.resource,'depth','recursive class references consume expression depth');
      error= errorOf(engine(['CHARS',new Array(10001).join('a')],{limits:{ops:1000}}),'a');
      t.is(error.code,'RESOURCE_LIMIT','decoding a long literal list is charged before processing');
      t.is(error.resource,'ops','literal-list parsing identifies its operation budget');
   });

   t.subtest('failure recovery, partial output, and diagnostics',function(t) {
      t.is(engine(regex(['ANY',['CHARS','z','a'],['CHARS','b']])).apply('b'),true,
         'a descending-range failure does not move the next alternative');
      t.is(engine(['NONE',['CHARS',['EXPR','missing']]]).apply(97),true,
         'missing common expressions remain recoverable matches');
      var input= {original:{n:1}}, instance= new JGraft(['JGRAFT',{v:1},
         ['COPY','done','first',['CHARS',['EXPR']],'result']]);
      var error= errorOf(instance,input);
      t.is(error.code,'INVALID_GRAFT','malformed EXPR syntax remains fatal');
      t.is(error.graftPath,[2,3,1],'class operand diagnostics retain the physical graft path');
      t.is(error.partial,{original:{n:1},first:'done'},'no failed class result is assigned');
      t.ok(error.partial.original===input.original,'untouched partial branches remain shared');
      t.is(input,{original:{n:1}},'input remains unchanged after failure');
   });

   t.done_testing();
});
