import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANALYSIS_QUEUE,
  SCAN_QUEUE,
  enqueueAnalysis,
  enqueueScan,
} from "./queue.js";

const SCAN_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const ANALYSIS_ID = "123e4567-e89b-42d3-a456-426614174000";
const DEFAULT_URL = "http://localhost:8787/enqueue";
const TOKEN = "test-worker-enqueue-token";

const fetchMock = vi.fn<typeof fetch>();

function okResponse(): Response {
  return new Response(null, { status: 200 });
}

function postedHeaders(): unknown {
  const call = fetchMock.mock.calls[0];
  expect(call).toBeDefined();
  return call?.[1]?.headers;
}

function postedBody(): unknown {
  const call = fetchMock.mock.calls[0];
  expect(call).toBeDefined();
  if (!call) return undefined;
  const init = call[1];
  expect(init?.method).toBe("POST");
  expect(postedHeaders()).toEqual({
    "content-type": "application/json",
    authorization: `Bearer ${TOKEN}`,
  });
  return JSON.parse(String(init?.body));
}

describe("web enqueue HTTP client", () => {
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

  it("POSTs a scan job to the default worker URL", async () => {
    await enqueueScan(SCAN_ID);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(DEFAULT_URL);
    expect(postedBody()).toEqual({
      queue: SCAN_QUEUE,
      payload: { scanId: SCAN_ID },
    });
  });

  it("POSTs an analysis job with the analysis queue name", async () => {
    await enqueueAnalysis(ANALYSIS_ID);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(postedBody()).toEqual({
      queue: ANALYSIS_QUEUE,
      payload: { analysisId: ANALYSIS_ID },
    });
  });

  it("sends the configured token in the Authorization header", async () => {
    vi.stubEnv("WORKER_ENQUEUE_TOKEN", "another-secret-value");

    await enqueueScan(SCAN_ID);

    expect(postedHeaders()).toEqual({
      "content-type": "application/json",
      authorization: "Bearer another-secret-value",
    });
  });

  it("omits the Authorization header and warns when no token is configured", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    vi.stubEnv("WORKER_ENQUEUE_TOKEN", "   ");

    await enqueueScan(SCAN_ID);

    expect(postedHeaders()).toEqual({ "content-type": "application/json" });
    expect(warnSpy).toHaveBeenCalledWith(
      "[offscript] queue enqueue missing worker token",
    );
    // The worker rejects this request with 401, so nothing is enqueued.
  });

  it("uses WORKER_ENQUEUE_URL when it is a valid http(s) URL", async () => {
    vi.stubEnv("WORKER_ENQUEUE_URL", "https://worker.internal:9000/hook");

    await enqueueScan(SCAN_ID);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://worker.internal:9000/hook",
    );
  });

  it("falls back to the default URL when WORKER_ENQUEUE_URL is invalid", async () => {
    vi.stubEnv("WORKER_ENQUEUE_URL", "not a url");

    await enqueueScan(SCAN_ID);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(DEFAULT_URL);
  });

  it("never issues a request for an invalid id", async () => {
    await enqueueScan("not-a-uuid");
    await enqueueAnalysis("");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("swallows network failures and logs only the error name", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    fetchMock.mockRejectedValue(
      new TypeError("dial tcp 127.0.0.1 failed for secret-token-abc"),
    );

    await expect(enqueueScan(SCAN_ID)).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      "[offscript] queue enqueue failed",
      "TypeError",
    );
    for (const args of errorSpy.mock.calls) {
      expect(JSON.stringify(args)).not.toContain(SCAN_ID);
      expect(JSON.stringify(args)).not.toContain("secret-token-abc");
    }
  });

  it("swallows non-2xx responses without leaking the payload", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));

    await expect(enqueueAnalysis(ANALYSIS_ID)).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      "[offscript] queue enqueue failed",
      "EnqueueHttpError",
    );
    for (const args of errorSpy.mock.calls) {
      expect(JSON.stringify(args)).not.toContain(ANALYSIS_ID);
    }
  });

  it("never logs the token value", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));

    await enqueueScan(SCAN_ID);

    for (const args of [...errorSpy.mock.calls, ...warnSpy.mock.calls]) {
      expect(JSON.stringify(args)).not.toContain(TOKEN);
    }
  });
});
