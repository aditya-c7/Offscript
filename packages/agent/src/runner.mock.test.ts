/**
 * Runner-level proof (NOT a worker-to-database E2E test).
 *
 * This file exercises `runTask` with injected `RunnerDeps` only. The provider
 * is a mock `callJson` that returns a schema-valid `done` AgentAction, and the
 * verifier path is mocked through the same injected caller (role `fast`).
 * No browser, no live LLM, no worker, and no real database are involved.
 * `persistStep` is an in-memory spy standing in for the database write; the
 * assertions below prove the runner hands the done action and its evidence
 * quote to that boundary. They do NOT claim that a worker persisted anything
 * to Postgres.
 */
import type { Page } from "playwright";
import type { ZodType } from "zod";
import { describe, expect, it } from "vitest";
import type {
  AgentAction,
  ObservationV2,
  PolicyEvent,
} from "@offscript/shared";
import type { ModelRole } from "./llm.js";
import { runTask, type AgentStep, type RunnerDeps } from "./runner.js";

const ANSWER = "The total is $42.00.";
const QUOTE = "Total: $42.00";

const doneAction: AgentAction = {
  kind: "done",
  answer: ANSWER,
  evidence_quotes: [QUOTE],
  reasoning: "The success criterion is met by the quoted page text.",
};

function observation(): ObservationV2 {
  return {
    schema: "offscript.observation/v2",
    observation_id: "obs-evidence-proof",
    state_token: "token-evidence-proof",
    title: "Order summary",
    url: "https://example.com/order",
    truncated: false,
    omitted_nodes: [],
    public_search_target_id: null,
    errors: [],
    content: `Checkout total shown on page: ${QUOTE}`,
    headings: [{ level: 1, text: "Order summary" }],
    navigation: [],
    nodes: [],
    targets: [],
  };
}

/**
 * Minimal browser stand-in. The done path never touches the page; the runtime
 * check makes the narrowing to `Page` a validated one rather than a blind cast.
 */
function fakePage(): Page {
  const candidate = {
    locator: () => ({
      count: async () => 0,
      first: () => ({ click: async () => undefined }),
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
    rule: "test-allow",
    detail: action.kind,
    blocked: false,
  },
});

describe("runTask runner-level mock proof (no worker, no database)", () => {
  it("persists the mocked done verdict, answer, and evidence quote", async () => {
    const persistedSteps: AgentStep[] = [];
    const invokedRoles: ModelRole[] = [];
    const verifierMessages: string[] = [];

    const deps: RunnerDeps = {
      captureObservation: async () => observation(),
      captureScreenshots: async () => ({
        numberedPath: "numbered.png",
        finalPath: "final.png",
      }),
      assertActionAllowed: allow,
      persistStep: async (step) => {
        persistedSteps.push(step);
      },
      // Mock provider + mock verifier through the single injected JSON caller.
      // `schema.parse` keeps every returned value validated through the real
      // Zod boundary, with no `any` or unvalidated casts.
      callJson: async <T>(
        role: ModelRole,
        schema: ZodType<T>,
        messages: { content: string }[],
      ) => {
        invokedRoles.push(role);
        if (role === "fast") {
          // Verifier path: a grounded verdict for the supplied evidence.
          verifierMessages.push(messages.map((m) => m.content).join("\n"));
          return {
            value: schema.parse({
              verdict: "pass",
              reasons: ["grounded in the quoted evidence"],
              grounded: true,
            }),
            inputTokens: 1,
            outputTokens: 1,
          };
        }
        // Agent path: the mocked `done` action carrying answer + evidence.
        return {
          value: schema.parse(doneAction),
          inputTokens: 2,
          outputTokens: 3,
        };
      },
      now: () => 1_000,
    };

    const result = await runTask({
      page: fakePage(),
      profile: "text_structure",
      task: "Find the checkout total",
      successCriteria: "Reports the checkout total",
      detailsLines: [],
      outDir: "out",
      runId: "run-mock-proof",
      deps,
    });

    // Verdict comes from the mocked verifier; the done action carries the
    // answer and the evidence quote through to the runner result.
    expect(result.verdict).toBe("pass");
    expect(result.answer).toBe(ANSWER);
    expect(result.evidenceQuotes).toEqual([QUOTE]);

    // The verifier path really ran and saw the same answer and quote.
    expect(invokedRoles).toContain("fast");
    expect(verifierMessages).toHaveLength(1);
    expect(verifierMessages[0]).toContain(ANSWER);
    expect(verifierMessages[0]).toContain(QUOTE);

    // The persisted step record contains the done action and its quote.
    const persistedDone = persistedSteps.find(
      (step) => step.action?.kind === "done",
    );
    expect(persistedDone).toBeDefined();
    expect(persistedDone?.action).toEqual(doneAction);
    expect(persistedDone?.metadata).toMatchObject({ completed: true });
    if (persistedDone?.action?.kind !== "done") {
      throw new Error("expected the persisted step to carry the done action");
    }
    expect(persistedDone.action.answer).toBe(ANSWER);
    expect(persistedDone.action.evidence_quotes).toContain(QUOTE);

    // The in-memory spy sees the same step objects the runner returns.
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toBe(persistedDone);
  });
});
