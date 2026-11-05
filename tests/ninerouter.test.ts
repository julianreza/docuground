import { expect, test } from 'bun:test';
import { nineRouterProvider } from '../src/core/ninerouter';

const input = { bytes:new Uint8Array([1,2]), mimeType:'image/png', pages:[{number:1,text:''}], instruction:'Extract' };

test('passes the preceding PDF page caption as context for a later single-page batch', async () => {
  const { readFile } = await import('node:fs/promises');
  const { parsePdf } = await import('../src/core/pdf');
  const { splitPdf, extractBatches } = await import('../src/core/batching');
  const bytes = await readFile('samples/inputs/Gemini Benchmark Test Suite.pdf');
  const batches = await splitPdf(bytes, await parsePdf(bytes), 1);
  let sentContext = '';
  const response = async (_url: string, options: RequestInit) => {
    const request = JSON.parse(String(options.body));
    sentContext = request.messages[1].content.filter((part: {type:string}) => part.type === 'text').map((part: {text:string}) => part.text).join('\n');
    return Response.json({choices:[{finish_reason:'stop',message:{content:'{"items":[]}'}}]});
  };
  const provider = nineRouterProvider('http://router/v1','m','',new AbortController().signal,response);
  await extractBatches([batches[1]], 'Extract Table 1', provider);
  expect(sentContext).toContain('Table 1: Multi-Level Hierarchical Financial');
  expect(sentContext).toContain('context only');
});

test('sends the image and labeled extraction request to the configured model', async () => {
  let body!: { model:string; stream:boolean; messages:[{content:string}, {content:{type:string; text?:string; image_url?:{url:string}}[]}] };
  const fakeFetch = async (url: string, options: RequestInit) => {
    expect(String(url)).toBe('http://router:20128/v1/chat/completions');
    expect(new Headers(options?.headers).get('authorization')).toBe('Bearer test-key');
    body = JSON.parse(String(options?.body));
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({items:[]})}}]});
  };
  const provider = nineRouterProvider('http://router:20128/v1','vision-model','test-key',new AbortController().signal,fakeFetch);
  expect(await provider(input)).toEqual([]);
  expect(body.model).toBe('vision-model');
  expect(body.stream).toBe(false);
  expect(body.messages[0].content).toContain('final text part');
  expect(body.messages[0].content).toContain('{"items": []}');
  expect(body.messages[1].content[1].image_url?.url).toBe('data:image/png;base64,AQI=');
  expect(body.messages[1].content.at(-1)).toEqual({type:'text',text:`Extraction request:\n${input.instruction}`});
});

test('rejects truncated and invalid responses', async () => {
  const truncated = async () => Response.json({choices:[{finish_reason:'length',message:{content:'{}'}}]});
  await expect(nineRouterProvider('http://router/v1','m','',new AbortController().signal,truncated)(input)).rejects.toThrow('truncated');
  const invalid = async () => Response.json({choices:[{finish_reason:'stop',message:{content:'{"items":[{}]}'}}]});
  await expect(nineRouterProvider('http://router/v1','m','',new AbortController().signal,invalid)(input)).rejects.toThrow();
});

test('preserves hierarchical table headers returned as a list by 9Router', async () => {
  const { extractBatches } = await import('../src/core/batching');
  const cell = {
    field: 'Operating Revenue', value: '8.4', page: 1, quote: '8.4', visual: false,
    tableTitle: 'Table 1', rowLabel: 'Acme Corp', rowId: 'r1',
    columnPath: ['Operating Revenue (Million USD)', 'FY 2023'],
  };
  const response = async () => Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({items:[cell]})}}]});
  const provider = nineRouterProvider('http://router/v1','m','',new AbortController().signal,response);
  const report = await extractBatches([{ ...input, pages: [{ number: 2, text: 'Acme Corp 8.4' }] }], 'Extract Table 1', provider);
  expect(report.failedPages).toEqual([]);
  expect(report.items).toMatchObject([{ page: 2, value: '8.4', columnPath: 'Operating Revenue (Million USD) > FY 2023' }]);
});

test('accepts the original number for a single supplied page and rejects other pages', async () => {
  const { extractBatches } = await import('../src/core/batching');
  const cell = { field: 'Operating Revenue', value: '8.4', quote: '8.4', visual: false };
  const items = [{ ...cell, page: 2 }, { ...cell, page: 3 }];
  const response = async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ items }) } }] });
  const provider = nineRouterProvider('http://router/v1', 'm', '', new AbortController().signal, response);
  const report = await extractBatches([{ ...input, pages: [{ number: 2, text: 'Acme Corp 8.4' }] }], 'Extract Table 1', provider);
  expect(report.items).toMatchObject([
    { page: 2, evidenceStatus: 'source_located' },
    { page: 3, evidenceStatus: 'rejected', reasonCode: 'PAGE_NOT_PROVIDED' },
  ]);
});

test('reports an incomplete router response in the batch report', async () => {
  const { extractBatches } = await import('../src/core/batching');
  const incomplete = async () => Response.json({choices:[{finish_reason:'in_progress',message:{content:''}}]});
  const provider = nineRouterProvider('http://router/v1','m','',new AbortController().signal,incomplete);
  const report = await extractBatches([input], 'Extract', provider);
  expect(report.status).toBe('failed');
  expect(report.errors[0].message).toContain('incomplete or empty response');
});

test('renders PDF pages in order with their local text', async () => {
  const {readFile} = await import('node:fs/promises');
  const {parsePdf} = await import('../src/core/pdf');
  const {splitPdf} = await import('../src/core/batching');
  const bytes = await readFile('samples/inputs/Gemini Benchmark Test Suite (1).pdf');
  const batch = (await splitPdf(bytes, await parsePdf(bytes)))[1];
  const fakeFetch = async (_url:string, options:RequestInit) => {
    const payload = JSON.parse(String(options.body));
    const content = payload.messages[1].content;
    expect(content[0].text).toContain('Page 1 text');
    expect(content[2].text).toContain('Page 2 text');
    expect(content[4].text).toContain('Page 3 text');
    expect(content[1].image_url.url).toStartWith('data:image/png;base64,');
    expect(content[5].image_url.url).toStartWith('data:image/png;base64,');
    return Response.json({choices:[{finish_reason:'stop',message:{content:'{"items":[]}'}}]});
  };
  expect(await nineRouterProvider('http://router/v1','vision','',new AbortController().signal,fakeFetch)({...batch,instruction:'Extract'})).toEqual([]);
});

test('reports authentication errors without exposing the key', async () => {
  const failed = async () => new Response('',{status:401});
  await expect(nineRouterProvider('http://router/v1','m','secret',new AbortController().signal,failed)(input)).rejects.toThrow('authentication failed');
});

test('uses an abortable request signal', async () => {
  const controller = new AbortController();
  let attempts = 0;
  const fakeFetch = async (_url:string, options:RequestInit) => {
    attempts++;
    controller.abort();
    expect(options.signal?.aborted).toBe(true);
    throw new DOMException('Aborted','AbortError');
  };
  await expect(nineRouterProvider('http://router/v1','m','',controller.signal,fakeFetch)(input)).rejects.toThrow('Aborted');
  expect(attempts).toBe(1);
});

test('retries timeouts before headers and while reading the response body', async () => {
  let attempts = 0;
  const fakeFetch = async () => {
    attempts++;
    const timeout = new DOMException('Timed out', 'TimeoutError');
    if (attempts === 1) throw timeout;
    if (attempts === 2) {
      return new Response(new ReadableStream({ start(controller) { controller.error(timeout); } }));
    }
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"items":[]}' } }] });
  };
  const provider = nineRouterProvider('http://router/v1', 'm', '', new AbortController().signal, fakeFetch);
  expect(await provider(input)).toEqual([]);
  expect(attempts).toBe(3);
});

test('reports a timeout after three failed attempts', async () => {
  let attempts = 0;
  const timeout = async () => {
    attempts++;
    throw new DOMException('Timed out', 'TimeoutError');
  };
  await expect(nineRouterProvider('http://router/v1','m','',new AbortController().signal,timeout)(input)).rejects.toThrow('timed out');
  expect(attempts).toBe(3);
});
