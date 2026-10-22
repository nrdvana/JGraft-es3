//; use lib do { (my $x= __FILE__) =~ s{[^/]+\z}{lib}; $x }; use TestJGraft -load => '../src/JGraft.js';

TAP(function(t) {
   function expression(value, limits) {
      return new JGraft(['JGRAFT',{v:1},['COPY',value,['NODE']]],{limits:limits});
   }
   function errorOf(instance, input) {
      try {instance.apply(input);} catch (error) {return error;}
      return {};
   }
   function repeat(text,count) {return new Array(count+1).join(text);}

   t.subtest('host number boundaries and spellings',function(t) {
      var value, i, values= [0.125,-2.5,1e-7,Number.MIN_VALUE,0.10000000000000002];
      for (i= 0; i < values.length; i++)
         t.is(expression(['CASTSTR']).apply(values[i]),JSON.stringify(values[i]),
            'fractional output follows the host JSON encoder for '+values[i]);
      value= expression(['CASTSTR']).apply(1e308);
      t.is(value,'1'+repeat('0',308),'large integer output expands positive exponents');
      value= expression(['CASTSTR']).apply(-1.25e21);
      t.is(value,'-1250000000000000000000','negative large integers preserve sign and mantissa');
      value= expression(['CASTSTR']).apply(1.0000000000000003e21);
      t.is(value,'1000000000000000300000','exponent expansion preserves the native significant digits');
      t.is(expression(['CASTSTR']).apply(-0),'0','negative zero uses the canonical zero spelling');
      value= expression(['CASTNUM']).apply('-0');
      t.is(1/value,-Infinity,'numeric parsing retains host negative zero');
      t.is(expression(['CASTNUM']).apply('1.7976931348623157e308'),Number.MAX_VALUE,'largest finite numeric token parses');
      t.is(expression(['CASTNUM']).apply('5e-324'),Number.MIN_VALUE,'smallest representable positive token parses');
      t.is(errorOf(expression(['CASTNUM']),'1e-9999').code,'UNSUPPORTED_GRAFT',
         'nonzero tokens that underflow to zero are outside the host numeric range');
      t.is(errorOf(expression(['CASTNUM']),'1.7976931348623159e308').code,'UNSUPPORTED_GRAFT',
         'finite-range overflow is distinguished from malformed input');
      t.is(errorOf(expression(['CASTNUM']),'1e400x').code,'INVALID_TARGET','syntax is checked before numeric range');
      t.is(errorOf(expression(['NONE',['CASTNUM']]),'1e400').code,'UNSUPPORTED_GRAFT',
         'negative matching cannot swallow unsupported numeric range');
      var token= '0.'+repeat('0',200)+'1';
      t.is(expression(['CASTNUM']).apply(token),Number(token),'long valid mantissas do not depend on host partial parsing');
      t.is(errorOf(expression(['CASTNUM']),token+'\n').code,'INVALID_TARGET','the grammar uses an absolute end assertion');
   });

   t.subtest('native nonfinite number extensions',function(t) {
      var i, value, values= [Infinity,-Infinity,NaN];
      for (i= 0; i < values.length; i++) {
         value= values[i];
         t.is(expression(['NUM']).apply(value),true,'NUM recognizes a native numeric value '+String(value));
         t.is(expression(['NUM',null,null]).apply(value),true,'null bounds impose no comparisons for '+String(value));
         t.is(expression(['CASTSTR']).apply(value),String(value),'nonfinite string spelling is explicit for '+String(value));
         var output= expression(['CASTNUM']).apply(value);
         t.ok(value !== value? output !== output : output === value,'native numeric values pass through CASTNUM');
         t.is(expression(['NUM',value,null]).apply(1),false,'nonfinite minimum is an invalid operand');
         t.is(expression(['NUM',null,value]).apply(1),false,'nonfinite maximum is an invalid operand');
      }
      t.is(expression(['NUM',0,1]).apply(NaN),false,'NaN cannot satisfy a finite range');
      t.is(expression(['NUM',0,null]).apply(Infinity),true,'an omitted upper bound does not imply finiteness');
      t.is(expression(['NUM',null,0]).apply(-Infinity),true,'an omitted lower bound does not imply finiteness');
      t.is(expression(['CASTBOOL']).apply(-0),false,'negative zero is an accepted false value');
   });

   t.subtest('native Dates and hostile coercion hooks',function(t) {
      var date= new Date(1234), called= false;
      var poison= function() {called= true; throw new Error('external method invoked');};
      date.toJSON= poison;
      date.valueOf= poison;
      date.toString= poison;
      date.getTime= poison;
      date.toISOString= poison;
      date.getUTCFullYear= poison;
      t.is(expression(['CASTSTR']).apply(date),'1970-01-01T00:00:01.234Z',
         'native Date stringification uses its timestamp without invoking own hooks');
      t.is(called,false,'none of the input Date methods were consulted');
      t.is(Date.prototype.getTime.call(date),1234,'the input Date remains unchanged');
      t.is(errorOf(expression(['CASTSTR']),new Date(NaN)).code,'INVALID_TARGET','invalid Dates are rejected as targets');
      date= new Date(0);
      date.setUTCFullYear(10000);
      t.is(expression(['CASTSTR']).apply(date),'+010000-01-01T00:00:00.000Z','expanded ISO years are preserved');
      date= new Date(0);
      date.setUTCFullYear(0);
      t.is(expression(['CASTSTR']).apply(date),'0000-01-01T00:00:00.000Z','year zero uses four digits');
      date.setUTCFullYear(-1);
      t.is(expression(['CASTSTR']).apply(date),'-000001-01-01T00:00:00.000Z','negative ISO years use a sign and six digits');
      var object= {toJSON:poison,valueOf:poison,toString:poison,hasOwnProperty:poison};
      t.is(errorOf(expression(['CASTSTR']),object).code,'INVALID_TARGET','objects cannot stringify through coercion hooks');
      t.is(errorOf(expression(['CASTNUM']),object).code,'INVALID_TARGET','objects cannot numify through coercion hooks');
      t.is(errorOf(expression(['CASTBOOL']),object).code,'INVALID_TARGET','objects cannot boolify through coercion hooks');
      t.is(called,false,'rejected scalar conversions invoke no user methods');
      for (var i= 0; i < 3; i++)
         t.is(expression([['BOOL','NUM','STR'][i]]).apply(date),false,'Date does not pass an unrelated scalar type check');
   });

   t.subtest('allocation and operation budgets',function(t) {
      var input= {}, i, error, instance, large= '1.'+repeat('0',10000);
      for (i= 0; i < 2000; i++) input['k'+i]= {value:i};
      instance= expression(['CASTSTR',['NODE']],{ops:500,new_obj:100});
      error= errorOf(instance,input);
      t.is(error.code,'INVALID_TARGET','invalid object references are inspected without cloning or enumerating them');
      t.ok(error.partial === input,'borrowed input remains the partial output');
      error= errorOf(expression(['CASTNUM'],{ops:1000}),large);
      t.is(error.code,'RESOURCE_LIMIT','numeric grammar and parsing charge long strings');
      t.is(error.resource,'ops','numeric scanning reports the operation budget');
      instance= expression(['CASTNUM'],{ops:1000});
      errorOf(instance,large);
      t.is(instance.apply('1'),1,'the instance is reusable after a parsing budget failure');
      error= errorOf(expression(['CASTSTR'],{mem:3000,ops:Infinity}),1e308);
      t.is(error.code,'RESOURCE_LIMIT','integer exponent expansion accounts for temporary and output allocation');
      t.is(error.resource,'mem','expanded-string failure reports the memory budget');
      var nested= ['CASTBOOL'];
      for (i= 0; i < 30; i++) nested= ['CASTBOOL',nested];
      error= errorOf(expression(nested,{depth:20}),true);
      t.is(error.code,'RESOURCE_LIMIT','nested casts contribute to expression depth');
      t.is(error.resource,'depth','nested cast failure reports the depth budget');
      error= errorOf(expression(['NONE',['CASTNUM']],{ops:1000}),large);
      t.is(error.code,'RESOURCE_LIMIT','match probes cannot hide numeric parsing resource exhaustion');
   });

   t.subtest('partial output and recovery after ordinary failures',function(t) {
      var input= {text:'invalid',keep:{n:1}}, instance= new JGraft(['JGRAFT',{v:1},
         ['COPY',7,'saved',['CASTNUM',['NODE','text']],'number']]),error= errorOf(instance,input);
      t.is(error.code,'INVALID_TARGET','invalid conversion aborts its action');
      t.is(error.partial,{text:'invalid',keep:{n:1},saved:7},'partial output retains the prior pair');
      t.is(input,{text:'invalid',keep:{n:1}},'original data is unchanged after partial failure');
      t.ok(error.partial.keep === input.keep,'unchanged subtrees remain shared');
      t.is(instance.apply({text:'2'}),{text:'2',saved:7,number:2},'subsequent input is converted independently');
   });

   t.done_testing();
});
