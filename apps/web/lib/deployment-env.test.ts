import { describe, expect, it } from "vitest";
import { parseDeploymentEnv } from "./deployment-env.js";

const DATABASE_URL = "postgresql://user:pass@localhost:5432/offscript";

describe("parseDeploymentEnv", () => {
  it("parses a minimal input and applies defaults", () => {
    const env = parseDeploymentEnv({ DATABASE_URL });

    expect(env.DATABASE_URL).toBe(DATABASE_URL);
    expect(env.NVIDIA_API_KEY).toBe("");
    expect(env.LLM_PROVIDER).toBe("nvidia");
    expect(env.LLM_MODEL_FAST).toBe(
      "meta/llama-3.3-70b-instruct,openai/gpt-oss-20b",
    );
    expect(env.LLM_MODEL_AGENT).toBe(
      "openai/gpt-oss-120b,qwen/qwen3-235b-a22b",
    );
    expect(env.LLM_MODEL_VISION).toBe(
      "meta/llama-3.2-90b-vision-instruct,mistralai/mistral-large-3-675b-instruct-2512",
    );
    expect(env.NEXT_PUBLIC_SITE_URL).toBe("https://offscript.adityahq.me");
    expect(env.PORT).toBe("3000");
    expect(env.HOSTNAME).toBe("0.0.0.0");
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(() => parseDeploymentEnv({})).toThrowError(/DATABASE_URL/);
    expect(() => parseDeploymentEnv({ DATABASE_URL: "" })).toThrowError(
      /DATABASE_URL/,
    );
  });

  it("accepts optional provider keys and overrides", () => {
    const env = parseDeploymentEnv({
      DATABASE_URL,
      NVIDIA_API_KEY: "nvidia-key",
      GROQ_API_KEY: "groq-key",
      GEMINI_API_KEY: "gemini-key",
      OPENROUTER_API_KEY: "openrouter-key",
      OPENAI_API_KEY: "openai-key",
      LLM_PROVIDER: "openrouter",
      LLM_MODEL_FAST: "custom-fast-model",
      NEXT_PUBLIC_SITE_URL: "https://example.com",
      PORT: "8080",
      HOSTNAME: "127.0.0.1",
    });

    expect(env.NVIDIA_API_KEY).toBe("nvidia-key");
    expect(env.GROQ_API_KEY).toBe("groq-key");
    expect(env.GEMINI_API_KEY).toBe("gemini-key");
    expect(env.OPENROUTER_API_KEY).toBe("openrouter-key");
    expect(env.OPENAI_API_KEY).toBe("openai-key");
    expect(env.LLM_PROVIDER).toBe("openrouter");
    expect(env.LLM_MODEL_FAST).toBe("custom-fast-model");
    expect(env.NEXT_PUBLIC_SITE_URL).toBe("https://example.com");
    expect(env.PORT).toBe("8080");
    expect(env.HOSTNAME).toBe("127.0.0.1");
  });

  it("reports field names but never secret values in errors", () => {
    const secret = "super-secret-token-value-12345";

    let databaseError = "";
    try {
      parseDeploymentEnv({ DATABASE_URL: "", OPENAI_API_KEY: secret });
    } catch (error: unknown) {
      databaseError = error instanceof Error ? error.message : String(error);
    }
    expect(databaseError).toContain("DATABASE_URL");
    expect(databaseError).not.toContain(secret);
    expect(databaseError).not.toContain(secret.slice(0, 8));

    let providerError = "";
    try {
      parseDeploymentEnv({ DATABASE_URL, LLM_PROVIDER: secret });
    } catch (error: unknown) {
      providerError = error instanceof Error ? error.message : String(error);
    }
    expect(providerError).toContain("LLM_PROVIDER");
    expect(providerError).not.toContain(secret);
    expect(providerError).not.toContain(secret.slice(0, 8));
  });
});
