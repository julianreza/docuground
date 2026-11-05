import { mkdir } from 'node:fs/promises';
import { renderReportMarkdown } from '../src/core/markdown';

const baseUrl = process.env.EVALUATION_URL || 'http://localhost:3101';
const output = process.env.EVALUATION_OUTPUT || 'samples/outputs/final';
await mkdir(output, { recursive: true });
const selected = process.argv.slice(2);
for (const name of ['official-research', 'official-table-chart', 'official-spt-fields', 'official-spt-checkboxes'].filter((name) => !selected.length || selected.includes(name))) {
  const gold = await Bun.file('samples/ground-truth/' + name + '.json').json();
  const image = name.includes('spt');
  const path = image ? 'samples/inputs/WhatsApp Image 2026-11-05 at 11.06.27.jpeg' : 'samples/inputs/1-s2.pdf';
  const form = new FormData();
  form.set('file', new File([await Bun.file(path).arrayBuffer()], path.split('/').pop()!, { type: image ? 'image/jpeg' : 'application/pdf' }));
  form.set('instruction', gold.instruction);
  form.set('mode', 'live');
  form.set('provider', image ? 'gemini' : 'deepseek');
  form.set('fallback', '0');
  form.set('cdm', '0');
  const response = await fetch(baseUrl + '/api/extract', { method: 'POST', body: form, signal: AbortSignal.timeout(420000) });
  const report = await response.json();
  await Bun.write(output + '/' + name + '.json', JSON.stringify(report, null, 2) + '\n');
  if (!response.ok) { console.error(name, response.status, report.error); continue; }
  await Bun.write(output + '/' + name + '.md', renderReportMarkdown(report));
  console.log(name, JSON.stringify({status:report.status,coverage:report.processedPages.length+'/'+report.pageCount,items:report.items.length,recoveries:report.recoveries,omitted:report.omittedBatchPlaceholders,durationMs:report.durationMs}));
}
