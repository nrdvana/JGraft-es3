//; use lib do { (my $x= __FILE__) =~ s{[^/]+\z}{lib}; $x }; use TestJGraft -load => '../src/JGraft.js';

TAP(function(t) {
   function engine(expr,config) {
      return new JGraft(['JGRAFT',{v:1},['COPY',expr,['NODE']]],config);
   }
   function errorOf(instance,input) {
      try {instance.apply(input);} catch (error) {return error;}
      return {};
   }

   t.subtest('selected native Date and container ownership',function(t) {
      var input= {date:new Date(1234),data:{items:[1]}}, called= false;
      input.date.getTime= input.date.toJSON= input.date.valueOf= function() {called=true;throw new Error('external Date method');};
      var result= engine(['CASE',['EXISTS'],['NODE','date'],['FAIL']]).apply(input);
      t.ok(result!==input.date,'the selected native Date is independently owned');
      t.is(Date.prototype.getTime.call(result),1234,'the selected Date retains its timestamp');
      result.setTime(0);
      t.is(Date.prototype.getTime.call(input.date),1234,'changing the result does not change input');
      t.is(called,false,'trusted built-ins handle native Date copying');
      result= engine(['CASE',['STR'],['FAIL'],['NODE','data']]).apply(input);
      t.ok(result!==input.data && result.items!==input.data.items,'an else reference is independently materialized');
      result.items[0]=2;
      t.is(input.data,{items:[1]},'the else result cannot mutate its source');
      result= engine(['CASE',['EXISTS'],{a:['NODE','data'],b:['NODE','data']}]).apply(input);
      t.ok(result.a!==result.b && result.a.items!==result.b.items,'repeated references in one selected value are independent');
   });

   t.subtest('lazy branches consume no value materialization budget',function(t) {
      var large= [],i;
      for (i=0;i<1000;i++) large.push({n:i});
      var input= {kind:'small',small:{n:1},large:large};
      var instance= engine(['CASE',{kind:'small'},['NODE','small'],['NODE','large']],{limits:{ops:2000,new_obj:100}});
      t.is(instance.apply(input),{n:1},'an unselected large else value is not copied');
      var error= errorOf(instance,{kind:'large',small:{n:1},large:large});
      t.is(error.code,'RESOURCE_LIMIT','selecting the large value exhausts the budget');
      t.is(instance.apply(input),{n:1},'an instance can be reused after selected-value resource failure');
      t.ok(instance.counts!==error.counts,'failed counters remain independent of reuse');
      instance= engine(['CASE',{kind:'large'},['NODE','large'],['NODE','small']],{limits:{ops:2000,new_obj:100}});
      t.is(instance.apply(input),{n:1},'an unselected earlier result is not copied');
      instance= engine(['CASE',['EXISTS'],1,['CASTNUM','1e9999'],2,['FAIL']]);
      t.is(instance.apply(input),1,'later unsupported conditions and a failing else are never evaluated');
   });

   t.subtest('ordered conditions and operation budgets',function(t) {
      var expr= ['CASE'], i;
      for (i=0;i<100;i++) expr.push(i,i);
      expr.push('else');
      var instance= engine(expr);
      t.is(instance.apply(0),0,'the first condition selects its result');
      t.is(instance.apply(50),50,'a middle condition selects its result');
      t.is(instance.apply(99),99,'the final condition selects its result');
      t.is(instance.apply(100),'else','all false conditions select else');
      instance= engine(expr,{limits:{ops:2000}});
      t.is(instance.apply(0),0,'an early match fits a smaller operation budget');
      var error= errorOf(instance,99);
      t.is(error.code,'RESOURCE_LIMIT','later conditions consume additional work');
      t.is(error.resource,'ops','condition iteration reports the operation budget');
      t.is(instance.apply(0),0,'condition search is fresh after failure');
   });

   t.subtest('unsupported host operations respect selection boundaries',function(t) {
      var forbidden= ['MKOBJ','__proto__',{safe:1}];
      var config= {forbidProto:true};
      t.is(engine(['CASE',1,'one',2,forbidden,forbidden],config).apply(1),'one',
         'unselected forbidden property writes are not visited');
      t.is(errorOf(engine(['CASE',2,forbidden,'else'],config),2).code,'UNSUPPORTED_GRAFT',
         'a selected forbidden write remains fatal');
      t.is(errorOf(engine(['CASE',['IS',forbidden,{}],'bad','else'],config),null).code,'UNSUPPORTED_GRAFT',
         'a forbidden operation in a condition cannot fall through');
      t.is(errorOf(engine(['NONE',['CASE',2,forbidden,'else']],config),2).code,'UNSUPPORTED_GRAFT',
         'an enclosing negative probe cannot hide host rejection');
      var output= engine(['CASE',2,forbidden,'else'],{forbidProto:false}).apply(2);
      t.is(Object.getOwnPropertyDescriptor(output,'__proto__').value,{safe:1},
         'a selected arbitrary key is stored safely when allowed');
      t.is(output.safe,undefined,'the selected property does not alter the prototype');
   });

   t.subtest('localized discriminator leaves input and namespaces intact',function(t) {
      var input= {id:7,status:'active',data:{n:1}};
      var expr= ['LOCAL','record',['NODE'],null,['NODE','status'],['CASE',
         'new',{id:['TEMP','record','id'],state:'pending'},
         'active',{id:['TEMP','record','id'],state:'enabled',data:['TEMP','record','data']},
         ['FAIL']]];
      var instance= new JGraft(['JGRAFT',{v:1},['COPY',expr,'selected',['NODE','status'],'statusAfter']]);
      var result= instance.apply(input);
      t.is(result.selected,{id:7,state:'enabled',data:{n:1}},'plain conditions compare the localized status');
      t.is(result.statusAfter,'active','the action current node is restored');
      t.ok(result.selected.data!==input.data,'selected original-record data is independently materialized');
      t.ok(result.data===input.data,'untouched original branches remain shared');
      t.is(input,{id:7,status:'active',data:{n:1}},'localization and CASE leave input untouched');
      result= engine(['LOCAL','x','outer',{failed:['NONE',['CASE',['EXISTS'],['LOCAL','x','inner',['FAIL']]]],x:['TEMP','x']}]).apply(input);
      t.is(result,{failed:true,x:'outer'},'trapping a selected branch failure restores its lexical bindings');
   });

   t.subtest('partial output and branch diagnostic paths',function(t) {
      var input= {original:{n:1}}, instance= new JGraft(['JGRAFT',{v:1},
         ['COPY','done','first',['CASE',['EXISTS'],['FAIL'],'else'],'result']]);
      var error= errorOf(instance,input);
      t.is(error.code,'INVALID_TARGET','a selected FAIL escapes in value context');
      t.is(error.graftPath,[2,3,2],'diagnostics identify the selected result');
      t.is(error.partial,{original:{n:1},first:'done'},'earlier edits survive without assigning a failed result');
      t.ok(error.partial.original===input.original,'untouched partial branches remain shared');
      t.is(input,{original:{n:1}},'input remains unchanged on failure');
      error= errorOf(engine(['CASE',1,'one',['FAIL']]),2);
      t.is(error.graftPath,[2,1,3],'diagnostics identify a failing else');
      error= errorOf(engine(['CASE',1,'one']),2);
      t.is(error.code,'INVALID_TARGET','implied FAIL retains INVALID_TARGET');
      t.is(error.graftPath,[2,1],'implied FAIL identifies the CASE expression');
      error= errorOf(engine(['CASE',['CASTNUM','1e9999'],'bad','else']),null);
      t.is(error.graftPath,[2,1,1],'fatal condition diagnostics identify that condition');
      error= errorOf(engine(['CASE',['EXISTS'],['NODE','missing'],'else']),{});
      t.is(error.inputPath,['missing'],'selected reference failures retain their source path');
      error= errorOf(engine(['FAIL',1]),null);
      t.is(error.code,'INVALID_GRAFT','malformed FAIL remains a syntax error');
   });

   t.done_testing();
});
