import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ScanReportSchema } from "@offscript/shared";
/* NOTE: the `@/...` tsconfig alias used by Next.js is not resolvable by the
 * package's bare `vitest run` (there is no vitest config with alias support).
 * These relative specifiers target the exact same source modules, so the
 * runtime contract is exercised without a Node-only code path or a mock. */
import {
  ANALYSIS_QUEUE,
  SCAN_QUEUE,
  enqueueAnalysis,
  enqueueScan,
} from "./queue.js";
import {
  buildScanReportFromRows,
  type ScanReportQueryRow,
} from "../app/api/_lib/get-scan-report.js";

/* ------------------------------------------------------------------ */
/* Shared fixtures / helpers                                           */
/* ------------------------------------------------------------------ */

const SCAN_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const ANALYSIS_ID = "123e4567-e89b-42d3-a456-426614174000";
const DEFAULT_URL = "http://localhost:8787/enqueue";
const TOKEN = "dummy-runtime-contract-token";

/** Validate the HTTP envelope before asserting on it (no unvalidated casts). */
const EnvelopeSchema = z.object({
  queue: z.string(),
  payload: z.record(z.string(), z.unknown()),
});

const fetchMock = vi.fn<typeof fetch>();

function postedBody(): z.infer<typeof EnvelopeSchema> {
  const call = fetchMock.mock.calls[0];
  expect(call).toBeDefined();
  if (!call) throw new Error("fetch was not called");
  const init = call[1];
  expect(init?.method).toBe("POST");
  expect(init?.headers).toEqual({
    "content-type": "application/json",
    authorization: `Bearer ${TOKEN}`,
  });
  const raw: unknown = JSON.parse(String(init?.body));
  return EnvelopeSchema.parse(raw);
}

function okResponse(): Response {
  return new Response(null, { status: 200 });
}

function minimalRow(): ScanReportQueryRow {
  const createdAt = new Date("2026-01-02T00:00:00.000Z");
  return {
    scan: {
      id: SCAN_ID,
      shareToken: "share-token-abc123",
      status: "complete",
      rubricVersion: "offscript.rubric/v2.0.0",
      pipelineVersion: "offscript-pipeline/v2.2.0",
      scoreFind: null,
      scoreUnderstand: null,
      scoreAct: null,
      scoreProtocols: null,
      standardsModifier: null,
      scoreOverall: null,
      coverageJson: {},
      interpretationJson: null,
      protocolsJson: [],
      createdAt,
      completedAt: createdAt,
    },
    site: {
      url: "https://example.com/",
      normalizedHost: "example.com",
      detectedStack: "generic",
      ownerCookieId: "owner-1",
    },
    checks: [],
  };
}

/* ------------------------------------------------------------------ */
/* 1. Web enqueue contract — offline, fetch fully mocked               */
/* ------------------------------------------------------------------ */

describe("web runtime: enqueue contract (no real network)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("WORKER_ENQUEUE_TOKEN", TOKEN);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("uses the stable queue names", () => {
    expect(SCAN_QUEUE).toBe("scan.site");
    expect(ANALYSIS_QUEUE).toBe("agent.run");
  });

  it("enqueueScan POSTs the scan queue with the scanId payload", async () => {
    await enqueueScan(SCAN_ID);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(DEFAULT_URL);
    expect(postedBody()).toEqual({
      queue: SCAN_QUEUE,
      payload: { scanId: SCAN_ID },
    });
  });

  it("enqueueAnalysis POSTs the analysis queue with the analysisId payload", async () => {
    await enqueueAnalysis(ANALYSIS_ID);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(DEFAULT_URL);
    expect(postedBody()).toEqual({
      queue: ANALYSIS_QUEUE,
      payload: { analysisId: ANALYSIS_ID },
    });
  });

  it("accepts a valid http(s) WORKER_ENQUEUE_URL", async () => {
    vi.stubEnv("WORKER_ENQUEUE_URL", "https://worker.internal:9000/hook");

    await enqueueScan(SCAN_ID);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://worker.internal:9000/hook",
    );
  });

  it("falls back to the default URL for a malformed enqueue URL", async () => {
    vi.stubEnv("WORKER_ENQUEUE_URL", "not a url");

    await enqueueScan(SCAN_ID);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(DEFAULT_URL);
  });

  it("falls back to the default URL for a non-http(s) enqueue URL", async () => {
    vi.stubEnv("WORKER_ENQUEUE_URL", "ftp://worker.internal/enqueue");

    await enqueueScan(SCAN_ID);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(DEFAULT_URL);
  });

  it("never issues a request for invalid ids", async () => {
    await enqueueScan("not-a-uuid");
    await enqueueAnalysis("");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* 2. Result reads work with in-memory rows — no DB drivers loaded      */
/* ------------------------------------------------------------------ */

describe("web runtime: scan report reads without DB drivers", () => {
  it("builds a valid ScanReport from a single in-memory row", () => {
    const report = buildScanReportFromRows(minimalRow());

    expect(report).not.toBeNull();
    if (!report) throw new Error("expected a ScanReport");
    expect(ScanReportSchema.safeParse(report).success).toBe(true);

    expect(report.id).toBe(SCAN_ID);
    expect(report.host).toBe("example.com");
    expect(report.status).toBe("complete");
    expect(report.checks_total).toBe(0);
    expect(report.categories).toHaveLength(4);
  });

  it("accepts a .limit(1)-style array of rows", () => {
    const report = buildScanReportFromRows([minimalRow()]);

    expect(report).not.toBeNull();
    if (!report) throw new Error("expected a ScanReport");
    expect(ScanReportSchema.safeParse(report).success).toBe(true);
  });

  it("gates by owner cookie id without any database access", () => {
    expect(buildScanReportFromRows(minimalRow(), "owner-1")).not.toBeNull();
    expect(buildScanReportFromRows(minimalRow(), "someone-else")).toBeNull();
    expect(buildScanReportFromRows(null)).toBeNull();
  });
});
