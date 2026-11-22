import { describe, expect, it } from "vitest";
import { cn, formatDate } from "./utils.js";

describe("cn", () => {
  it("merges conditional classes and deduplicates tailwind utilities", () => {
    expect(cn("px-2", "px-4", false && "hidden", "text-sm")).toBe(
      "px-4 text-sm",
    );
  });
});

describe("formatDate", () => {
  it("formats an ISO date in a stable form", () => {
    expect(formatDate("2026-01-02T00:00:00.000Z")).toMatch(
      /Jan 2, 2026|Jan 1, 2026/,
    );
  });

  it("returns the input when it is not a date", () => {
    expect(formatDate("not-a-date")).toBe("not-a-date");
  });
});
