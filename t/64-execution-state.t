//; use lib do { (my $x= __FILE__) =~ s{[^/]+\z}{lib}; $x }; use TestJGraft -load => '../src/JGraft.js';

TAP(function(t) {
   function errorOf(instance,input) {
      try {instance.apply(input);} catch(error) {return error;}
      return {};
   }
   t.subtest('reentrant host calls restore execution state',function(t) {
      var stringify=JSON.stringify,nestedOutput,earlyError,fatalError,hookCalls=0,output;
      var inner=new JGraft(['JGRAFT',{v:1},['LOG','info','inner'],['COPY',1,'done']]);
      var early=new JGraft(['JGRAFT',{v:1}],{limits:{ops:0}});
      var fatal=new JGraft(['JGRAFT',{v:1},['LOG','fail','inner failure']]);
      var outer=new JGraft(['JGRAFT',{v:1},['LOG','info','outer before'],
         ['COPY',['CASTSTR',['NODE','number']],'text'],['LOG','warn','outer after',['NODE']]]);
      // Simulate a host JSON implementation that enters JGraft while formatting
      // a number. No input object methods or new application callbacks are used.
      JSON.stringify=function(value) {
         if (value===0.5) {
            hookCalls++;
            nestedOutput=inner.apply({});
            earlyError=errorOf(early,{});
            fatalError=errorOf(fatal,{});
         }
         return stringify(value);
      };
      try {output=outer.apply({number:0.5});}
      finally {JSON.stringify=stringify;}
      t.is(hookCalls,1,'the host call reenters once');
      t.is(nestedOutput,{done:1},'the nested application succeeds');
      t.is(earlyError.code,'RESOURCE_LIMIT','nested failure can happen before tree setup');
      t.is(fatalError.code,'NO_MATCH','nested failure can happen after actions execute');
      t.is(output,{number:0.5,text:'0.5'},'the outer application resumes correctly');
      t.is(outer.logs.length,2,'nested logs do not escape into the outer attempt');
      t.is(inner.logs.length,1,'inner logs stay on their instance');
      t.is(outer.logs[1].graftPath,[4],'outer action diagnostics are restored');
      t.is(outer.logs[1].data,output,'outer data copying uses its own tree');
      t.ok(outer.counts!==inner.counts&&outer.counts!==earlyError.counts&&outer.counts!==fatalError.counts,
         'all attempts keep independent counters');
      t.is(earlyError.logs,[],'early failure publishes its own empty log');
      t.is(fatalError.logs[0].message,'inner failure','fatal diagnostics retain the inner attempt');
   });
   t.subtest('foreign nested failures retain their identity',function(t) {
      var stringify=JSON.stringify,inner=new JGraft(['JGRAFT',{v:1},['LOG','fail','inner']]),nestedError,outerError;
      var outer=new JGraft(['JGRAFT',{v:1},['LOG','info','before'],
         ['COPY',['IS',['CASTSTR',['NODE','number']],'0.5'],'matched']]);
      JSON.stringify=function(value) {
         if(value===0.5) {
            nestedError=errorOf(inner,{});
            throw nestedError;
         }
         return stringify(value);
      };
      try {outerError=errorOf(outer,{number:0.5});}
      finally {JSON.stringify=stringify;}
      t.ok(outerError===nestedError,'an outer match cannot swallow an error from another attempt');
      t.ok(outerError.counts===inner.counts&&outerError.counts!==outer.counts,'the thrown error retains inner counters');
      t.is(outer.logs.length,1,'the outer log stays separate after propagated failure');
      t.is(inner.logs[0].message,'inner','inner records are retained');
      var after=new JGraft(['JGRAFT',{v:1},['COPY',['CASTSTR'],['NODE']]]);
      t.is(after.apply(0.5),'0.5','later applications start with a clean execution binding');
   });
   t.done_testing();
});
