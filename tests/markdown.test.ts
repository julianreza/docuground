import { expect, test } from 'bun:test';
import { renderReportMarkdown } from '../src/core/markdown';

test('exports visual coordinates and strips control characters', () => {
  const result = renderReportMarkdown({mode:'live',status:'complete',sourceName:'form.jpg',sourceHash:'h',processedPages:[1],failedPages:[],skippedPages:[],items:[{field:'Amount',value:'10',page:1,quote:'Amount\u0010 10',visual:true,region:[0.1,0.2,0.8,0.3],reasonCode:'VISUAL_REGION_MISMATCH',evidenceStatus:'needs_review'}]});
  expect(result).toContain('Region: 0.1, 0.2, 0.8, 0.3');
  expect(result).toContain('VISUAL\\_REGION\\_MISMATCH');
  expect(result).not.toContain('\u0010');
});

test('exports field states, coverage, and review labels without exposing rejected values', () => {
  const result = renderReportMarkdown({mode:'demo',status:'partial',sourceName:'fixture.pdf',sourceHash:'abc',processedPages:[1],failedPages:[],skippedPages:[2],items:[
    {field:'Blank field',value:null,valueState:'blank',page:1,quote:'',evidenceStatus:'needs_review'},
    {field:'Checkbox',value:false,valueState:'observed',page:1,quote:'',evidenceStatus:'needs_review'},
    {field:'Invalid',value:'secret rejected value',page:9,quote:'',evidenceStatus:'rejected',reasonCode:'PAGE_NOT_PROVIDED'},
  ]});
  expect(result).toContain('\\[BLANK\\]');
  expect(result).toContain('Not selected');
  expect(result).toContain('needs\\_review');
  expect(result).toContain('Skipped pages: 2');
  expect(result).not.toContain('secret rejected value');
});

test('escapes model-controlled markdown syntax', () => {
  const result = renderReportMarkdown({mode:'live',status:'complete',sourceName:'a.pdf',sourceHash:'h',processedPages:[1],failedPages:[],skippedPages:[],items:[{field:'[x](https://example.com)',value:'<tag> | value',page:1,quote:'quote',evidenceStatus:'needs_review'}]});
  expect(result).toContain('\\[x\\]\\(https://example\\.com\\)');
  expect(result).toContain('\\<tag\\> \\| value');
});

test('summarizes review items and preserves table context without empty quotes', () => {
  const result = renderReportMarkdown({mode:'live',status:'complete',sourceName:'form.pdf',sourceHash:'hash',pageCount:2,processedPages:[1,2],failedPages:[],skippedPages:[],items:[
    {field:'Group 1 - Standard',value:true,page:1,quote:'[X]',evidenceStatus:'needs_review',tableTitle:'Checkboxes',rowLabel:'Standard',columnPath:'Mark',rowId:'group-1'},
    {field:'Group 2 - Standard',value:false,page:1,quote:'',evidenceStatus:'needs_review',tableTitle:'Checkboxes',rowLabel:'Standard',columnPath:'Mark',rowId:'group-2'},
  ]});
  expect(result).toContain('Processed pages: 2 / 2');
  expect(result).toContain('Needs review: 2');
  expect(result).toContain('Row ID: group-1');
  expect(result).toContain('Row ID: group-2');
  expect(result).toContain('Column: Mark');
  expect(result).not.toContain('\n> \n');
  expect(result.match(/### Group/g)).toHaveLength(2);
});

test('renders extracted tables GFM, context fields, and runtime telemetry', () => {
  const result = renderReportMarkdown({
    mode: 'live',
    status: 'complete',
    sourceName: 'stats.pdf',
    sourceHash: 'sha123',
    durationMs: 3200,
    usage: { inputTokens: 1200, outputTokens: 300, totalTokens: 1500, retries: 0 },
    apiCalls: 2,
    processedPages: [1],
    failedPages: [],
    skippedPages: [],
    tables: [{
      title: 'Metrics Table',
      page: 1,
      pages: [1],
      cells: [
        { field: 'Accuracy', quote: '95%', tableTitle: 'Metrics Table', rowLabel: 'Accuracy', columnPath: 'Metric', page: 1, evidenceStatus: 'source_located', value: 'Accuracy' },
        { field: 'Accuracy', quote: '95%', tableTitle: 'Metrics Table', rowLabel: 'Accuracy', columnPath: 'Value', page: 1, evidenceStatus: 'source_located', value: '95%' },
      ],
    }],
    items: [{
      field: 'Revenue',
      value: '100M',
      page: 1,
      quote: 'Revenue was 100M USD.',
      evidenceStatus: 'source_located',
      unit: 'USD',
      entity: 'Acme Corp',
      period: 'FY2024',
      chartTitle: 'Annual Growth',
      series: 'North America',
    }],
  });
  expect(result).toContain('## Extracted tables');
  expect(result).toContain('| Metric | Value |');
  expect(result).toContain('Accuracy');
  expect(result).toContain('- Unit: USD');
  expect(result).toContain('- Entity: Acme Corp');
  expect(result).toContain('- Period: FY2024');
  expect(result).toContain('- Chart: Annual Growth');
  expect(result).toContain('- Series: North America');
  expect(result).toContain('- Runtime: 3200 ms');
  expect(result).toContain('- Total tokens: 1500');
  expect(result).toContain('- Token breakdown: 1200 input / 300 output');
  expect(result).toContain('- API calls: 2');
});
