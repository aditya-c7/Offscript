# Web-to-worker integration verification (disposable)

Scope: verify the web -> Node worker -> pg-boss -> report path in isolation.
This package owns only `tests/integration/**`. It never deploys, never runs
migrations, never edits the application schema, and never reads `.env`.

## Preflight contract

`DATABASE_URL` must already be exported in the shell. If it is absent, the
suite is skipped and prints an exact blocker; no process is started and no row
is touched. Do **not** source `.env` into the shell for this suite.

```powershell
# 1. Confirm the shell export exists (presence only, value hidden).
if ($env:DATABASE_URL) { "DATABASE_URL=SET" } else { "DATABASE_URL=MISSING" }

# 2. Package-only checks (no DB required).
pnpm --filter @offscript/integration typecheck
pnpm --filter @offscript/integration lint
pnpm --filter @offscript/integration test

# 3. Repo-wide contract checks.
pnpm typecheck && pnpm lint && pnpm test
```

## Isolation strategy

- Owner prefix: `itest_<uuid>` in `sites.owner_cookie_id`; the test owner
  cookie `offscript_uid` carries the same value. Cleanup deletes exactly those
  rows plus the generated pg-boss jobs, using parameterized SQL only.
- Target: an offline HTML server on an ephemeral loopback port (no external
  network, no shared fixture ports).
- Worker/web: started from source with explicit env, on ephemeral loopback
  ports. The worker's `start` script is deliberately not used because it loads
  `../../.env`.
- Token: generated per run and passed to both processes as
  `WORKER_ENQUEUE_TOKEN`. No secret is read from the repo or printed.

## What is asserted (when unblocked)

1. `POST /enqueue` without a token is rejected with 401/403.
2. `POST /enqueue` with the test token is accepted with 200 (only checked if 1 passes).
3. `POST /api/scans` with the test owner cookie returns 201 + a scan id.
4. The worker drains `scan.site`, the scan reaches `complete`, the report
   validates against `ScanReportSchema`, all 31 checks validate, and a second
   `GET` after refresh has the same shape and stable identity/scores.

## Known blockers / findings (reported, not masked)

- **Hard blocker:** `DATABASE_URL` is not exported in the shell of this
  session. Per the task rule `.env` was not read, so no live verification ran;
  all five tests are explicitly skipped with that reason.
- **Static defect found while preparing the harness:** enqueue auth now exists
  in `apps/worker/src/index.ts` (401 before routing, every write endpoint), and
  `apps/web/lib/queue.ts` sends `Authorization: Bearer <WORKER_ENQUEUE_TOKEN>`.
  However `apps/web/app/api/_lib/quota.ts::createWorkerJob` — the bridge used by
  `POST /api/scans`, `POST /api/analyses`, re-runs and settle — still sends only
  `content-type`. The worker will reject those calls with 401, so
  `POST /api/scans` is expected to surface as HTTP 500. Test 3 in this suite
  asserts 201 and will catch this as soon as a DB is supplied. (Existing unit
  tests cover `queue.ts` only, not `createWorkerJob`.)
- **Isolation risk:** the worker constructs `new PgBoss(DATABASE_URL)` with
  pg-boss's default `pgboss` schema. A local worker pointed at a shared DB
  would consume shared queue jobs; use a dedicated DB for this suite.
