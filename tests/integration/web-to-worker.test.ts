import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CheckResultSchema,
  ScanReportSchema,
} from "../../packages/shared/src/schemas";
import { cleanupRows, type CleanupResult } from "./helpers/db";
import { readIntegrationEnv } from "./helpers/env";
import { ownerCookie, requestJson } from "./helpers/http";
import { delay, freeLoopbackPort } from "./helpers/ports";
import {
  REPO_ROOT,
  startWeb,
  startWorker,
  waitForHttp,
  type ManagedProcess,
} from "./helpers/processes";
import { startTargetServer, type TargetServer } from "./helpers/target";

const UuidSchema = z.string().uuid();
const CreatedSchema = z.object({ id: UuidSchema });
const ReportEnvelopeSchema = z.object({ scan: ScanReportSchema });
const ErrorSchema = z.object({ error: z.string() }).passthrough();

const integrationEnv = readIntegrationEnv(process.env);

if (integrationEnv.blocker !== null) {
  process.stderr.write(
    "\n[integration] BLOCKED: no live web-to-worker verification was performed.\n" +
      `[integration] ${integrationEnv.blocker}\n\n`,
  );
}

describe.skipIf(integrationEnv.blocker !== null)(
  "web-to-worker path (disposable owner prefix)",
  () => {
    const ownerId = `itest_${randomUUID()}`;
    const testToken = randomUUID();
    const storageDir = resolve(
      REPO_ROOT,
      "tests",
      "integration",
      ".tmp",
      ownerId,
    );
    const createdScanIds: string[] = [];

    let target: TargetServer | undefined;
    let worker: ManagedProcess | undefined;
    let web: ManagedProcess | undefined;
    let workerPort = 0;
    let webPort = 0;
    let authEnforced = false;
    let submittedScanId = "";
    let cleanup: CleanupResult | null = null;

    beforeAll(async () => {
      target = await startTargetServer();
      workerPort = await freeLoopbackPort();
      webPort = await freeLoopbackPort();

      worker = startWorker({
        databaseUrl: integrationEnv.databaseUrl,
        port: workerPort,
        token: testToken,
        storageDir,
      });
      await waitForHttp(
        `http://127.0.0.1:${workerPort}/enqueue`,
        worker,
        [404, 401, 403],
        60_000,
      );

      web = startWeb({
        databaseUrl: integrationEnv.databaseUrl,
        port: webPort,
        workerPort,
        token: testToken,
        storageDir,
      });
      await waitForHttp(
        `http://127.0.0.1:${webPort}/api/health`,
        web,
        [200],
        180_000,
      );
    }, 240_000);

    afterAll(async () => {
      if (web) await web.stop();
      if (worker) await worker.stop();
      if (target) await target.stop();

      if (integrationEnv.blocker === null) {
        cleanup = await cleanupRows({
          databaseUrl: integrationEnv.databaseUrl,
          ownerId,
          scanIds: createdScanIds,
        });
        // Counts and names only; no URL, token, or row content is printed.
        process.stderr.write(
          `[integration] cleanup summary: ${JSON.stringify(cleanup)}\n`,
        );
      }
      await rm(storageDir, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }, 60_000);

    it("rejects an unauthenticated /enqueue request (401/403)", async () => {
      const scanId = randomUUID();
      createdScanIds.push(scanId);
      const response = await requestJson(
        `http://127.0.0.1:${workerPort}/enqueue`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            queue: "scan.site",
            payload: { scanId },
          }),
        },
        ErrorSchema,
      );
      authEnforced = response.status === 401 || response.status === 403;
      expect(
        authEnforced,
        `Worker /enqueue returned ${response.status}; expected 401/403. ` +
          "RUNBOOK.md requires WORKER_ENQUEUE_TOKEN auth, but no token " +
          "check exists in apps/worker/src/index.ts on this branch.",
      ).toBe(true);
    }, 30_000);

    it("accepts an authenticated /enqueue request (200)", async () => {
      if (!authEnforced) {
        throw new Error(
          "NOT VERIFIED: unauthenticated /enqueue was accepted, so token " +
            "acceptance is not meaningful. Enqueue auth is not implemented " +
            "in this branch (see RUNBOOK.md, 'Worker enqueue authentication').",
        );
      }
      const scanId = randomUUID();
      createdScanIds.push(scanId);
      const response = await requestJson(
        `http://127.0.0.1:${workerPort}/enqueue`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${testToken}`,
            "x-worker-enqueue-token": testToken,
          },
          body: JSON.stringify({
            queue: "scan.site",
            payload: { scanId },
          }),
        },
        ErrorSchema,
      );
      expect(
        response.status,
        `Authenticated /enqueue returned ${response.status}; expected 200.`,
      ).toBe(200);
    }, 30_000);

    it("creates a scan through POST /api/scans with the test owner cookie", async () => {
      expect(target).toBeDefined();
      const targetUrl = target?.url ?? "";
      const response = await requestJson(
        `http://127.0.0.1:${webPort}/api/scans`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: ownerCookie(ownerId),
          },
          body: JSON.stringify({ url: targetUrl }),
        },
        CreatedSchema,
      );
      expect(
        response.status,
        `POST /api/scans returned ${response.status}; expected 201.`,
      ).toBe(201);
      submittedScanId = response.data?.id ?? "";
      createdScanIds.push(submittedScanId);
      expect(
        UuidSchema.safeParse(submittedScanId).success,
        "POST /api/scans did not return a valid scan id.",
      ).toBe(true);
    }, 60_000);

    it("worker completes the scan and the GET report survives a refresh", async () => {
      const url = `http://127.0.0.1:${webPort}/api/scans/${submittedScanId}`;
      const deadline = Date.now() + 150_000;
      let lastStatus = "";
      let first: z.infer<typeof ReportEnvelopeSchema> | null = null;

      while (Date.now() < deadline) {
        const response = await requestJson(
          url,
          { headers: { cookie: ownerCookie(ownerId) } },
          ReportEnvelopeSchema,
        );
        if (response.data) {
          first = response.data;
          lastStatus = response.data.scan.status;
          if (lastStatus === "complete" || lastStatus === "failed") break;
        }
        await delay(1000);
      }

      expect(
        lastStatus,
        `Scan ${submittedScanId} never reached a terminal status ` +
          `(last=${lastStatus === "" ? "unknown" : lastStatus}).`,
      ).toBe("complete");
      expect(first).not.toBeNull();
      if (!first) return;

      const report = first.scan;
      expect(report.id).toBe(submittedScanId);
      expect(report.checks_total).toBe(31);
      const flatChecks = report.categories.flatMap(
        (category) => category.checks,
      );
      expect(flatChecks).toHaveLength(31);
      for (const check of flatChecks) {
        expect(
          CheckResultSchema.safeParse(check).success,
          `Check ${check.key} does not match CheckResult contract.`,
        ).toBe(true);
      }

      const refresh = await requestJson(
        url,
        { headers: { cookie: ownerCookie(ownerId) } },
        ReportEnvelopeSchema,
      );
      expect(refresh.status, `Refreshed GET returned ${refresh.status}.`).toBe(
        200,
      );
      expect(refresh.data).not.toBeNull();
      if (!refresh.data) return;
      const after = refresh.data.scan;
      expect(after.id).toBe(report.id);
      expect(after.share_token).toBe(report.share_token);
      expect(after.status).toBe("complete");
      expect(after.scores).toEqual(report.scores);
      expect(after.checks_total).toBe(report.checks_total);
    }, 180_000);

    it("recorded a cleanup summary for the disposable owner prefix", () => {
      expect(cleanup).not.toBeNull();
      expect(cleanup?.ownerId).toBe(ownerId);
    });
  },
);
