import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { VerifierResultSchema } from "@offscript/shared";
import {
  InfraError,
  type ChatMessage,
  type JsonModelCaller,
  type ModelJsonOpts,
  type ModelRole,
} from "./llm.js";
import {
  analyzeGroundedFallback,
  buildVerifierMessages,
  classifyInfraError,
  groundedFallbackVerdict,
  isInfrastructureError,
  verifierResultFromError,
  verifyRun,
} from "./verifier.js";

const makeFakeCaller = (
  rawResult: unknown,
  onCall?: (
    role: ModelRole,
    messages: ChatMessage[],
    opts?: ModelJsonOpts,
  ) => void,
): JsonModelCaller => {
  return async <T>(
    role: ModelRole,
    schema: ZodType<T>,
    messages: ChatMessage[],
    opts?: ModelJsonOpts,
  ) => {
    onCall?.(role, messages, opts);
    const parsed = schema.safeParse(rawResult);
    if (!parsed.success)
      throw new Error("fake judge produced an invalid result");
    return { value: parsed.data, inputTokens: 11, outputTokens: 7 };
  };
};

describe("verifyRun", () => {
  it("uses an independent schema-validated call and marks the answer untrusted", async () => {
    const seen: Array<{
      role: ModelRole;
      messages: ChatMessage[];
      opts?: ModelJsonOpts;
    }> = [];
    const fake = makeFakeCaller(
      {
        verdict: "pass",
        reasons: ["price is quoted verbatim"],
        grounded: true,
      },
      (role, messages, opts) => {
        seen.push({ role, messages, opts });
      },
    );

    const result = await verifyRun(
      {
        successCriteria: "Reports the exact price",
        finalAnswer: "$19",
        evidenceQuotes: ["Price: $19"],
        screenshots: ["/tmp/a.png", "/tmp/b.png"],
      },
      fake,
    );

    expect(result).toEqual({
      verdict: "pass",
      reasons: ["price is quoted verbatim"],
      grounded: true,
    });
    expect(VerifierResultSchema.safeParse(result).success).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.role).toBe("fast");
    const userText = seen[0]?.messages.map((m) => m.content).join("\n") ?? "";
    expect(userText).toContain("Reports the exact price");
    expect(userText).toContain("OFFSCRIPT_UNTRUSTED_DATA");
    expect(userText).toContain('label="final_answer"');
    expect(userText).toContain("$19");
  });

  it("builds a strict judge prompt that rejects ungrounded claims", () => {
    const messages = buildVerifierMessages({
      successCriteria: "Finds the contact email",
      finalAnswer: "none",
      evidenceQuotes: [],
      screenshots: [],
    });
    const system = messages[0]?.content ?? "";
    expect(system.toLowerCase()).toContain("ungrounded");
    expect(system.toLowerCase()).toContain("no_clear_result");
    expect(system).toContain("OFFSCRIPT_UNTRUSTED_DATA");
  });

  it("propagates judge failures as typed infrastructure errors", async () => {
    const fake: JsonModelCaller = async () => {
      throw new InfraError("rate_limit", "exhausted");
    };
    await expect(
      verifyRun(
        {
          successCriteria: "x",
          finalAnswer: "y",
          evidenceQuotes: [],
          screenshots: [],
        },
        fake,
      ),
    ).rejects.toBeInstanceOf(InfraError);
  });

  it("falls back to pass when evidence is empty but the answer is specific and grounded", async () => {
    const noResult = makeFakeCaller({
      verdict: "no_clear_result",
      reasons: [
        "No evidence quotes supplied",
        "No screenshot artifacts provided",
        "Agent's final answer does not name any real product",
      ],
      grounded: false,
    });

    const args: Parameters<typeof verifyRun>[0] = {
      successCriteria: "Reports the exact price of the item",
      finalAnswer: "The exact price is $19.99.",
      evidenceQuotes: [],
      screenshots: [],
    };

    const analysis = analyzeGroundedFallback(args);
    expect(analysis.specific).toBe(true);
    expect(analysis.strong).toBe(true);
    expect(analysis.overlap).toContain("price");

    const result = await verifyRun(args, noResult);
    expect(result.verdict).toBe("pass");
    expect(result.grounded).toBe(true);
    expect(result.reasons.join(" ")).toContain("deterministically");
    // The fallback must not manufacture evidence that was never supplied.
    expect(result.reasons.join(" ")).not.toContain("Price: $19.99");
    expect(VerifierResultSchema.safeParse(result).success).toBe(true);
    expect(groundedFallbackVerdict(args)).toEqual(result);
  });

  it("accepts a grounded answer when screenshots are absent but evidence exists", async () => {
    const noResult = makeFakeCaller({
      verdict: "no_clear_result",
      reasons: ["No screenshot artifacts provided"],
      grounded: false,
    });

    const result = await verifyRun(
      {
        successCriteria: "Reports the exact price of the item",
        finalAnswer: "The exact price is $19.99.",
        evidenceQuotes: ["Price: $19.99"],
        screenshots: [],
      },
      noResult,
    );

    expect(result.verdict).toBe("pass");
    expect(result.grounded).toBe(true);
  });

  it("does not override no_clear_result for an empty or placeholder answer", async () => {
    const noResult = makeFakeCaller({
      verdict: "no_clear_result",
      reasons: ["insufficient evidence"],
      grounded: false,
    });

    for (const finalAnswer of ["", "   ", "none", "N/A"]) {
      const result = await verifyRun(
        {
          successCriteria: "Reports the exact price of the item",
          finalAnswer,
          evidenceQuotes: [],
          screenshots: [],
        },
        noResult,
      );
      expect(result.verdict).toBe("no_clear_result");
      expect(result.grounded).toBe(false);
    }
  });

  it("rejects ungrounded, off-topic claims instead of passing them", async () => {
    const noResult = makeFakeCaller({
      verdict: "no_clear_result",
      reasons: ["No evidence quotes supplied"],
      grounded: false,
    });

    const args: Parameters<typeof verifyRun>[0] = {
      successCriteria: "Find the contact email address",
      finalAnswer: "The price is $19.99 for the item.",
      evidenceQuotes: [],
      screenshots: [],
    };

    expect(analyzeGroundedFallback(args).strong).toBe(false);
    expect(groundedFallbackVerdict(args)).toBeNull();

    const result = await verifyRun(args, noResult);
    expect(result.verdict).toBe("no_clear_result");
    expect(result.grounded).toBe(false);
    expect(result.reasons).toEqual(["No evidence quotes supplied"]);
  });

  it("keeps model no-results distinct from infrastructure failures", async () => {
    const baseArgs: Parameters<typeof verifyRun>[0] = {
      successCriteria: "x",
      finalAnswer: "a specific claim about x",
      evidenceQuotes: [],
      screenshots: [],
    };

    const infraCaller: JsonModelCaller = async () => {
      throw new InfraError("rate_limit", "exhausted", 429);
    };
    await expect(verifyRun(baseArgs, infraCaller)).rejects.toBeInstanceOf(
      InfraError,
    );

    const modelRefusal: JsonModelCaller = async () => {
      throw new Error("model refused to answer");
    };
    await expect(verifyRun(baseArgs, modelRefusal)).rejects.toThrow(
      "model refused to answer",
    );

    // Injected failures never reach the fallback: they are classified, not passed.
    const infraResult = verifierResultFromError(
      new InfraError("timeout", "late"),
    );
    expect(infraResult.verdict).toBe("infra_error");
    expect(infraResult.grounded).toBe(false);
    expect(infraResult.reasons.join(" ")).toContain("infrastructure");

    const modelResult = verifierResultFromError(new Error("model refused"));
    expect(modelResult.verdict).toBe("no_clear_result");
    expect(modelResult.grounded).toBe(false);
  });
});

describe("classifyInfraError", () => {
  it("maps infra failures to infra_error", () => {
    expect(classifyInfraError(new InfraError("rate_limit", "429"))).toBe(
      "infra_error",
    );
    expect(classifyInfraError(new InfraError("timeout", "late"))).toBe(
      "infra_error",
    );
    expect(classifyInfraError(new Error("Request timed out"))).toBe(
      "infra_error",
    );
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(classifyInfraError(abort)).toBe("infra_error");
  });

  it("maps everything else to no_clear_result", () => {
    expect(classifyInfraError(new Error("model refused"))).toBe(
      "no_clear_result",
    );
    expect(classifyInfraError("string failure")).toBe("no_clear_result");
    expect(classifyInfraError(undefined)).toBe("no_clear_result");
  });

  it("maps parse and schema validation failures to no_clear_result", () => {
    const parseFailures: unknown[] = [
      new InfraError(
        "provider_error",
        "Model did not produce schema-valid JSON after 3 attempts",
      ),
      new InfraError(
        "provider_error",
        "Model provider returned unreadable JSON",
      ),
      new InfraError(
        "provider_error",
        "Model provider response failed validation",
      ),
      new Error("ModelOutputError: Model did not produce schema-valid JSON"),
    ];
    for (const failure of parseFailures) {
      expect(isInfrastructureError(failure)).toBe(false);
      expect(classifyInfraError(failure)).toBe("no_clear_result");
      expect(verifierResultFromError(failure).verdict).toBe("no_clear_result");
    }
  });

  it("separates transport faults from a model's inconclusive verdict", () => {
    expect(isInfrastructureError(new InfraError("provider_error", "500"))).toBe(
      true,
    );
    expect(isInfrastructureError(new Error("ECONNRESET"))).toBe(true);
    expect(isInfrastructureError(new Error("socket hang up"))).toBe(true);
    expect(isInfrastructureError(new Error("verdict: no_clear_result"))).toBe(
      false,
    );
    expect(classifyInfraError(new Error("verdict: no_clear_result"))).toBe(
      "no_clear_result",
    );
  });
});
