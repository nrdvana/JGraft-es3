//; use lib do { (my $x= __FILE__) =~ s{[^/]+\z}{lib}; $x }; use TestJGraft -load => '../src/JGraft.js';

TAP(function(t) {
   function engine(expr,config) {
      return new JGraft(['JGRAFT',{v:1},['COPY',expr,['NODE']]],config);
   }
   function errorOf(instance,input) {
      try {instance.apply(input);} catch (error) {return error;}
      return {};
   }

   t.subtest('native Dates and independent returned values',function(t) {
      var input= {date:new Date(1234),data:{items:[1]}}, called= false;
      input.date.getTime= input.date.toJSON= input.date.valueOf= function() {called=true;throw new Error('external Date hook');};
      var exprs= [
         ['LOCAL','d',['NODE','date'],['TEMP','d']],
         ['LOCAL',null,['NODE','date'],['NODE']]
      ], i, result;
      for (i= 0; i < exprs.length; i++) {
         result= engine(exprs[i]).apply(input);
         t.ok(result!==input.date,'LOCAL result '+i+' owns its native Date');
         t.is(Date.prototype.getTime.call(result),1234,'LOCAL result '+i+' retains milliseconds');
         result.setTime(0);
         t.is(Date.prototype.getTime.call(input.date),1234,'LOCAL result '+i+' cannot mutate input');
      }
      t.is(engine(['WITH','d',['NODE','date'],['IS',['TEMP','d','second'],1.234]]).apply(input),true,
         'WITH bindings expose native UTC virtual fields');
      t.is(called,false,'trusted Date methods handle every binding and return');
      result= engine(['LOCAL','a',['NODE','data'],{a:['TEMP','a'],b:['TEMP','a']}]).apply(input);
      t.ok(result.a!==input.data && result.a!==result.b,'two returns of one TEMP value are independent');
      result.a.items[0]= 2;
      t.is(result.b,{items:[1]},'the sibling result retains its data');
      t.is(input.data,{items:[1]},'the original data retains its data');
   });

   t.subtest('prototype binding names use safe lexical roots',function(t) {
      var exprs= [
         ['LOCAL','__proto__',{safe:1},['TEMP','__proto__']],
         ['WITH','__proto__',{safe:1},['IS',['TEMP','__proto__','safe'],1]]
      ], i;
      for (i= 0; i < exprs.length; i++) {
         t.is(engine(exprs[i],{forbidProto:false}).apply(null),i?true:{safe:1},
            'binding '+i+' supports an own __proto__ root');
         t.is(errorOf(engine(exprs[i],{forbidProto:true}),null).code,'UNSUPPORTED_GRAFT',
            'binding '+i+' respects configured property restrictions');
         t.is(errorOf(engine(['NONE',exprs[i]],{forbidProto:true}),null).code,'UNSUPPORTED_GRAFT',
            'binding '+i+' cannot trap a host restriction');
      }
      var instance= new JGraft(['JGRAFT',{v:1},['COPY',{x:1},['TEMP','__proto__'],
         ['LOCAL','__proto__',{x:2},['TEMP','__proto__']],'inner',
         ['WITH','__proto__',{x:3},['IS',['TEMP','__proto__','x'],3]],'match',
         ['TEMP','__proto__'],'outer']],{forbidProto:false});
      t.is(instance.apply({}),{inner:{x:2},match:true,outer:{x:1}},
         'cloning a TEMP root preserves and restores an own prototype-named binding');
   });

   t.subtest('binding many roots and overwriting aliases',function(t) {
      var local= ['LOCAL'], withExpr= ['WITH'], i, count= 100;
      for (i= 0; i < count; i++) {local.push('p'+i,i);withExpr.push('p'+i,i);}
      local.push({first:['TEMP','p0'],last:['TEMP','p99']});
      withExpr.push(['ALL',['IS',['TEMP','p0'],0],['IS',['TEMP','p99'],99]]);
      t.is(engine(local).apply(null),{first:0,last:99},'LOCAL applies every binding');
      t.is(engine(withExpr).apply(null),true,'WITH applies every binding');
      t.is(engine(['LOCAL',-0,'old','0','new',['TEMP',0]]).apply(null),'new',
         'LOCAL negative zero and string zero name the same root');
      t.is(engine(['WITH',-0,'old','0','new',['IS',['TEMP',0],'new']]).apply(null),true,
         'WITH negative zero and string zero name the same root');
   });

   t.subtest('matching consumes no caller bindings or array elements',function(t) {
      var source= [{x:1},{x:2}], pattern= ['SEQ',
         ['WITH','saved',['NODE'],{x:1}],{x:2},['WITH','end',0,['END']]];
      var expr= ['LOCAL','outer',9,['IS',[[pattern]]]];
      t.is(engine(expr).apply(source),true,'a wrapped element and end assertion consume their original widths');
      t.is(source,[{x:1},{x:2}],'matching leaves source values intact');
      t.is(engine(['WITH','all',['NODE'],['IS',['TEMP','all'],['NODE']]]).apply(source),true,
         'binding a whole array does not change its elements');
   });

   t.subtest('resource failure and reuse',function(t) {
      var large= [], i;
      for (i= 0; i < 200; i++) large.push({n:i});
      var cases= [
         {expr:['LOCAL','x',['NODE'],['TEMP','x']],limits:{new_obj:100}},
         {expr:['WITH','x',['NODE'],['EXISTS']],limits:{new_obj:100}},
         {expr:['LOCAL','x',['NODE'],['TEMP','x']],limits:{ops:2000}},
         {expr:['NONE',['WITH','x',['NODE'],['EXISTS']]],limits:{ops:2000}}
      ];
      for (i= 0; i < cases.length; i++) {
         var example= cases[i], instance= engine(example.expr,{limits:example.limits});
         var error= errorOf(instance,large), counter= i<2?'new_obj':'ops';
         t.is(error.code,'RESOURCE_LIMIT','case '+i+' stops when its budget is exhausted');
         t.is(error.resource,counter,'case '+i+' reports the exhausted counter');
         var expected= i===1?true:i===3?false:[1];
         t.is(instance.apply([1]),expected,'case '+i+' can be reused after failure');
         t.ok(instance.counts!==error.counts,'case '+i+' retains independent failure counters');
      }
   });

   t.subtest('partial output and diagnostic context',function(t) {
      var input= {original:{n:1}}, instance= new JGraft(['JGRAFT',{v:1},
         ['COPY','done','first',['LOCAL','x',1,['NODE','missing']],'result']]);
      var error= errorOf(instance,input);
      t.is(error.code,'INVALID_TARGET','LOCAL does not trap return failures');
      t.is(error.graftPath,[2,3,3],'diagnostics identify the LOCAL return expression');
      t.is(error.inputPath,['missing'],'diagnostics identify the missing source');
      t.is(error.partial,{original:{n:1},first:'done'},'failed results are never assigned');
      t.ok(error.partial.original===input.original,'untouched input remains shared');
      t.is(input,{original:{n:1}},'the source tree stays unchanged');
      error= errorOf(engine(['LOCAL','x',['NODE','missing'],1]),{});
      t.is(error.graftPath,[2,1,2],'binding failures identify the value operand');
      error= errorOf(engine(['WITH','x',['UNKNOWN'],['EXISTS']]),{});
      t.is(error.code,'INVALID_GRAFT','WITH cannot swallow malformed value expressions');
      t.is(error.graftPath,[2,1,2],'WITH diagnostics identify its value operand');
   });

   t.done_testing();
});
