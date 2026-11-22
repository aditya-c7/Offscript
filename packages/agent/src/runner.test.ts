import { describe, expect, it, vi } from "vitest";
import type { ZodType } from "zod";
import type { Page } from "playwright";
import {
  MAX_TURN_INPUT_TOKENS,
  VerifierResultSchema,
  type AgentAction,
  type ObservationV2,
  type PolicyEvent,
} from "@offscript/shared";
import { estimateTokens, type JsonModelCaller, type ModelRole } from "./llm.js";
import {
  buildAgentMessages,
  runTask,
  type AgentStep,
  type AgentTurn,
  type RunnerDeps,
} from "./runner.js";

function observation(
  stateToken: string,
  marker: string,
  withCookie = false,
): ObservationV2 {
  return {
    schema: "offscript.observation/v2",
    observation_id: `obs-${marker}`,
    state_token: stateToken,
    title: "Generic page",
    url: "https://example.com/page",
    truncated: false,
    omitted_nodes: [],
    public_search_target_id: null,
    errors: [],
    content: `visible content ${marker}`,
    headings: [{ level: 1, text: "Heading" }],
    navigation: [],
    nodes: [],
    targets: withCookie
      ? [
          {
            id: "t-accept",
            role: "button",
            name: "Accept",
            destination: null,
            state: {},
            bounds: { x: 0, y: 0, width: 10, height: 10 },
          },
        ]
      : [],
  };
}

/** Minimal browser stand-in; the runtime check makes the cast a validated one. */
function fakePage(clickSpy?: ReturnType<typeof vi.fn>): Page {
  const candidate = {
    locator: () => ({
      count: async () => 1,
      first: () => ({
        click: async () => {
          clickSpy?.();
        },
      }),
    }),
    goto: async () => null,
    mouse: { wheel: async () => undefined },
  };
  if (
    !("locator" in candidate) ||
    !("goto" in candidate) ||
    !("mouse" in candidate)
  ) {
    throw new Error("invalid fake page");
  }
  return candidate as unknown as Page;
}

const allow = (
  action: AgentAction,
): { allowed: boolean; event: PolicyEvent } => ({
  allowed: true,
  event: {
    at: "2026-01-01T00:00:00.000Z",
    rule: "test",
    detail: action.kind,
    blocked: false,
  },
});

function increasingClock(): () => number {
  let tick = 1_000;
  return () => {
    tick += 100;
    return tick;
  };
}

const extractAction: AgentAction = {
  kind: "extract",
  question: "What is on this page?",
  reasoning: "Learn about the page.",
};

describe("runTask loop control", () => {
  it("warns on the first repeated state and exits as no_clear_result on the second", async () => {
    // Identical content/title/targets is a genuine stall; a token-only match
    // with changing content is not.
    const observations = [
      observation("same", "same"),
      observation("same", "same"),
      observation("same", "same"),
      observation("same", "same"),
    ];
    let observationIndex = 0;
    const steps: AgentStep[] = [];
    const roles: ModelRole[] = [];
    const deps: RunnerDeps = {
      captureObservation: async () => {
        const next =
          observations[Math.min(observationIndex, observations.length - 1)];
        observationIndex += 1;
        if (next === undefined) throw new Error("missing observation");
        return next;
      },
      captureScreenshots: async () => ({
        numberedPath: "n.png",
        finalPath: "f.png",
      }),
      assertActionAllowed: allow,
      persistStep: async (step) => {
        steps.push(step);
      },
      callJson: async <T>(role: ModelRole, schema: ZodType<T>) => {
        roles.push(role);
        const parsed = schema.safeParse(extractAction);
        if (!parsed.success) throw new Error("invalid fake action");
        return { value: parsed.data, inputTokens: 3, outputTokens: 2 };
      },
      now: increasingClock(),
    };

    const result = await runTask({
      page: fakePage(),
      profile: "text_structure",
      task: "Find a fact",
      successCriteria: "Reports a fact",
      detailsLines: [],
      outDir: "out",
      runId: "run-1",
      deps,
    });

    expect(result.verdict).toBe("no_clear_result");
    expect(result.answer).toContain("visible content same");
    expect(result.evidenceQuotes.length).toBeGreaterThan(0);
    expect(result.screenshots).not.toBeNull();
    expect(result.steps).toHaveLength(3);
    // The verifier's fake response fails validation and throws before tokens
    // are counted, so only the two agent decisions contribute here.
    expect(result.inputTokens).toBe(6);
    expect(result.outputTokens).toBe(4);
    expect(
      steps.some((step) => step.metadata["repeated_state_token"] === true),
    ).toBe(true);
    expect(steps.some((step) => step.metadata["stuck_loop"] === true)).toBe(
      true,
    );
    expect(roles).toEqual(["agent", "agent", "fast"]);
  });

  it("does not click when the policy gate blocks the action", async () => {
    const clickSpy = vi.fn();
    const recordedSteps: AgentStep[] = [];
    const clickAction: AgentAction = {
      kind: "click",
      target_id: "t-one",
      reasoning: "Try a link.",
    };
    const obs = observation("state", "marker");
    obs.targets = [
      {
        id: "t-one",
        role: "link",
        name: "A link",
        destination: "https://example.com/next",
        state: {},
        bounds: { x: 0, y: 0, width: 10, height: 10 },
      },
    ];

    const deps: RunnerDeps = {
      captureObservation: async () => obs,
      captureScreenshots: async () => ({
        numberedPath: "n.png",
        finalPath: "f.png",
      }),
      assertActionAllowed: (action) => ({
        allowed: false,
        event: {
          at: "2026-01-01T00:00:00.000Z",
          rule: "blocked",
          detail: action.kind,
          blocked: true,
        },
      }),
      persistStep: async (step) => {
        recordedSteps.push(step);
      },
      callJson: async <T>(_role: ModelRole, schema: ZodType<T>) => {
        const parsed = schema.safeParse(clickAction);
        if (!parsed.success) throw new Error("invalid fake action");
        return { value: parsed.data, inputTokens: 1, outputTokens: 1 };
      },
      now: increasingClock(),
    };

    const result = await runTask({
      page: fakePage(clickSpy),
      profile: "visual_screen",
      task: "Find a fact",
      successCriteria: "Reports a fact",
      detailsLines: [],
      outDir: "out",
      runId: "run-2",
      deps,
    });

    expect(result.verdict).toBe("no_clear_result");
    expect(clickSpy).not.toHaveBeenCalled();
    expect(
      recordedSteps.some((step) => step.metadata["blocked_by_policy"] === true),
    ).toBe(true);
  });
});

describe("runTask result propagation", () => {
  const doneAction: AgentAction = {
    kind: "done",
    answer: "The price is $42.",
    evidence_quotes: ["Price: $42"],
    reasoning: "Criterion met.",
  };

  it("propagates a done answer, attaches screenshots to the step/result, and gives vision the numbered image", async () => {
    const screenshotSpy = vi.fn((args: { step: number }) => ({
      numberedPath: `numbered-${args.step}.png`,
      finalPath: "final.png",
    }));
    const visionText: string[] = [];
    const deps: RunnerDeps = {
      captureObservation: async () => observation("state", "marker"),
      captureScreenshots: async (args) => screenshotSpy(args),
      assertActionAllowed: allow,
      persistStep: async () => undefined,
      callJson: async <T>(
        role: ModelRole,
        schema: ZodType<T>,
        messages: { content: string }[],
      ) => {
        if (role === "fast") {
          const value = VerifierResultSchema.parse({
            verdict: "pass",
            reasons: ["grounded"],
            grounded: true,
          });
          return { value: value as T, inputTokens: 1, outputTokens: 1 };
        }
        visionText.push(messages.map((m) => m.content).join("\n"));
        const parsed = schema.safeParse(doneAction);
        if (!parsed.success) throw new Error("invalid fake action");
        return { value: parsed.data, inputTokens: 1, outputTokens: 1 };
      },
      now: increasingClock(),
    };

    const result = await runTask({
      page: fakePage(),
      profile: "visual_screen",
      task: "Find the price",
      successCriteria: "Reports the price",
      detailsLines: [],
      outDir: "out",
      runId: "run-done",
      deps,
    });

    expect(result.verdict).toBe("pass");
    expect(result.answer).toBe("The price is $42.");
    expect(result.evidenceQuotes).toEqual(["Price: $42"]);
    expect(result.screenshots?.numberedPath).toBe("numbered-0.png");
    expect(result.steps).toHaveLength(1);
    expect(
      (result.steps[0] as { screenshots?: { numberedPath: string } })
        .screenshots?.numberedPath,
    ).toBe("numbered-0.png");
    expect(screenshotSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        outDir: "out",
        runId: "run-done",
        step: 0,
      }),
    );
    expect(visionText).toHaveLength(1);
    expect(visionText[0]).toContain("numbered-0.png");
  });

  it("ends null/invalid actions as no_clear_result with an observation-derived answer", async () => {
    const recorded: AgentStep[] = [];
    const deps: RunnerDeps = {
      captureObservation: async () => observation("state", "marker"),
      captureScreenshots: async () => ({
        numberedPath: "n.png",
        finalPath: "f.png",
      }),
      assertActionAllowed: allow,
      persistStep: async (step) => {
        recorded.push(step);
      },
      callJson: async <T>(role: ModelRole) => {
        if (role === "fast") {
          const value = VerifierResultSchema.parse({
            verdict: "no_clear_result",
            reasons: [],
            grounded: false,
          });
          return { value: value as T, inputTokens: 0, outputTokens: 0 };
        }
        throw new Error("invalid fake action");
      },
      now: increasingClock(),
    };

    const result = await runTask({
      page: fakePage(),
      profile: "text_structure",
      task: "Find a fact",
      successCriteria: "Reports a fact",
      detailsLines: [],
      outDir: "out",
      runId: "run-invalid",
      deps,
    });

    expect(result.verdict).toBe("no_clear_result");
    expect(result.answer).toContain("visible content marker");
    expect(result.evidenceQuotes.length).toBeGreaterThan(0);
    expect(recorded.every((step) => step.action === null)).toBe(true);
    expect(
      recorded.some((step) => step.metadata["invalid_action"] === true),
    ).toBe(true);
  });
});

describe("buildAgentMessages", () => {
  it("keeps the two newest observations full and summarizes older turns", () => {
    const turns: AgentTurn[] = [0, 1, 2, 3].map((i) => ({
      index: i,
      observation: observation(`token-${i}`, `T${i}`),
      action: { kind: "scroll", direction: "down", reasoning: "look further" },
    }));
    const current = observation("token-current", "CURRENT");
    const details = ["CUSTOM_DETAIL_MARKER"];

    const messages = buildAgentMessages(
      {
        task: "Find a price",
        successCriteria: "Reports the price",
        detailsLines: details,
        profile: "text_structure",
      },
      current,
      turns,
      ["WORKING_MEMORY_MARKER"],
    );
    const joined = messages.map((m) => m.content).join("\n");

    expect(joined).toContain("CURRENT");
    expect(joined).toContain("T3");
    expect(joined).not.toContain("T0");
    expect(joined).not.toContain("T1");
    expect(joined).toContain("step summary:");
    expect(joined).toContain("WORKING_MEMORY_MARKER");
    expect(joined).toContain("CUSTOM_DETAIL_MARKER");
    expect(joined).toContain("OFFSCRIPT_UNTRUSTED_DATA");
    expect(estimateTokens(joined)).toBeLessThanOrEqual(MAX_TURN_INPUT_TOKENS);
  });
});
