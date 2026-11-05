import { expect, test } from 'bun:test';
import { groupTables, mergeTableFragments } from '../src/core/tables';

test('joins a numbered continuation to its full table title', () => {
  const fragments = groupTables([
    { ...cell, tableTitle: 'Table 1 AR HMD design evaluation', page: 4 },
    { ...cell, tableTitle: 'Table 1', page: 5 },
  ]);
  const merged = mergeTableFragments(fragments, [{ number: 4, text: 'Table 1 AR HMD design evaluation' }, { number: 5, text: 'Table 1 (continued)' }]);
  expect(merged).toHaveLength(1);
  expect(merged[0].pages).toEqual([4, 5]);
});

const cell = {field:'value', value:'10', valueState:'observed', page:1, quote:'10', visual:false, region:null, evidenceStatus:'source_located', reasonCode:null, tableTitle:'Financial results', rowLabel:'Acme', columnPath:'Revenue / 2024'};

test('groups validated table cells and preserves separate pages and labels', () => {
  const tables = groupTables([
    cell,
    {...cell, value:'11', columnPath:'Revenue / 2023'},
    {...cell, page:2, rowLabel:'Beta'},
    {...cell, tableTitle:'Unrelated'},
  ]);
  expect(tables).toHaveLength(3);
  expect(tables[0].title).toBe('Financial results');
  expect(tables[0].page).toBe(1);
  expect(tables[0].cells.map(c => c.columnPath)).toEqual(['Revenue / 2024','Revenue / 2023']);
  expect(tables[1].page).toBe(2);
});

test('does not publish rejected or incomplete table cells', () => {
  const tables = groupTables([{...cell,evidenceStatus:'rejected'}, {...cell,rowLabel:''}]);
  expect(tables).toEqual([]);
});

test('renders table cells as escaped GFM with source page references', async () => {
  const { renderTablesMarkdown } = await import('../src/core/tables');
  const output = renderTablesMarkdown(groupTables([
    {...cell, rowLabel:'Acme | East', value:'10 | 11'},
    {...cell, rowLabel:'Beta', value:null, valueState:'unreadable', evidenceStatus:'needs_review'},
  ]));
  expect(output).toContain('Acme \\| East');
  expect(output).toContain('10 \\| 11');
  expect(output).toContain('\\[UNREADABLE\\]');
  expect(output).toContain('p. 1');
});

test('keeps repeated row labels with distinct row identities separate', async () => {
  const { renderTablesMarkdown } = await import('../src/core/tables');
  const output = renderTablesMarkdown(groupTables([
    {...cell, rowId:'r1', rowLabel:'Standard', value:'10'},
    {...cell, rowId:'r2', rowLabel:'Standard', value:'20'},
  ]));
  expect(output.split('\n').filter(line => line.startsWith('| Standard |'))).toHaveLength(2);
});

test('keeps ambiguous repeated labels without row identities separate', async () => {
  const { renderTablesMarkdown } = await import('../src/core/tables');
  const output = renderTablesMarkdown(groupTables([
    {...cell, rowLabel:'Standard', value:'10'},
    {...cell, rowLabel:'Standard', value:'20'},
  ]));
  expect(output.split('\n').filter(line => line.startsWith('| Standard |'))).toHaveLength(2);
});

test('merges adjacent fragments only with matching columns and explicit source continuation', async () => {
  const { mergeTableFragments } = await import('../src/core/tables');
  const fragments = groupTables([cell, {...cell,page:2,rowLabel:'Beta'}]);
  const pages = [{number:1,text:'Financial results'}, {number:2,text:'Financial results (continued)'}];
  const merged = mergeTableFragments(fragments, pages);
  expect(merged).toHaveLength(1);
  expect(merged[0].pages).toEqual([1,2]);
  expect(merged[0].cells).toHaveLength(2);
});

test('keeps separate fragments when continuation or columns are uncertain', async () => {
  const { mergeTableFragments } = await import('../src/core/tables');
  const fragments = groupTables([cell, {...cell,page:2,rowLabel:'Beta',columnPath:'Margin'}]);
  expect(mergeTableFragments(fragments, [{number:1,text:'Financial results'}, {number:2,text:'Financial results (continued)'}])).toHaveLength(2);
  expect(mergeTableFragments(groupTables([cell,{...cell,page:2}]), [{number:1,text:'Financial results'}, {number:2,text:'Financial results'}])).toHaveLength(2);
});

test('does not combine equal row IDs from different pages in a merged table', async () => {
  const { mergeTableFragments, renderTablesMarkdown } = await import('../src/core/tables');
  const fragments = groupTables([{...cell,rowId:'r1'}, {...cell,page:2,rowId:'r1',value:'20'}]);
  const merged = mergeTableFragments(fragments, [{number:1,text:'Financial results'}, {number:2,text:'Financial results (continued)'}]);
  const rows = renderTablesMarkdown(merged).split('\n').filter(line => line.startsWith('| Acme |'));
  expect(rows).toHaveLength(2);
});
