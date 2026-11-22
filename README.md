<div align="center">

# Offscript

### Agent readiness scanning for the open web

_See what an AI agent can find, read, and do on your site._

[![Live Demo](https://img.shields.io/badge/Live_Demo-Open-22C55E?logo=cloudflare&logoColor=white)](https://offscript.adityahq.me)
[![Overview](https://img.shields.io/badge/Overview-3_modules-2563EB)](#modules)
[![Checks](https://img.shields.io/badge/Checks-31_static-DC2626)](#what-it-checks)
[![Protocols](https://img.shields.io/badge/Protocols-7_detected-0891B2)](#what-it-checks)

</div>

## What it does

Offscript scans a website the way an AI agent would. It checks whether pages can be reached and read, whether controls are understandable, and whether the site explains who runs it. The report gives a score, ranked fixes, and the exact commands and selectors needed to reproduce each problem.

It also runs real, read-only agent tasks against the site and records both what the agent read in the page structure and what it saw on screen.

No signup. No paywall.

## Modules

- **Overview** - scan a site, track scores across sites, and jump into the next action.
- **Agent analysis** - pick tasks, watch agents work step by step, and inspect artifacts with PII redacted.
- **Scans** - the full report: score, 31 checks, ranked fixes, and 7 agent protocols.

## What it checks

| Area                    | Questions answered                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| Reaching your pages     | Real links, fresh sitemap, canonical URLs, true 404s, HTTPS, AI bot access, robots rules, cloaking parity |
| Reading your pages      | Language, titles, alt text, server-rendered facts, landmarks, heading order, JSON-LD, page errors         |
| Using forms and buttons | Accessible names, field labels, native controls, feedback surfaces, action boundaries                     |
| Knowing who you are     | Operator name, contact details, about, privacy, terms, refunds, verified profiles, clear pricing          |

Seven agent protocols are detected: `llms.txt`, MCP, WebMCP, A2A, OpenAPI, Markdown negotiation, and content signals.

## Model routing

NVIDIA NIM is the default provider. Groq and OpenRouter act as automatic fallback providers when their keys are set. The web app and the worker read the same role-based model configuration.

## Layout

| Path               | Role                                        |
| ------------------ | ------------------------------------------- |
| `apps/web`         | Next.js UI and REST API                     |
| `apps/worker`      | Playwright browser worker and job queue     |
| `packages/shared`  | Contracts, URL rules, rubric constants      |
| `packages/db`      | Drizzle schema and quota transactions       |
| `packages/scanner` | Crawler, checks, protocols, scoring         |
| `packages/agent`   | Read-only policy, observation, model router |
| `fixtures/sites`   | Six local mock sites for tests              |

## Run locally

Copy `.env.example` to `.env`, set `DATABASE_URL` and `NVIDIA_API_KEY`, then:

```bash
pnpm install
pnpm db:migrate
pnpm dev
pnpm worker
```

Local fixtures: `pnpm --filter @offscript/fixtures dev`.

Verify with `pnpm typecheck && pnpm lint && pnpm test`.

## Deployment

`apps/web` is packaged for Cloudflare Workers with OpenNext. In the Cloudflare dashboard, configure Workers Builds with these exact settings:

- Root directory: `apps/web`
- Install command: `pnpm install --frozen-lockfile`
- Build command: `pnpm exec opennextjs-cloudflare build`
- Deploy command: leave it blank, or set it to `pnpm exec opennextjs-cloudflare deploy` so it stays scoped to the app. Do not use a root-level `npx wrangler deploy`.

Set the Worker secrets before the first deploy. Cloudflare Containers are not used.

`apps/worker` is a separate Node process and is not part of the Worker deployment. Run it on its own host with `pnpm worker`.
