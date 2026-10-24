//; use lib do { (my $x= __FILE__) =~ s{[^/]+\z}{lib}; $x }; use TestJGraft -load => '../src/JGraft.js';

TAP(function(t) {
   function engine(expr,config) {return new JGraft(['JGRAFT',{v:1},['COPY',expr,['NODE']]],config);}
   function errorOf(instance,input) {try {instance.apply(input);} catch(error) {return error;} return {};}
   t.subtest('boolean functions borrow operands and stay lazy',function(t) {
      var deep={x:1},i,instance,input;
      for(i=0;i<80;i++)deep={child:deep};
      input={first:false,next:deep};
      instance=engine(['AND',['NODE','first'],['NODE','next']],{limits:{depth:16,ops:1000}});
      t.is(instance.apply(input),false,'AND skips deep operands after false');
      instance=engine(['OR',['NODE','first'],['NODE','next']],{limits:{depth:16,ops:1000}});
      input.first=true;
      t.is(instance.apply(input),true,'OR skips deep operands after true');
      input.first=false;
      t.is(errorOf(instance,input).code,'INVALID_TARGET','a visited object is rejected without copying its deep contents');
      input.next=new Boolean(true);
      t.is(errorOf(instance,input).code,'INVALID_TARGET','boxed booleans are not primitive booleans');
      t.is(instance.apply({first:false,next:true}),true,'an instance remains usable after operand failure');
   });
   t.subtest('own properties and native dates',function(t) {
      function External() {}
      External.prototype={inherited:1};
      var input=new External(),output,date=new Date(1234);
      input.z={x:[1]};input.a=date;input.hasOwnProperty=0;
      output=engine(['PROPS',['NODE'],1]).apply(input);
      t.is(output,[['a',new Date(1234)],['hasOwnProperty',0],['z',{x:[1]}]],'only own properties are sorted and paired');
      t.ok(output[0][1]!==date,'Date values have independent identity');
      t.ok(output[2][1]!==input.z&&output[2][1].x!==input.z.x,'nested output containers are independent');
      date.setTime(9999);output[2][1].x[0]=9;
      t.is(output[0][1].getTime(),1234,'input Date mutation does not alter the copy');
      t.is(input.z.x,[1],'output mutation does not alter the input');
      t.is(errorOf(engine(['PROPS']),new Date(0)).code,'INVALID_TARGET','native Date targets are not objects for PROPS');
   });
   t.subtest('names avoid values while value forms enforce traversal budgets',function(t) {
      var deep=0,i,input;
      for(i=0;i<80;i++)deep={child:deep};
      input={deep:deep};
      t.is(engine(['PROPS'],{limits:{depth:16}}).apply(input),['deep'],'names do not traverse property values');
      t.is(errorOf(engine(['PROPS',['NODE'],1],{limits:{depth:16}}),input).code,'RESOURCE_LIMIT','pairs account for value traversal depth');
      t.is(errorOf(engine(['PROPS',['NODE'],2],{limits:{depth:16}}),input).code,'RESOURCE_LIMIT','parallel arrays account for value traversal depth');
   });
   t.subtest('sort work and output allocation are charged',function(t) {
      var input={},i,error,instance;
      for(i=0;i<200;i++)input['key'+(1000-i)]={x:i};
      instance=engine(['PROPS'],{limits:{ops:1000}});
      error=errorOf(instance,input);
      t.is(error.code,'RESOURCE_LIMIT','large key sets consume operation budget');
      t.is(error.resource,'ops','operation exhaustion is reported');
      instance=engine(['PROPS',['NODE'],1],{limits:{new_obj:80,ops:Infinity}});
      error=errorOf(instance,input);
      t.is(error.code,'RESOURCE_LIMIT','pair and value allocations consume object budget');
      t.is(error.resource,'new_obj','object exhaustion is reported');
      t.is(instance.apply({z:2,a:1}),[['a',1],['z',2]],'reuse after a sort/allocation failure starts fresh');
      input={};input[new Array(4097).join('a')]=1;input[new Array(4097).join('b')]=2;
      error=errorOf(engine(['PROPS'],{limits:{ops:1000}}),input);
      t.is(error.code,'RESOURCE_LIMIT','native sort propagates comparator resource failures');
      t.is(error.resource,'ops','long property-name comparisons charge their string work');
   });
   t.subtest('arbitrary own keys and inherited properties',function(t) {
      var input={toString:1,constructor:2},instance=engine(['PROPS',['NODE'],2],{forbidProto:false}),out;
      Object.defineProperty(input,'__proto__',{value:{x:3},enumerable:true});
      out=instance.apply(input);
      t.is(out,[['__proto__','constructor','toString'],[{x:3},2,1]],'magic names remain ordinary sorted names and data');
      t.ok(out[1][0]!==Object.getOwnPropertyDescriptor(input,'__proto__').value,'magic-property data is independently copied');
      t.is(errorOf(engine(['PROPS'],{forbidProto:true}),input).code,'UNSUPPORTED_GRAFT','name enumeration enforces host restrictions');
   });
   t.done_testing();
});
