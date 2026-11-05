import { expect, test } from 'bun:test';
import { extractBatches } from '../src/core/batching';

const pages = [1, 2, 3, 4].map(number => ({number, text: `Page ${number} value ${number}`}));
const batches = [
  { mimeType: 'application/pdf', bytes: new Uint8Array([1]), pages: pages.slice(0, 3) },
  { mimeType: 'application/pdf', bytes: new Uint8Array([2]), pages: pages.slice(3) },
];

test('reduces new concurrent requests after a rate limit', async () => {
  const work = Array.from({ length: 6 }, (_, index) => ({
    mimeType: 'image/png', bytes: new Uint8Array([index]), pages: [{ number: index + 1, text: '' }],
  }));
  let running = 0;
  const starts: number[] = [];
  let releaseFirst!: () => void;
  const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const result = extractBatches(work, 'Extract', async (input) => {
    running++;
    starts.push(running);
    if (input.bytes[0] === 0) {
      input.onRateLimit?.();
      input.onRateLimit?.();
      await gate;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
    running--;
    return [];
  }, undefined, undefined, 3);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(starts).toEqual([1]);
  releaseFirst();
  expect((await result).processedPages).toEqual([1, 2, 3, 4, 5, 6]);
  expect(Math.max(...starts)).toBe(1);
});

test('maps local source page numbers to original page numbers', async () => {
  const report = await extractBatches(batches, 'Find values', async () => [{field: 'value', value: 'value 4', page: 1, quote: 'Page 4 value 4', visual: false}]);
  expect(report.items[1].page).toBe(4);
  expect(report.items[1].evidenceStatus).toBe('source_located');
  expect(report.processedPages).toEqual([1,2,3,4]);
});

test('returns partial coverage when a batch fails', async () => {
  const report = await extractBatches(batches, 'Find values', async input => {
    if (input.bytes[0] === 2) throw new Error('failed');
    return [];
  });
  expect(report.status).toBe('partial');
  expect(report.processedPages).toEqual([1,2,3]);
  expect(report.failedPages).toEqual([4]);
});

test('rejects page citations outside their batch', async () => {
  const report = await extractBatches([batches[1]], 'Find values', async () => [{field:'x',value:'4',page:4,quote:'Page 4 value 4',visual:false}]);
  expect(report.items[0].evidenceStatus).toBe('rejected');
  expect(report.status).toBe('partial');
});

test('splits the 18-page fixture into six independently readable windows', async () => {
  const { readFile } = await import('node:fs/promises');
  const { parsePdf } = await import('../src/core/pdf');
  const { splitPdf } = await import('../src/core/batching');
  const bytes = await readFile('samples/inputs/Gemini Benchmark Test Suite (1).pdf');
  const original = await parsePdf(bytes);
  const result = await splitPdf(bytes, original);
  expect(result).toHaveLength(6);
  expect(result.map(batch => batch.pages.map(page => page.number))).toEqual([[1,2,3],[4,5,6],[7,8,9],[10,11,12],[13,14,15],[16,17,18]]);
  const last = await parsePdf(result[5].bytes);
  expect(last[2].text).toContain('AUD-541');
});

test('reports unattempted pages as skipped after cancellation', async () => {
  const controller = new AbortController();
  const report = await extractBatches(batches, 'Find values', async () => {
    controller.abort();
    return [];
  }, controller.signal);
  expect(report.processedPages).toEqual([1,2,3]);
  expect(report.skippedPages).toEqual([4]);
  expect(report.status).toBe('partial');
});

test('reports failed when every batch fails', async () => {
  const report = await extractBatches(batches, 'Find values', async () => { throw new Error('provider error'); });
  expect(report.status).toBe('failed');
  expect(report.failedPages).toEqual([1,2,3,4]);
});

test('splits truncated windows and preserves page numbers after the first window', async () => {
  const { readFile } = await import('node:fs/promises');
  const { parsePdf } = await import('../src/core/pdf');
  const { splitPdf } = await import('../src/core/batching');
  const { TruncatedResponseError } = await import('../src/core/gemini');
  const bytes = await readFile('samples/inputs/Gemini Benchmark Test Suite (1).pdf');
  const windows = await splitPdf(bytes, await parsePdf(bytes));
  const calls: number[] = [];
  const report = await extractBatches([windows[1]], 'Extract', async (input) => {
    calls.push(input.pages.length);
    if (input.pages.length > 1) throw new TruncatedResponseError();
    return [];
  });
  expect(calls).toEqual([3, 2, 1, 1, 1]);
  expect(report.processedPages).toEqual([4, 5, 6]);
  expect(report.status).toBe('complete');
});

test('removes duplicate located claims while retaining distinct sources', async () => {
  const repeat = { mimeType:'application/pdf', bytes:new Uint8Array([1]), pages:[{number:1,text:'Revenue: 10 USD'}] };
  const other = { mimeType:'application/pdf', bytes:new Uint8Array([2]), pages:[{number:2,text:'Revenue: 10 USD'}] };
  const report = await extractBatches([repeat, repeat, other], 'Extract', async () => [
    { field:'Revenue', value:'10 USD', page:1, quote:'Revenue: 10 USD', visual:false },
  ]);
  expect(report.items.map(item => item.page)).toEqual([1,2]);
});

test('keeps ambiguous duplicate claims for human review', async () => {
  const page = { mimeType:'image/png', bytes:new Uint8Array([1]), pages:[{number:1,text:''}] };
  const report = await extractBatches([page], 'Extract', async () => [
    { field:'checkbox', value:'selected', page:1, quote:'', visual:true },
    { field:'checkbox', value:'selected', page:1, quote:'', visual:true },
  ]);
  expect(report.items).toHaveLength(2);
});

test('does not collapse distinct table columns that share a source quote and value', async () => {
  const batch = {mimeType:'application/pdf',bytes:new Uint8Array([1]),pages:[{number:1,text:'Acme 10'}]};
  const report = await extractBatches([batch], 'Extract', async () => [
    {field:'Revenue',value:'10',page:1,quote:'Acme 10',visual:false,tableTitle:'Results',rowLabel:'Acme',rowId:'row1',columnPath:'2023'},
    {field:'Revenue',value:'10',page:1,quote:'Acme 10',visual:false,tableTitle:'Results',rowLabel:'Acme',rowId:'row1',columnPath:'2024'},
  ]);
  expect(report.items).toHaveLength(2);
});

test('reports page progress for each batch without exposing content', async () => {
  const events: unknown[] = [];
  const report = await extractBatches(batches, 'Find', async () => [], undefined, (event) => events.push(event));
  expect(report.status).toBe('complete');
  expect(events).toEqual([
    {type:'started',pages:[1,2,3],workerId:1}, {type:'started',pages:[4],workerId:2},
    {type:'completed',pages:[1,2,3],workerId:1}, {type:'completed',pages:[4],workerId:2},
  ]);
});
