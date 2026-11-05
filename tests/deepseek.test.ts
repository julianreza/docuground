import { expect, test } from 'bun:test';
import { nineRouterProvider } from '../src/core/ninerouter';
import { capabilities } from '../src/core/config';
import { POST } from '../app/api/extract/route';

const input = { bytes: new Uint8Array([1, 2]), mimeType: 'image/png', pages: [{ number: 1, text: '' }], instruction: 'Extract' };

test('sends an authenticated DeepSeek vision request and validates its response', async () => {
  const request = async (url: string, options: RequestInit) => {
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(new Headers(options.headers).get('authorization')).toBe('Bearer secret');
    const body = JSON.parse(String(options.body));
    expect(body.model).toBe('deepseek-flash');
    expect(body.thinking.type).toBe('disabled');
    expect(body.response_format.type).toBe('json_object');
    expect(body.messages[1].content[1].image_url.url).toBe('data:image/png;base64,AQI=');
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"items":[]}' } }] });
  };
  expect(await nineRouterProvider('https://api.deepseek.com', 'deepseek-flash', 'secret', new AbortController().signal, request, true)(input)).toEqual([]);
});

test('requires a DeepSeek key and does not reveal it on authentication failure', async () => {
  const saved = process.env.DEEPSEEK_API_KEY;
  try {
    delete process.env.DEEPSEEK_API_KEY;
    expect(capabilities().deepSeek).toBe(false);
    const form = new FormData();
    form.set('file', new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'fixture.png'));
    form.set('instruction', 'Extract');
    form.set('provider', 'deepseek');
    const response = await POST(new Request('http://localhost/api/extract', { method: 'POST', body: form }));
    expect(response.status).toBe(503);
    const provider = nineRouterProvider('https://api.deepseek.com', 'deepseek-flash', 'secret', new AbortController().signal, async () => new Response('', { status: 401 }), true);
    await expect(provider(input)).rejects.toThrow('DeepSeek authentication failed');
    try { await provider(input); } catch (error) { expect(String(error)).not.toContain('secret'); }
  } finally {
    if (saved === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = saved;
  }
});

test.each(['gemini', '9router'] as const)('DeepSeek balance failure falls back to %s', async (target) => {
  const keys = ['DEEPSEEK_API_KEY', 'GEMINI_API_KEY', 'NINEROUTER_BASE_URL', 'NINEROUTER_MODEL'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  if (target === 'gemini') process.env.GEMINI_API_KEY = 'gemini-key';
  else delete process.env.GEMINI_API_KEY;
  process.env.NINEROUTER_BASE_URL = 'http://router/v1';
  process.env.NINEROUTER_MODEL = 'vision';
  globalThis.fetch = Object.assign(async (url: unknown) => {
    if (String(url).startsWith('https://api.deepseek.com')) return new Response('', { status: 402 });
    if (target === 'gemini') return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '[]' }] } }] });
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"items":[]}' } }] });
  }, { preconnect: fetch.preconnect });
  try {
    const form = new FormData();
    form.set('file', new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'fixture.png'));
    form.set('instruction', 'Extract');
    form.set('provider', 'deepseek');
    const response = await POST(new Request('http://localhost/api/extract', { method: 'POST', body: form }));
    const report = await response.json();
    expect(report).toMatchObject({ provider: 'deepseek', model: 'deepseek-flash', status: 'complete', fallback: { provider: target, processedPages: [1] } });
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});

test('keeps uncertain DeepSeek findings for review while rejecting invalid evidence', async () => {
  const { extractBatches } = await import('../src/core/batching');
  const items = [
    { field: 'Funding Grant Identifier', value: 'omitted from this report', valueState: 'not_located', page: 1, quote: 'omitted from this report', visual: false },
    { field: 'IRB Expiration Date', value: 'omitted from this report', valueState: 'not_located', page: 1, quote: 'omitted from this report', visual: false },
    { field: 'Restricted', value: 'ambiguous mark', valueState: 'ambiguous', page: 1, quote: 'ambiguous mark', visual: true, box: [10, 20, 30, 40] },
    { field: 'Title', value: 'Title', valueState: 'observed', page: 1, quote: 'Title', visual: false },
  ];
  const request = async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ items }) } }] });
  const provider = nineRouterProvider('https://api.deepseek.com', 'deepseek-flash', 'key', new AbortController().signal, request, true);
  const batch = { ...input, pages: [{ number: 1, text: 'Title omitted from this report ambiguous mark' }] };
  const report = await extractBatches([batch], 'Extract', provider);
  expect(report.status).toBe('complete');
  expect(report.items.slice(0, 3).map(item => item.value)).toEqual([null, null, null]);
  expect(report.items.slice(0, 3).map(item => item.evidenceStatus)).toEqual(['needs_review', 'needs_review', 'needs_review']);
  expect(report.items[2]).toMatchObject({ quote: 'ambiguous mark', page: 1, box: [10, 20, 30, 40] });
  expect(report.items[3].value).toBe('Title');
  items[2].box = [40, 20, 30, 40];
  const invalid = await extractBatches([batch], 'Extract', provider);
  expect(invalid.status).toBe('partial');
  expect(invalid.items[2].reasonCode).toBe('INVALID_REGION');
});
