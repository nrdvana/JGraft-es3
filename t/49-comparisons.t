//; use lib do { (my $x= __FILE__) =~ s{[^/]+\z}{lib}; $x }; use TestJGraft -load => '../src/JGraft.js';

TAP(function(t) {
   function engine(expr,config) {
      return new JGraft(['JGRAFT',{v:1},['COPY',expr,['NODE']]],config);
   }
   function errorOf(instance,input) {
      try {instance.apply(input);} catch (error) {return error;}
      return {};
   }
   function compare(op,config) {return engine([op,['NODE','a'],['NODE','b']],config);}

   t.subtest('native numeric extensions and NaN rejection',function(t) {
      var names= ['LESS','LESSEQ'],i,instance;
      for (i=0;i<names.length;i++) {
         instance= compare(names[i]);
         t.is(instance.apply({a:-Infinity,b:0}),true,names[i]+' orders negative infinity');
         t.is(instance.apply({a:0,b:Infinity}),true,names[i]+' orders positive infinity');
         t.is(instance.apply({a:Infinity,b:Infinity}),!!i,names[i]+' compares equal infinities');
         t.is(instance.apply({a:-0,b:0}),!!i,names[i]+' treats signed zero as equal');
         t.is(errorOf(instance,{a:NaN,b:1}).code,'INVALID_TARGET',names[i]+' rejects a left NaN');
         t.is(errorOf(instance,{a:1,b:NaN}).code,'INVALID_TARGET',names[i]+' rejects a right NaN');
         t.is(errorOf(instance,{a:NaN,b:NaN}).code,'INVALID_TARGET',names[i]+' rejects two NaNs');
         t.is(errorOf(instance,{a:[0,NaN],b:[0,1]}).code,'INVALID_TARGET',names[i]+' rejects a visited nested NaN');
         t.is(instance.apply({a:[0,NaN],b:[1,0]}),true,names[i]+' ignores a NaN after an earlier difference');
         t.is(engine(['NONE',[names[i],['NODE','a'],['NODE','b']]]).apply({a:NaN,b:1}),true,
            names[i]+' NaN failure remains trappable in match context');
      }
   });

   t.subtest('native dates use trusted UTC fields and logical timestamp precision',function(t) {
      var a= new Date(1234),b= new Date(1235),called= false;
      function poison() {called=true;throw new Error('external Date method invoked');}
      a.getTime=a.getUTCFullYear=a.getUTCMonth=a.getUTCDate=a.getUTCHours=poison;
      a.getUTCMinutes=a.getUTCSeconds=a.getUTCMilliseconds=a.valueOf=a.toJSON=poison;
      a.year=9999;a.parts=[0];a.count=3;
      t.is(compare('LESS').apply({a:a,b:b}),true,'native timestamps compare by their trusted fields');
      t.is(compare('LESSEQ').apply({a:a,b:new Date(1234)}),true,'equal native timestamps compare equal');
      t.is(engine(['LESSEQ',['NODE'],['CASTDATE','1970-01-01T01:00:01.234+01']]).apply(a),true,
         'a native Date can equal a parsed timestamp across offsets');
      t.is(engine(['LESS',['NODE'],['CASTDATE','1970-01-01T00:00:01.235Z']]).apply(a),true,
         'mixed native/parsed timestamps retain millisecond order');
      t.is(errorOf(engine(['LESS',['NODE'],['CASTDATE','1970-01-01']]),a).code,'INVALID_TARGET',
         'native timestamps cannot compare with calendar dates');
      t.is(errorOf(compare('LESS'),{a:new Date(NaN),b:b}).code,'INVALID_TARGET','invalid native Dates fail');
      t.is(called,false,'none of the poisoned methods were called');
      t.is(Date.prototype.getTime.call(a),1234,'comparison never changes the original native Date');
   });

   t.subtest('prefix comparisons avoid unvisited data and repeated nested equality',function(t) {
      var tail=[],i,a=1,b=1;
      for (i=0;i<2000;i++) tail.push({n:i});
      var instance= compare('LESS',{limits:{ops:2000,new_obj:100}});
      t.is(instance.apply({a:[0,tail],b:[1,null]}),true,'an early difference does not copy or inspect later values');
      t.is(instance.apply({a:[],b:[tail]}),true,'a shorter array does not inspect its remaining counterpart');
      for (i=0;i<40;i++) {a=[a];b=[b];}
      instance= compare('LESSEQ',{limits:{ops:10000}});
      t.is(instance.apply({a:a,b:b}),true,'deep equal arrays compare each element pair once');
      t.is(compare('LESS',{limits:{ops:10000}}).apply({a:a,b:b}),false,'strict comparison also avoids repeated equality walks');
      t.is(errorOf(compare('LESS',{limits:{depth:20}}),{a:a,b:b}).resource,'depth',
         'recursive comparison contributes to depth limits');
   });

   t.subtest('Unicode ordering and unchanged string cursors',function(t) {
      var high=String.fromCharCode(0xD800),low=String.fromCharCode(0xDFFF),pair=String.fromCharCode(0xD800,0xDC00);
      t.is(compare('LESS').apply({a:String.fromCharCode(0xE000),b:pair}),true,'BMP values order below higher astral codepoints');
      t.is(compare('LESS').apply({a:low,b:pair}),true,'lone surrogates remain independent codepoints');
      t.is(compare('LESSEQ').apply({a:high,b:high}),true,'equal lone surrogates remain equal');
      var instance= engine(['LOCAL','a','a','b','b',[[
         ['LESSEQ',['TEMP','a'],['TEMP','b']],['LESS',['TEMP','b'],['TEMP','a']],
         ['LENGTH',['CONCAT',pair,'x']],['SLICE',['CONCAT',pair,'xy'],1,1]
      ]]]);
      t.is(instance.apply(null),[true,false,2,'x'],'comparison and string operations can share an application safely');
   });

   t.subtest('pending MOVE deletions are checked only at visited positions',function(t) {
      var input= [[0,9],[1,0]],instance=new JGraft(['JGRAFT',{v:1},
         ['MOVE',['NODE',0,1],null,['NODE',1,['LOCAL','result',['LESS',['NODE',0],['NODE',1]],0]],['STASH','saved']],
         ['COPY',['STASH','saved'],['NODE']]]);
      t.is(instance.apply(input),1,'an earlier unequal pair ignores a pending deletion later in its array');
      t.is(input,[[0,9],[1,0]],'pending comparison leaves input unchanged');
      instance=new JGraft(['JGRAFT',{v:1},['MOVE',['NODE',0,0],null,
         ['NODE',1,['LOCAL','result',['LESS',['NODE',0],['NODE',1]],0]],['STASH','saved']]]);
      t.is(errorOf(instance,[[0],[1]]).code,'INVALID_TARGET','a pending deletion at a visited pair fails');
   });

   t.subtest('resource failures, host restrictions, reuse, and partial output',function(t) {
      var list=[],i;
      for (i=0;i<1000;i++) list.push(i);
      var instance=compare('LESSEQ',{limits:{ops:2000}}),error=errorOf(instance,{a:list,b:list});
      t.is(error.code,'RESOURCE_LIMIT','comparing a long equal prefix charges iteration');
      t.is(error.resource,'ops','the exhausted comparison counter is identified');
      t.is(instance.apply({a:[1],b:[1]}),true,'the instance is reusable after a comparison failure');
      t.ok(error.counts!==instance.counts,'prior failure counts remain independent');
      t.is(errorOf(engine(['NONE',['LESS',['NODE','__proto__'],1]],{forbidProto:true}),{}).code,'UNSUPPORTED_GRAFT',
         'an enclosing comparison probe cannot hide forbidden property access');
      var input={original:{n:1}};
      instance=new JGraft(['JGRAFT',{v:1},['COPY','done','first',['LESS',null,null],'result']]);
      error=errorOf(instance,input);
      t.is(error.code,'INVALID_TARGET','unsupported comparisons fail in value context');
      t.is(error.graftPath,[2,3],'comparison errors identify the expression');
      t.is(error.partial,{original:{n:1},first:'done'},'a failed comparison publishes no result');
      t.ok(error.partial.original===input.original,'untouched partial branches remain shared');
      t.is(input,{original:{n:1}},'the input is unchanged after failure');
      error=errorOf(engine(['LESS',1,['NODE','missing']]),{});
      t.is(error.graftPath,[2,1,2],'operand failures identify the operand expression');
      t.is(error.inputPath,['missing'],'operand failures retain their input path');
   });

   t.done_testing();
});
