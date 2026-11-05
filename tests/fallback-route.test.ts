import { expect, test } from 'bun:test';
import { PDFDocument } from 'pdf-lib';
import { POST } from '../app/api/extract/route';
import { readEventStream } from '../src/core/stream';
import { renderReportMarkdown, type Report } from '../src/core/markdown';

const settings = {
  GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'test-gemini',
  NINEROUTER_BASE_URL: 'http://router/v1', NINEROUTER_MODEL: 'test-router',
};

async function withProviders(request: typeof fetch, run: () => Promise<void>) {
  const original = globalThis.fetch;
  const saved = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  Object.assign(process.env, settings);
  globalThis.fetch = request;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

const geminiResult = () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '[]' }] } }] });
const routerResult = () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"items":[]}' } }] });

test('switches Gemini PDF batches to 9Router and preserves pages already processed', async () => {
  let routerCalls = 0;
  const request = Object.assign(async (url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).startsWith(settings.NINEROUTER_BASE_URL)) {
      routerCalls++;
      expect(body.messages[1].content.filter((part: { type: string }) => part.type === 'image_url')).toHaveLength(1);
      return routerResult();
    }
    const pdf = await PDFDocument.load(Buffer.from(body.contents[0].parts[0].inlineData.data, 'base64'));
    return pdf.getPage(0).getWidth() === 100 ? geminiResult() : Response.json({ error: { message: 'Credits depleted' } }, { status: 402 });
  }, { preconnect: fetch.preconnect });

  await withProviders(request, async () => {
    const pdf = await PDFDocument.create();
    for (let page = 0; page < 7; page++) pdf.addPage([100 + page, 100]);
    const form = new FormData();
    form.set('file', new File([new Uint8Array(await pdf.save())], 'fixture.pdf'));
    form.set('instruction', 'Extract fields');
    form.set('stream', '1');
    const response = await POST(new Request('http://localhost/api/extract', { method: 'POST', body: form }));
    expect(response.status).toBe(200);
    const events: { type: string; progress?: { type: string }; report?: Report }[] = [];
    await readEventStream(response.body!, (event) => events.push(event as typeof events[number]));
    expect(events.filter((event) => event.progress?.type === 'fallback')).toHaveLength(1);
    const report = events.find((event) => event.type === 'result')?.report;
    expect(report).toMatchObject({
      status: 'complete', provider: 'gemini', processedPages: [1, 2, 3, 4, 5, 6, 7], failedPages: [],
      fallback: { provider: '9router', model: 'test-router', processedPages: [4, 5, 6, 7] },
    });
    expect(renderReportMarkdown(report!)).toContain('Pages processed by fallback: 4, 5, 6, 7');
    expect(routerCalls).toBe(4);
  });
});

test.each([
  { name: 'stops after both providers run out of credits', routerStatus: 402, routerAttempts: 1, geminiStatus: 402, status: 'failed' },
  { name: 'switches to Gemini after the 9Router rate limit persists', routerStatus: 429, routerAttempts: 3, geminiStatus: 200, status: 'complete' },
  { name: 'keeps the 9Router authentication error without switching', routerStatus: 401, routerAttempts: 1, geminiStatus: null, status: 'failed' },
])('$name', async ({ routerStatus, routerAttempts, geminiStatus, status }) => {
  let routerCalls = 0;
  let geminiCalls = 0;
  const request = Object.assign(async (url: unknown) => {
    if (String(url).startsWith(settings.NINEROUTER_BASE_URL)) {
      routerCalls++;
      return Response.json({ error: { message: 'Router error' } }, { status: routerStatus });
    }
    geminiCalls++;
    return geminiStatus === 200 ? geminiResult() : Response.json({ error: { message: 'Credits depleted' } }, { status: 402 });
  }, { preconnect: fetch.preconnect });

  await withProviders(request, async () => {
    const form = new FormData();
    form.set('file', new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'fixture.png'));
    form.set('instruction', 'Extract fields');
    form.set('provider', '9router');
    const response = await POST(new Request('http://localhost/api/extract', { method: 'POST', body: form }));
    const report: Report = await response.json();
    expect(report.status).toBe(status);
    expect(report.failedPages).toEqual(status === 'failed' ? [1] : []);
    if (geminiStatus) expect(report.fallback).toMatchObject({ provider: 'gemini', processedPages: status === 'complete' ? [1] : [] });
    else expect(report.fallback).toBeUndefined();
    expect(routerCalls).toBe(routerAttempts);
    expect(geminiCalls).toBe(geminiStatus ? 1 : 0);
  });
});
