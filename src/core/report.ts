import { z } from 'zod';
import { validateEvidence, validateCount } from './evidence';

export const CandidateSchema = z.object({
  field: z.string().min(1),
  factKey: z.string().nullable().optional(),
  value: z.union([z.string(), z.boolean(), z.null()]),
  valueState: z.enum(['observed', 'blank', 'unreadable', 'ambiguous', 'estimated', 'not_located']).optional(),
  page: z.number().int().positive(),
  quote: z.string(),
  visual: z.boolean(),
  box: z.array(z.number()).nullable().optional(),
  tableTitle: z.string().nullable().optional(),
  rowLabel: z.string().nullable().optional(),
  rowId: z.string().nullable().optional(),
  columnPath: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  entity: z.string().nullable().optional(),
  period: z.string().nullable().optional(),
  chartTitle: z.string().nullable().optional(),
  series: z.string().nullable().optional(),
});
type Candidate = z.infer<typeof CandidateSchema>;

export function buildReport(pages: { number: number; text: string }[], candidates: Candidate[]) {
  const pageText = new Map(pages.map((page) => [page.number, page.text]));
  const items = candidates.map((candidate) => {
    const evidence = validateEvidence(candidate, pageText);
    const box = candidate.box;
    const validBox = !box || (box.length === 4 && box.every((value) => Number.isFinite(value) && value >= 0 && value <= 1000) && box[0] < box[2] && box[1] < box[3]);
    const region: [number, number, number, number] | null = box && validBox ? [box[1] / 1000, box[0] / 1000, box[3] / 1000, box[2] / 1000] : null;
    const valueState = candidate.valueState ?? 'observed';
    const hasValue = candidate.value !== null && candidate.value !== '';
    const validState = valueState === 'observed' ? hasValue : valueState === 'estimated' ? typeof candidate.value === 'string' && hasValue : candidate.value === null;
    const valueMatches = typeof candidate.value === 'string' && candidate.value && evidence.status === 'source_located' &&
      validateEvidence({ page: candidate.page, quote: candidate.value },
        new Map([[candidate.page, evidence.excerpt]])).status === 'source_located';
    const countMatches = typeof candidate.value === 'string' && evidence.status === 'source_located' && validateCount(candidate.value, evidence.excerpt);
    const tableContext = candidate.tableTitle ? [candidate.rowLabel, ...candidate.columnPath?.split(' > ') ?? []] : [];
    const contextMatches = !candidate.tableTitle || (candidate.rowLabel && candidate.columnPath && tableContext.every((part) =>
      part && candidate.quote.toLowerCase().includes(part.trim().toLowerCase())));
    const fieldGroup = candidate.field.match(/\b([A-Z]{2,4})\s+condition\b/)?.[1];
    const groupMatches = !fieldGroup || new RegExp('\\b' + fieldGroup + '\\b').test(candidate.quote);
    const explicitContextMatches = [candidate.entity, candidate.period, candidate.unit].every((part) =>
      !part?.trim() || validateEvidence({ page: candidate.page, quote: part.trim() }, new Map([[candidate.page, candidate.quote]])).status === 'source_located');
    const evidenceStatus = evidence.status === 'rejected' || !validBox || !validState ? 'rejected' :
      candidate.visual || !(valueMatches || countMatches) || !contextMatches || !explicitContextMatches || !groupMatches || (candidate.valueState && candidate.valueState !== 'observed') ? 'needs_review' : 'source_located';
    const reasonCode = evidence.status === 'rejected' ? 'PAGE_NOT_PROVIDED' : !validBox ? 'INVALID_REGION' : !validState ? 'INVALID_VALUE_STATE' : (!groupMatches || !candidate.visual && (!contextMatches || !explicitContextMatches)) ? 'CONTEXT_NOT_SUPPORTED' : candidate.visual ? 'VISUAL_NEEDS_REVIEW' : evidence.status === 'needs_review' ? 'QUOTE_NOT_UNIQUE_OR_FOUND' : !(valueMatches || countMatches) ? 'VALUE_NOT_SUPPORTED' : null;
    return { ...candidate, valueState, region, evidenceStatus, reasonCode };
  });
  return {
    status: items.some((item) => item.evidenceStatus === 'rejected') ? 'partial' : 'complete',
    items,
  };
}
