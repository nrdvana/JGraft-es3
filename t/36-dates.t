//; use lib do { (my $x= __FILE__) =~ s{[^/]+\z}{lib}; $x }; use TestJGraft -load => '../src/JGraft.js';

TAP(function(t) {
   function instance(value, config) {
      return new JGraft(['JGRAFT',{v:1},['COPY',value,['NODE']]],config);
   }
   function errorOf(graft, input) {
      try {graft.apply(input);} catch (error) {return error;}
      return {};
   }
   function date(text) {return ['CASTDATE',text];}
   var strict= {truncateDateResolution:false}, d1='2024-01-01', d2='2024-01-02', d3='2024-01-03';

   t.subtest('resolution configuration and decimal flooring',function(t) {
      var engine= instance(['CASTDATE']);
      t.is(engine.truncateDateResolution,true,'millisecond Date hosts enable truncation by default');
      t.is(engine.apply('2024-12-31T23:59:59.999999999Z'),'2024-12-31T23:59:59.999Z',
         'truncation never rounds into the next day');
      t.is(engine.apply('1969-12-31T23:59:59.9999Z'),'1969-12-31T23:59:59.999Z',
         'pre-epoch values floor toward the preceding millisecond');
      t.is(engine.apply({year:2024,second:1.001}),'2024-01-01 00:00:01.001',
         'binary multiplication cannot corrupt a millisecond-exact field');
      t.is(engine.apply({year:2024,second:0.9999999999999999}),'2024-01-01 00:00:00.999',
         'object seconds just below a boundary also floor');
      t.is(engine.apply({year:2024,second:1e-7}),'2024-01-01 00:00:00','scientific seconds below a millisecond floor to zero');
      t.is(engine.apply('2024-01-01T00:00:60.999999999Z'),'2024-01-01T00:00:60.999Z','leap seconds are never normalized away');
      engine= instance(['CASTDATE'],strict);
      t.is(engine.apply('2024-01-01T00:00:01.001000Z'),'2024-01-01T00:00:01.001Z',
         'discarding redundant fractional zeroes is not precision loss');
      t.is(engine.apply({year:2024,second:1.001}),'2024-01-01 00:00:01.001','strict mode accepts exact object milliseconds');
      t.is(errorOf(engine,'2024-01-01T00:00:00.0001Z').code,'UNSUPPORTED_GRAFT','strict mode rejects meaningful extra digits');
      t.is(errorOf(engine,{year:2024,second:1e-7}).code,'UNSUPPORTED_GRAFT','strict mode rejects sub-millisecond object fields');
      t.is(errorOf(instance(['NONE',['DATE']],strict),'2024-01-01T00:00:00.0001Z').code,
         'UNSUPPORTED_GRAFT','DATE and negative probes cannot hide precision loss');
      t.is(errorOf(engine,'2024-01-01T00:00:61.0001Z').code,'INVALID_TARGET','invalid fields are rejected before truncation policy');
      var config= {truncateDateResolution:true};engine= instance(['CASTDATE'],config);config.truncateDateResolution=false;
      t.is(engine.apply('2024-01-01T00:00:00.0001Z'),'2024-01-01T00:00:00Z','configuration is copied from its source');
      var invalid= [null,0,1,'false',{},[]], i;
      for (i=0;i<invalid.length;i++) {
         var thrown= false;
         try {instance(['DATE'],{truncateDateResolution:invalid[i]});} catch(error) {thrown= error instanceof TypeError;}
         t.ok(thrown,'nonboolean resolution option is rejected: '+String(invalid[i]));
      }
   });

   t.subtest('seconds-only host policy',function(t) {
      var NativeDate= Date, SecondsDate= function(value) {return new NativeDate(Math.floor(value/1000)*1000);};
      SecondsDate.prototype= NativeDate.prototype;
      var source= TestJGraft.readFile('../src/JGraft.js');
      var SecondsJGraft= new Function('Date','window',source+'\nreturn window.JGraft;')(SecondsDate,{});
      var make= function(config) {return new SecondsJGraft(['JGRAFT',{v:1},['COPY',['CASTDATE'],['NODE']]],config);};
      var engine= make();
      t.is(engine.truncateDateResolution,false,'seconds-only hosts do not silently discard fractions by default');
      t.is(errorOf(engine,'2024-01-01T00:00:00.125Z').code,'UNSUPPORTED_GRAFT','default seconds policy rejects millisecond loss');
      t.is(engine.apply('2024-01-01T00:00:00Z'),'2024-01-01T00:00:00Z','whole seconds still parse');
      engine= make({truncateDateResolution:true});
      t.is(engine.apply('1969-12-31T23:59:59.999Z'),'1969-12-31T23:59:59Z','explicit coarse truncation floors pre-epoch calendar seconds');
      t.is(errorOf(make(),new NativeDate(-1)).code,'UNSUPPORTED_GRAFT','native input loss is detected before copying');
      t.is(engine.apply(new NativeDate(-1)).getTime(),-1000,'native input copying also floors instead of clipping toward zero');
   });

   t.subtest('native Date inputs and virtual fields',function(t) {
      var input= new Date(1234), called= false, poison= function() {called=true;throw new Error('input date method called');};
      input.getTime= input.getUTCFullYear= input.getUTCMonth= input.getUTCDate= input.getUTCHours= poison;
      input.getUTCMinutes= input.getUTCSeconds= input.getUTCMilliseconds= input.toJSON= input.valueOf= poison;
      input.year= 9999;input.parts= [0];input.count= 3;
      var value= instance(['CASTDATE']).apply(input);
      t.ok(Object.prototype.toString.call(value)==='[object Date]','native CASTDATE outputs stay native');
      t.ok(value!==input,'COPY of a cast native Date has independent ownership');
      t.is(Date.prototype.getTime.call(value),1234,'the native timestamp passes through');
      value.setTime(0);
      t.is(Date.prototype.getTime.call(input),1234,'mutating the result cannot modify the input Date');
      value= instance({year:['NODE','year'],month:['NODE','month'],day:['NODE','day'],hour:['NODE','hour'],
         minute:['NODE','minute'],second:['NODE','second'],zone:['NODE','tz_offset']}).apply(input);
      t.is(value,{year:1970,month:1,day:1,hour:0,minute:0,second:1.234,zone:0},'native virtual fields use UTC and ignore own shadows');
      t.is(called,false,'no input method was invoked');
      t.is(instance(['DATE']).apply(input),true,'DATE accepts a native Date');
      t.is(instance(['DATE']).apply(new Date(NaN)),false,'DATE rejects an invalid native Date');
      t.is(errorOf(instance(['CASTDATE']),new Date(NaN)).code,'INVALID_TARGET','CASTDATE rejects an invalid native Date');
      t.is(instance(['IS',['CASTDATE','1970-01-01T01:00:01.234+01'],['NODE']]).apply(input),true,
         'native timestamps compare to parsed timestamps across offsets');
      var exact= true, i, native;
      for (i=0;i<1000;i++) {
         native= new Date((i%60)*1000+i);
         var engine= instance(['IS',['CASTDATE'],date('1970-01-01T00:00:'+('0'+(i%60)).slice(-2)+'.'+('00'+i).slice(-3)+'Z')]);
         if (!engine.apply(native)) {exact=false;break;}
      }
      t.ok(exact,'extracting integer seconds and milliseconds introduces no binary-addition mismatches');
   });

   t.subtest('parsed values export without namespace aliasing',function(t) {
      var graft= new JGraft(['JGRAFT',{v:1,const:['date',date(d1)]},
         ['COPY',{a:['CONST','date']},['STASH','original']],
         ['COPY',['STASH','original'],['STASH','saved']],
         ['MOVE',['STASH','original'],'result'],
         ['COPY',['STASH','saved','a','year'],'savedYear',['CONST','date','year'],'constYear']]);
      var output= graft.apply({});
      t.is(output,{result:{a:d1},savedYear:2024,constYear:2024},'exporting a moved container does not erase dates in other namespaces');
      graft= new JGraft(['JGRAFT',{v:1},['COPY',date(d1),'date',['IS',['NODE','date'],['STR']],'isText']]);
      t.is(graft.apply({}),{date:d1,isText:true},'a later COPY pair sees the exported target string');
      t.is(instance({dates:[[date(d1),{nested:date('2024-01-01T00:00:60Z')}]]}).apply(null),
         {dates:[d1,{nested:'2024-01-01T00:00:60Z'}]},'nested dates export recursively without leaking private records');
      graft= new JGraft(['JGRAFT',{v:1},['SPLICE',0,0,date(d1)]]);
      t.is(graft.apply([]),[d1],'SPLICE exports dates inserted into the target');
      graft= new JGraft(['JGRAFT',{v:1},['COPY',[[]],['STASH','list']],['SPLICE',['STASH','list',0],0,date(d1)],
         ['COPY',['STASH','list',0,'year'],['NODE']]]);
      t.is(graft.apply(null),2024,'SPLICE into stash retains internal date precision and virtual fields');
      graft= new JGraft(['JGRAFT',{v:1},['SPLIT',',',['COPY',['CASTDATE',['NODE',0]],0]]]);
      t.is(graft.apply('20240101,other'),'2024-01-01,other','SPLIT reassembly sees an exported string and retains separator metadata');
   });

   t.subtest('MOVE pending arrays retain identity and date exports',function(t) {
      var graft= new JGraft(['JGRAFT',{v:1},['COPY',[[date(d1),date(d2),date(d3)]],['STASH','list']],
         ['MOVE',['STASH','list',0],null,['STASH','list'],['NODE']]]);
      t.is(graft.apply({}),[d2,d3],'moving a pending-deletion array keeps its deferred shifts while exporting dates');
      graft= new JGraft(['JGRAFT',{v:1},['COPY',[[date(d1),date(d3)]],['STASH','list'],date(d2),['STASH','insert']],
         ['MOVE',['STASH','insert'],['STASH','list',0.5],['STASH','list'],['NODE']]]);
      t.is(graft.apply({}),[d1,d2,d3],'moving a pending-insertion array also exports its queued values');
      graft= new JGraft(['JGRAFT',{v:1},['COPY',[[date(d1),date(d3)]],['STASH','list'],date(d2),['STASH','insert']],
         ['MOVE',['STASH','insert'],['STASH','list',0.5]],['COPY',['STASH','list',1,'year'],['NODE']]]);
      t.is(graft.apply({}),2024,'queued values in stash remain dates if the array is not exported');
      graft= new JGraft(['JGRAFT',{v:1},['COPY',date(d2),['STASH','insert']],
         ['MOVE',['STASH','insert'],['NODE',0.5]]]);
      t.is(graft.apply([d1,d3]),[d1,d2,d3],'half-index insertion directly into target data exports immediately');
   });

   t.subtest('immutability, class distinctions, and untrusted fields',function(t) {
      var graft= new JGraft(['JGRAFT',{v:1},['COPY',date(d1),['STASH','date']],['COPY',2025,['STASH','date','year']]]);
      t.is(errorOf(graft,{}).code,'INVALID_TARGET','date virtual properties are immutable');
      graft= new JGraft(['JGRAFT',{v:1},['COPY',date(d1),['STASH','date']],['MOVE',['STASH','date','year'],'year']]);
      t.is(errorOf(graft,{}).code,'INVALID_TARGET','a virtual field cannot be detached');
      t.is(instance(['LOCAL','date',date(d1),['IS',['STASH','missing'],['EXISTS']]]).apply({}),false,'unrelated missing probes remain false');
      t.is(instance(['LOCAL','date',date(d1),['IS',['TEMP','date','parts'],['EXISTS']]]).apply({}),false,'private parts are not virtual properties');
      t.is(instance(['LOCAL','date',date(d1),['IS',['TEMP','date','constructor'],['EXISTS']]]).apply({}),false,'date paths do not expose prototypes');
      var input= {year:2024,parts:[1],count:7,constructor:'DateValue',toString:function(){throw new Error('coercion');}};
      t.is(instance(['CASTDATE']).apply(input),d1,'ordinary objects cannot spoof an internal date class');
      t.is(instance(['IS',date(d1),date('2024-01-01T00:00:00')]).apply(null),false,'date and datetime precision remain distinct');
      t.is(instance(['IS',date('2024-01-01T00:00:00'),date('2024-01-01T00:00:00Z')]).apply(null),false,
         'datetime and timestamp precision remain distinct');
      t.is(instance(['CASTSTR',date('+010000-01-01')]).apply(null),'+010000-01-01','expanded years retain their calendar meaning');
      t.is(instance(['CASTSTR',date('-000001-01-01')]).apply(null),'-000001-01-01','negative years retain their sign');
   });

   t.subtest('resources, partial output, and instance reuse',function(t) {
      var engine= instance(['CASTDATE'],{limits:{ops:1000}}),text='2024-01-01T00:00:00.'+new Array(10001).join('1')+'Z';
      var error= errorOf(engine,text);
      t.is(error.code,'RESOURCE_LIMIT','fraction scanning is charged before parsing');
      t.is(error.resource,'ops','scanning identifies the operation budget');
      t.is(engine.apply(d1),d1,'instance counters and parser state reset after resource failure');
      engine= instance(['CASTDATE'],strict);
      errorOf(engine,'2024-01-01T00:00:00.0001Z');
      t.is(engine.apply(d1),d1,'instance is reusable after unsupported precision');
      var input= {original:{n:1}};
      engine= new JGraft(['JGRAFT',{v:1},['COPY',date(d1),'saved',['CASTDATE','2024-02-30'],'invalid']]);
      error= errorOf(engine,input);
      t.is(error.code,'INVALID_TARGET','later invalid dates abort the action');
      t.is(error.partial,{original:{n:1},saved:d1},'partial results contain exported values rather than private date objects');
      t.is(input,{original:{n:1}},'input is unchanged after earlier writes and a date failure');
      t.ok(error.partial.original===input.original,'untouched input data stays shared');
   });

   t.done_testing();
});
