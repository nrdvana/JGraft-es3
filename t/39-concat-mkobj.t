//; use lib do { (my $x= __FILE__) =~ s{[^/]+\z}{lib}; $x }; use TestJGraft -load => '../src/JGraft.js';

TAP(function(t) {
   function engine(expr,config) {
      return new JGraft(['JGRAFT',{v:1},['COPY',expr,['NODE']]],config);
   }
   function errorOf(instance,input) {
      try {instance.apply(input);} catch (error) {return error;}
      return {};
   }
   function forms(name,value) {
      return [['MKOBJ',name,value],['MKOBJ',[[name]],[[value]]],['MKOBJ',[[[[name,value]]]]]];
   }

   t.subtest('CONCAT copies referenced values independently',function(t) {
      var input= [{x:[1]},new Date(1234)], result= engine(['CONCAT',['NODE'],['NODE']]).apply(input);
      t.ok(result!==input,'the combined array is new');
      t.ok(result[0]!==input[0] && result[0]!==result[2],'each occurrence has its own object');
      t.ok(result[0].x!==input[0].x && result[0].x!==result[2].x,'nested arrays are independent');
      t.ok(result[1]!==input[1] && result[1]!==result[3],'each native Date is cloned');
      result[0].x[0]= 2;result[1].setTime(0);
      t.is(input[0],{x:[1]},'editing the output leaves input objects alone');
      t.is(input[1].getTime(),1234,'editing an output Date leaves the input alone');
      t.is(result[2],{x:[1]},'editing one occurrence leaves another alone');
      t.is(result[3].getTime(),1234,'the second Date retains its timestamp');
      result= engine(['CONCAT',['NODE']]).apply(input);
      t.ok(result!==input && result[0]!==input[0],'a single operand still materializes its result');
   });

   t.subtest('MKOBJ materializes each native Date and container',function(t) {
      var input= {date:new Date(1234),value:{items:[1]}}, i, expr, result, poisonCalled= false;
      input.date.getTime= input.date.toJSON= input.date.valueOf= function() {poisonCalled=true;throw new Error('input method called');};
      var expressions= forms('date',['NODE','date']);
      for (i= 0; i < expressions.length; i++) {
         expr= expressions[i];result= engine(expr).apply(input);
         t.ok(result.date!==input.date,'form '+i+' clones its native Date');
         t.is(Date.prototype.getTime.call(result.date),1234,'form '+i+' uses trusted Date methods');
      }
      t.is(poisonCalled,false,'no external Date hook was invoked');
      result= engine(['MKOBJ','a',['NODE','value'],'b',['NODE','value']]).apply(input);
      t.ok(result.a!==result.b && result.a!==input.value,'repeated reference values are independent');
      result.a.items[0]= 2;
      t.is(result.b,{items:[1]},'a sibling value remains unchanged');
      t.is(input.value,{items:[1]},'the input remains unchanged');
   });

   t.subtest('own-property handling and host restrictions',function(t) {
      var expressions= forms('__proto__',{safe:1}), i, result, error;
      for (i= 0; i < expressions.length; i++) {
         result= engine(expressions[i],{forbidProto:false}).apply(null);
         t.ok(!!Object.getOwnPropertyDescriptor(result,'__proto__'),'form '+i+' writes an own data property');
         t.is(Object.getOwnPropertyDescriptor(result,'__proto__').value,{safe:1},'form '+i+' preserves its property value');
         t.is(result.safe,undefined,'form '+i+' leaves the prototype alone');
         error= errorOf(engine(expressions[i],{forbidProto:true}),null);
         t.is(error.code,'UNSUPPORTED_GRAFT','form '+i+' honors the configured restriction');
         t.is(errorOf(engine(['NONE',expressions[i]],{forbidProto:true}),null).code,'UNSUPPORTED_GRAFT',
            'form '+i+' cannot hide host restrictions in a negative probe');
      }
      var input= {names:['constructor','toString','hasOwnProperty'],values:[1,2,3]};
      result= engine(['MKOBJ',['NODE','names'],['NODE','values']]).apply(input);
      t.is(result,{constructor:1,toString:2,hasOwnProperty:3},'inherited method names do not count as duplicates');
      function Source() {}
      Source.prototype.hidden= 'inherited';
      input= new Source();input.visible= 1;
      result= engine(['MKOBJ','source',['NODE']]).apply(input);
      t.is(result,{source:{visible:1}},'referenced objects contribute only own data');
   });

   t.subtest('SPLIT array values retain metadata in all MKOBJ forms',function(t) {
      var config= {sep:['ANY',':','|'],default:'/',trim:' '}, i;
      var expressions= forms('array',['SPLIT',config,' a : b|c ']);
      for (i= 0; i < expressions.length; i++) {
         var expr= ['LOCAL','obj',expressions[i],['JOIN',{sep:['ANY',':','|'],default:'/'},['TEMP','obj','array']]];
         t.is(engine(expr).apply(null),' a : b|c ','form '+i+' preserves separators and trims');
      }
   });

   t.subtest('large property lists and arrays',function(t) {
      var names= [], values= [], pairs= [], i, count= 2000, result;
      for (i= 0; i < count; i++) {names.push('p'+i);values.push(i);pairs.push(['p'+i,i]);}
      result= engine(['MKOBJ',['NODE','names'],['NODE','values']]).apply({names:names,values:values});
      var complete= true;
      for (i= 0; i < count; i++) if (result['p'+i]!==i) complete=false;
      t.ok(complete,'parallel arrays construct every property');
      result= engine(['MKOBJ',['NODE']]).apply(pairs);complete=true;
      for (i= 0; i < count; i++) if (result['p'+i]!==i) complete=false;
      t.ok(complete,'pair lists construct every property');
      result= engine(['CONCAT',['NODE'],['NODE']]).apply(values);
      t.is(result.length,count*2,'concatenation materializes both full spans');
      t.is(result[count],0,'the second span starts at the expected index');
      t.is(result[count*2-1],count-1,'the final element is retained');
   });

   t.subtest('resource failures and reusable instances',function(t) {
      var large= [], i, cases= [
         {expr:['CONCAT',['NODE'],['NODE']],small:[1],big:null,limits:{ops:2000}},
         {expr:['MKOBJ',['NODE']],small:[['x',1]],big:null,limits:{new_obj:100}},
         {expr:['MKOBJ',['NODE','name'],['NODE','value']],small:{name:'x',value:1},
            big:{name:new Array(20001).join('x'),value:1},limits:{mem:10000}}
      ];
      for (i= 0; i < 500; i++) large.push(['p'+i,{x:i}]);
      cases[0].big=large;cases[1].big=large;
      for (i= 0; i < cases.length; i++) {
         var example= cases[i], instance= engine(example.expr,{limits:example.limits});
         var error= errorOf(instance,example.big), resource;
         for (resource in example.limits) break;
         t.is(error.code,'RESOURCE_LIMIT','budget '+resource+' fails inside the expression');
         t.is(error.resource,resource,'the exhausted counter is identified');
         var expected= i===0?[1,1]:{x:1};
         t.is(instance.apply(example.small),expected,'the instance works after '+resource+' failure');
         t.ok(error.counts!==instance.counts,'previous failure counters remain independent');
      }
      var deep= {}, cursor= deep;
      for (i= 0; i < 40; i++) {cursor.next={};cursor=cursor.next;}
      t.is(errorOf(engine(['MKOBJ','x',['NODE']],{limits:{depth:20}}),deep).resource,'depth',
         'nested values consume traversal depth');
   });

   t.subtest('partial output, diagnostic paths, and failed construction',function(t) {
      var input= {source:[1]}, instance= new JGraft(['JGRAFT',{v:1},
         ['COPY','done','first',['MKOBJ','a',1,'a',2],'result']]);
      var error= errorOf(instance,input);
      t.is(error.code,'INVALID_TARGET','duplicates abort the construction');
      t.is(error.graftPath,[2,3],'duplicate diagnostics identify the MKOBJ expression');
      t.is(error.partial,{source:[1],first:'done'},'a partially constructed object is not assigned');
      t.is(input,{source:[1]},'input data stays unchanged');
      t.ok(error.partial.source===input.source,'untouched input remains shared');
      error= errorOf(engine(['MKOBJ','x',['NODE','absent']]),{});
      t.is(error.graftPath,[2,1,2],'nested failure paths identify the value operand');
      t.is(error.inputPath,['absent'],'nested failure paths identify the missing source');
      error= errorOf(engine(['CONCAT','ok',['NODE','absent']]),{});
      t.is(error.graftPath,[2,1,2],'CONCAT identifies its failing operand');
      instance= engine(['MKOBJ',['NODE']]);
      errorOf(instance,[['x',1],['x',2]]);
      t.is(instance.apply([['x',1]]),{x:1},'duplicate tracking is fresh for every application');
   });

   t.done_testing();
});
