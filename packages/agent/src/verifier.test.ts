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
  buildVerifierMessages,
  classifyInfraError,
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
});
