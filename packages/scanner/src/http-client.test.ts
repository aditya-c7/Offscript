import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeFetch } from "./http-client.js";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  lookup: vi.fn(),
  close: vi.fn(),
}));

vi.mock("node:dns", () => ({
  promises: { lookup: mocks.lookup },
}));

vi.mock("undici", () => ({
  Agent: class {
    close(): Promise<void> {
      mocks.close();
      return Promise.resolve();
    }
    destroy(): void {
      // no-op in tests
    }
  },
  buildConnector: () => () => {
    // no-op connector for tests
  },
  fetch: mocks.fetch,
}));

class FakeHeaders {
  private readonly values = new Map<string, string>();

  constructor(entries: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(entries)) {
      this.values.set(key.toLowerCase(), value);
    }
  }

  get(name: string): string | null {
    return this.values.get(name.toLowerCase()) ?? null;
  }

  forEach(callback: (value: string, key: string) => void): void {
    this.values.forEach((value, key) => callback(value, key));
  }
}

function textBody(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller: ReadableStreamDefaultController<Uint8Array>) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function fakeResponse(options: {
  status: number;
  text?: string;
  headers?: Record<string, string>;
  url?: string;
}): unknown {
  return {
    status: options.status,
    headers: new FakeHeaders(options.headers ?? {}),
    body: textBody(options.text ?? ""),
    url: options.url ?? "",
  };
}

function firstCallArgument(index: number): unknown {
  const call: unknown[] | undefined = mocks.fetch.mock.calls[0];
  if (call === undefined) throw new Error("fetch was not called");
  return call[index];
}

describe("safeFetch SSRF guards", () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
    mocks.lookup.mockReset();
    mocks.close.mockReset();
    mocks.lookup.mockImplementation(async (hostname: string) =>
      hostname === "public.example"
        ? [{ address: "93.184.216.34", family: 4 }]
        : [],
    );
  });

  it.each([
    "http://localhost/",
    "http://127.0.0.1/",
    "http://169.0.0.1/",
    "http://169.254.169.254/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::1]/",
  ])("blocks %s before issuing a request", async (url) => {
    await expect(safeFetch(url)).rejects.toThrow();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("blocks a redirect chain that ends at loopback", async () => {
    mocks.fetch.mockResolvedValueOnce(
      fakeResponse({
        status: 302,
        headers: { location: "http://127.0.0.1/secret" },
      }),
    );

    await expect(safeFetch("https://public.example/start")).rejects.toThrow();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("blocks a redirect to a hostname resolving to loopback", async () => {
    mocks.lookup.mockImplementation(async (hostname: string) => {
      if (hostname === "public.example") {
        return [{ address: "93.184.216.34", family: 4 }];
      }
      if (hostname === "loop.example") {
        return [{ address: "127.0.0.1", family: 4 }];
      }
      return [];
    });
    mocks.fetch.mockResolvedValueOnce(
      fakeResponse({
        status: 301,
        headers: { location: "http://loop.example/secret" },
      }),
    );

    await expect(safeFetch("https://public.example/start")).rejects.toThrow();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("caps the redirect chain at five hops", async () => {
    for (let i = 0; i < 6; i += 1) {
      mocks.fetch.mockResolvedValueOnce(
        fakeResponse({
          status: 302,
          headers: { location: `https://public.example/hop/${String(i)}` },
        }),
      );
    }
    await expect(safeFetch("https://public.example/start")).rejects.toThrow(
      /redirect/i,
    );
    expect(mocks.fetch).toHaveBeenCalledTimes(6);
  });

  it("returns a bounded response with the default agent user-agent", async () => {
    mocks.fetch.mockResolvedValueOnce(
      fakeResponse({
        status: 200,
        text: "hello world",
        headers: { "content-type": "text/html; charset=utf-8" },
        url: "https://public.example/final",
      }),
    );

    const result = await safeFetch("https://public.example/page");
    expect(result.status).toBe(200);
    expect(result.text).toBe("hello world");
    expect(result.url).toBe("https://public.example/final");
    expect(result.contentType).toBe("text/html; charset=utf-8");
    expect(mocks.fetch).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        headers: expect.objectContaining({
          "user-agent": "Offscript-Agent/1.0",
        }),
      }),
    );
  });

  it("strips credentials from the requested URL", async () => {
    mocks.fetch.mockResolvedValueOnce(
      fakeResponse({ status: 200, text: "", url: "https://public.example/" }),
    );

    await safeFetch("https://user:pass@public.example/");
    expect(String(firstCallArgument(0))).not.toContain("user:pass");
  });
});
