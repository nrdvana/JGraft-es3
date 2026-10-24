//; use lib do { (my $x= __FILE__) =~ s{[^/]+\z}{lib}; $x }; use TestJGraft -load => '../src/JGraft.js';

TAP(function(t) {
   function caught(instance,input) {
      try {instance.apply(input);} catch(error) {return error;}
      t.fail('expected application failure');
   }
   t.subtest('ordered entries and fatal retention',function(t) {
      var input={x:1},instance=new JGraft(['JGRAFT',{v:1},
         ['LOG','info','one'],[10,'warn','two',null],['LOG',0,'three',false],
         ['LOG',1,'four',0],['COPY',2,'x'],['LOG','fail','stop',['NODE']],
         ['LOG','info','unreachable']]),error;
      t.is(instance.logs,null,'logs are absent before the first attempt');
      error=caught(instance,input);
      t.is(error.code,'NO_MATCH','fatal logging rejects the graft');
      t.is(error.message,'stop','the logged reason is also the error message');
      t.is(instance.logs,[
         {level:0,message:'one',graftPath:[2],inputPath:[]},
         {level:1,message:'two',data:null,graftPath:[3],inputPath:[]},
         {level:0,message:'three',data:false,graftPath:[4],inputPath:[]},
         {level:1,message:'four',data:0,graftPath:[5],inputPath:[]},
         {level:2,message:'stop',data:{x:2},graftPath:[7],inputPath:[]}
      ],'entries normalize levels and distinguish absent data from null');
      t.ok(error.logs===instance.logs,'error and instance expose the same attempt log');
      t.is(error.graftPath,[7],'fatal errors identify the LOG action');
      t.is(error.inputPath,[],'fatal errors identify its current node');
      t.is(error.partial,{x:2},'preceding edits are retained');
      error.partial.x=9;
      t.is(error.logs[4].data,{x:2},'recorded data is independent of partial output');
      t.is(input,{x:1},'input remains unchanged');
   });
   t.subtest('locations are action locations',function(t) {
      var instance=new JGraft(['JGRAFT',{v:1},['LOG','info','root'],
         ['AT','item',['LOG','warn',['NODE','name'],['NODE','payload']]],
         ['LOG','info','after']]);
      instance.apply({item:{name:'nested',payload:{x:1}}});
      t.is(instance.logs[1],{level:1,message:'nested',data:{x:1},
         graftPath:[3,2],inputPath:['item']},'operand paths do not replace the log action location');
      t.is(instance.logs[2].inputPath,[],'AT restores the outer current node');
      instance=new JGraft(['JGRAFT',{v:1},['AT','item',['LOG','fail',['NODE','name'],['NODE','payload']]]]);
      var error=caught(instance,{item:{name:'reason',payload:[1]}});
      t.is(error.graftPath,[2,2],'fatal path points to LOG rather than its data argument');
      t.is(error.inputPath,['item'],'fatal input path points to its current node');
      t.is(error.logs[0].inputPath,['item'],'entry and fatal error agree');
   });
   t.subtest('data snapshots survive subsequent writes',function(t) {
      var input={data:{x:[1]}},instance=new JGraft(['JGRAFT',{v:1},
         ['LOG','info','before',['NODE','data']],['COPY',2,['NODE','data','x',0]],
         ['LOG','warn','after',['NODE','data']],['COPY',3,['NODE','data','x',0]]]);
      var output=instance.apply(input);
      t.is(instance.logs[0].data,{x:[1]},'first snapshot keeps its original value');
      t.is(instance.logs[1].data,{x:[2]},'second snapshot records the later value');
      t.is(output,{data:{x:[3]}},'output includes the final edit');
      output.data.x[0]=4;input.data.x[0]=5;
      t.is(instance.logs[0].data,{x:[1]},'later input/output mutation cannot alter the first record');
      instance.logs[0].data.x[0]=6;
      t.is(instance.logs[1].data,{x:[2]},'records are independent of one another');
      t.is(output.data.x,[4],'editing a record cannot alter the output');
   });
   t.subtest('per-attempt reset includes early failures',function(t) {
      var instance=new JGraft(['JGRAFT',{v:1},['LOG','info',['NODE','message'],['NODE','data']]]);
      instance.apply({message:'one',data:{x:1}});
      var first=instance.logs,error=caught(instance,{message:'bad\n',data:{x:2}});
      t.is(error.code,'INVALID_TARGET','invalid text fails before an entry is published');
      t.is(instance.logs,[],'failed attempts receive a fresh empty array');
      t.ok(instance.logs!==first,'reuse replaces the array');
      t.is(first[0].data,{x:1},'previous attempt data is retained');
      var failed=error.logs;
      instance.apply({message:'two',data:{x:2}});
      t.is(instance.logs.length,1,'later success starts fresh');
      t.is(failed,[],'previous errors retain their attempt array');
      instance=new JGraft(['JGRAFT',{v:1}],{limits:{ops:0}});
      error=caught(instance,{});
      t.is(error.logs,[],'even the first resource check publishes logs');
      t.ok(error.logs===instance.logs,'early failures expose the same array');
   });
   t.subtest('operand errors preserve only complete preceding records',function(t) {
      var instance=new JGraft(['JGRAFT',{v:1},['LOG','info','first'],
         ['LOG','fail','second',['NODE','missing']]]),error=caught(instance,{});
      t.is(error.code,'INVALID_TARGET','data errors precede fail-level NO_MATCH');
      t.is(error.logs.length,1,'failed data does not publish a partial entry');
      t.is(error.logs[0].message,'first','earlier records remain available');
      t.is(error.graftPath,[3,3],'operand failures retain their own diagnostic path');
   });
   t.subtest('scope, capture, stash, and skipped messages',function(t) {
      var instance=new JGraft(['JGRAFT',{v:1,const:['message','outer']},
         ['COPY',['NODE'],['STASH','saved']],
         ['MATCH',[[['SEQMAX','span',['REP',0,-1,['EXISTS']]]]],
            ['LOG','info',['CONST','message'],['CAP']]],
         ['JGRAFT',{const:['message','inner']},['LOG','warn',['CONST','message']]],
         ['IF',false,['LOG','fail','skipped'],['LOG',0,['CONST','message'],['STASH','saved']]]]);
      instance.apply([1,2]);
      t.is(instance.logs.length,3,'nested scopes share the attempt log and skipped actions add nothing');
      t.is(instance.logs[0].data,{span:{path:[],ofs:0,len:2,lim:2}},'LOG can inspect captures');
      t.is(instance.logs[1].message,'inner','nested constants apply');
      t.is(instance.logs[2].message,'outer','outer constants are restored');
      t.is(instance.logs[2].data,[1,2],'outer stash survives a nested JGRAFT');
   });
   t.subtest('native and logical dates are stable public data',function(t) {
      var date=new Date(1234),input={date:date},instance=new JGraft(['JGRAFT',{v:1},
         ['LOG','info','native',['NODE']],
         ['LOG','info','logical',{date:['CASTDATE','2000-01-01']}]]);
      instance.apply(input);
      t.ok(instance.logs[0].data.date instanceof Date,'native dates remain native dates');
      t.ok(instance.logs[0].data.date!==date,'native dates have independent identity');
      date.setTime(9999);
      t.is(instance.logs[0].data.date.getTime(),1234,'mutating the input date leaves the log stable');
      t.is(instance.logs[1].data,{date:'2000-01-01'},'private logical date objects are exported');
   });
   t.subtest('arbitrary own properties and host restrictions',function(t) {
      var input={hasOwnProperty:0,toString:1},instance=new JGraft(['JGRAFT',{v:1},['LOG','info','data',['NODE']]],{forbidProto:false});
      Object.defineProperty(input,'__proto__',{value:{secret:1},enumerable:true});
      instance.apply(input);
      var data=instance.logs[0].data;
      t.ok(Object.prototype.hasOwnProperty.call(data,'__proto__'),'snapshot owns the arbitrary key');
      t.is(Object.getOwnPropertyDescriptor(data,'__proto__').value,{secret:1},'snapshot preserves its data value');
      t.is(data.hasOwnProperty,0,'shadowed methods are data');
      instance=new JGraft(['JGRAFT',{v:1},['LOG','info','data',['NODE']]],{forbidProto:true});
      var error=caught(instance,input);
      t.is(error.code,'UNSUPPORTED_GRAFT','forbidden data properties are rejected');
      t.is(instance.logs,[],'rejected snapshots are not published');
   });
   t.subtest('retained messages and data consume resources',function(t) {
      var actions=['JGRAFT',{v:1}],i,error,instance;
      for(i=0;i<100;i++)actions.push(['LOG','info','message']);
      instance=new JGraft(actions,{limits:{mem:8192,ops:Infinity}});
      error=caught(instance,{});
      t.is(error.code,'RESOURCE_LIMIT','retaining entries consumes memory');
      t.is(error.resource,'mem','entry allocations are accounted');
      t.ok(instance.logs.length>0&&instance.logs.length<100,'only complete records preceding exhaustion survive');
      instance=new JGraft(['JGRAFT',{v:1},['LOG','info',['NODE']]],{limits:{ops:1000}});
      error=caught(instance,new Array(10001).join('x'));
      t.is(error.code,'RESOURCE_LIMIT','validation of long strings consumes work');
      t.is(instance.logs,[],'unfinished validation does not publish a message');
      instance=new JGraft(['JGRAFT',{v:1},['LOG','info','data',['NODE']]],{limits:{new_obj:60,ops:Infinity}});
      var input=[];for(i=0;i<100;i++)input.push({x:i});
      error=caught(instance,input);
      t.is(error.code,'RESOURCE_LIMIT','deep data snapshots consume allocation budget');
      t.is(error.resource,'new_obj','data copying charges objects');
      t.is(instance.logs,[],'unfinished data copying is not published');
      t.is(input.length,100,'failed logging leaves source data intact');
   });
   t.done_testing();
});
