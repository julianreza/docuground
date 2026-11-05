import type { ReportItem } from './markdown';

// Conservative matching for a single printed percentage and the same ordered
// measurement/comparison label. Other paraphrases retain their separate items.
export function percentageFactIdentity(item: ReportItem): string | null {
  if (item.tableTitle || item.rowId || typeof item.value !== 'string') return null;
  const values = [...item.value.matchAll(/(?<![\d.,])[-+]?\d+(?:\.\d+)?%/g)].map(m=>m[0]);
  if (values.length !== 1 || !item.quote.includes(values[0])) return null;
  if (/\b(no|not|without)\b/i.test(item.value + ' ' + item.quote)) return null;
  const positive = /\b(improvement|faster|reduction|decrease)\b/i.test(item.quote);
  const negative = /\b(slower|worse|increase|decline)\b/i.test(item.quote);
  if (positive === negative) return null;
  const normalizeLabel = (text: string) => text.toLowerCase().replace(/\b(key|results?|task|based|vs|versus|instructions?|visualisation|visualization|information|mode|in|for|of|the|on)\b/g,' ').replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).sort().join(' ');
  const label = normalizeLabel(item.field);
  const comparisonTail = item.field.split(/\bvs\.?|\bversus\b/i)[1]?.split(/\bin\b|\bfor\b/i)[0];
  if (!comparisonTail) return null;
  if (!label || label.split(' ').length < 3) return null;
  return JSON.stringify(['percentage',label,normalizeLabel(comparisonTail),values[0],positive,item.valueState ?? 'observed',item.entity ?? null,item.period ?? null,item.unit ?? null,item.series ?? null]);
}
