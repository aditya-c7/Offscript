# Offscript

A website readiness scanner that audits how well automated agents can discover, understand, and interact with a site.

## Layout

- `apps/web` — Next.js App Router UI and REST API routes
- `apps/worker` — Playwright browser worker and pg-boss job consumers
- `packages/shared` — Zod contracts, URL normalization, rubric constants
- `packages/db` — Drizzle schema and quota helpers
- `packages/scanner` — crawler, browser loader, 31 checks, 7 protocol detectors, scorer
- `packages/agent` — read-only policy, observation capture, model router, runner, verifier
- `fixtures/sites` — six deterministic local mock servers (ports 4101–4106)

## Setup

Copy `.env.example` to `.env` and fill in the database URL and the provider key you use.

```
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm dev
```

Run the local fixtures with `pnpm --filter @offscript/fixtures dev`.

## Verification

```
pnpm typecheck
pnpm lint
pnpm test
```
