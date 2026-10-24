//; use lib do { (my $x= __FILE__) =~ s{[^/]+\z}{lib}; $x }; use TestJGraft -load => '../src/JGraft.js';

TAP(function(t) {
   function engine(expr,config) {
      return new JGraft(['JGRAFT',{v:1},['COPY',expr,['NODE']]],config);
   }
   function binary(op,config) {return engine([op,['NODE','a'],['NODE','b']],config);}
   function errorOf(instance,input) {
      try {instance.apply(input);} catch (error) {return error;}
      return {};
   }

   t.subtest('native floating arithmetic and accumulation order',function(t) {
      t.is(binary('ADD').apply({a:0.1,b:0.2}),0.1+0.2,'addition uses host floating arithmetic');
      t.is(binary('SUB').apply({a:0.3,b:0.2}),0.3-0.2,'subtraction uses host floating arithmetic');
      t.is(binary('MUL').apply({a:0.1,b:0.2}),0.1*0.2,'multiplication uses host floating arithmetic');
      t.is(binary('DIV').apply({a:1,b:3}),1/3,'division uses host floating arithmetic');
      var input=[1e16,1,-1e16];
      t.is(engine(['ADD',['NODE']]).apply(input),((0+input[0])+input[1])+input[2],
         'array addition follows left-to-right accumulation');
      t.is(engine(['ADD',1e16,-1e16,1]).apply(null),(1e16-1e16)+1,
         'variadic addition preserves operand order');
      t.is(binary('MUL').apply({a:Number.MIN_VALUE,b:0.5}),Number.MIN_VALUE*0.5,
         'underflow uses the host result without a new precision policy');
      t.is(1/engine(['MUL',['NODE']]).apply(-0),-Infinity,'native multiplication retains negative zero');
      t.is(1/engine(['ADD',['NODE']]).apply(-0),1/(0+-0),'addition uses its zero accumulator for signed zero');
   });

   t.subtest('nonfinite results and zero divisors',function(t) {
      var operations=['ADD','SUB','MUL','DIV','MOD'],i,instance,error;
      for (i=0;i<operations.length;i++) {
         instance=binary(operations[i]);
         error=errorOf(instance,{a:NaN,b:2});
         t.is(error.code,'INVALID_TARGET',operations[i]+' rejects a NaN result');
         t.is(errorOf(instance,{a:Infinity,b:2}).code,operations[i]==='MOD'?'INVALID_TARGET':'UNSUPPORTED_GRAFT',
            operations[i]+' distinguishes an infinite result from NaN');
         t.is(errorOf(engine([operations[i],['CASTNUM'],2]),'1e9999').code,'UNSUPPORTED_GRAFT',
            operations[i]+' preserves unsupported native numeric-range failures');
         t.is(errorOf(engine(['NONE',['IS',[operations[i],['CASTNUM'],2],0]]),'1e9999').code,'UNSUPPORTED_GRAFT',
            operations[i]+' cannot hide native numeric-range rejection in a match probe');
      }
      t.is(errorOf(binary('ADD'),{a:Number.MAX_VALUE,b:Number.MAX_VALUE}).code,'UNSUPPORTED_GRAFT','addition overflow is UNSUPPORTED_GRAFT');
      t.is(errorOf(binary('SUB'),{a:-Number.MAX_VALUE,b:Number.MAX_VALUE}).code,'UNSUPPORTED_GRAFT','subtraction overflow is UNSUPPORTED_GRAFT');
      t.is(errorOf(binary('MUL'),{a:Number.MAX_VALUE,b:2}).code,'UNSUPPORTED_GRAFT','multiplication overflow is UNSUPPORTED_GRAFT');
      t.is(errorOf(binary('DIV'),{a:Number.MAX_VALUE,b:Number.MIN_VALUE}).code,'UNSUPPORTED_GRAFT','division overflow is UNSUPPORTED_GRAFT');
      t.is(errorOf(engine(['MUL',['NODE']]),[Number.MAX_VALUE,2,0]).code,'UNSUPPORTED_GRAFT',
         'a later zero cannot hide an earlier overflow');
      t.is(binary('DIV').apply({a:1,b:Infinity}),0,'a native infinite divisor can still produce a finite host result');
      for (i=0;i<2;i++) {
         var op=i?'MOD':'DIV';
         t.is(errorOf(binary(op),{a:1,b:-0}).code,'INVALID_TARGET',op+' rejects negative zero divisors');
         t.is(errorOf(binary(op),{a:0,b:0}).code,'INVALID_TARGET',op+' rejects zero divided by zero');
         t.is(engine(['NONE',['IS',[op,1,0],0]]).apply(null),true,op+' zero errors remain trappable in match context');
      }
   });

   t.subtest('modulus sign correction and rounding boundaries',function(t) {
      var instance=binary('MOD'),a,b,i,result;
      t.is(instance.apply({a:1,b:Number.MAX_VALUE}),1,'a tiny positive remainder is not lost by adding the divisor unnecessarily');
      t.is(instance.apply({a:-1,b:-Number.MAX_VALUE}),-1,'an already-correct negative remainder is preserved');
      t.is(instance.apply({a:Number.MAX_VALUE,b:Number.MIN_VALUE}),Number.MAX_VALUE%Number.MIN_VALUE,
         'modulus does not overflow by constructing the quotient');
      t.is(instance.apply({a:-Number.MIN_VALUE,b:1}),0,'rounding to an excluded positive boundary wraps to zero');
      t.is(instance.apply({a:Number.MIN_VALUE,b:-1}),0,'rounding to an excluded negative boundary wraps to zero');
      var correct=true;
      for (i=0;i<1000;i++) {
         a=(i%101-50)/8;b=(i%19-9)/4;
         if (!b) continue;
         result=instance.apply({a:a,b:b});
         if (result!==a-Math.floor(a/b)*b || (b>0?result<0||result>=b:result>0||result<=b)) correct=false;
      }
      t.ok(correct,'dyadic modulus agrees with an independent floor-quotient calculation and divisor-sign bounds');
   });

   t.subtest('strict operands never invoke external coercion hooks',function(t) {
      var called=false, date=new Date(0), object={};
      function poison() {called=true;throw new Error('external numeric coercion');}
      date.valueOf=date.toString=poison;object.valueOf=object.toString=poison;
      var operations=['ADD','SUB','MUL','DIV','MOD'],i;
      for (i=0;i<operations.length;i++) {
         t.is(errorOf(binary(operations[i]),{a:date,b:2}).code,'INVALID_TARGET',operations[i]+' rejects Dates without conversion');
         t.is(errorOf(binary(operations[i]),{a:object,b:2}).code,'INVALID_TARGET',operations[i]+' rejects objects without conversion');
      }
      t.is(called,false,'none of the input coercion methods were invoked');
      t.is(errorOf(engine(['MUL',['NODE']]),[0,NaN]).code,'INVALID_TARGET','a zero factor does not suppress a later NaN');
      t.is(errorOf(engine(['ADD',['NODE']]),[[1]]).code,'INVALID_TARGET','array entries are numbers, not recursively flattened');
   });

   t.subtest('array folds borrow data and charge iteration',function(t) {
      var input=[],i;
      for (i=0;i<20000;i++) input.push(1);
      var config={limits:{ops:30000,mem:5000,new_obj:100}};
      t.is(engine(['ADD',['NODE']],config).apply(input),20000,'large sums require no materialized operand array');
      t.is(engine(['MUL',['NODE']],config).apply(input),1,'large products require no materialized operand array');
      var instance=engine(['ADD',['NODE']],{limits:{ops:1000}}),error=errorOf(instance,input);
      t.is(error.code,'RESOURCE_LIMIT','a large array fold charges its iteration before work');
      t.is(error.resource,'ops','folding identifies the exhausted counter');
      t.is(instance.apply([1,2]),3,'a failed instance can be reused on a smaller list');
      t.ok(error.counts!==instance.counts,'previous failure counts remain independent');
      t.is(input.length,20000,'folding never changes the source array');
      t.is(input[0],1,'source values remain intact');
   });

   t.subtest('pending deletions, fatal host errors, and partial output',function(t) {
      var operations=['ADD','MUL'],i;
      for (i=0;i<operations.length;i++) {
         var op=operations[i],input={numbers:[0,2],saved:{value:4}};
         var instance=new JGraft(['JGRAFT',{v:1},['MOVE',['NODE','numbers',1],null,
            ['NODE','saved',['LOCAL','value',[op,['NODE','numbers']],'value']],['STASH','saved']]]);
         var error=errorOf(instance,input);
         t.is(error.code,'INVALID_TARGET',op+' cannot enumerate a pending-deletion slot');
         t.is(input,{numbers:[0,2],saved:{value:4}},op+' leaves input unchanged after pending failure');
      }
      t.is(errorOf(engine(['NONE',['IS',['ADD',1,['NODE','__proto__']],0]],{forbidProto:true}),{}).code,
         'UNSUPPORTED_GRAFT','a math probe cannot hide a forbidden property operation');
      input={a:2,b:3,original:{n:1}};
      instance=new JGraft(['JGRAFT',{v:1},['COPY',['ADD',['NODE','a'],['NODE','b']],'sum',['DIV',1,0],'invalid']]);
      error=errorOf(instance,input);
      t.is(error.code,'INVALID_TARGET','a later arithmetic failure aborts the action');
      t.is(error.graftPath,[2,3],'diagnostics identify the failing arithmetic expression');
      t.is(error.partial,{a:2,b:3,original:{n:1},sum:5},'partial output retains earlier results without assigning a failed value');
      t.ok(error.partial.original===input.original,'untouched partial branches remain shared');
      t.is(input,{a:2,b:3,original:{n:1}},'the original input is unchanged');
      error=errorOf(engine(['SUB',1,['NODE','missing']]),{});
      t.is(error.graftPath,[2,1,2],'operand failures retain the physical graft path');
      t.is(error.inputPath,['missing'],'operand failures identify their missing input');
   });

   t.done_testing();
});
