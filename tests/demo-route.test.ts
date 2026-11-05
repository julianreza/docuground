import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { POST } from '../app/api/extract/route';
import { DEMO_INSTRUCTION } from '../src/core/demo';

test('replays the fixed benchmark demo without provider credentials', async () => {
  const bytes = await readFile('samples/inputs/Gemini Benchmark Test Suite (1).pdf');
  const form = new FormData();
  form.append('file', new File([bytes], 'fixture.pdf', { type: 'application/pdf' }));
  form.append('instruction', DEMO_INSTRUCTION);
  form.append('mode', 'demo');
  const originalKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  let response: Response;
  try {
    response = await POST(new Request('http://localhost/api/extract', { method: 'POST', body: form }));
  } finally {
    if (originalKey !== undefined) process.env.GEMINI_API_KEY = originalKey;
  }
  const result = await response.json();
  expect(response.status).toBe(200);
  expect(result.mode).toBe('demo');
  expect(result.items).toHaveLength(4);
  expect(result.processedPages).toEqual([1]);
  expect(result.skippedPages).toHaveLength(17);
  expect(result.status).toBe('partial');
});

test('records the correct source page for chart replay and supports the derived form image', async () => {
  const { DEMO_PRESETS } = await import('../src/core/demo');
  for (const [path, preset, expectedPages, skipped] of [
    ['samples/inputs/Gemini Benchmark Test Suite (1).pdf', DEMO_PRESETS[1], [2], 17],
    ['samples/inputs/benchmark-form.png', DEMO_PRESETS[3], [1], 0],
  ] as const) {
    const form = new FormData();
    form.append('file', new File([await readFile(path)], path));
    form.append('instruction', preset.instruction);
    form.append('mode', 'demo');
    const response = await POST(new Request('http://localhost/api/extract', {method:'POST',body:form}));
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.processedPages).toEqual(expectedPages);
    expect(result.skippedPages).toHaveLength(skipped);
    expect(result.items.length).toBeGreaterThan(0);
  }
});

test('streams progress and the final recorded result when requested', async () => {
  const form = new FormData();
  form.append('file', new File([await readFile('samples/inputs/Gemini Benchmark Test Suite (1).pdf')], 'fixture.pdf'));
  form.append('instruction', DEMO_INSTRUCTION);
  form.append('mode', 'demo');
  form.append('stream', '1');
  const response = await POST(new Request('http://localhost/api/extract', {method:'POST',body:form}));
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  const events = (await response.text()).split('\n\n').filter(Boolean).map(line => JSON.parse(line.slice(6)));
  expect(events.some(event => event.type === 'progress' && event.progress.type === 'started')).toBe(true);
  const result = events.find(event => event.type === 'result');
  expect(result.report.mode).toBe('demo');
  expect(result.report.items).toHaveLength(4);
});
