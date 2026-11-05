import { z } from 'zod';
import { evaluateCase } from './benchmark';

const GoldSchema = z.object({ purpose: z.enum(['development', 'holdout']), coverage: z.enum(['partial', 'complete']), expected: z.array(z.object({ id: z.string().min(1) })) });
const ReportSchema = z.object({
  status: z.enum(['complete', 'partial', 'failed']), mode: z.enum(['live', 'demo']), sourceHash: z.string().min(1), reportHash: z.string().min(1),
  items: z.array(z.object({ evidenceStatus: z.enum(['source_located', 'needs_review', 'rejected']) })),
});
const ReviewSchema = z.object({
  sourceHash: z.string().min(1), reportHash: z.string().min(1),
  reviews: z.array(z.object({ itemIndex: z.number().int().nonnegative(), expectedId: z.string().nullable(), correct: z.boolean().nullable(), supported: z.boolean().nullable() })),
});

export function evaluateReport(goldInput: z.input<typeof GoldSchema>, reportInput: z.input<typeof ReportSchema>, reviewInput: z.input<typeof ReviewSchema>) {
  const gold = GoldSchema.parse(goldInput);
  const report = ReportSchema.parse(reportInput);
  const review = ReviewSchema.parse(reviewInput);
  if (review.sourceHash !== report.sourceHash || review.reportHash !== report.reportHash) throw new Error('Review hash does not match report');
  const byIndex = new Map<number, typeof review.reviews[number]>();
  for (const item of review.reviews) {
    if (byIndex.has(item.itemIndex) || !report.items[item.itemIndex] || report.items[item.itemIndex].evidenceStatus === 'rejected') {
      throw new Error('Invalid or duplicate review index');
    }
    byIndex.set(item.itemIndex, item);
  }
  const claims = report.items.flatMap((item, index) => {
    if (item.evidenceStatus === 'rejected') return [];
    const label = byIndex.get(index);
    return [{ expectedId: label?.expectedId ?? null, correct: label?.correct ?? null, supported: label?.supported ?? null }];
  });
  return evaluateCase({ ...gold, runStatus: report.status, mode: report.mode, claims });
}
