import type { AgentAction, ObservationTarget } from "@offscript/shared";
import { describe, expect, it } from "vitest";
import { DESTRUCTIVE_PATTERN, assertActionAllowed } from "./policy.js";

/** Observation targets may be enriched with raw DOM hints by a caller. */
type ObservedActionTarget = ObservationTarget & {
  inputType?: string;
  autocomplete?: string;
  attributes?: Record<string, string>;
};

function observedTarget(
  overrides: Partial<ObservedActionTarget> &
    Pick<ObservationTarget, "role" | "name" | "destination">,
): ObservedActionTarget {
  return {
    ...overrides,
    id: overrides.id ?? "t_test",
    role: overrides.role,
    name: overrides.name,
    destination: overrides.destination,
    state: overrides.state ?? { enabled: true },
    bounds: overrides.bounds ?? { x: 0, y: 0, width: 10, height: 10 },
  };
}

function typeAction(targetId: string, value = "hunter2"): AgentAction {
  return { kind: "type", target_id: targetId, value, reasoning: "test" };
}

function clickAction(targetId: string): AgentAction {
  return { kind: "click", target_id: targetId, reasoning: "test" };
}

describe("DESTRUCTIVE_PATTERN", () => {
  it("matches destructive and auth control labels", () => {
    expect(DESTRUCTIVE_PATTERN.test("Buy Now")).toBe(true);
    expect(DESTRUCTIVE_PATTERN.test("Sign in")).toBe(true);
    expect(DESTRUCTIVE_PATTERN.test("Submit order")).toBe(true);
    expect(DESTRUCTIVE_PATTERN.test("About us")).toBe(false);
  });
});

describe("assertActionAllowed", () => {
  it("blocks typing into a password field", () => {
    const action: AgentAction = {
      kind: "type",
      target_id: "t_test_0",
      value: "hunter2",
      reasoning: "test",
    };
    const result = assertActionAllowed(action, {
      role: "textbox",
      name: "Password",
      destination: null,
      inputType: "password",
      autocomplete: "current-password",
    });
    expect(result.allowed).toBe(false);
    expect(result.event.blocked).toBe(true);
    expect(result.event.rule).toBe("sensitive_input_blocked");
    expect(result.event.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("blocks typing into an email field", () => {
    const action: AgentAction = {
      kind: "type",
      target_id: "t_test_1",
      value: "user@example.com",
      reasoning: "test",
    };
    const result = assertActionAllowed(action, {
      role: "textbox",
      name: "Email",
      destination: null,
      inputType: "email",
    });
    expect(result.allowed).toBe(false);
    expect(result.event.blocked).toBe(true);
  });

  it("blocks clicking a Buy Now button", () => {
    const action: AgentAction = {
      kind: "click",
      target_id: "t_test_2",
      reasoning: "test",
    };
    const result = assertActionAllowed(action, {
      role: "button",
      name: "Buy Now",
      destination: null,
    });
    expect(result.allowed).toBe(false);
    expect(result.event.rule).toBe("destructive_click_blocked");
  });

  it("allows a harmless About link and still audits it", () => {
    const action: AgentAction = {
      kind: "click",
      target_id: "t_test_3",
      reasoning: "test",
    };
    const result = assertActionAllowed(action, {
      role: "link",
      name: "About",
      destination: "https://example.com/about",
    });
    expect(result.allowed).toBe(true);
    expect(result.event.blocked).toBe(false);
    expect(result.event.rule).toBe("action_allowed");
  });

  it("allows harmless navigation and records its destination", () => {
    const result = assertActionAllowed({
      kind: "navigate",
      url: "https://example.com/docs",
      reasoning: "read docs",
    });
    expect(result.allowed).toBe(true);
    expect(result.event.rule).toBe("action_allowed");
    expect(result.event.detail).toContain("https://example.com/docs");
    expect(result.event.detail).not.toContain("no destination");
  });
});

describe("assertActionAllowed with an ObservationTarget", () => {
  it("blocks typing into an ObservationTarget password field via its name", () => {
    // Observations carry role/name/destination/state but no inputType.
    const target = observedTarget({
      id: "t_pw_0",
      role: "textbox",
      name: "Password",
      destination: null,
      state: { enabled: true },
    });
    const result = assertActionAllowed(typeAction(target.id), target);
    expect(result.allowed).toBe(false);
    expect(result.event.rule).toBe("sensitive_input_blocked");
    expect(result.event.detail).toContain(`textbox "Password"`);
  });

  it("blocks typing when only raw attributes identify a sensitive field", () => {
    const target = observedTarget({
      id: "t_pw_1",
      role: "textbox",
      name: "Enter value",
      destination: null,
      attributes: { type: "password", autocomplete: "current-password" },
    });
    const result = assertActionAllowed(typeAction(target.id), target);
    expect(result.allowed).toBe(false);
    expect(result.event.rule).toBe("sensitive_input_blocked");
    expect(result.event.detail).toContain("type=password");
    expect(result.event.detail).toContain("autocomplete=current-password");
  });

  it("blocks typing when passthrough state identifies a sensitive field", () => {
    const target = observedTarget({
      id: "t_pw_2",
      role: "textbox",
      name: "Value",
      destination: null,
      state: { enabled: true, inputType: "password" },
    });
    const result = assertActionAllowed(typeAction(target.id), target);
    expect(result.allowed).toBe(false);
    expect(result.event.rule).toBe("sensitive_input_blocked");
    expect(result.event.detail).toContain("type=password");
  });

  it("blocks clicking an ObservationTarget Buy Now button", () => {
    const target = observedTarget({
      id: "t_buy_0",
      role: "button",
      name: "Buy Now",
      destination: null,
    });
    const result = assertActionAllowed(clickAction(target.id), target);
    expect(result.allowed).toBe(false);
    expect(result.event.rule).toBe("destructive_click_blocked");
    expect(result.event.detail).toContain(`button "Buy Now"`);
  });

  it("allows clicking an ObservationTarget harmless About link", () => {
    const target = observedTarget({
      id: "t_link_0",
      role: "link",
      name: "About",
      destination: "https://example.com/about",
    });
    const result = assertActionAllowed(clickAction(target.id), target);
    expect(result.allowed).toBe(true);
    expect(result.event.blocked).toBe(false);
    expect(result.event.rule).toBe("action_allowed");
    expect(result.event.detail).toContain("https://example.com/about");
  });
});
