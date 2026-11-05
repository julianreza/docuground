# Repository Guidelines

## Project Structure & Module Organization

- `app/` contains the UI, assets, and API routes under `app/api/`.
- `src/core/` contains extraction, batching, adapters, evidence validation, and rendering. Keep adapters behind the shared `Provider` interface.
- `tests/` contains Bun tests. `scripts/` contains benchmark and live-evaluation runners.
- `samples/inputs/`, `samples/ground-truth/`, and `samples/outputs/` hold source documents, annotations, and evaluation artifacts.

## Build, Test, and Development Commands

- `bun install --frozen-lockfile` installs pinned dependencies.
- `bun run dev` starts development at `http://localhost:3000`.
- `bun test` runs the suite. Use `bun test tests/report.test.ts` for targeted checks.
- `bun run lint` runs ESLint with Next.js and TypeScript rules.
- `bun run build` builds production assets and checks TypeScript. `bun run start` serves that build.
- `docker compose up --build` builds and starts the complete application.
- `bun run benchmark <gold.json> <report.json> [review.json]` prepares or scores manual reviews.

## Coding Style & Naming Conventions

Use TypeScript, two-space indentation, semicolons, and camelCase identifiers. Use PascalCase types and components and kebab-case filenames such as `visual-evidence.ts`. Follow surrounding quote style. Reuse existing helpers. Keep core modules independent of React and HTTP handlers.

## Testing Guidelines

Use `bun:test` and `*.test.ts` filenames. Describe behavior in test names. Cover changed validation, recovery, citations, and aggregation. Mock provider calls for deterministic tests. Run tests, lint, and build before submitting. No coverage percentage is configured. Run live evaluations intentionally and preserve original reports, hashes, and review provenance.

## Commit & Pull Request Guidelines

No commits exist. Use imperative subjects, optionally prefixed with `fix:`, `feat:`, or `docs:`. PRs should explain the problem, behavior, verification, and limitations. Link relevant issues and include screenshots for UI changes.

## Security & Configuration

Copy `.env.example` to `.env` and configure the required provider keys. Keep credentials and local experiment history ignored. Include reproducible sample outputs and distinguish live runs from offline replay.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
