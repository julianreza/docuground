import { renderTablesMarkdown, type TableCell, type TableFragment } from './tables';

export interface UsageMetrics {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  apiCalls?: number | null;
  retries?: number | null;
}

export type ReportItem = TableCell & {
  field: string;
  factKey?: string | null;
  citations?: { page: number; quote: string; region?: [number, number, number, number] | null }[];
  localizationDiagnostic?: unknown;
  visual?: boolean;
  cdmSuggestion?: string;
  value: string | boolean | null;
  valueState?: string | null;
  region?: [number, number, number, number] | null;
  quote: string;
  reasonCode?: string | null;
  unit?: string | null;
  entity?: string | null;
  period?: string | null;
  chartTitle?: string | null;
  series?: string | null;
};

export interface Report {
  cdm?: { classification: { label: string; score: number; warning: boolean } | null; attempts: number; suggestions: number; durationMs: number; notes: string[] };
  mode: 'demo' | 'live';
  provider?: string;
  fallback?: { provider: 'gemini' | '9router'; model: string; promptVersion: string; processedPages: number[] };
  model?: string | null;
  promptVersion?: string | null;
  durationMs?: number | null;
  usage?: UsageMetrics | null;
  apiCalls?: number | null;
  errors?: { pages: number[]; message: string }[];
  status: string;
  items: ReportItem[];
  tables?: TableFragment<ReportItem>[];
  pageCount?: number;
  httpAttempts?: number;
  recoveries?: number;
  omittedBatchPlaceholders?: number;
  omittedRunningHeaders?: number;
  sourceName: string;
  sourceHash: string;
  processedPages: number[];
  failedPages: number[];
  skippedPages: number[];
}
export function formatValue(item: ReportItem): string {
  if (item.value === null) return `[${(item.valueState || 'unavailable').toUpperCase()}]`;
  if (typeof item.value === 'boolean') return item.value ? 'Selected' : 'Not selected';
  return item.valueState === 'estimated' ? `${item.value} [ESTIMATED]` : item.value;
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').replace(/[\\`*_{}[\]()#+.!|<>]/g, '\\$&');
}

export function renderReportMarkdown(report: Report): string {
  const review = report.items.filter((item) => item.evidenceStatus === 'needs_review');
  const located = report.items.filter((item) => item.evidenceStatus === 'source_located');
  const rejected = report.items.filter((item) => item.evidenceStatus === 'rejected');
  const lines = ['# Extraction report', '', `Source: ${escapeMarkdown(report.sourceName)}`, '', '## Summary', '',
    `- Processing status: ${escapeMarkdown(report.status)}`,
    `- Processed pages: ${report.processedPages.length}${report.pageCount != null ? ` / ${report.pageCount}` : ''}`,
    `- Items: ${report.items.length}`, `- Needs review: ${review.length}`, `- Source located: ${located.length}`, `- Rejected: ${rejected.length}`, '',
    'Processing status describes page coverage. Source location is checked where possible. Semantic support requires review.', ''];

  if (report.tables && report.tables.length > 0) {
    lines.push('## Extracted tables', '', renderTablesMarkdown(report.tables), '');
  }
  for (const [title, items] of [['Needs review', review], ['Source located', located]] as const) {
    lines.push(`## ${title}`, '');
    if (!items.length) lines.push('None.', '');
    for (const item of items) {
      lines.push(`### ${escapeMarkdown(item.field)}`, '', `- Value: ${escapeMarkdown(formatValue(item))}`,
        `- Page: ${item.page}`, `- Evidence status: ${escapeMarkdown(item.evidenceStatus)}`);
      if (item.region) lines.push(`- Region: ${item.region.join(', ')}`);
      if (item.reasonCode) lines.push(`- Review reason: ${escapeMarkdown(item.reasonCode)}`);
      if (item.tableTitle) lines.push(`- Table: ${escapeMarkdown(item.tableTitle)}`);
      if (item.rowLabel) lines.push(`- Row: ${escapeMarkdown(item.rowLabel)}`);
      if (item.columnPath) lines.push(`- Column: ${escapeMarkdown(item.columnPath)}`);
      if (item.rowId) lines.push(`- Row ID: ${escapeMarkdown(item.rowId)}`);
      if (item.unit) lines.push(`- Unit: ${escapeMarkdown(item.unit)}`);
      if (item.entity) lines.push(`- Entity: ${escapeMarkdown(item.entity)}`);
      if (item.period) lines.push(`- Period: ${escapeMarkdown(item.period)}`);
      if (item.chartTitle) lines.push(`- Chart: ${escapeMarkdown(item.chartTitle)}`);
      if (item.series) lines.push(`- Series: ${escapeMarkdown(item.series)}`);
      if (item.quote.trim()) lines.push('', `> ${escapeMarkdown(item.quote)}`);
      for (const citation of item.citations?.slice(1) ?? []) {
        lines.push('', `Additional source: page ${citation.page}`, `> ${escapeMarkdown(citation.quote)}`);
        if (citation.region) lines.push(`Region: ${citation.region.join(', ')}`);
      }
      if (item.cdmSuggestion) lines.push('', `CDM suggested quote: ${escapeMarkdown(item.cdmSuggestion)}`);
      lines.push('');
    }
  }
  if (rejected.length) {
    lines.push('## Rejected items', '');
    for (const item of rejected) lines.push(`- Rejected item: ${escapeMarkdown(item.reasonCode || 'invalid evidence')}.`);
    lines.push('');
  }
  lines.push('## Metadata', '', `- SHA-256: ${escapeMarkdown(report.sourceHash)}`, `- Mode: ${escapeMarkdown(report.mode)}`,
    `- Provider: ${escapeMarkdown(report.provider || report.mode)}`, `- Model: ${escapeMarkdown(report.model || 'n/a')}`,
    `- Prompt: ${escapeMarkdown(report.promptVersion || 'n/a')}`, `- Processed pages: ${report.processedPages.join(', ') || 'none'}`,
    `- Failed pages: ${report.failedPages.join(', ') || 'none'}`, `- Skipped pages: ${report.skippedPages.join(', ') || 'none'}`);
  if (report.fallback) {
    const { provider, model, promptVersion, processedPages } = report.fallback;
    lines.push(`- Fallback provider: ${escapeMarkdown(provider)} (${escapeMarkdown(model)}, ${escapeMarkdown(promptVersion)})`,
      `- Pages processed by fallback: ${processedPages.join(', ') || 'none'}`);
  }
  if (report.cdm) {
    lines.push(`- CDM attempts: ${report.cdm.attempts}, suggestions: ${report.cdm.suggestions}, runtime: ${report.cdm.durationMs} ms`);
    if (report.cdm.classification) lines.push(`- CDM classification: ${escapeMarkdown(report.cdm.classification.label)} (${report.cdm.classification.score})${report.cdm.classification.warning ? ' — instruction may be out of scope' : ''}`);
    for (const note of report.cdm.notes) lines.push(`- CDM: ${escapeMarkdown(note)}`);
  }
  if (report.durationMs != null) lines.push(`- Runtime: ${report.durationMs} ms`);
  if (report.usage?.totalTokens != null) lines.push(`- Total tokens: ${report.usage.totalTokens}`);
  if (report.usage?.inputTokens != null && report.usage?.outputTokens != null) lines.push(`- Token breakdown: ${report.usage.inputTokens} input / ${report.usage.outputTokens} output`);
  if (report.usage?.retries != null) lines.push(`- Retries: ${report.usage.retries}`);
  if (report.omittedRunningHeaders != null) lines.push(`- Omitted running headers: ${report.omittedRunningHeaders}`);
  if (report.httpAttempts != null) lines.push(`- HTTP attempts: ${report.httpAttempts}`);
  if (report.recoveries != null) lines.push(`- Recovery attempts: ${report.recoveries}`);
  if (report.omittedBatchPlaceholders != null) lines.push(`- Omitted batch placeholders: ${report.omittedBatchPlaceholders}`);
  if (report.apiCalls != null) lines.push(`- API calls: ${report.apiCalls}`);
  for (const error of report.errors || []) lines.push(`- Error on pages ${error.pages.join(', ') || 'unknown'}: ${escapeMarkdown(error.message)}`);
  lines.push('');
  return lines.join('\n');
}
