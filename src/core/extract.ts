import { z } from 'zod';
import { buildReport, CandidateSchema } from './report';
import type { VisualLocation } from './visual-evidence';
import type { ReportItem } from './markdown';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  retries?: number;
}

export interface ProviderCapabilities {
  defaultBatchSize: number;
  timeoutMs: number;
  supportsNativePdf: boolean;
  supportsStructuredOutputs: boolean;
}

export class ProviderError extends Error {
  status?: number;
  retryable: boolean;
  code?: string;
  constructor(message: string, options?: { status?: number; retryable?: boolean; code?: string }) {
    super(message);
    this.name = new.target.name;
    this.status = options?.status;
    this.retryable = options?.retryable ?? false;
    this.code = options?.code;
  }
}

export class TruncatedResponseError extends ProviderError {
  constructor(message = 'Model response was truncated') {
    super(message, { retryable: true, code: 'TRUNCATED_RESPONSE' });
  }
}

export interface DocumentInput {
  mimeType: string;
  bytes: Uint8Array;
  pages: { number: number; text: string; sourceNumber?: number; previousPageText?: string }[];
  onUsage?: (usage: TokenUsage) => void;
  onRateLimit?: () => void;
  onAttempt?: () => void;
  maxOutputTokens?: number;
  repairValues?: boolean;
  reviewCoverage?: boolean;
}

export type Provider = ((input: DocumentInput & { instruction: string }) => Promise<unknown>) & {
  capabilities?: ProviderCapabilities;
  locateEvidence?: (input: DocumentInput, items: ReportItem[], signal: AbortSignal) => Promise<{ locations: VisualLocation[]; usage?: TokenUsage }>;
};

export function validateInstructionScope(instruction: string): { supported: boolean; reason?: string } {
  const normalized = instruction.trim().toLowerCase();
  if (!normalized) return { supported: false, reason: 'Instruction cannot be empty.' };
  const unsupportedPatterns = [
    /search (?:the )?(?:web|internet|google)/,
    /browse (?:the )?(?:web|internet)/,
    /external (?:data|sources|lookup)/,
    /write (?:code|a program|a script) to/,
    /execute (?:code|python|bash)/,
    /ignore (?:the )?document/,
  ];
  for (const pattern of unsupportedPatterns) {
    if (pattern.test(normalized)) {
      return { supported: false, reason: 'Instruction requests actions outside document factual extraction (e.g., external search, execution, or ungrounded synthesis).' };
    }
  }
  return { supported: true };
}

export async function extractDocument(document: DocumentInput, instruction: string, provider: Provider) {
  const output = await provider({ ...document, instruction });
  const candidates = z.array(CandidateSchema).parse(output);
  const findings = candidates.filter((item) => !(item.valueState === 'not_located' && !item.quote.trim() && !item.box));
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
  const scoped = findings.filter((item) => {
    const page = document.pages.find((page) => page.number === item.page);
    const abbreviatedAuthor = /authors?/i.test(item.field) && typeof item.value === 'string' && /et al\.?/i.test(item.value) && item.quote.trim().length < 100;
    const runningPosition = page && normalize(page.text).endsWith(normalize(item.quote));
    return !(/exclude running headers/i.test(instruction) && (page?.sourceNumber ?? page?.number ?? 1) > 1 && abbreviatedAuthor && runningPosition);
  });
  return { ...buildReport(document.pages, scoped), omittedBatchPlaceholders: candidates.length - findings.length, omittedRunningHeaders: findings.length - scoped.length };
}
