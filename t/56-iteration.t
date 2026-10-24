//; use lib do { (my $x= __FILE__) =~ s{[^/]+\z}{lib}; $x }; use TestJGraft -load => '../src/JGraft.js';

TAP(function(t) {
   function engine(expr,config) {return new JGraft(['JGRAFT',{v:1},['COPY',expr,['NODE']]],config);}
   function errorOf(instance,input) {try {instance.apply(input);} catch(error) {return error;} return {};}
   function literal(value) {return [value];}

   t.subtest('CURPROP on virtual date properties and regex scopes',function(t) {
      var input={date:new Date(1234)},instance=new JGraft(['JGRAFT',{v:1},
         ['AT',['NODE','date','year'],['COPY',['CURPROP'],['STASH','name']]],
         ['COPY',['STASH','name'],['NODE']]]);
      t.is(instance.apply(input),'year','virtual Date fields retain their property names');
      t.is(input.date.getTime(),1234,'inspecting a virtual field leaves the native Date intact');
      var pattern=['SEQ',['START'],
         ['IS',['MAP',['CURPROP'],literal(['x','y'])],literal([0,1])],['IS',['CURPROP'],0],'a',
         ['IS',['REDUCE',['ADD',['TEMP','acc'],['CURPROP']],'acc',0,literal([7,8])],1],['IS',['CURPROP'],1],'b',['END']];
      t.is(engine(['IS',['STR',pattern]]).apply('ab'),true,
         'callbacks localize ordinary arrays and restore the caller regex position');
      t.is(engine(['HAS',{missing:['IS',['CURPROP'],'missing']}]).apply({}),true,
         'a missing virtual object property still has a name');
   });

   t.subtest('returned values have independent ownership',function(t) {
      var input=[{x:[1]},{x:[2]}],operators=[['MAP',['NODE']],['FILTER',['EXISTS']]],i,output;
      for(i=0;i<operators.length;i++) {
         output=engine(operators[i]).apply(input);
         t.ok(output!==input && output[0]!==input[0] && output[0].x!==input[0].x,
            operators[i][0]+' materializes its selected containers');
         output[0].x[0]=9;
         t.is(input,[{x:[1]},{x:[2]}],operators[i][0]+' output edits do not change input');
      }
      output=engine(['REDUCE',['NODE'],'acc',null]).apply(input);
      t.ok(output!==input[1] && output.x!==input[1].x,'a borrowed final accumulator is copied before returning');
      output.x[0]=9;t.is(input[1],{x:[2]},'editing a final accumulator leaves its source intact');
      var seed={x:[1]};
      output=engine(['REDUCE',['FAIL'],'acc',['NODE','seed'],['NODE','items']]).apply({seed:seed,items:[]});
      t.ok(output!==seed && output.x!==seed.x,'empty REDUCE also materializes its borrowed seed');
      output=engine(['MAP',{x:[[1]]}]).apply([0,1]);output[0].x[0]=9;
      t.is(output[1],{x:[1]},'constant transform objects do not alias sibling results');
   });

   t.subtest('native Dates are copied with trusted methods',function(t) {
      var date=new Date(1234),called=false;
      function poison() {called=true;throw new Error('external Date hook');}
      date.getTime=date.valueOf=date.toJSON=poison;
      var cases=[{e:['MAP',['NODE']],input:[date],array:true},
         {e:['FILTER',['EXISTS']],input:[date],array:true},
         {e:['REDUCE',['NODE'],'acc',null],input:[date]},
         {e:['REDUCE',['FAIL'],'acc',['NODE','seed'],literal([])],input:{seed:date}}],i,result;
      for(i=0;i<cases.length;i++) {
         result=engine(cases[i].e).apply(cases[i].input);if(cases[i].array)result=result[0];
         t.ok(result!==date,'case '+i+' returns an independent Date');
         t.is(Date.prototype.getTime.call(result),1234,'case '+i+' retains milliseconds');
      }
      t.is(called,false,'no external Date method was invoked');
   });

   t.subtest('bounded depth and efficient read-only accumulators',function(t) {
      var input=[],i;
      for(i=0;i<500;i++)input.push(1);
      var config={limits:{depth:12}};
      t.is(engine(['REDUCE',['ADD',['TEMP','acc'],['NODE']],'acc',0],config).apply(input),500,
         'REDUCE loop depth does not grow with the array');
      var output=engine(['MAP',['CURPROP']],config).apply(input);
      t.is(output.length,500,'MAP processes all elements within the depth budget');
      t.is(output[499],499,'MAP preserves the final source index');
      t.is(engine(['FILTER',['NUM']],config).apply(input).length,500,'FILTER uses constant iteration depth');
      var seed={rows:[]},items=[];
      for(i=0;i<500;i++)seed.rows.push({n:i});
      for(i=0;i<100;i++)items.push(0);
      output=engine(['REDUCE',['TEMP','acc'],'acc',['NODE','seed'],['NODE','items']],
         {limits:{ops:100000,mem:250000,new_obj:5000}}).apply({seed:seed,items:items});
      t.is(output,seed,'returning an unchanged accumulator avoids per-iteration deep copies');
      t.ok(output!==seed && output.rows[0]!==seed.rows[0],'the efficient accumulator still returns independent data');
   });

   t.subtest('prototype names and lexical restoration',function(t) {
      var graft=['JGRAFT',{v:1},['COPY',['REDUCE',['ADD',['TEMP','__proto__'],['NODE']],'__proto__',0],['NODE']]];
      t.is(new JGraft(graft,{forbidProto:false}).apply([1,2]),3,'accumulator names use safe own-property writes');
      t.is(errorOf(new JGraft(graft,{forbidProto:true}),[1,2]).code,'UNSUPPORTED_GRAFT',
         'forbidden accumulator bindings are fatal');
      var expr=['LOCAL','acc','outer',{failed:['NONE',['IS',
         ['REDUCE',['FAIL'],'acc',0,literal([1])],0]],outer:['TEMP','acc']}];
      t.is(engine(expr).apply(null),{failed:true,outer:'outer'},'trapped reduction failure restores caller TEMP');
      expr=['LOCAL','acc','outer',{mapped:['MAP',['LOCAL','acc','inner',['TEMP','acc']],literal([1,2])],
         filtered:['FILTER',['WITH','acc','inner',['IS',['TEMP','acc'],'inner']],literal([1,2])],outer:['TEMP','acc']}];
      t.is(engine(expr).apply(null),{mapped:['inner','inner'],filtered:[1,2],outer:'outer'},
         'MAP/FILTER callbacks cannot leak lexical overrides');
      t.is(errorOf(engine(['FILTER',['IS',['MUL',['NODE'],2],0]]),[Number.MAX_VALUE]).code,'UNSUPPORTED_GRAFT',
         'FILTER cannot swallow an arithmetic overflow as a rejected element');
   });

   t.subtest('missing source elements, budget failures, and reuse',function(t) {
      var callbacks=[['MAP',['NODE'],['NODE','items']],['FILTER',['EXISTS'],['NODE','items']],
         ['REDUCE',['ADD',['TEMP','acc'],['NODE']],'acc',0,['NODE','items']]],i,error;
      for(i=0;i<callbacks.length;i++) {
         var input={items:[1,2],saved:{value:4}},instance=new JGraft(['JGRAFT',{v:1},
            ['MOVE',['NODE','items',1],null,['NODE','saved',['LOCAL','result',callbacks[i],'value']],['STASH','saved']]]);
         error=errorOf(instance,input);
         t.is(error.code,'INVALID_TARGET',callbacks[i][0]+' cannot iterate a pending-deletion slot');
         t.is(input,{items:[1,2],saved:{value:4}},callbacks[i][0]+' failure leaves input intact');
      }
      var queued={items:[1,3],insert:2,spare:9};
      instance=new JGraft(['JGRAFT',{v:1},['MOVE',['NODE','insert'],['NODE','items',0.5],
         ['NODE','spare'],['STASH',['JOIN',',',['MAP',['CASTSTR'],['NODE','items']]]]],
         ['COPY',['STASH','1,3'],'proof']]);
      t.is(instance.apply(queued),{items:[1,2,3],proof:9},'queued half-index insertions remain invisible during iteration');
      t.is(queued,{items:[1,3],insert:2,spare:9},'iteration and queued insertion preserve the original input');
      var large=[];for(i=0;i<1000;i++)large.push(1);
      var examples=[{expr:['REDUCE',['ADD',['TEMP','acc'],['NODE']],'acc',0],limits:{ops:2000},expected:1},
         {expr:['FILTER',['NUM']],limits:{ops:2000},expected:[1]},
         {expr:['MAP',['NODE']],limits:{new_obj:100},expected:[1]}];
      for(i=0;i<examples.length;i++) {
         var example=examples[i];instance=engine(example.expr,{limits:example.limits});error=errorOf(instance,large);
         t.is(error.code,'RESOURCE_LIMIT','iteration '+i+' consumes its configured budget');
         t.is(instance.apply([1]),example.expected,'iteration '+i+' can be reused after failure');
         t.ok(error.counts!==instance.counts,'iteration '+i+' retains independent failure counters');
      }
   });

   t.subtest('partial output and callback diagnostics',function(t) {
      var input={items:[{x:1},{}],original:{n:1}};
      var instance=new JGraft(['JGRAFT',{v:1},['COPY','done','first',['MAP',['NODE','x'],['NODE','items']],'result']]);
      var error=errorOf(instance,input);
      t.is(error.code,'INVALID_TARGET','a transform failure aborts MAP');
      t.is(error.graftPath,[2,3,1],'diagnostics identify the deferred transform');
      t.is(error.inputPath,[1,'x'],'diagnostics identify the failing localized element');
      t.is(error.partial,{items:[{x:1},{}],original:{n:1},first:'done'},'a partial transformed array is not assigned');
      t.ok(error.partial.items===input.items,'untouched source arrays remain shared in partial output');
      t.is(input,{items:[{x:1},{}],original:{n:1}},'deferred callback failure leaves input unchanged');
   });

   t.done_testing();
});
