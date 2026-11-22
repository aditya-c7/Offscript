import type { AgentAction } from "@offscript/shared";
import { describe, expect, it } from "vitest";
import { DESTRUCTIVE_PATTERN, assertActionAllowed } from "./policy.js";

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
});
