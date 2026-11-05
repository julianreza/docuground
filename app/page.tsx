'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import EvidenceFigure, { ExtractionFigure, ScaleFigure } from './evidence-figure';
import { DEMO_INSTRUCTION, DEMO_PRESETS } from '@/src/core/demo';
import { renderTablesMarkdown } from '@/src/core/tables';
import { formatValue, renderReportMarkdown, type Report, type ReportItem } from '@/src/core/markdown';
import { readEventStream } from '@/src/core/stream';
import type { BatchProgress } from '@/src/core/batching';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const DEFAULT_INSTRUCTION = 'Extract the most important facts explicitly stated in this document: its purpose, key entities, dates, figures, and outcomes where present. Report one fact per item in document order. Preserve the original wording, units, and time periods, and include a short exact quote or a visible source region for each fact. Skip boilerplate and do not infer missing information.';

const QUICK_INSTRUCTIONS = [
  { label: 'Key Facts', instruction: DEFAULT_INSTRUCTION },
  {
    label: 'Research & Findings',
    instruction: 'Extract the article title and authors from its title block, its stated objective or research questions, study design, participants recruited, exclusions and analysis sample sizes, key results, and stated limitations. Focus on this paper’s own study and exclude running headers, cited studies and references. Distinguish information modes from interaction modes and preserve population, comparisons and units. Report each distinct finding once. Use exact source quotes; do not infer missing information.',
  },
  {
    label: 'Tables & Metrics',
    instruction: 'Extract every data cell in each table, including labels, codes, status columns, and blank cells. Preserve the table title, row identity, full column hierarchy, and printed units. Also extract explicitly stated metrics and printed chart values with their labels, series, and periods. Do not calculate missing totals or estimate unlabeled chart values.',
  },
  {
    label: 'Form Fields & Entities',
    instruction: 'Extract one item per labeled form field, including names, organizations, identifiers, dates, and entered values. Keep section or person context when labels repeat. Copy values as written, including leading zeros. Distinguish blank fields, unreadable entries, and conflicting entries; use null for those states and cite the label and entry area.',
  },
  {
    label: 'Checkboxes & Selections',
    instruction: 'Extract every visible checkbox and radio option, including unselected options. Identify each by its group and exact option label. Report true for clearly selected and false for clearly unselected; use null for unreadable or ambiguous marks. If a single-choice group has conflicting marks, flag the affected options as ambiguous. Cite the control, label, and group context.',
  },
];

function providerLabel(provider?: string) {
  return provider === 'deepseek' ? 'DeepSeek' : provider === '9router' ? '9Router' : 'Gemini';
}

function scaleDownActivity(event: BatchProgress) {
  if (event.phase === 'plan') {
    if (event.type === 'started') return 'Choosing worker count…';
    const count = `${event.workerCount} ${event.workerCount === 1 ? 'worker' : 'workers'}`;
    return event.type === 'completed' ? `Recommended ${count}` : `Recommendation unavailable. Using ${count}.`;
  }
  return `${event.phase === 'classify' ? 'Instruction classification' : 'Citation review'} ${event.type}`;
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [page, setPage] = useState(1);
  const [region, setRegion] = useState<[number, number, number, number] | null>(null);
  const [pdfPreview, setPdfPreview] = useState('');
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [liveInstruction, setLiveInstruction] = useState(DEFAULT_INSTRUCTION);
  const [demoInstruction, setDemoInstruction] = useState<string>(DEMO_INSTRUCTION);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [scalePhase, setScalePhase] = useState<BatchProgress['phase']>();
  const [workers, setWorkers] = useState<Record<number, { type: string; pages: number[] }>>({});
  const [activity, setActivity] = useState<(BatchProgress & { time: string })[]>([]);
  const [progress, setProgress] = useState('');
  const [capabilities, setCapabilities] = useState<{ gemini: boolean; nineRouter: boolean; deepSeek: boolean; scaleDown: boolean } | null>(null);
  const [selectedMode, setMode] = useState<'live' | '9router' | 'deepseek' | 'demo' | null>(null);
  const mode = selectedMode ?? (capabilities?.gemini ? 'live' : capabilities?.deepSeek ? 'deepseek' : capabilities?.nineRouter ? '9router' : 'demo');
  const [cdm, setCdm] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/capabilities', { cache: 'no-store', signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .catch(() => null)
      .then(configured => {
        if (!controller.signal.aborted) setCapabilities(configured ?? { gemini: false, nineRouter: false, deepSeek: false, scaleDown: false });
      });
    return () => controller.abort();
  }, []);
  const instruction = mode === 'demo' ? demoInstruction : liveInstruction;

  const [activeTab, setActiveTab] = useState<'findings' | 'tables' | 'markdown'>('findings');
  const [statusFilter, setStatusFilter] = useState<'all' | 'source_located' | 'needs_review' | 'rejected'>('all');
  const [rawMarkdownView, setRawMarkdownView] = useState(false);
  const [copied, setCopied] = useState(false);

  const active = useRef<AbortController | null>(null);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  useEffect(() => {
    if (!file || !(file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))) return;
    const controller = new AbortController();
    let objectUrl = '';
    const form = new FormData();
    form.append('file', file);
    form.append('page', String(page));
    fetch('/api/preview', { method: 'POST', body: form, signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error();
        const headerCount = response.headers.get('x-page-count');
        if (headerCount && Number.isInteger(Number(headerCount))) {
          setPdfPageCount(Number(headerCount));
        }
        return response.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setPdfPreview(objectUrl);
        setPreviewError('');
      })
      .catch(() => {
        if (!controller.signal.aborted) setPreviewError('Could not render page preview.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreviewLoading(false);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file, page]);

  function selectFile(next: File | null) {
    active.current?.abort();
    active.current = null;
    setBusy(false);
    setProgress('');
    setScalePhase(undefined);
    setWorkers({});
    setActivity([]);
    setReport(null);
    setError('');
    setPage(1);
    setRegion(null);
    setPdfPreview('');
    setPdfPageCount(null);
    setPreviewError('');
    setUrl(next ? URL.createObjectURL(next) : '');
    setFile(next);
  }

  async function run() {
    if (!capabilities || !file || !instruction.trim()) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setScalePhase(undefined);
    setWorkers({});
    setActivity([]);
    setProgress(mode === 'demo' ? 'Preparing recorded demo…' : 'Preparing document…');
    setError('');
    setReport(null);
    const form = new FormData();
    form.append('file', file);
    form.append('instruction', instruction);
    form.append('mode', mode === 'demo' ? 'demo' : 'live');
    form.append('provider', mode === 'deepseek' ? 'deepseek' : mode === '9router' ? '9router' : 'gemini');
    if (mode !== 'demo' && cdm && capabilities?.scaleDown) form.append('cdm', '1');
    setCdm(false);
    form.append('stream', '1');
    try {
      const response = await fetch('/api/extract', { method: 'POST', body: form, signal: controller.signal });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'Extraction failed.');
      }
      if (!response.body) throw new Error('No extraction stream was returned.');
      let receivedResult = false;
      await readEventStream(response.body, (message) => {
        if (!message || typeof message !== 'object') return;
        const event = message as { type?: string; progress?: BatchProgress; report?: Report; message?: string };
        if (event.type === 'error') throw new Error(event.message || 'Extraction failed.');
        if (event.type === 'progress' && event.progress && active.current === controller) {
          const update = event.progress;
          setActivity(previous => [{ ...update, time: new Date().toLocaleTimeString() }, ...previous]);
          if (update.type === 'fallback') {
            setProgress(`Provider quota reached. Switching to ${providerLabel(update.provider)}…`);
            return;
          }
          if (update.workerId === 0) setScalePhase(update.type === 'started' ? update.phase : undefined);
          setWorkers(previous => update.workerId ? { ...previous, [update.workerId]: update } : previous);
          const pages = update.pages.join(', ');
          const label = event.progress.type === 'started' ? 'Processing' : event.progress.type === 'completed' ? 'Processed' : event.progress.type === 'split' ? 'Splitting' : 'Failed';
          setProgress(update.workerId === 0 ? scaleDownActivity(update) : mode === 'demo' ? 'Replaying recorded results…' : `${label} pages ${pages}…`);
        }
        if (event.type === 'result' && event.report && active.current === controller) {
          receivedResult = true;
          setReport(event.report);
        }
      });
      if (!receivedResult && !controller.signal.aborted) throw new Error('Extraction ended before a result was received.');
    } catch (cause) {
      if (!controller.signal.aborted && active.current === controller) setError(cause instanceof Error ? cause.message : 'Extraction failed.');
    } finally {
      if (active.current === controller) { active.current = null; setBusy(false); setProgress(''); }
    }
  }

  function download() {
    if (!report) return;
    const link = document.createElement('a');
    const blobUrl = URL.createObjectURL(new Blob([renderReportMarkdown(report)], { type: 'text/markdown' }));
    link.href = blobUrl; link.download = 'docuground-report.md'; link.click(); URL.revokeObjectURL(blobUrl);
  }

  function downloadJson() {
    if (!report) return;
    const link = document.createElement('a');
    const blobUrl = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    link.href = blobUrl; link.download = 'docuground-report.json'; link.click(); URL.revokeObjectURL(blobUrl);
  }

  const markdownOutput = report ? renderReportMarkdown(report) : '';

  function handleCopyMarkdown() {
    if (!markdownOutput) return;
    navigator.clipboard.writeText(markdownOutput).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const isPdf = file ? (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) : false;
  const totalPages = report?.pageCount || pdfPageCount || 1;
  const locatedCount = report?.items.filter((i) => i.evidenceStatus === 'source_located').length ?? 0;
  const reviewCount = report?.items.filter((i) => i.evidenceStatus === 'needs_review').length ?? 0;
  const rejectedCount = report?.items.filter((i) => i.evidenceStatus === 'rejected').length ?? 0;

  const filteredItems = (report?.items || []).filter((item: ReportItem) => {
    if (statusFilter === 'all') return true;
    return item.evidenceStatus === statusFilter;
  });

  return (
    <main className="app">
      {/* Zona 1: Top Command & Telemetry Header */}
      <header className="top">
        <div className="brand-group">
          <span className="mark">DG</span>
          <div>
            <strong>DocuGround</strong>
            <span className="subtle">{' // LOCAL EXTRACTION WORKBENCH'}</span>
          </div>
        </div>
        <div className="top-badges">
          <span className="badge">
            {mode === 'demo' ? 'FIXTURE // DEMO' : mode === 'deepseek' ? 'LIVE // DEEPSEEK' : mode === '9router' ? 'LIVE // 9ROUTER' : 'LIVE // GEMINI'}
          </span>
          {report && (
            <span className={`badge status-${report.status}`}>
              STATUS: {report.status.toUpperCase()}
            </span>
          )}
        </div>
      </header>

      {/* Hero Header */}
      <div className="heading">
        <div>
          <p className="eyebrow">DOCUMENT INTELLIGENCE</p>
          <h1>Extract with evidence.</h1>
          <p>Ground AI extractions into source document visual bounds, citations, and complete markdown tables.</p>
        </div>
      </div>

      <div className="workspace">
        {/* Zona 2 — Panel Kiri: Sticky Source Document & Visual Evidence Stage */}
        <section className="panel panel-sticky">
          <div className="panelhead">
            <div>
              <span className="step">01</span>
              <strong>Source document</strong>
            </div>
            <span className="hint">PDF · PNG · JPG // MAX 25 MB</span>
          </div>

          <div className="panelbody">
            {!file ? (
              <label className="upload">
                <span className="uploadicon">↑</span>
                <strong>Choose a source document</strong>
                <span className="hint">Drag & drop or browse from local filesystem</span>
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  onChange={(event) => selectFile(event.target.files?.[0] || null)}
                />
              </label>
            ) : (
              <div className="upload upload-compact">
                <div className="upload-meta">
                  <span className="uploadicon">📄</span>
                  <div>
                    <strong>{file.name}</strong>
                    <span className="hint">
                      {(file.size / 1024 / 1024).toFixed(2)} MB · {file.type || 'document'}
                    </span>
                  </div>
                </div>
                <label className="btn-mini" style={{ cursor: 'pointer' }}>
                  [REPLACE FILE]
                  <input
                    type="file"
                    style={{ display: 'none' }}
                    accept="application/pdf,image/png,image/jpeg"
                    onChange={(event) => selectFile(event.target.files?.[0] || null)}
                  />
                </label>
              </div>
            )}

            {url && file && (
              <>
                <div className="viewer-toolbar">
                  <div className="viewer-nav">
                    <button
                      type="button"
                      className="btn-mini"
                      disabled={page <= 1}
                      onClick={() => {
                        setPage((p) => Math.max(1, p - 1));
                        setRegion(null);
                      }}
                    >
                      ◀ PREV
                    </button>
                    <span className="viewer-page-indicator">
                      PAGE {page} {totalPages > 1 ? `/ ${totalPages}` : ''}
                    </span>
                    <button
                      type="button"
                      className="btn-mini"
                      disabled={page >= totalPages}
                      onClick={() => {
                        setPage((p) => Math.min(totalPages, p + 1));
                        setRegion(null);
                      }}
                    >
                      NEXT ▶
                    </button>
                  </div>

                  {region && (
                    <button
                      type="button"
                      className="btn-mini"
                      onClick={() => setRegion(null)}
                    >
                      ✕ CLEAR HIGHLIGHT
                    </button>
                  )}
                </div>

                <div className="preview">
                  <div className="imageview">
                    {previewLoading && (
                      <div style={{ padding: '24px', textAlign: 'center', background: 'rgba(255,255,255,0.85)', position: 'absolute', inset: 0, zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
                        ⚡ Rendering Page {page}...
                      </div>
                    )}
                    <Image
                      src={isPdf ? (pdfPreview || url) : url}
                      alt="Uploaded document preview"
                      width={1200}
                      height={1600}
                      unoptimized
                    />
                    {region && (
                      <span
                        aria-label="Approximate evidence region"
                        className="region"
                        style={{
                          left: `${region[0] * 100}%`,
                          top: `${region[1] * 100}%`,
                          width: `${(region[2] - region[0]) * 100}%`,
                          height: `${(region[3] - region[1]) * 100}%`,
                        }}
                      />
                    )}
                  </div>
                </div>
              </>
            )}

            {previewError && <p role="alert" className="error">{previewError}</p>}

            <p className="privacy">
              {mode === 'demo'
                ? 'Demo mode replays fixed benchmark findings without remote API calls. Select the 18-page benchmark PDF or the derived benchmark-form.png matching the preset.'
                : `Your document and instruction are sent to ${mode === 'deepseek' ? 'DeepSeek' : mode === '9router' ? 'configured 9Router' : 'Gemini 3.1 Flash-Lite'} when you trigger extraction.`}
              {mode !== 'demo' && (mode === 'deepseek' ? capabilities?.gemini || capabilities?.nineRouter : capabilities?.gemini && capabilities.nineRouter) &&
                ` If that provider runs out of credits or quota, remaining pages and the instruction may be sent to ${providerLabel(mode === 'deepseek' ? (capabilities?.gemini ? 'gemini' : '9router') : mode === '9router' ? 'gemini' : '9router')}.`}
            </p>
          </div>
        </section>

        {/* Zona 3 — Panel Kanan: Instruction Studio, Telemetry Grid & Multi-View Results */}
        <section className="panel">
          <div className="panelhead">
            <div>
              <span className="step">02</span>
              <strong>Extraction & Evidence</strong>
            </div>
            {report && (
              <span className={`badge status-${report.status}`}>
                {report.mode === 'demo' ? 'DEMO · ' : ''}
                {report.status.toUpperCase()}
              </span>
            )}
          </div>

          <div className="panelbody">
            {/* Control Deck */}
            <label className="label" htmlFor="mode">Extraction mode</label>
            <select
              id="mode"
              value={mode}
              disabled={!capabilities}
              aria-busy={!capabilities}
              onChange={(event) => {
                const next = event.target.value as 'live' | '9router' | 'deepseek' | 'demo';
                active.current?.abort();
                active.current = null;
                setBusy(false);
                setProgress('');
                setError('');
                setMode(next);
                setReport(null);
              }}
            >
              {capabilities?.gemini && <option value="live">Live Gemini</option>}
              {capabilities?.deepSeek && <option value="deepseek">Live DeepSeek</option>}
              {capabilities?.nineRouter && <option value="9router">Live 9Router</option>}
              <option value="demo">Recorded benchmark demo</option>
            </select>

            {mode === 'demo' ? (
              <>
                <label className="label" htmlFor="preset">Recorded scenario</label>
                <select
                  id="preset"
                  value={instruction}
                  onChange={(event) => {
                    setDemoInstruction(event.target.value);
                    setReport(null);
                    setError('');
                  }}
                >
                  {DEMO_PRESETS.map((preset) => (
                    <option key={preset.instruction} value={preset.instruction}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <>
                <div className="label-row">
                  <span className="label">Quick Instruction Presets</span>
                </div>
                <div className="preset-strip">
                  {QUICK_INSTRUCTIONS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      className={`preset-chip ${instruction === preset.instruction ? 'active' : ''}`}
                      aria-pressed={instruction === preset.instruction}
                      onClick={() => {
                        setLiveInstruction(preset.instruction);
                        setReport(null);
                        setError('');
                      }}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="label-row">
              <label className="label" htmlFor="instruction">Extraction Instruction</label>
              <span className="hint">{instruction.length} / 4000 CHARS</span>
            </div>
            <textarea
              id="instruction"
              readOnly={mode === 'demo'}
              value={instruction}
              onChange={(event) => setLiveInstruction(event.target.value)}
              maxLength={4000}
              rows={mode === 'demo' ? 4 : 6}
            />

            {mode !== 'demo' && capabilities?.scaleDown && (
              <label className="cdm-option">
                <input
                  type="checkbox"
                  checked={cdm}
                  onChange={event => setCdm(event.target.checked)}
                  disabled={busy}
                  aria-labelledby="cdm-title"
                  aria-describedby="cdm-description"
                />
                <span>
                  <strong id="cdm-title">Enable ScaleDown CDM</strong>
                  <span id="cdm-description" className="cdm-description">
                    Instruction and text from pages requiring review may be sent to ScaleDown.
                  </span>
                </span>
              </label>
            )}
            <div className="actions">
              <button onClick={run} disabled={!capabilities || !file || !instruction.trim() || busy}>
                {busy ? 'Extracting…' : 'Extract document →'}
              </button>
              {busy && (
                <button
                  type="button"
                  className="secondary btn-danger"
                  onClick={() => {
                    active.current?.abort();
                    active.current = null;
                    setBusy(false);
                    setProgress('');
                  }}
                >
                  ■ Stop run
                </button>
              )}
              {report && (
                <>
                  <button type="button" className="secondary btn-success" onClick={download}>
                    ↓ Download .md
                  </button>
                  <button type="button" className="secondary" onClick={downloadJson}>
                    ↓ Download .json
                  </button>
                </>
              )}
            </div>

            {(busy || activity.length > 0) && <section className="live-activity">
              {mode === 'demo' && <span className="activity-replay">Recorded replay</span>}
              {busy && scalePhase && <div className="worker-row">
                <ScaleFigure phase={scalePhase} />
                <div className="worker-details"><strong>ScaleDown</strong><p>{scalePhase === 'classify' ? 'Checking instruction' : scalePhase === 'plan' ? 'Choosing workers' : 'Reviewing citations'}</p></div>
              </div>}
              <div className="worker-list">{Object.entries(workers).map(([id, worker]) => <div className="worker-row" key={id}>
                <ExtractionFigure progress={progress} scanning={busy && worker.type === 'started'} />
                <div className="worker-details"><strong>Worker {id}</strong><span className={`worker-status status-${worker.type}`}>{worker.type === 'started' ? 'Reading' : worker.type === 'completed' ? 'Finished' : worker.type === 'split' ? 'Splitting' : 'Failed'}</span><p>{file?.name}</p><small>Pages {worker.pages.join(', ')}</small></div>
              </div>)}</div>
              <span className="visually-hidden" role="status">{progress}</span>
              <details className="activity-log" open><summary>Live Activity <span>{activity.length} events</span></summary><ol>{activity.map((entry, index) => <li key={index}>
                <time>{entry.time}</time><span className="activity-badge">{entry.type === 'fallback' ? 'Fallback' : entry.workerId ? `Worker ${entry.workerId}` : 'ScaleDown'}</span><span>{entry.type === 'fallback' ? `Provider quota reached. Switched to ${providerLabel(entry.provider)}.` : entry.workerId ? `${entry.type === 'started' ? 'Reading' : entry.type === 'completed' ? 'Finished' : entry.type === 'split' ? 'Split' : 'Failed'} pages ${entry.pages.join(', ')}${entry.type === 'split' ? ' into smaller batches' : ''}` : scaleDownActivity(entry)}</span>
              </li>)}</ol></details>
            </section>}
            {error && <p role="alert" className="error">{error}</p>}

            <div className="divider" />

            {/* Telemetry Grid saat report tersedia */}
            {report && (
              <div className="telemetry-grid">
                <div className="stat-tile">
                  <span>Page Coverage</span>
                  <strong>
                    {report.processedPages.length}/{report.pageCount || report.processedPages.length} pgs
                  </strong>
                </div>
                <div className="stat-tile">
                  <span>Evidence Audit</span>
                  <strong>
                    {locatedCount} L · {reviewCount} R · {rejectedCount} X
                  </strong>
                </div>
                <div className="stat-tile">
                  <span>Model & Mode</span>
                  <strong title={report.model || report.provider || report.mode}>
                    {report.model || report.provider || report.mode}
                  </strong>
                </div>
                <div className="stat-tile">
                  <span>Runtime & Calls</span>
                  <strong>
                    {report.durationMs != null ? `${(report.durationMs / 1000).toFixed(1)}s` : 'recorded'} · {report.usage?.totalTokens ? `${report.usage.totalTokens} tok` : report.apiCalls ? `${report.apiCalls} calls` : '1 batch'}
                  </strong>
                </div>
              </div>
            )}

            <div className="resultshead">
              <div>
                <p className="eyebrow">EXTRACTED FINDINGS</p>
                <h2>Results Workspace</h2>
              </div>
            </div>

            {!report && !busy && (
              <div className="empty">
                <EvidenceFigure />
                <strong>Your findings will appear here</strong>
                <p>Upload a document and trigger extraction to view structured evidence.</p>
              </div>
            )}

            {report && (
              <>
                <p className="notice">
                  {report.cdm?.classification?.warning && 'ScaleDown suggests the instruction may be outside document extraction scope. '}
                  {report.cdm?.notes.map((note, index) => <span key={index}>{note} </span>)}
                  Processing status describes page coverage, not accuracy. Source location is checked where possible. Review each claim against the document.
                  {report.mode === 'demo' && ' Recorded demo covers the selected preset only. Skipped pages were not evaluated.'}
                  {report.fallback && ` Switched to ${providerLabel(report.fallback.provider)} (${report.fallback.model}) after the primary provider reached its quota or credit limit. Pages processed by fallback: ${report.fallback.processedPages.join(', ') || 'none'}.`}
                  {report.errors?.map((failure, index) => <span key={index}> {failure.message}</span>)}
                  {report.failedPages.length > 0 && ` Failed pages: ${report.failedPages.join(', ')}.`}
                  {report.skippedPages.length > 0 && ` Skipped pages: ${report.skippedPages.join(', ')}.`}
                </p>

                {/* Tabs Bar */}
                <div className="tab-bar">
                  <button
                    type="button"
                    className={`tab-btn ${activeTab === 'findings' ? 'active' : ''}`}
                    onClick={() => setActiveTab('findings')}
                  >
                    FINDINGS ({report.items.length})
                  </button>
                  <button
                    type="button"
                    className={`tab-btn ${activeTab === 'tables' ? 'active' : ''}`}
                    onClick={() => setActiveTab('tables')}
                  >
                    TABLES ({report.tables?.length || 0})
                  </button>
                  <button
                    type="button"
                    className={`tab-btn ${activeTab === 'markdown' ? 'active' : ''}`}
                    onClick={() => setActiveTab('markdown')}
                  >
                    RENDERED MARKDOWN
                  </button>
                </div>

                {/* Tab A: Findings */}
                {activeTab === 'findings' && (
                  <>
                    <div className="filter-bar">
                      <button
                        type="button"
                        className={`filter-chip ${statusFilter === 'all' ? 'active' : ''}`}
                        onClick={() => setStatusFilter('all')}
                      >
                        ALL ({report.items.length})
                      </button>
                      <button
                        type="button"
                        className={`filter-chip ${statusFilter === 'source_located' ? 'active' : ''}`}
                        onClick={() => setStatusFilter('source_located')}
                      >
                        SOURCE LOCATED ({locatedCount})
                      </button>
                      <button
                        type="button"
                        className={`filter-chip ${statusFilter === 'needs_review' ? 'active' : ''}`}
                        onClick={() => setStatusFilter('needs_review')}
                      >
                        NEEDS REVIEW ({reviewCount})
                      </button>
                      <button
                        type="button"
                        className={`filter-chip ${statusFilter === 'rejected' ? 'active' : ''}`}
                        onClick={() => setStatusFilter('rejected')}
                      >
                        REJECTED ({rejectedCount})
                      </button>
                    </div>

                    <div className="results">
                      {filteredItems.length === 0 && (
                        <p>{report.items.length === 0 && report.status === 'complete' ? 'No matching items were found for this instruction in the processed document.' : 'No matching items under this filter.'}</p>
                      )}

                      {filteredItems.map((item, index) => {
                        const cardClass = item.evidenceStatus === 'source_located'
                          ? 'finding finding-located'
                          : item.evidenceStatus === 'rejected'
                          ? 'finding finding-rejected'
                          : 'finding finding-review';

                        return (
                          <article className={cardClass} key={index}>
                            {item.evidenceStatus === 'rejected' ? (
                              <p>Rejected item: {item.reasonCode || 'invalid evidence'}.</p>
                            ) : (
                              <>
                                <div className="findinghead">
                                  <strong>{item.field}</strong>
                                  <span className={item.evidenceStatus === 'needs_review' ? 'review' : 'located'}>
                                    {item.evidenceStatus === 'needs_review' ? 'Needs review' : 'Source located'}
                                  </span>
                                </div>

                                <div className="finding-value">
                                  {formatValue(item)}
                                </div>

                                {(item.tableTitle || item.rowLabel || item.columnPath || item.unit || item.entity || item.period || item.chartTitle || item.series) && (
                                  <div className="meta-chips">
                                    {item.tableTitle && <span className="meta-chip">Table: {item.tableTitle}</span>}
                                    {item.rowLabel && <span className="meta-chip">Row: {item.rowLabel}</span>}
                                    {item.columnPath && <span className="meta-chip">Col: {item.columnPath}</span>}
                                    {item.unit && <span className="meta-chip">Unit: {item.unit}</span>}
                                    {item.entity && <span className="meta-chip">Entity: {item.entity}</span>}
                                    {item.period && <span className="meta-chip">Period: {item.period}</span>}
                                    {item.chartTitle && <span className="meta-chip">Chart: {item.chartTitle}</span>}
                                    {item.series && <span className="meta-chip">Series: {item.series}</span>}
                                  </div>
                                )}

                                <div>
                                  <button
                                    type="button"
                                    className="citation"
                                    onClick={() => {
                                      setPdfPreview('');
                                      setPreviewError('');
                                      setPage(item.page);
                                      setRegion(item.region ? [...item.region] : null);
                                    }}
                                  >
                                    Page {item.page} ↗
                                  </button>
                                  {item.region && <span className="hint"> · approximate visual crop</span>}
                                </div>

                                {item.citations?.slice(1).map((citation, sourceIndex) => <button key={sourceIndex} type="button" className="citation" onClick={() => { setPdfPreview(''); setPage(citation.page); setRegion(citation.region ?? null); }}>Additional source · page {citation.page}</button>)}
                                {item.reasonCode && <p className="hint">Review reason: {item.reasonCode}</p>}
                                {item.quote && <blockquote>{item.quote}</blockquote>}
                                {item.cdmSuggestion && <p>CDM suggested quote: {item.cdmSuggestion}</p>}
                              </>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  </>
                )}

                {/* Tab B: Tables */}
                {activeTab === 'tables' && (
                  <div className="tableview">
                    {report.tables && report.tables.length > 0 ? (
                      <>
                        <p className="hint">
                          Tables joined by matching headers & column alignments. Verify values against source document.
                        </p>
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children }) => <span>{children}</span> }}>
                          {renderTablesMarkdown(report.tables)}
                        </ReactMarkdown>
                      </>
                    ) : (
                      <p className="hint">No structured tables extracted in this run.</p>
                    )}
                  </div>
                )}

                {/* Tab C: Rendered Markdown */}
                {activeTab === 'markdown' && (
                  <div>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                      <button type="button" className="btn-mini" onClick={handleCopyMarkdown}>
                        {copied ? '✓ COPIED!' : 'COPY .MD'}
                      </button>
                      <button
                        type="button"
                        className="btn-mini"
                        onClick={() => setRawMarkdownView(!rawMarkdownView)}
                      >
                        {rawMarkdownView ? 'VIEW RENDERED' : 'VIEW RAW SOURCE'}
                      </button>
                    </div>

                    {rawMarkdownView ? (
                      <pre className="raw-markdown">{markdownOutput}</pre>
                    ) : (
                      <div className="markdown-preview">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children }) => <span>{children}</span> }}>
                          {markdownOutput}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </div>

      <footer>
        DocuGround <span>{'//'}</span> Technical Document Extraction & Evidence Grounding Workbench
      </footer>
    </main>
  );
}
