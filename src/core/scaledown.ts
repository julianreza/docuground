import { z } from 'zod';
import { validateEvidence } from './evidence';
import type { ReportItem } from './markdown';

const labels = [
  { name: 'document_extraction', rubric: 'Does the instruction request extraction of facts from the supplied document?' },
  { name: 'external_search', rubric: 'Does the instruction request external information or web search?' },
  { name: 'code_execution', rubric: 'Does the instruction request code execution or ignoring the document?' },
];

export class ScaleDown {
  private spent = 0;
  classification: { label: string; score: number; warning: boolean } | null = null;
  attempts = 0;
  suggestions = 0;
  notes: string[] = [];
  constructor(private key: string, private signal: AbortSignal) {}

  private async post(path: string, body: unknown) {
    const remaining = 12000 - this.spent;
    if (remaining <= 0) throw new Error('CDM time budget exhausted.');
    const start = Date.now();
    try {
      const response = await fetch(`https://api.scaledown.xyz${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': this.key },
        body: JSON.stringify(body), signal: AbortSignal.any([this.signal, AbortSignal.timeout(Math.min(3000, remaining))]),
      });
      if (!response.ok) throw new Error('ScaleDown request failed.');
      return await response.json();
    } finally { this.spent += Date.now() - start; }
  }

  async classify(instruction: string) {
    try {
      const result = z.object({ top_label: z.enum(['document_extraction', 'external_search', 'code_execution']), scores: z.record(z.string(), z.number().min(0).max(1)) }).parse(await this.post('/classify', { text: instruction, labels }));
      const score = result.scores[result.top_label];
      if (score === undefined) throw new Error('Missing score');
      this.classification = { label: result.top_label, score, warning: result.top_label !== 'document_extraction' && score >= 0.9 };
    } catch { this.notes.push('ScaleDown instruction classification unavailable.'); }
  }

  async recommendWorkers({ batchCount, batchSize, bytes, provider }: {
    batchCount: number; batchSize: number; bytes: number; provider: string;
  }): Promise<number | null> {
    const maximum = Math.min(6, batchCount);
    const minimum = Math.min(3, maximum);
    const options = Array.from({ length: maximum - minimum + 1 }, (_, index) => {
      const workers = index + minimum;
      return {
        name: `workers_${workers}`,
        rubric: `Is ${workers} concurrent requests (${Math.ceil(batchCount / workers)} waves) the best balance of turnaround time and request pressure for this workload? Prefer lower concurrency for heavy batches and higher concurrency for many small independent batches.`,
      };
    });
    try {
      const text = `Provider: ${provider}. Independent batches: ${batchCount}. Maximum pages per batch: ${batchSize}. Total input bytes: ${bytes}. Account rate limits are unknown.`;
      const result = z.object({ top_label: z.string() }).parse(await this.post('/classify', { text, labels: options }));
      const index = options.findIndex((option) => option.name === result.top_label);
      if (index < 0) throw new Error('Invalid worker recommendation');
      return index + minimum;
    } catch {
      this.notes.push('ScaleDown worker recommendation unavailable. Using default concurrency.');
      return null;
    }
  }

  async suggest(items: ReportItem[], pages: { number: number; text: string }[], onStart?: () => void) {
    const pageMap = new Map(pages.map(page => [page.number, page.text]));
    const candidates = items.filter(item => {
      const text = pageMap.get(item.page);
      return item.evidenceStatus === 'needs_review' && !item.visual && (item.valueState ?? 'observed') === 'observed' && typeof item.value === 'string' && !!item.value && !!text && text.length <= 12000 && validateEvidence(item, pageMap).status !== 'source_located';
    }).sort((a, b) => a.page - b.page).slice(0, 3);
    if (candidates.length && !this.signal.aborted) onStart?.();
    for (const item of candidates) {
      if (this.signal.aborted) break;
      this.attempts++;
      const text = pageMap.get(item.page)!;
      try {
        const result = await this.post('/v1/chat/completions', { model: 'extract-1', messages: [{ role: 'user', content: text }], response_format: { type: 'json_schema', json_schema: { name: 'citation', schema: { type: 'object', properties: { citation: { type: 'string', description: `Find the source excerpt containing the value ${item.value} for the field ${item.field}.` } } } } } });
        const content = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1) }).parse(result).choices[0].message.content;
        const entities = z.object({ entities: z.array(z.object({ text: z.string().min(1), start: z.number().int().nonnegative(), end: z.number().int().nonnegative() })) }).parse(JSON.parse(content)).entities;
        if (entities.length !== 1) continue;
        const span = entities[0];
        if (span.end <= span.start || text.slice(span.start, span.end) !== span.text) continue;
        if (validateEvidence({ page: item.page, quote: span.text }, pageMap).status !== 'source_located') continue;
        if (validateEvidence({ page: item.page, quote: item.value as string }, new Map([[item.page, span.text]])).status !== 'source_located') continue;
        item.cdmSuggestion = span.text;
        this.suggestions++;
      } catch { this.notes.push(`ScaleDown citation suggestion unavailable for page ${item.page}.`); }
    }
  }

  metadata() { return { classification: this.classification, attempts: this.attempts, suggestions: this.suggestions, durationMs: this.spent, notes: this.notes }; }
}
