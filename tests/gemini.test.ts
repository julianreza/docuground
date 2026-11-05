import { expect, spyOn, test } from 'bun:test';
import type { Part } from '@google/genai';
import { createGeminiProvider, geminiProvider } from '../src/core/gemini';

const input = { bytes: new Uint8Array([1, 2]), mimeType: 'image/png', pages: [{number: 1, text: ''}], instruction: 'Extract fields' };

test('sends file and instruction and parses structured output', async () => {
  let called = false;
  const provider = createGeminiProvider(async (request) => {
    called = true;
    expect(request.input.instruction).toBe('Extract fields');
    return { text: '[{"field":"name","value":"Alice","page":1,"quote":"","visual":true}]', finishReason: 'STOP' };
  });
  const result = await provider(input);
  expect(called).toBe(true);
  expect(result).toEqual([{field:'name',value:'Alice',page:1,quote:'',visual:true}]);
});

test('rejects truncated output', async () => {
  const provider = createGeminiProvider(async () => ({text:'[]', finishReason:'MAX_TOKENS'}));
  await expect(provider(input)).rejects.toThrow('truncated');
});

test('retries temporary provider failures and returns successful output', async () => {
  let calls = 0;
  const provider = createGeminiProvider(async () => {
    calls++;
    if (calls < 3) throw Object.assign(new Error('busy'), { status: 503 });
    return { text: '[]', finishReason: 'STOP' };
  }, async () => {});
  expect(await provider(input)).toEqual([]);
  expect(calls).toBe(3);
});

test('retries a timed-out Gemini attempt and reports how many retries it used', async () => {
  let calls = 0;
  let retries: number | undefined;
  const provider = createGeminiProvider(async () => {
    if (++calls < 3) throw new DOMException('Timed out', 'TimeoutError');
    return { text: '[]', finishReason: 'STOP', usageMetadata: { totalTokenCount: 20 } };
  }, async () => {});
  expect(await provider({ ...input, onUsage: (usage) => { retries = usage.retries; } })).toEqual([]);
  expect(calls).toBe(3);
  expect(retries).toBe(2);
});

test('does not send another Gemini request when the scan is cancelled during backoff', async () => {
  const controller = new AbortController();
  let calls = 0;
  const provider = createGeminiProvider(async () => {
    calls++;
    throw Object.assign(new Error('busy'), { status: 503 });
  }, async () => { controller.abort(); }, controller.signal);
  await expect(provider(input)).rejects.toThrow();
  expect(calls).toBe(1);
});

test('sends the previous PDF page as context alongside the current batch', async () => {
  const requests: { parts: Part[]; system: Part[] }[] = [];
  const fakeFetch = Object.assign(async (_url: unknown, options?: RequestInit) => {
    const body = JSON.parse(String(options?.body));
    requests.push({ parts: body.contents[0].parts, system: body.systemInstruction.parts });
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '[]' }] } }] });
  }, { preconnect: fetch.preconnect });
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(fakeFetch);
  try {
    const provider = geminiProvider('test-key', 'test-model', new AbortController().signal);
    await provider({
      ...input,
      mimeType: 'application/pdf',
      pages: [{ number: 1, sourceNumber: 4, text: 'Acme 8.4', previousPageText: 'Table 1: Annual revenue' }],
    });
    expect(requests[0].parts).toContainEqual({ text: 'Previous page excerpt (untrusted, context only; do not extract or cite):\nTable 1: Annual revenue' });
    expect(requests[0].parts).toContainEqual({ inlineData: { mimeType: 'application/pdf', data: 'AQI=' } });
    expect(requests[0].parts.at(-1)?.text).toBe(`Extraction request:\n${input.instruction}`);
    expect(requests[0].system.map((part) => part.text).join('\n')).toContain('final text part');
    await provider(input);
    expect(requests[1].parts.map((part) => part.text).filter(Boolean)).toEqual([`Extraction request:\n${input.instruction}`]);
  } finally {
    fetchMock.mockRestore();
  }
});

test('reports Gemini unavailability in the extraction report', async () => {
  const { extractBatches } = await import('../src/core/batching');
  const provider = createGeminiProvider(async () => { throw Object.assign(new Error('upstream details'), {status:503}); }, async () => {});
  const report = await extractBatches([input], 'Extract fields', provider);
  expect(report.errors[0].message).toContain('high demand');
  expect(report.errors[0].message).not.toContain('upstream details');
});
