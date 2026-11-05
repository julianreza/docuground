import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { evaluateReport } from '../src/core/benchmark-report';

const GoldSchema = z.object({
  sourceHash: z.string().min(1), purpose: z.enum(['development', 'holdout']), coverage: z.enum(['partial', 'complete']),
  instruction: z.string().min(1),
  items: z.array(z.object({ id: z.string().min(1) })),
});
const ReportSchema = z.object({
  status: z.enum(['complete', 'partial', 'failed']), mode: z.enum(['live', 'demo']), sourceHash: z.string().min(1), instruction: z.string().min(1),
  items: z.array(z.object({ evidenceStatus: z.enum(['source_located', 'needs_review', 'rejected']) }).passthrough()),
});

async function main() {
  const [goldPath, reportPath, reviewsPath] = process.argv.slice(2);
  if (!goldPath || !reportPath) throw new Error('Usage: bun run benchmark <ground-truth.json> <report.json> [reviews.json]');
  const gold = GoldSchema.parse(JSON.parse(await readFile(goldPath, 'utf8')));
  const reportBytes = await readFile(reportPath);
  const report = ReportSchema.parse(JSON.parse(reportBytes.toString('utf8')));
  if (gold.sourceHash !== report.sourceHash) throw new Error('Ground-truth source hash does not match the report');
  if (gold.instruction !== report.instruction) throw new Error('Ground-truth instruction does not match the report');
  const reportHash = createHash('sha256').update(reportBytes).digest('hex');
  if (!reviewsPath) {
    const reviews = report.items.flatMap((item, itemIndex) => item.evidenceStatus === 'rejected' ? [] : [{ itemIndex, expectedId: null, correct: null, supported: null, claim: item }]);
    console.log(JSON.stringify({ sourceHash: report.sourceHash, reportHash, reviews }, null, 2));
    return;
  }
  const reviews = JSON.parse(await readFile(reviewsPath, 'utf8'));
  const result = evaluateReport({ purpose: gold.purpose, coverage: gold.coverage, expected: gold.items }, { ...report, reportHash }, reviews);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Benchmark failed');
  process.exitCode = 1;
});
