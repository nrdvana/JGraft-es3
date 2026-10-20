//; use lib do { (my $x= __FILE__) =~ s{[^/]+\z}{lib}; $x }; use TestJS -load => ['../src/JGraft.js', 'lib/test-util.js'];

TAP(function(t) {
   TestJS.runConformanceTests(t, '../jgraft-spec/conformance/01-copy.json');
   TestJS.runConformanceTests(t, '../jgraft-spec/conformance/02-move.json');
   TestJS.runConformanceTests(t, '../jgraft-spec/conformance/03-splice.json');
   TestJS.runConformanceTests(t, {
      version: 1,
      name: 'Native Date inputs',
      tests: [
         {
            name: 'COPY a Date without changing the original',
            input: {source: new Date(1234567890123)},
            jgraft: ['JGRAFT', {v: 1}, ['COPY', ['NODE', 'source'], 'copy']],
            output: {source: new Date(1234567890123), copy: new Date(1234567890123)}
         },
         {
            name: 'COPY a subtree containing Dates',
            input: {source: {dates: [new Date(0), new Date(-1234567890123)]}},
            jgraft: ['JGRAFT', {v: 1}, ['COPY', ['NODE', 'source'], 'copy']],
            output: {
               source: {dates: [new Date(0), new Date(-1234567890123)]},
               copy: {dates: [new Date(0), new Date(-1234567890123)]}
            }
         },
         {
            name: 'MOVE a Date between properties',
            input: {source: new Date(1234567890123)},
            jgraft: ['JGRAFT', {v: 1}, ['MOVE', 'source', 'dest']],
            output: {dest: new Date(1234567890123)}
         },
         {
            name: 'MOVE a Date to the root',
            input: {source: new Date(0)},
            jgraft: ['JGRAFT', {v: 1}, ['MOVE', 'source', ['NODE']]],
            output: new Date(0)
         },
         {
            name: 'SPLICE a referenced Date into an array',
            input: {source: new Date(1234567890123), list: []},
            jgraft: ['JGRAFT', {v: 1}, ['SPLICE', ['NODE', 'list', 0], 0, ['NODE', 'source']]],
            output: {source: new Date(1234567890123), list: [new Date(1234567890123)]}
         },
         {
            name: 'SPLICE existing Date elements',
            input: [new Date(0), new Date(1234567890123)],
            jgraft: ['JGRAFT', {v: 1}, ['SPLICE', 0, 1]],
            output: [new Date(1234567890123)]
         },
         {
            name: 'A failed splice leaves Date inputs unchanged',
            input: [new Date(0)],
            jgraft: ['JGRAFT', {v: 1}, ['SPLICE', 0, 2]],
            errors: {INVALID_TARGET: true}
         }
      ]
   });
   t.done_testing();
});
