# DocuGround

DocuGround is a local document extraction application built for the Senior AI Engineer take-home assessment. Upload a PDF, PNG, or JPEG, edit the extraction instruction, and receive Markdown with page references, source excerpts, and proposed image regions.

## Run with Docker

Docker with Compose is the only host dependency for running the application.

```bash
cp .env.example .env
# Edit .env to configure the providers you want to use.
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000).

| Configuration | Purpose |
| --- | --- |
| `DEEPSEEK_API_KEY` | Enables DeepSeek Flash, used for the recorded research PDF runs |
| `GEMINI_API_KEY` | Enables Gemini, used for the recorded SPT runs |
| `GEMINI_MODEL` | Optional Gemini model override; defaults to `gemini-3.1-flash-lite` |
| `NINEROUTER_BASE_URL`, `NINEROUTER_MODEL`, `NINEROUTER_API_KEY` | Optional OpenAI-compatible vision provider; the base URL must end in `/v1` |
| `SCALEDOWN_ENABLED`, `SCALEDOWN_API_KEY` | Optional instruction classification and citation suggestions |

DeepSeek and Gemini keys are independent. Configure either provider, both, or use recorded demo mode without keys. The four-case evaluation runner requires both keys. Unconfigured live providers are hidden in the UI. Keep credentials in ignored environment files.

## Try the application

1. Upload one of the original samples:
   - Research PDF, 18 pages — `samples/inputs/1-s2.pdf`.
   - SPT tax form — `samples/inputs/WhatsApp Image 2026-11-05 at 11.06.27.jpeg`.
2. Select a configured live provider. The recorded evaluation uses DeepSeek for PDF and Gemini for SPT.
3. Choose a preset or edit the instruction. Run extraction, inspect coverage and review reasons, and click the source references.
4. Download the Markdown and JSON reports.

Two example instructions can be run through the UI without code changes:

```text
Extract this paper's title, authors, research questions, study design, recruited participants, exclusions, analysis sample sizes, key results, and limitations. Focus on its own study. Preserve comparisons and units, exclude running headers and references, and cite exact source excerpts.
```

```text
Extract only the tax year, Penghasilan Neto Fiskal, Penghasilan Kena Pajak, PPh yang harus dibayar sendiri, and payment date. Preserve the printed amounts and date. Cite image regions containing both the label and value. Distinguish blank from unreadable.
```

Exact instructions for recorded runs are stored in their JSON reports and in `samples/ground-truth/official-*.json`.

### Demo without API keys

Select **Recorded benchmark demo**, then upload the fixture matching the recorded scenario:

| Fixture included in this repo | Recorded scenario |
| --- | --- |
| [Gemini Benchmark Test Suite (1).pdf](<samples/inputs/Gemini Benchmark Test Suite (1).pdf>) (18 pages) | **PDF · annual revenue** or **PDF · printed chart values** |
| [samples/inputs/benchmark-form.png](samples/inputs/benchmark-form.png) | **Form image · field states** or **Form image · checkboxes** |

Use the original files unchanged: demo validation checks their SHA-256 hashes and the selected preset instruction. The four-page `samples/inputs/Gemini Benchmark Test Suite.pdf` is used by tests and does not match the PDF demo. For your own documents, select a configured live provider.

The fake adapter replays fixed findings for matching fixture hashes and instructions. Its reported page coverage may be partial because a preset targets a particular fixture page. Use it to check integration and UI behavior. Extraction accuracy is measured on live outputs against source answers.

## Architecture and extension points

```text
app/                 UI, source preview, and HTTP/SSE routes
src/core/            Extraction, batching, validation, providers, and Markdown
tests/               Bun unit and integration tests
scripts/             Benchmark scoring and live evaluation runners
samples/inputs/      Original samples and synthetic form fixture
samples/ground-truth/Manual source answers and evaluation instructions
samples/outputs/     Saved reports, reviews, and research replay artifacts
```

- **Ingestion** detects PDF, PNG, and JPEG by magic bytes, validates upload size, and reads PDF pages with `pdfjs-dist`. The upload limit is 25 MB and the PDF limit is 100 pages.
- **Providers** implement the shared `Provider` contract in `src/core/extract.ts`. Gemini accepts native PDF bytes. DeepSeek and 9Router receive rendered pages and extracted text through the OpenAI-compatible adapter.
- **Orchestration** uses provider batch settings, maps batch-local references to original page numbers, streams progress, and tracks failed or skipped pages.
- **Validation** checks output schemas, field states, quote matching, explicit context, and coordinate bounds. Tables retain row identity and column hierarchy.
- **Rendering** produces escaped Markdown and source references. JSON preserves audit metadata and localization diagnostics.

To add a provider, implement the shared callable interface, return candidates matching `CandidateSchema`, report attempts and usage, and expose batch size, timeout, and input capabilities. Register its configuration, capability response, route selection, and UI option. Optional `locateEvidence` supports image-region refinement.

To add a format, extend MIME detection and ingestion to produce document bytes and numbered pages. Keep format handling separate from provider invocation. Add a domain through editable instructions or presets using the existing candidate fields.

## Reliability, uncertainty, and tradeoffs

DeepSeek defaults to one rendered PDF page per invocation; Gemini defaults to three native PDF pages. Smaller batches isolate failures and limit output size, while increasing request overhead. Provider availability and quotas depend on the configured account.

Multi-page truncated batches are split. A single page has at most two pipeline attempts, with output limits of 8,192 then 16,384 tokens. Invalid responses, inconsistent observed values, and empty conclusion pages can trigger bounded recovery. Total PDF invocations are limited to three times the document page count.

Image localization uses at most one additional Gemini request per image with a 30-second deadline. The adapter converts its explicit 0–1000 coordinates to normalized 0–1 regions. Conflicting regions are cleared and marked for review. If localization fails, initial regions remain approximate with a visible reason.

- `complete` describes processing coverage and validation status; individual findings can still require review.
- `source_located` records a text match. Semantic support still needs source review.
- `needs_review` carries a reason such as unsupported context, uncertain quote, or proposed visual evidence.
- Blank, unreadable, ambiguous, and estimated values have explicit states. Chart estimation requires an explicit instruction.
- Document content is treated as untrusted evidence. Provider prompts direct the model to ignore embedded instructions, and Markdown output is escaped.
- When configured providers exhaust quota or credits, the UI discloses possible fallback. Evaluation runs disable fallback and ScaleDown for comparability.

`apiCalls` counts pipeline provider invocations. `httpAttempts` counts adapter request attempts, including retries and localization. Usage is reported when available. Runtime includes ingestion, provider processing, validation, and enabled supplementary steps.

## Evaluation and recorded results

Manual source answers are under `samples/ground-truth/`. Review files are bound to source and report SHA-256 hashes. Cases already used for tuning are labeled `development`; the supplied annotations are partial, so acceptance is `not_evaluated`.

- **Recall** measures unique expected answers recovered.
- **Precision** measures unique correct in-scope answers relative to published claims; duplicates reduce precision.
- **Evidence support** measures manually supported claims. Image support requires the correct label, value/control, and context within the region.
- **Operational performance** records page coverage, runtime, token usage, invocation counts, and recoveries.

| Case and saved report | Coverage | Recorded result | Runtime / tokens |
| --- | --- | --- | --- |
| [Latest research PDF](samples/outputs/research-fix/official-research.md) | 18/18 | Complete; 169 findings, 83 placeholders suppressed, 3 recoveries; targeted source audit completed | 48.6 s / 110,851 |
| [PDF tables and charts](samples/outputs/final/official-table-chart.md) | 18/18 | Partial; 159 findings, 4 invalid regions rejected; quality metrics pending | 41.8 s / 99,688 |
| [SPT five fields](samples/outputs/final/official-spt-fields.md) | 1/1 | 5/5 values correct; 4/5 supporting regions | 6.4 s / 5,110 |
| [SPT row 9 checkboxes](samples/outputs/final/official-spt-checkboxes.md) | 1/1 | 2/2 states correct; 0/2 supporting regions | 5.7 s / 3,910 |

The latest research source audit confirmed the title and authors, participant exclusions, CG condition code, and page 17 limitations. The final consolidation change was checked by [offline replay](samples/outputs/research-fix/official-research-replay.md) of the same saved candidates, producing 168 findings with both citations for the repeated 14% result. The live report remains unchanged. See the [audit notes](samples/outputs/research-fix/REVIEW.md).

Saved reports retain their actual model and prompt versions; the cases were recorded at different implementation stages. Replay is labeled `demo` and is excluded from live accuracy claims.

### Reproduce evaluation

For saved SPT scoring, use Bun:

```bash
bun install --frozen-lockfile
bun run benchmark samples/ground-truth/official-spt-fields.json samples/outputs/final/official-spt-fields.json samples/outputs/final/official-spt-fields-review.json
bun run benchmark samples/ground-truth/official-spt-checkboxes.json samples/outputs/final/official-spt-checkboxes.json samples/outputs/final/official-spt-checkboxes-review.json
```

For new live runs against the normal Docker application:

```bash
EVALUATION_URL=http://localhost:3000 EVALUATION_OUTPUT=samples/outputs/new-run bun scripts/evaluate-originals.ts
```

This runner uses DeepSeek for both PDF cases and Gemini for both SPT cases. Configure both keys first. It makes remote API calls and saves new artifacts separately. To run only the research case, append `official-research`. Reviews must be checked again and bound to the new report hashes.

## Local development and verification

Bun 1.4.4 is pinned by `package.json`. Local development also supports `.env.local`.

```bash
bun install --frozen-lockfile
bun run dev
bun test
bun run lint
bun run build
```

The last passing verification recorded 120 tests, lint, production build, and isolated Docker Compose startup. HTTP smoke checks returned 200 for the home page and 400 for corrupt input. Browser interaction verification was interrupted by a tooling timeout.

Keep both `samples/inputs/Gemini Benchmark Test Suite*.pdf` fixtures and `samples/inputs/benchmark-form.png`: the tests reference them. These synthetic fixtures are separate from the original research paper and tax form.

Development used Codex for implementation, debugging, regression tests, and documentation. DeepSeek and Gemini supplied live extraction outputs recorded in the reports.

## Limitations and next improvements

- Complete manual accuracy scoring for the PDF cases remains pending. The current research audit checks selected source answers.
- SPT localization still places the PPh region on row 10 rather than row 9. Both checkbox regions are vertically misplaced despite correct states.
- Four chart regions in the saved table/chart case are invalid and rejected.
- Conservative deduplication handles matching contextualized facts and a limited class of percentage paraphrases. Other paraphrases can remain separate.
- English number-word matching covers integers below 100. Larger magnitudes and fractions require review.
- Improve region localization, broaden source annotations, and verify source navigation/download in the browser before expanding providers or OCR support.

## Submission walkthrough

- [ ] Record Docker startup and the local URL.
- [ ] Demonstrate both original samples, two editable instructions, source navigation, and Markdown download.
- [ ] Explain architecture, extension points, AI tools, validation, measured results, and limitations.
- [ ] Add an accessible video link.
- [ ] Verify repository access and invite `deduu` as collaborator.
