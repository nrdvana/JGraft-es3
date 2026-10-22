//; use lib do { (my $x= __FILE__) =~ s{[^/]+\z}{lib}; $x }; use TestJGraft -load => '../src/JGraft.js';

TAP(function(t) {
   function matcher(pattern, limits) {
      return new JGraft(['JGRAFT',{v:1},['MATCH',pattern]],{limits:limits});
   }
   function errorOf(instance, input) {
      try {instance.apply(input);} catch (error) {return error;}
      return {};
   }
   var large= [], i;
   for (i= 0; i < 20000; i++) large.push(1);

   t.subtest('borrowed arrays and bounded allocation',function(t) {
      var input= [{n:1},2,3], output;
      output= matcher(['ARRAY',0,{n:1}]).apply(input);
      t.ok(output === input,'matching retains the original root identity');
      t.ok(output[0] === input[0],'matching borrows nested values');
      output= matcher(['ARRAY'],{ops:500,new_obj:100,mem:16384}).apply(large);
      t.ok(output === large,'type checks do not enumerate or clone a large array');
      output= matcher(['IS',['ARRAY',20000]],{ops:500,new_obj:100,mem:16384}).apply(large);
      t.ok(output === large,'length checks do not enumerate elements');
      output= matcher(['ARRAY',19999,1],{ops:Infinity,new_obj:100,mem:16384}).apply(large);
      t.ok(output === large,'large offsets require no per-element scopes, placeholders, or slices');
      output= matcher(['IS',['ARRAY',0,1]],{ops:Infinity,new_obj:100,mem:16384}).apply(large);
      t.ok(output === large,'an exact-mode ignored suffix needs no per-element allocations');
      var date= new Date(1234);
      input= [date];
      output= matcher(['ARRAY',0,['NODE']]).apply(input);
      t.ok(output[0] === date,'native Date elements remain borrowed values');
   });

   t.subtest('resource accounting and reuse',function(t) {
      var instance= matcher(['ARRAY',19999,1],{ops:1000}), error= errorOf(instance,large);
      t.is(error.code,'RESOURCE_LIMIT','skipped prefix traversal consumes operations');
      t.is(error.resource,'ops','prefix failure identifies the operation budget');
      instance= matcher(['IS',['ARRAY',0,1]],{ops:1000});
      error= errorOf(instance,large);
      t.is(error.code,'RESOURCE_LIMIT','exact-mode suffix presence checks consume operations');
      error= errorOf(matcher(['NONE',['IS',['ARRAY',0,1]]],{ops:1000}),large);
      t.is(error.code,'RESOURCE_LIMIT','negative probes do not swallow resource failures');
      instance= matcher(['ARRAY',['NODE',0],1],{ops:1000});
      error= errorOf(instance,[19999].concat(large));
      t.is(error.code,'RESOURCE_LIMIT','input-dependent large offsets exhaust the budget');
      var input= [1,1];
      t.ok(instance.apply(input) === input,'a later application starts with fresh counters and state');
      input= 1;
      var pattern= 1;
      for (var j= 0; j < 30; j++) {
         input= [input];
         pattern= ['ARRAY',0,pattern];
      }
      error= errorOf(matcher(pattern,{depth:20}),input);
      t.is(error.code,'RESOURCE_LIMIT','nested ARRAY patterns consume logical expression depth');
      t.is(error.resource,'depth','nested failure identifies the depth budget');
   });

   t.subtest('missing slots and successor-dependent suffix checks',function(t) {
      var input= [1,2,3];
      delete input[1];
      t.ok(matcher(['ARRAY',3]).apply(input) === input,'length checks permit native sparse arrays');
      t.is(errorOf(matcher(['ARRAY',2,3]),input).code,'NO_MATCH','a skipped native hole is not EXISTS');
      t.ok(matcher(['HAS',['ARRAY',0,1]]).apply(input) === input,'partial mode leaves sparse suffixes uninspected');
      t.is(errorOf(matcher(['IS',['ARRAY',0,1]]),input).code,'NO_MATCH','exact mode rejects a missing suffix slot');
      t.ok(matcher(['IS',['ARRAY',0,1,['NONE',['EXISTS']],3]]).apply(input) === input,
         'an explicit missing-node predicate can cover a hole');
      var pattern= ['IS',['ARRAY',0,['SEQ',['ANY',1,['SEQ',1,['HAS',['NONE',['EXISTS']]],3]]]]];
      t.ok(matcher(pattern).apply(input) === input,'suffix presence filters alternatives by their actual endpoint');
      t.ok(!(1 in input),'probing never fills the original hole');
   });

   t.subtest('capture preference at ARRAY roots and deeper arrays',function(t) {
      var input= [0,1,1,9], pattern= ['ARRAY',1,['SEQMIN','short',['REP',0,-1,1]],
         ['SEQMAX','long',['REP',0,-1,1]]], output;
      output= new JGraft(['JGRAFT',{v:1},['COPY',['CAPTURE',pattern],['NODE']]]).apply(input);
      t.is(output,{short:{path:[],ofs:1,len:0,lim:1},long:{path:[],ofs:1,len:2,lim:3}},
         'root preference order excludes the offset operand and respects each named group');
      input= [[1,2],9];
      pattern= ['ARRAY',0,['SEQMAX','outer',['ARRAY',0,['SEQMAX','inner',1]]]];
      output= new JGraft(['JGRAFT',{v:1},['COPY',['CAPTURE',pattern],['NODE']]]).apply(input);
      t.is(output,{outer:{path:[],ofs:0,len:1,lim:1},inner:{path:[0],ofs:0,len:1,lim:1}},
         'nested ARRAY matching resolves its own cursor and retains both capture paths');
   });

   t.subtest('copy-on-write on action failures',function(t) {
      var input= {items:[1,2]}, instance= new JGraft(['JGRAFT',{v:1},
         ['COPY',3,['NODE','items',0]],['MATCH',{items:['ARRAY',0,9]}]]);
      var error= errorOf(instance,input);
      t.is(error.code,'NO_MATCH','a failed ARRAY guard rejects the graft');
      t.is(input,{items:[1,2]},'earlier writes leave the original input unchanged');
      t.is(error.partial,{items:[3,2]},'partial output retains the earlier edit');
   });

   t.done_testing();
});
