import { percentageFactIdentity } from './facts';
import { PDFDocument } from 'pdf-lib';
import { extractDocument, ProviderError, TruncatedResponseError, type DocumentInput, type Provider, type TokenUsage } from './extract';

export async function splitPdf(bytes: Uint8Array, pages: DocumentInput['pages'], size = 3): Promise<DocumentInput[]> {
  const source = await PDFDocument.load(bytes);
  if (source.getPageCount() !== pages.length) throw new Error('Page count mismatch');
  const batches: DocumentInput[] = [];
  for (let start = 0; start < pages.length; start += size) {
    const chunk = pages.slice(start, start + size).map((page, index) => ({
      ...page,
      previousPageText: pages[start + index - 1]?.text.slice(-600) ?? page.previousPageText,
    }));
    const pdf = await PDFDocument.create();
    const copied = await pdf.copyPages(source, chunk.map((_, index) => start + index));
    copied.forEach((page) => pdf.addPage(page));
    batches.push({ mimeType: 'application/pdf', bytes: await pdf.save(), pages: chunk });
  }
  return batches;
}

export const DEFAULT_WORKER_COUNT = 3;

type Fallback = { name: 'gemini' | '9router'; provider: Provider };

export type BatchProgress = {
  type: 'started' | 'completed' | 'failed' | 'split' | 'fallback';
  pages: number[];
  workerId: number;
  provider?: Fallback['name'];
  phase?: 'classify' | 'suggest' | 'plan';
  workerCount?: number;
};

export async function extractBatches(
  batches: DocumentInput[], instruction: string, provider: Provider,
  signal?: AbortSignal, onProgress?: (event: BatchProgress) => void,
  workerCount = DEFAULT_WORKER_COUNT, fallback?: Fallback,
) {
  const items: Awaited<ReturnType<typeof extractDocument>>['items'] = [];
  const processedPages: number[] = [];
  const failedPages: number[] = [];
  const skippedPages: number[] = [];
  const errors: { pages: number[]; message: string }[] = [];
  const seenLocated = new Set<string>();
  const pending = [...batches];
  const callBudget = batches.reduce((total, batch) => total + batch.pages.length * 3, 0);
  const leafAttempts = new Map<number, number>();
  let omittedBatchPlaceholders = 0;
  let omittedRunningHeaders = 0;
  const coverageAudits = new Set<number>();
  let httpAttempts = 0;
  let recoveries = 0;
  let currentProvider = provider;
  let fallbackPages: number[] | undefined;
  let fallbackExhausted = false;
  let calls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let retries = 0;
  let concurrency = Math.min(workerCount, batches.length);
  let active = 0;
  const waiting = new Set<() => void>();
  function wakeWaiting() {
    for (const wake of waiting) wake();
    waiting.clear();
  }
  signal?.addEventListener('abort', wakeWaiting, { once: true });
  async function worker(workerId: number) {
  while (pending.length) {
    while (active >= concurrency && !signal?.aborted) {
      await new Promise<void>((resolve) => waiting.add(resolve));
    }
    const batch = pending.shift()!;
    if (!batch) break;
    if (signal?.aborted || fallbackExhausted) {
      skippedPages.push(...batch.pages.map((page) => page.number));
      continue;
    }
    if (calls >= callBudget) {
      skippedPages.push(...batch.pages.map((page) => page.number));
      continue;
    }
    active++;
    const batchProvider = currentProvider;
    const pageNumbers = batch.pages.map((page) => page.number);
    try {
      const batchSize = batchProvider.capabilities?.defaultBatchSize;
      if (batchProvider === fallback?.provider && batchSize && batch.mimeType === 'application/pdf' && batch.pages.length > batchSize) {
        pending.unshift(...await splitPdf(batch.bytes, batch.pages, batchSize));
        onProgress?.({ type: 'split', pages: pageNumbers, workerId });
        continue;
      }
      if (batch.pages.length === 1) {
        const attempts = leafAttempts.get(pageNumbers[0]) ?? 0;
        if (attempts >= 2) {
          failedPages.push(...pageNumbers);
          errors.push({ pages: pageNumbers, message: 'Single-page recovery budget exhausted.' });
          continue;
        }
        leafAttempts.set(pageNumbers[0], attempts + 1);
      }
      calls++;
      onProgress?.({ type: 'started', pages: pageNumbers, workerId });
      const localPages = batch.pages.map((page, index) => ({ ...page, sourceNumber: page.number, number: index + 1 }));
      const result = await extractDocument({
        ...batch,
        pages: localPages,
        maxOutputTokens: batch.pages.length === 1 && (leafAttempts.get(pageNumbers[0]) ?? 0) > 1 ? 16384 : 8192,
        reviewCoverage: coverageAudits.has(pageNumbers[0]),
        repairValues: batch.pages.length === 1 && (leafAttempts.get(pageNumbers[0]) ?? 0) > 1,
        onAttempt: () => { httpAttempts++; },
        onUsage: (u: TokenUsage) => {
          inputTokens += u.inputTokens;
          outputTokens += u.outputTokens;
          totalTokens += u.totalTokens;
          if (u.retries) retries += u.retries;
        },
        onRateLimit: () => {
          if (batchProvider === currentProvider) concurrency = Math.max(1, concurrency - 1);
        },
      }, instruction, batchProvider);
      omittedBatchPlaceholders += result.omittedBatchPlaceholders;
      omittedRunningHeaders += result.omittedRunningHeaders;
      const researchRequest = /research questions|own study|stated limitations/i.test(instruction);
      const conclusionPage = /conclusion|limitations|further research/i.test(batch.pages[0]?.text ?? '');
      if (researchRequest && conclusionPage && !result.items.length && batch.pages.length === 1 && (leafAttempts.get(pageNumbers[0]) ?? 0) < 2) {
        coverageAudits.add(pageNumbers[0]);
        recoveries++;
        pending.unshift(batch);
        continue;
      }
      const invalidObserved = result.items.some((item) => (item.reasonCode === 'INVALID_VALUE_STATE' && item.valueState === 'observed' || item.reasonCode === 'CONTEXT_NOT_SUPPORTED' && item.visual));
      if (invalidObserved && batch.pages.length === 1 && (leafAttempts.get(pageNumbers[0]) ?? 0) < 2) {
        recoveries++;
        pending.unshift(batch);
        continue;
      }
      for (const item of result.items) {
        const mapped = { ...item, page: batch.pages[item.page - 1]?.number ?? item.page };
        const key = JSON.stringify([mapped.page, mapped.field, mapped.value, mapped.quote, mapped.tableTitle, mapped.rowId, mapped.rowLabel, mapped.columnPath]);
        if (mapped.evidenceStatus === 'source_located') {
          if (seenLocated.has(key)) continue;
          seenLocated.add(key);
        }
        items.push(mapped);
      }
      processedPages.push(...pageNumbers);
      if (batchProvider === fallback?.provider) fallbackPages?.push(...pageNumbers);
      onProgress?.({ type: 'completed', pages: pageNumbers, workerId });
    } catch (error) {
      if (fallback && !signal?.aborted && error instanceof ProviderError && (error.status === 402 || error.status === 429)) {
        if (batchProvider === fallback.provider) {
          fallbackExhausted = true;
        } else if (!fallbackExhausted) {
          if (!fallbackPages) {
            fallbackPages = [];
            currentProvider = fallback.provider;
            concurrency = Math.min(workerCount, batches.length);
            onProgress?.({ type: 'fallback', pages: pageNumbers, workerId, provider: fallback.name });
          }
          pending.unshift(batch);
          continue;
        }
      }
      if ((error instanceof TruncatedResponseError || error instanceof ProviderError && error.code === 'INVALID_RESPONSE') && batch.mimeType === 'application/pdf' && batch.pages.length === 1 && (leafAttempts.get(pageNumbers[0]) ?? 0) < 2 && !signal?.aborted) {
        recoveries++;
        pending.unshift(batch);
        continue;
      }
      if (error instanceof TruncatedResponseError && batch.mimeType === 'application/pdf' && batch.pages.length > 1) {
        try {
          pending.unshift(...await splitPdf(batch.bytes, batch.pages, Math.ceil(batch.pages.length / 2)));
          onProgress?.({ type: 'split', pages: pageNumbers, workerId });
          continue;
        } catch {
          // Preserve this batch as failed when it cannot be split.
        }
      }
      failedPages.push(...batch.pages.map((page) => page.number));
      if (error instanceof ProviderError) errors.push({ pages: pageNumbers, message: error.message });
      else if (signal?.aborted) errors.push({ pages: pageNumbers, message: 'Extraction was interrupted before this batch finished.' });
      onProgress?.({ type: 'failed', pages: pageNumbers, workerId });
    } finally {
      active--;
      wakeWaiting();
    }
  }
  }
  await Promise.all(Array.from({ length: Math.min(workerCount, batches.length) }, (_, index) => worker(index + 1)));
  signal?.removeEventListener('abort', wakeWaiting);
  items.sort((a, b) => a.page - b.page);
  processedPages.sort((a, b) => a - b);
  failedPages.sort((a, b) => a - b);
  skippedPages.sort((a, b) => a - b);
  fallbackPages?.sort((a, b) => a - b);
  const status = processedPages.length === 0 ? 'failed' :
    failedPages.length || skippedPages.length || items.some((item) => item.evidenceStatus === 'rejected') ? 'partial' : 'complete';
  const consolidated: (typeof items[number] & { citations?: {page:number;quote:string;region:typeof items[number]['region']}[] })[] = [];
  const keyed = new Map<string, typeof consolidated[number]>();
  for (const item of items) {
    const key = !item.tableTitle && item.evidenceStatus !== 'rejected' && percentageFactIdentity(item) || (item.factKey && !item.tableTitle && item.evidenceStatus !== 'rejected' ? JSON.stringify([item.factKey, item.value, item.valueState, item.entity, item.period, item.unit, item.series, item.rowId]) : null);
    const existing = key ? keyed.get(key) : undefined;
    const citation = { page: item.page, quote: item.quote, region: item.region };
    if (existing) {
      existing.citations = [...existing.citations ?? [{page:existing.page,quote:existing.quote,region:existing.region}], citation];
      if (item.evidenceStatus !== 'source_located') {
        existing.evidenceStatus = 'needs_review';
        existing.reasonCode = item.reasonCode;
      }
    } else {
      consolidated.push(item);
      if (key) keyed.set(key, item);
    }
  }
  const usage = totalTokens > 0 ? { inputTokens, outputTokens, totalTokens, apiCalls: calls, retries } : undefined;
  return { status, items: consolidated, omittedBatchPlaceholders, omittedRunningHeaders, httpAttempts, recoveries, processedPages, failedPages, skippedPages, errors, apiCalls: calls, usage, fallbackPages };
}
