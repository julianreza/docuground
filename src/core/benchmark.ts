import { z } from 'zod';

export const BenchmarkCaseSchema = z.object({
  mode: z.enum(['live', 'demo']),
  purpose: z.enum(['development', 'holdout']),
  coverage: z.enum(['partial', 'complete']),
  runStatus: z.enum(['complete', 'partial', 'failed']),
  expected: z.array(z.object({ id: z.string().min(1) })),
  claims: z.array(z.object({
    expectedId: z.string().nullable(),
    correct: z.boolean().nullable(),
    supported: z.boolean().nullable(),
  })),
});

export type BenchmarkCase = z.infer<typeof BenchmarkCaseSchema>;

export function evaluateCase(input: BenchmarkCase) {
  const data = BenchmarkCaseSchema.parse(input);
  const expectedIds = new Set(data.expected.map((item) => item.id));
  if (expectedIds.size !== data.expected.length) throw new Error('Expected IDs must be unique');
  const matched = new Set<string>();
  let unreviewedExtraction = 0;
  let unreviewedGrounding = 0;
  let supported = 0;
  for (const claim of data.claims) {
    if (claim.correct === null) unreviewedExtraction++;
    if (claim.supported === null) unreviewedGrounding++;
    if (claim.supported === true) supported++;
    if (claim.correct === true) {
      if (!claim.expectedId || !expectedIds.has(claim.expectedId)) throw new Error('Correct claim must map to an expected item');
      matched.add(claim.expectedId);
    }
  }
  const correct = matched.size;
  const emitted = data.claims.length;
  const expected = data.expected.length;
  const recall = expected && !unreviewedExtraction ? correct / expected : null;
  const precision = emitted && !unreviewedExtraction ? correct / emitted : null;
  const grounding = emitted && !unreviewedGrounding ? supported / emitted : null;
  let acceptance: 'pass' | 'fail' | 'not_evaluated' = 'not_evaluated';
  if (data.mode === 'live' && data.purpose === 'holdout' && data.coverage === 'complete' && recall !== null && grounding !== null) {
    acceptance = data.runStatus === 'complete' && precision !== null && precision >= 0.9 && recall >= 0.9 && grounding >= 0.95 ? 'pass' : 'fail';
  }
  return {
    extraction: { correct, expected, emitted, recall, precision },
    grounding: { supported, emitted, unreviewed: unreviewedGrounding, precision: grounding },
    unreviewedExtraction,
    acceptance,
  };
}
