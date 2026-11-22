import { describe, expect, it } from "vitest";
import {
  hostnameToIpLiteral,
  isSafeIpAddress,
  normalizeUrl,
  UrlValidationError,
} from "./url.js";

describe("normalizeUrl", () => {
  it("adds https and lowercases the host", () => {
    expect(normalizeUrl("Example.COM/Path").href).toBe(
      "https://example.com/Path",
    );
  });

  it("strips credentials, fragments and default ports", () => {
    expect(normalizeUrl("https://user:pass@Example.com:443/a#frag").href).toBe(
      "https://example.com/a",
    );
  });

  it("rejects non-web schemes", () => {
    expect(() => normalizeUrl("ftp://example.com")).toThrow(UrlValidationError);
  });

  it("rejects localhost by name", () => {
    expect(() => normalizeUrl("http://localhost:3000")).toThrow(
      UrlValidationError,
    );
  });
});

describe("isSafeIpAddress", () => {
  it("allows public unicast addresses", () => {
    expect(isSafeIpAddress("8.8.8.8")).toBe(true);
    expect(isSafeIpAddress("2606:4700:4700::1111")).toBe(true);
  });

  it("blocks loopback, private, link-local and metadata addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.1",
      "192.168.1.1",
      "100.64.0.1",
      "169.254.169.254",
      "::1",
      "fc00::1",
    ]) {
      expect(isSafeIpAddress(ip)).toBe(false);
    }
  });

  it("blocks IPv4-mapped IPv6 loopback", () => {
    expect(isSafeIpAddress("::ffff:127.0.0.1")).toBe(false);
    expect(hostnameToIpLiteral("[::ffff:127.0.0.1]")).toBe("::ffff:127.0.0.1");
  });
});
