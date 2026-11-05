import { createHash } from 'node:crypto';
import { capabilities } from '@/src/core/config';
import { ScaleDown } from '@/src/core/scaledown';
import { DEFAULT_WORKER_COUNT, extractBatches, splitPdf, type BatchProgress } from '@/src/core/batching';
import { validateInstructionScope, type Provider } from '@/src/core/extract';
import { geminiProvider, PROMPT_VERSION } from '@/src/core/gemini';
import { parsePdf } from '@/src/core/pdf';
import { detectFileType } from '@/src/core/upload';
import { demoProvider, findDemoFixture } from '@/src/core/demo';
import { groupTables, mergeTableFragments } from '@/src/core/tables';
import { nineRouterProvider, NINEROUTER_PROMPT_VERSION, DEEPSEEK_PROMPT_VERSION } from '@/src/core/ninerouter';
import { applyVisualLocations } from '@/src/core/visual-evidence';

export async function POST(request: Request) {
  const maxBytes = 25 * 1024 * 1024;
  const length = Number(request.headers.get('content-length') || 0);
  if (length > maxBytes + 65536) return Response.json({ error: 'File exceeds 25 MB.' }, { status: 413 });
  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: 'Invalid upload.' }, { status: 400 });
  const file = form.get('file');
  const instruction = form.get('instruction');
  if (!(file instanceof File) || file.size === 0 || file.size > maxBytes || typeof instruction !== 'string' || !instruction.trim() || instruction.length > 4000) {
    return Response.json({ error: 'Select a file up to 25 MB and enter an instruction up to 4000 characters.' }, { status: 400 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const scope = validateInstructionScope(instruction);
  if (!scope.supported) {
    return Response.json({ code: 'UNSUPPORTED_INSTRUCTION', error: scope.reason }, { status: 422 });
  }
  const mimeType = detectFileType(bytes);
  if (!mimeType) return Response.json({ error: 'Only PDF, PNG and JPEG files are supported.' }, { status: 400 });
  const mode = form.get('mode') === 'demo' ? 'demo' : 'live';
  const providerName = form.get('provider') || 'gemini';
  if (providerName !== 'gemini' && providerName !== '9router' && providerName !== 'deepseek') return Response.json({ error: 'Unknown provider.' }, { status: 400 });
  const sourceHash = createHash('sha256').update(bytes).digest('hex');
  const demoFixture = mode === 'demo' ? findDemoFixture(sourceHash, instruction) : null;
  if (mode === 'demo' && !demoFixture) return Response.json({ error: 'Demo requires the matching benchmark fixture and preset instruction.' }, { status: 400 });
  const configured = capabilities();
  if (mode === 'live' && providerName === 'deepseek' && !configured.deepSeek) return Response.json({ error: 'DEEPSEEK_API_KEY is not configured.' }, { status: 503 });
  if (mode === 'live' && providerName === 'gemini' && !configured.gemini) return Response.json({ error: 'GEMINI_API_KEY is not configured.' }, { status: 503 });
  if (mode === 'live' && providerName === '9router' && !configured.nineRouter) return Response.json({ error: 'Configure NINEROUTER_BASE_URL ending in /v1 and NINEROUTER_MODEL.' }, { status: 503 });
  const useCdm = mode === 'live' && form.get('cdm') === '1';
  if (useCdm && !configured.scaleDown) return Response.json({ error: 'ScaleDown is not configured.' }, { status: 503 });
  const startedAt = Date.now();
  try {
    const pages = mimeType === 'application/pdf' ? await parsePdf(bytes) : [{ number: 1, text: '' }];
    if (pages.length > 100) return Response.json({ error: 'PDF exceeds 100 pages.' }, { status: 400 });
    const cancelled = new AbortController();
    const timeoutSignal = AbortSignal.any([request.signal, cancelled.signal, AbortSignal.timeout(mode === 'live' && providerName !== 'gemini' ? 360000 : 240000)]);
    const liveNineRouter = mode === 'live' && providerName === '9router';
    const replayProvider: Provider = async (input) => {
      if (form.get('stream') === '1') {
        await new Promise<void>((resolve, reject) => {
          if (timeoutSignal.aborted) { reject(timeoutSignal.reason); return; }
          const timer = setTimeout(() => { timeoutSignal.removeEventListener('abort', abort); resolve(); }, 1400);
          function abort() { clearTimeout(timer); reject(timeoutSignal.reason); }
          timeoutSignal.addEventListener('abort', abort, { once: true });
        });
      }
      return demoProvider(input);
    };
    const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
    const routerModel = process.env.NINEROUTER_MODEL!;
    const makeGemini = () => geminiProvider(process.env.GEMINI_API_KEY!, geminiModel, timeoutSignal);
    const makeRouter = () => nineRouterProvider(process.env.NINEROUTER_BASE_URL!, routerModel, process.env.NINEROUTER_API_KEY || '', timeoutSignal);
    const makeDeepSeek = () => nineRouterProvider('https://api.deepseek.com', 'deepseek-flash', process.env.DEEPSEEK_API_KEY!, timeoutSignal, fetch, true);
    const provider = mode === 'demo' ? replayProvider : providerName === 'deepseek' ? makeDeepSeek() : liveNineRouter ? makeRouter() : makeGemini();
    const fallbackName = providerName === 'deepseek' ? (configured.gemini ? 'gemini' : '9router') : liveNineRouter ? 'gemini' : '9router';
    const hasFallback = providerName === 'deepseek' ? configured.gemini || configured.nineRouter : configured.gemini && configured.nineRouter;
    const fallback = mode === 'live' && form.get('fallback') !== '0' && hasFallback
      ? { name: fallbackName, provider: fallbackName === 'gemini' ? makeGemini() : makeRouter() } as const
      : undefined;
    const timeoutMs = provider.capabilities?.timeoutMs ?? (liveNineRouter ? 360000 : 240000);
    const defaultBatchSize = provider.capabilities?.defaultBatchSize ?? (liveNineRouter ? 1 : 3);
    const signal = AbortSignal.any([timeoutSignal, AbortSignal.timeout(timeoutMs)]);
    const batches = mimeType === 'application/pdf' ? await splitPdf(bytes, pages, defaultBatchSize) : [{ bytes, mimeType, pages }];
    const run = async (onProgress?: (event: BatchProgress) => void) => {
      const cdm = useCdm ? new ScaleDown(process.env.SCALEDOWN_API_KEY!, signal) : null;
      if (cdm) {
        onProgress?.({ type: 'started', pages: [], workerId: 0, phase: 'classify' });
        await cdm.classify(instruction);
        onProgress?.({
          type: cdm.classification ? 'completed' : 'failed',
          pages: [], workerId: 0, phase: 'classify',
        });
      }
      let workerCount = Math.min(DEFAULT_WORKER_COUNT, batches.length);
      if (cdm && batches.length > 1 && !signal.aborted) {
        onProgress?.({ type: 'started', pages: [], workerId: 0, phase: 'plan' });
        const recommendation = await cdm.recommendWorkers({
          batchCount: batches.length,
          batchSize: defaultBatchSize,
          bytes: bytes.length,
          provider: providerName,
        });
        workerCount = recommendation ?? workerCount;
        onProgress?.({
          type: recommendation === null ? 'failed' : 'completed',
          pages: [], workerId: 0, phase: 'plan', workerCount,
        });
      }
      const { fallbackPages, ...report } = await extractBatches(mode === 'demo' ? batches.slice(0, 1) : batches, instruction, provider, signal, onProgress, workerCount, fallback);
      if (mode === 'live' && mimeType !== 'application/pdf' && !fallbackPages && provider.locateEvidence && report.items.some((item) => item.visual && item.evidenceStatus !== 'rejected')) {
        report.apiCalls++;
        report.httpAttempts++;
        try {
          const localized = await provider.locateEvidence(batches[0], report.items, AbortSignal.any([signal, AbortSignal.timeout(30000)]));
          report.items = applyVisualLocations(report.items, localized.locations);
          if (localized.usage && report.usage) {
            const usage = report.usage;
            report.usage = { ...usage, inputTokens: usage.inputTokens + localized.usage.inputTokens, outputTokens: usage.outputTokens + localized.usage.outputTokens, totalTokens: usage.totalTokens + localized.usage.totalTokens, apiCalls: report.apiCalls };
          } else report.usage = undefined;
        } catch {
          signal.throwIfAborted();
          report.usage = undefined;
          report.items = report.items.map((item) => item.visual && item.evidenceStatus !== 'rejected' ? { ...item, reasonCode: 'VISUAL_LOCALIZATION_UNAVAILABLE' } : item);
        }
      }
      if (demoFixture) {
        report.processedPages = [demoFixture.sourcePage];
        report.skippedPages = pages.filter((page) => page.number !== demoFixture.sourcePage).map((page) => page.number);
        report.status = report.skippedPages.length ? 'partial' : report.status;
      }
      if (cdm && mimeType === 'application/pdf') {
        let started = false;
        await cdm.suggest(report.items, pages, () => {
          started = true;
          onProgress?.({ type: 'started', pages: [], workerId: 0, phase: 'suggest' });
        });
        if (started) onProgress?.({ type: 'completed', pages: [], workerId: 0, phase: 'suggest' });
      }
      const durationMs = Date.now() - startedAt;
      const fallbackInfo = fallbackPages && {
        provider: fallbackName,
        model: fallbackName === 'gemini' ? geminiModel : routerModel,
        promptVersion: fallbackName === 'gemini' ? PROMPT_VERSION : NINEROUTER_PROMPT_VERSION,
        processedPages: fallbackPages,
      };
      return { ...report, fallback: fallbackInfo, ...(cdm ? { cdm: cdm.metadata() } : {}), durationMs, tables: mergeTableFragments(groupTables(report.items), pages), mode, provider: mode === 'demo' ? 'demo' : providerName, instruction, model: mode === 'demo' ? null : providerName === 'deepseek' ? 'deepseek-flash' : liveNineRouter ? routerModel : geminiModel, promptVersion: mode === 'demo' ? null : providerName === 'deepseek' ? DEEPSEEK_PROMPT_VERSION : liveNineRouter ? NINEROUTER_PROMPT_VERSION : PROMPT_VERSION, pageCount: pages.length, sourceName: file.name, sourceHash };
    };
    if (form.get('stream') !== '1') return Response.json(await run());
    let closed = false;
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const send = (event: unknown) => { if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); };
        const heartbeat = setInterval(() => send({ type: 'heartbeat' }), 10000);
        void run((progress) => send({ type: 'progress', progress })).then(
          (report) => send({ type: 'result', report }),
          () => send({ type: 'error', message: 'Extraction failed. Check the document, provider configuration, and quota.' }),
        ).finally(() => { clearInterval(heartbeat); if (!closed) { closed = true; controller.close(); } });
      },
      cancel() { closed = true; cancelled.abort(); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' } });
  } catch (error) {
    const failure = error as { name?: string; status?: number };
    console.error('Extraction failed', { name: failure.name, status: failure.status });
    return Response.json({ error: 'Extraction failed. Check the document, provider configuration, and quota.' }, { status: 502 });
  }
}
