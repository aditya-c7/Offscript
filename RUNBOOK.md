# Offscript deployment runbook

## Authoritative deploy path

GitHub Actions `.github/workflows/ci.yml` is the only automatic production deploy path.
Jobs: `verify`, `build-check`, `deploy`. The `deploy` job runs on pushes to `main`
after the other two jobs pass, from `apps/web`, with a frozen lockfile.

The Cloudflare Worker deploy does not deploy the Node worker. The Node worker
(`apps/worker`, started with `pnpm worker`) is a separate Node process on a host
you manage. This repository has no automatic deploy path for it.

## Logs and versions

- GitHub Actions logs: repository Actions tab, select the run for the commit SHA.
  `gh run view <run-id> --log` reads the same logs locally.
- Cloudflare Worker version: the `deploy` job log prints `Current Version ID`.
  Match that line to the commit SHA in the same GitHub run.
- Runtime logs: Cloudflare dashboard -> Workers & Pages -> offscript -> Logs.
  Build logs are only present for the old Cloudflare Git integration.
- Node worker logs: stdout of the `pnpm worker` process on its host, or the
  `worker` container logs in `deploy/docker-compose.yml`.

## Worker and queue health

Check two separate layers. A healthy web process does not prove the Node worker
is reachable or that jobs are draining.

### Web (Cloudflare Worker)

- `/api/health` is a dependency-free liveness route on the deployed Worker.
  A 200 proves only that the web process is up. It does not prove the Node worker
  is reachable or that queued jobs drain.

### Node worker process

- Start with `pnpm worker`. On boot it logs `Offscript worker started
(scan.site, agent.run)`, and the enqueue listener logs `enqueue server
listening`.
- The enqueue listener binds to `WORKER_ENQUEUE_HOST` / `WORKER_ENQUEUE_PORT`,
  defaulting to `127.0.0.1:8787`.
- There is no worker HTTP health route. Verify liveness from the host (process
  running and the two log lines above), and verify the listener by confirming
  the web app can create scans and analyses end to end.

### Queue health (pg-boss)

- The worker starts pg-boss and consumes two queues: `scan.site` and `agent.run`.
- Inspect job states in Postgres to confirm jobs are draining:

  ```sql
  SELECT name, state, count(*)
  FROM pgboss.job
  GROUP BY name, state
  ORDER BY name, state;
  ```

- Healthy: recent jobs reach `complete`; `created` and `active` counts do not
  grow without bound; `failed` and `expired` stay near zero.
- A job stuck in `active` usually means a crashed browser slot. A growing
  `created` backlog means the worker is down or too slow.
- If a job never reaches a terminal state, the Analysis UI stops polling after
  10 minutes and shows a visible error instead of Waiting forever.

## Worker enqueue authentication

- The web POSTs jobs to `WORKER_ENQUEUE_URL` (the `/enqueue` route) and POSTs
  create/re-run commands to the same host's `/scans`, `/analyses`, `.../again`
  and `.../settle` routes.
- These calls must be authenticated. The web sends the shared secret
  `WORKER_ENQUEUE_TOKEN`; the worker rejects requests whose token does not
  match. Missing or wrong tokens get a 401/403 and are never enqueued.
- Token name: `WORKER_ENQUEUE_TOKEN` was chosen for this plan. The enqueue-auth
  agent implements the exact header check, so confirm the name and header match
  that implementation before deploy. Keep the value in a secret store, never in
  the repository. Rotate it by updating the web secret and the worker secret
  together.
- Set the web-side secret with `npx wrangler secret put WORKER_ENQUEUE_TOKEN`
  and provide the same value to the Node worker environment.

## Node worker hosting

- `http://localhost:8787/enqueue` is for local development and CI only. It is
  not a production plan: on Cloudflare Workers, localhost points at the Worker
  itself, and even on a single VM a loopback URL cannot be reached from the
  Workers web.
- Production requires `WORKER_ENQUEUE_URL` to be a public HTTPS URL, not a
  loopback address. Proposed host options:
  1. Public HTTPS Node host: run `pnpm worker` on a VM or container with a public
     DNS name and TLS termination (reverse proxy or load balancer). Set
     `WORKER_ENQUEUE_URL` to `https://<host>/enqueue`.
  2. Cloudflare Tunnel or VPC: keep the worker private and expose `/enqueue`
     through a Cloudflare Tunnel (or Cloudflare VPC/private networking) so the
     Workers web reaches a stable HTTPS hostname without opening inbound ports.
     Enforce the token and restrict the route as defense in depth.
- In either option the browser slots still need the memory and `shm_size` shown
  in `deploy/docker-compose.yml`, and the worker needs the pooled
  `DATABASE_URL`.

## Rollback

1. Find the last verified version ID in a passing `deploy` job log.
2. In the Cloudflare dashboard, select that version and choose "Promote".
3. Verify rollback status: confirm `/api/health` returns 200, confirm the
   rolled-back version ID is the one now serving, and confirm a scan completes
   end to end. The rollback is not complete until those checks pass.
4. If the Node worker was also rolled back, recheck its logs, the enqueue
   listener, and queue drain after the rollback.
5. Do not auto-retry a failed release. Mark it failed and report the rollback
   target and the verification evidence.

Use the pooled `DATABASE_URL` at runtime. Use `DATABASE_URL_UNPOOLED` only for
migrations. Secrets are never stored in the repository.
