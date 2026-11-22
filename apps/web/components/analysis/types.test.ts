import { describe, expect, it } from "vitest";
import { isPollingExpired } from "./types.js";

describe("isPollingExpired", () => {
  const startedAtMs = 1_000_000;
  const defaultTimeout = 600_000;

  it("is false before the deadline", () => {
    expect(
      isPollingExpired(startedAtMs, startedAtMs + defaultTimeout - 1),
    ).toBe(false);
  });

  it("is true exactly at the deadline", () => {
    expect(isPollingExpired(startedAtMs, startedAtMs + defaultTimeout)).toBe(
      true,
    );
  });

  it("is true after the deadline", () => {
    expect(
      isPollingExpired(startedAtMs, startedAtMs + defaultTimeout + 1),
    ).toBe(true);
  });

  it("honours a custom timeout", () => {
    expect(isPollingExpired(startedAtMs, startedAtMs + 9_999, 10_000)).toBe(
      false,
    );
    expect(isPollingExpired(startedAtMs, startedAtMs + 10_000, 10_000)).toBe(
      true,
    );
  });
});
