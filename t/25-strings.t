//; use lib do { (my $x= __FILE__) =~ s{[^/]+\z}{lib}; $x }; use TestJGraft -load => '../src/JGraft.js';

TAP(function(t) {
   function expression(value, limits) {
      return new JGraft(['JGRAFT', {v: 1}, ['COPY', value, ['NODE']]], {limits: limits});
   }
   function errorOf(instance, input) {
      try {
         instance.apply(input);
      } catch (error) {
         return error;
      }
      return {};
   }
   function repeat(text, count) {
      return new Array(count + 1).join(text);
   }
   var emoji= '\uD83D\uDE00', high= '\uD800', low= '\uDC00';

   TestJGraft.runConformanceTests(t, '../jgraft-spec/conformance/06-length.json');
   TestJGraft.runConformanceTests(t, '../jgraft-spec/conformance/07-slice.json');

   t.subtest('SPLIT codepoints and lone surrogates', function(t) {
      var samples= [[], ['a', '\u0000', '\u00E9', '\u0301', '\u4E2D'], [emoji],
         ['\uD800\uDC00', '\uDBFF\uDFFF', '\uD834\uDD1E'], [high], [low],
         [high, 'a', low], [low, high], [high, emoji, low], ['a', emoji, 'b']];
      var parts, input, output, i;
      for (i= 0; i < samples.length; i++) {
         parts= samples[i];
         input= parts.join('');
         output= expression(['SPLIT', {sep: '', discard: true}]).apply(input);
         t.is(JSON.stringify(output), JSON.stringify(parts), 'sample ' + i + ': empty-separator SPLIT produces codepoints');
      }
   });

   t.subtest('literal separators and trimming respect codepoint boundaries', function(t) {
      var text= 'a' + emoji + 'b' + emoji, output;
      output= expression(['SPLIT', {sep: emoji, discard: true}]).apply(text);
      t.is(JSON.stringify(output), '["a","b",""]', 'a supplementary separator matches as a whole character');
      output= expression(['SPLIT', {sep: '\uD83D', discard: true}]).apply(emoji);
      t.is(output[0], emoji, 'a high-surrogate separator cannot end inside a pair');
      t.is(output.length, 1, 'a failed partial-pair separator leaves one element');
      output= expression(['SPLIT', {sep: '\uDE00', discard: true}]).apply(emoji);
      t.is(output[0], emoji, 'a low-surrogate separator cannot start inside a pair');
      output= expression(['SPLIT', {sep: low + '\uD83D', discard: true}]).apply(low + emoji);
      t.is(output[0], low + emoji, 'a multi-unit separator also cannot cut a pair');
      output= expression(['SPLIT', {sep: ',', trim: '\uD83D', discard: true}]).apply(emoji);
      t.is(output[0], emoji, 'left trimming cannot remove half of a pair');
      output= expression(['SPLIT', {sep: ',', trim: '\uDE00', discard: true}]).apply(emoji);
      t.is(output[0], emoji, 'right trimming cannot remove half of a pair');
      output= expression(['SPLIT', {sep: high, discard: true}]).apply('a' + high + 'b');
      t.is(JSON.stringify(output), '["a","b"]', 'a genuinely lone surrogate is a usable separator');
      output= new JGraft(['JGRAFT', {v: 1},
         ['SPLIT', '', ['COPY', 'x', 1]]]).apply('a' + emoji + 'b');
      t.is(output, 'axb', 'SPLIT actions address logical characters');
      text= emoji + 'a' + emoji + ',' + emoji + 'b' + emoji;
      output= new JGraft(['JGRAFT', {v: 1},
         ['SPLIT', {sep: ',', trim: emoji}, ['COPY', 'z', 1]]]).apply(text);
      t.is(output, emoji + 'a' + emoji + ',' + emoji + 'z' + emoji, 'supplementary trimming metadata survives edits');
   });

   t.subtest('checkpoint boundaries and reverse seeks', function(t) {
      var parts= ['a', emoji, high, 'z', low], text= repeat(parts.join(''), 400);
      var indexes= [0, 255, 256, 257, 511, 512, 513, 1999, 1024, 1, 768, 254, 256, 0];
      var slices= [], output, i;
      for (i= 0; i < indexes.length; i++)
         slices.push(['SLICE', ['NODE'], indexes[i], 1]);
      output= expression([slices]).apply(text);
      for (i= 0; i < indexes.length; i++)
         t.is(output[i], parts[indexes[i] % parts.length], 'seek to codepoint ' + indexes[i]);
      t.is(expression(['SLICE', ['NODE'], 2000, 0]).apply(text), '', 'seeking the end after a partial checkpoint works');
      text= repeat(emoji, 512);
      t.is(expression(['SLICE', ['NODE'], 512, 0]).apply(text), '', 'the end can be exactly on a checkpoint');
      t.is(expression(['SLICE', ['NODE'], 511, 1]).apply(text), emoji, 'the codepoint preceding an end checkpoint is readable');
   });

   t.subtest('resource limits, cache reuse, and allocation bounds', function(t) {
      var text= repeat(emoji, 32768), instance, output, error, slices= [], i;
      instance= expression(['LENGTH'], {mem: 4096, new_obj: 100, ops: Infinity});
      t.is(instance.apply(text), 32768, 'long paired strings fit a small checkpoint budget without a character array');
      t.is(instance.apply(repeat('a', 65536)), 65536, 'long strings without pairs need no character or checkpoint arrays');
      t.is(instance.apply(repeat(high + 'x' + low, 20000)), 60000, 'lone surrogates also use the direct-index path');
      for (i= 0; i < 40; i++)
         slices.push(['SLICE', ['NODE'], i % 2? 3 : 32767 - i, 1]);
      output= expression([slices], {ops: 250000}).apply(text);
      t.is(output.length, slices.length, 'many distant seeks reuse the scan and checkpoints within an operation budget');
      t.is(output[0], emoji, 'a distant seek returns a complete supplementary character');
      t.is(output[39], emoji, 'a reverse seek also returns a complete supplementary character');
      error= errorOf(expression(['LENGTH'], {ops: 500}), repeat('a', 2000));
      t.is(error.code, 'RESOURCE_LIMIT', 'the preliminary surrogate-pair scan is charged even on the direct-index path');
      t.is(error.resource, 'ops', 'the preliminary scan consumes the operation budget');
      error= errorOf(expression(['LENGTH'], {mem: 4096, ops: Infinity}), repeat(emoji, 262144));
      t.is(error.code, 'RESOURCE_LIMIT', 'checkpoint growth is charged before allocation');
      t.is(error.resource, 'mem', 'checkpoint growth consumes the memory budget');
      t.is(error.partial.length, 524288, 'failed indexing leaves the original string intact');
   });
   t.done_testing();
});
