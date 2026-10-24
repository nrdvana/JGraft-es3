//; use lib do { (my $x= __FILE__) =~ s{[^/]+\z}{lib}; $x }; use TestJGraft -load => '../src/JGraft.js';

TAP(function(t) {
   function errorOf(graft,input) {try {new JGraft(graft).apply(input);} catch(error) {return error;} return {};}
   function value(expr) {return ['JGRAFT',{v:1},['COPY',expr,['NODE']]];}
   t.subtest('unknown expression integers remain fatal in every context',function(t) {
      var ids=[-1e20,-100,-6,20,21,49,79,100,1e20],i,id;
      for(i=0;i<ids.length;i++) {
         id=ids[i];
         t.is(errorOf(value([id]),null).code,'INVALID_GRAFT','value ID '+id);
         t.is(errorOf(value(['IS',[id]]),null).code,'INVALID_GRAFT','match ID '+id);
         t.is(errorOf(value(['IS',['STR',[id]]]),'x').code,'INVALID_GRAFT','regex ID '+id);
         t.is(errorOf(value(['IS',[[['SEQ',[id]]]]]),[1]).code,'INVALID_GRAFT','sequence ID '+id);
      }
   });
   t.subtest('integer validation precedes interval dispatch',function(t) {
      var ids=[null,false,true,-5.5,0.5,16.5,18.5,50.5,78.5,'0','17','50','78'],i,id;
      for(i=0;i<ids.length;i++) {
         id=ids[i];
         t.is(errorOf(value([id]),1).code,'INVALID_GRAFT','expression '+JSON.stringify(id));
         t.is(errorOf(['JGRAFT',{v:1},[id]],1).code,'INVALID_GRAFT','action '+JSON.stringify(id));
      }
      t.is(new JGraft(value([-0])).apply(1),1,'negative zero remains NODE=0');
   });
   t.subtest('action gaps and extremes remain rejected',function(t) {
      var ids=[-1e20,-100,-2,7,8,9,11,100,1e20],i;
      for(i=0;i<ids.length;i++)
         t.is(errorOf(['JGRAFT',{v:1},[ids[i]]],{}).code,'INVALID_GRAFT','action ID '+ids[i]);
   });
   t.subtest('literal and escaped-array sentinels bypass opcode partitions',function(t) {
      var cases=[null,false,true,0,'',{},[],[1]],i,expected,graft;
      for(i=0;i<cases.length;i++) {
         expected=cases[i];
         graft=value(['IS',['NODE']]);
         t.is(new JGraft(graft).apply(expected),true,'reference matching preserves literal '+JSON.stringify(expected));
      }
      t.is(new JGraft(value(['IS',[[]]])).apply([]),true,'an escaped empty array is structure');
      t.is(new JGraft(value(['IS',{missing:['NONE',['EXISTS']]}])).apply({}),true,
         'an absent structural node is distinct from an opcode');
   });
   t.subtest('sequence-only IDs cannot enter value dispatch',function(t) {
      var ids=[13,14,15,16],i;
      for(i=0;i<ids.length;i++)
         t.is(errorOf(value([ids[i]]),[]).code,'INVALID_GRAFT','value ID '+ids[i]);
   });
   t.done_testing();
});
