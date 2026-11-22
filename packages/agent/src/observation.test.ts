import { describe, expect, it } from "vitest";
import { computeStateToken, nonceTag } from "./observation.js";

describe("nonceTag", () => {
  it("produces matching, randomized untrusted delimiters", () => {
    const first = nonceTag("page_html");
    const second = nonceTag("page_html");

    expect(first.open.startsWith("<UNTRUSTED_PAGE_HTML_")).toBe(true);
    expect(first.close).toBe(`</${first.open.slice(1, -1)}>`);
    expect(first.open).not.toBe(second.open);
    expect(first.close).not.toBe(second.close);
  });

  it("sanitizes non-alphanumeric labels", () => {
    const tag = nonceTag("details-json");
    expect(tag.open).toMatch(/^<UNTRUSTED_DETAILS_JSON_[0-9a-f]{16}>$/);
  });
});

describe("computeStateToken", () => {
  it("is deterministic for identical text and URL", () => {
    const a = computeStateToken("hello world", "https://example.com/");
    const b = computeStateToken("hello world", "https://example.com/");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when either input changes", () => {
    const base = computeStateToken("hello", "https://example.com/");
    expect(computeStateToken("goodbye", "https://example.com/")).not.toBe(base);
    expect(computeStateToken("hello", "https://example.com/other")).not.toBe(
      base,
    );
  });
});
