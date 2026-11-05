import { expect, test } from 'bun:test';
import { PDFDocument } from 'pdf-lib';
import { POST } from '../app/api/extract/route';
import type { BatchProgress } from '../src/core/batching';
import { readEventStream } from '../src/core/stream';

test('uses the ScaleDown recommendation for initial workers and falls back to three', async () => {
  const originalFetch = globalThis.fetch;
  const settings = {
    NINEROUTER_BASE_URL: 'http://router/v1',
    NINEROUTER_MODEL: 'vision',
    NINEROUTER_API_KEY: 'test',
    SCALEDOWN_ENABLED: 'true',
    SCALEDOWN_API_KEY: 'test',
  };
  const saved = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  Object.assign(process.env, settings);

  let recommendation = 'workers_4';
  globalThis.fetch = Object.assign(async (url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith('/classify')) {
      if (body.labels[0].name === 'workers_3') {
        expect(body.labels.map((label: { name: string }) => label.name)).toEqual(
          ['workers_3', 'workers_4', 'workers_5'],
        );
        return Response.json({ top_label: recommendation });
      }
      return Response.json({ top_label: 'document_extraction', scores: { document_extraction: 1 } });
    }
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"items":[]}' } }] });
  }, { preconnect: originalFetch.preconnect }) as typeof fetch;

  try {
    const pdf = await PDFDocument.create();
    for (let index = 0; index < 5; index++) pdf.addPage([100, 100]);
    const file = new File([new Uint8Array(await pdf.save())], 'fixture.pdf');
    for (const scenario of [
      { label: 'workers_4', enabled: true, count: 4, status: 'completed' },
      { label: 'workers_7', enabled: true, count: 3, status: 'failed' },
      { label: 'workers_4', enabled: false, count: 3, status: undefined },
    ] as const) {
      recommendation = scenario.label;
      const form = new FormData();
      form.set('file', file);
      form.set('instruction', 'Extract');
      form.set('provider', '9router');
      form.set('cdm', scenario.enabled ? '1' : '0');
      form.set('stream', '1');
      const response = await POST(new Request('http://localhost/api/extract', { method: 'POST', body: form }));
      expect(response.status).toBe(200);
      const events: BatchProgress[] = [];
      await readEventStream(response.body!, (message) => {
        const event = message as { type: string; progress?: BatchProgress };
        if (event.type === 'progress' && event.progress) events.push(event.progress);
      });
      const decision = events.find((event) => event.phase === 'plan' && event.type !== 'started');
      expect(decision?.type).toBe(scenario.status);
      if (decision) expect(decision.workerCount).toBe(scenario.count);
      const workerEvents = events.filter((event) => event.workerId > 0);
      const firstFinished = workerEvents.findIndex((event) => event.type === 'completed');
      expect(workerEvents.slice(0, firstFinished).map((event) => event.workerId)).toEqual(
        Array.from({ length: scenario.count }, (_, index) => index + 1),
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('routes selected 9Router requests and includes provider metadata', async () => {
  const originalFetch = globalThis.fetch;
  const saved = {base:process.env.NINEROUTER_BASE_URL,model:process.env.NINEROUTER_MODEL,key:process.env.NINEROUTER_API_KEY};
  process.env.NINEROUTER_BASE_URL='http://router/v1';process.env.NINEROUTER_MODEL='vision';process.env.NINEROUTER_API_KEY='test';
  const imagesPerRequest: number[] = [];
  globalThis.fetch = Object.assign(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    imagesPerRequest.push(body.messages[1].content.filter((part: {type: string}) => part.type === 'image_url').length);
    return Response.json({choices:[{finish_reason:'stop',message:{content:'```json\n{"items":[{"field":"example","value":"1","page":1,"quote":"","visual":true}]}\n```'}}]});
  }, {preconnect:originalFetch.preconnect}) as typeof fetch;
  try {
    const pdf = await PDFDocument.create();
    pdf.addPage([100, 100]);
    pdf.addPage([100, 100]);
    const form = new FormData();form.append('file',new File([new Uint8Array(await pdf.save())],'fixture.pdf'));form.append('instruction','Extract');form.append('provider','9router');
    const response = await POST(new Request('http://localhost/api/extract',{method:'POST',body:form}));
    const result = await response.json();
    expect(response.status).toBe(200);expect(result.provider).toBe('9router');expect(result.model).toBe('vision');expect(result.promptVersion).toBe('docuground-9router-v8');
    expect(imagesPerRequest).toEqual([1, 1]);
    expect(result.items.map((item: {page: number}) => item.page)).toEqual([1, 2]);
  } finally {
    globalThis.fetch=originalFetch;
    for(const [name,value] of Object.entries({NINEROUTER_BASE_URL:saved.base,NINEROUTER_MODEL:saved.model,NINEROUTER_API_KEY:saved.key})) if(value === undefined) delete process.env[name]; else process.env[name]=value;
  }
});

test('default provider does not require 9Router configuration', async () => {
  const saved = {gemini:process.env.GEMINI_API_KEY,base:process.env.NINEROUTER_BASE_URL,model:process.env.NINEROUTER_MODEL};
  delete process.env.GEMINI_API_KEY; delete process.env.NINEROUTER_BASE_URL; delete process.env.NINEROUTER_MODEL;
  try {
    const form = new FormData();
    form.append('file',new File([new Uint8Array([137,80,78,71,13,10,26,10])],'fixture.png'));
    form.append('instruction','Extract');
    const response = await POST(new Request('http://localhost/api/extract',{method:'POST',body:form}));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain('GEMINI_API_KEY');
  } finally {
    for(const [name,value] of Object.entries({GEMINI_API_KEY:saved.gemini,NINEROUTER_BASE_URL:saved.base,NINEROUTER_MODEL:saved.model})) if(value === undefined) delete process.env[name]; else process.env[name]=value;
  }
});
