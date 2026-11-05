export type EvidenceResult =
  | { status: 'source_located'; excerpt: string }
  | { status: 'needs_review' | 'rejected' };

export function validateEvidence(
  evidence: { page: number; quote: string },
  pages: ReadonlyMap<number, string>,
): EvidenceResult {
  const rawSource = pages.get(evidence.page);
  const normalize = (text: string) => text.normalize('NFC').replace(/\u00ad/g, '').replace(/[\u00a0\u202f]/g, ' ');
  const source = rawSource === undefined ? undefined : normalize(rawSource);
  if (source === undefined) return { status: 'rejected' };
  const words = normalize(evidence.quote).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { status: 'needs_review' };
  const pattern = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  const matches = Array.from(source.matchAll(new RegExp(pattern, 'gu'))).filter((match) => {
    const start = match.index;
    const end = start + match[0].length;
    return !/[\p{L}\p{N}.,+−-]/u.test(source[start - 1] ?? '') &&
      !/[\p{L}\p{N}]/u.test(source[end] ?? '') &&
      !/^[.,]\d/u.test(source.slice(end));
  });
  if (matches.length !== 1) return { status: 'needs_review' };
  return { status: 'source_located', excerpt: matches[0][0] };
}

// Count equivalence is intentionally limited to English integers below 100.
// Larger magnitudes and non-count expressions continue to require review.
export function validateCount(value: string, quote: string): boolean {
  if (!/^(0|[1-9]\d?)$/.test(value) || /\b(hundred|thousand|million|billion|point|half|quarter|third)\b/i.test(quote)) return false;
  const small = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
  const tens = 'twenty thirty forty fifty sixty seventy eighty ninety'.split(' ');
  const pattern = new RegExp('\\b(?:(?:minus|negative)\\s+)?(?:' + tens.join('|') + ')(?:[- ](?:' + small.slice(1,10).join('|') + '))?\\b|\\b(?:(?:minus|negative)\\s+)?(?:' + small.join('|') + ')\\b', 'gi');
  const normalized = quote.replace(pattern, (word, offset) => {
    if (/^[-\w]/.test(quote.slice(offset + word.length)) || /^\s+(hundred|thousand|million|billion)\b/i.test(quote.slice(offset + word.length))) return word;
    const negative = /^(minus|negative) /i.test(word);
    const parts = word.toLowerCase().replace(/^(minus|negative) /, '').split(/[- ]/);
    const number = tens.includes(parts[0]) ? (tens.indexOf(parts[0]) + 2) * 10 + (parts[1] ? small.indexOf(parts[1]) : 0) : small.indexOf(parts[0]);
    return (negative ? '-' : '') + number;
  });
  return validateEvidence({page:1,quote:value}, new Map([[1,normalized]])).status === 'source_located';
}
