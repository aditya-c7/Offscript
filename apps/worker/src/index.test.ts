import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";

type HandleRequest = (typeof import("./index.js"))["handleRequest"];
type IsAuthorizedEnqueue = (typeof import("./index.js"))["isAuthorizedEnqueue"];

const TOKEN = "unit-test-worker-enqueue-token";

let handleRequest: HandleRequest;
let isAuthorizedEnqueue: IsAuthorizedEnqueue;

beforeAll(async () => {
  // Satisfy the worker's module-load env validation without real secrets.
  // VITEST=true keeps main() from binding a port or starting pg-boss/Chromium.
  vi.stubEnv("VITEST", "true");
  vi.stubEnv(
    "DATABASE_URL",
    "postgres://user:pass@127.0.0.1:5432/offscript_test",
  );
  vi.stubEnv("DB_DRIVER", "neon-http");
  vi.stubEnv("WORKER_ENQUEUE_TOKEN", TOKEN);

  const module = await import("./index.js");
  handleRequest = module.handleRequest;
  isAuthorizedEnqueue = module.isAuthorizedEnqueue;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Real Node request object with no server or socket I/O. */
function fakeRequest(authorization?: string): IncomingMessage {
  const req = new IncomingMessage(new Socket());
  req.method = "POST";
  req.url = "/enqueue";
  if (authorization !== undefined) req.headers.authorization = authorization;
  return req;
}

function fakeResponse() {
  const res = new ServerResponse(fakeRequest());
  const endSpy = vi.spyOn(res, "end").mockImplementation(() => res);
  return { res, endSpy };
}

describe("worker enqueue authentication (offline)", () => {
  it("denies a request with no Authorization header with HTTP 401", async () => {
    expect(isAuthorizedEnqueue(fakeRequest())).toBe(false);

    const { res, endSpy } = fakeResponse();
    await handleRequest(fakeRequest(), res);

    expect(res.statusCode).toBe(401);
    expect(endSpy).toHaveBeenCalledWith(
      JSON.stringify({ error: "unauthorized" }),
    );
  });

  it("denies an invalid token and a non-Bearer scheme", () => {
    expect(isAuthorizedEnqueue(fakeRequest(`Bearer ${TOKEN}-wrong`))).toBe(
      false,
    );
    expect(isAuthorizedEnqueue(fakeRequest(`Basic ${TOKEN}`))).toBe(false);
    expect(isAuthorizedEnqueue(fakeRequest("Bearer"))).toBe(false);
  });

  it("accepts the exact configured Bearer token", () => {
    expect(isAuthorizedEnqueue(fakeRequest(`Bearer ${TOKEN}`))).toBe(true);
  });

  it("denies every request when no token is configured (fail closed)", () => {
    vi.stubEnv("WORKER_ENQUEUE_TOKEN", "   ");
    try {
      expect(isAuthorizedEnqueue(fakeRequest(`Bearer ${TOKEN}`))).toBe(false);
    } finally {
      vi.stubEnv("WORKER_ENQUEUE_TOKEN", TOKEN);
    }
  });

  it("logs only the status, never the token", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await handleRequest(
      fakeRequest(`Bearer ${TOKEN}-wrong`),
      fakeResponse().res,
    );

    expect(warnSpy).toHaveBeenCalledWith(
      "[offscript] enqueue request rejected",
      401,
    );
    for (const args of warnSpy.mock.calls) {
      expect(JSON.stringify(args)).not.toContain(TOKEN);
    }
  });
});
