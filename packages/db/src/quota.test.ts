import { describe, expect, it } from "vitest";
import { decideSettlement } from "./quota.js";

describe("decideSettlement", () => {
  it("credits an analysis whose only run passed", () => {
    expect(decideSettlement(["pass"], false)).toEqual({
      shouldSettle: true,
      shouldCredit: true,
    });
  });

  it("credits an analysis whose only run failed", () => {
    expect(decideSettlement(["fail"], false)).toEqual({
      shouldSettle: true,
      shouldCredit: true,
    });
  });

  it("never credits when the only result is no_clear_result", () => {
    expect(decideSettlement(["no_clear_result"], false)).toEqual({
      shouldSettle: true,
      shouldCredit: false,
    });
  });

  it("never credits when the only result is infra_error", () => {
    expect(decideSettlement(["infra_error"], false)).toEqual({
      shouldSettle: true,
      shouldCredit: false,
    });
  });

  it("credits a mixed set containing one pass, but only once", () => {
    const verdicts = ["infra_error", "no_clear_result", "pass", "fail"];
    expect(decideSettlement(verdicts, false)).toEqual({
      shouldSettle: true,
      shouldCredit: true,
    });
    // Once settled, a second call cannot settle or credit again.
    expect(decideSettlement(verdicts, true)).toEqual({
      shouldSettle: false,
      shouldCredit: false,
    });
  });

  it("never settles again once credit was consumed", () => {
    expect(decideSettlement(["pass"], true)).toEqual({
      shouldSettle: false,
      shouldCredit: false,
    });
  });

  it("settles without crediting when there are no runs at all", () => {
    expect(decideSettlement([], false)).toEqual({
      shouldSettle: true,
      shouldCredit: false,
    });
  });

  it("ignores null verdicts", () => {
    expect(decideSettlement([null, null], false)).toEqual({
      shouldSettle: true,
      shouldCredit: false,
    });
  });
});
