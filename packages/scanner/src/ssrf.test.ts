import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SsrfValidationError,
  assertSafeUrl,
  resolveAndValidate,
} from "./ssrf.js";

const lookupMock = vi.hoisted(() => ({ lookup: vi.fn() }));

vi.mock("node:dns", () => ({
  promises: { lookup: lookupMock.lookup },
}));

type LookupAnswer = { address: string; family: number };

function answer(hostname: string, addresses: LookupAnswer[]): void {
  lookupMock.lookup.mockImplementation(async (name: string) => {
    if (name === hostname) return addresses;
    return [];
  });
}

describe("assertSafeUrl", () => {
  beforeEach(() => {
    lookupMock.lookup.mockReset();
  });

  it("blocks localhost by hostname", async () => {
    await expect(assertSafeUrl("http://localhost")).rejects.toBeInstanceOf(
      SsrfValidationError,
    );
  });

  it("blocks loopback IPv4 literals", async () => {
    await expect(assertSafeUrl("http://127.0.0.1")).rejects.toBeInstanceOf(
      SsrfValidationError,
    );
  });

  it("blocks the 169.0.0.0/8 family", async () => {
    await expect(assertSafeUrl("http://169.0.0.1")).rejects.toBeInstanceOf(
      SsrfValidationError,
    );
  });

  it("blocks the cloud metadata link-local address", async () => {
    await expect(
      assertSafeUrl("http://169.254.169.254"),
    ).rejects.toBeInstanceOf(SsrfValidationError);
  });

  it("blocks IPv4-mapped IPv6 loopback", async () => {
    await expect(
      assertSafeUrl("http://[::ffff:127.0.0.1]"),
    ).rejects.toBeInstanceOf(SsrfValidationError);
  });

  it("blocks IPv6 loopback", async () => {
    await expect(assertSafeUrl("http://[::1]")).rejects.toBeInstanceOf(
      SsrfValidationError,
    );
  });

  it("blocks a hostname whose DNS answer contains a private address", async () => {
    answer("mixed.example", [
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(
      assertSafeUrl("https://mixed.example/"),
    ).rejects.toBeInstanceOf(SsrfValidationError);
  });

  it("rejects a hostname with no DNS answers", async () => {
    answer("empty.example", []);
    await expect(
      assertSafeUrl("https://empty.example/"),
    ).rejects.toBeInstanceOf(SsrfValidationError);
  });

  it("accepts a normal public hostname", async () => {
    answer("example.com", [{ address: "93.184.216.34", family: 4 }]);
    const result = await assertSafeUrl("https://example.com/some/path");
    expect(result.ip).toBe("93.184.216.34");
    expect(result.url.href).toBe("https://example.com/some/path");
  });

  it("validates literal IPs without DNS", async () => {
    const result = await assertSafeUrl("http://8.8.8.8/x");
    expect(result.ip).toBe("8.8.8.8");
    expect(lookupMock.lookup).not.toHaveBeenCalled();
  });
});

describe("resolveAndValidate", () => {
  beforeEach(() => {
    lookupMock.lookup.mockReset();
  });

  it("rejects a literal loopback address", async () => {
    await expect(resolveAndValidate("127.0.0.1")).rejects.toBeInstanceOf(
      SsrfValidationError,
    );
  });

  it("returns the first safe address", async () => {
    answer("good.example", [{ address: "1.1.1.1", family: 4 }]);
    await expect(resolveAndValidate("good.example")).resolves.toBe("1.1.1.1");
  });
});
