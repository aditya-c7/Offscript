import { z } from "zod";

/**
 * Runtime environment the Next.js app receives inside the Cloudflare Container.
 *
 * Secrets are validated for presence/type only. Values are never logged and
 * never echoed in error messages — parsing failures report field names only.
 */
export const DeploymentEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  NVIDIA_API_KEY: z.string().default(""),
  GROQ_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  LLM_PROVIDER: z
    .enum(["nvidia", "groq", "gemini", "openrouter", "openai"])
    .default("nvidia"),
  LLM_MODEL_FAST: z
    .string()
    .default("meta/llama-3.3-70b-instruct,openai/gpt-oss-20b"),
  LLM_MODEL_AGENT: z
    .string()
    .default("openai/gpt-oss-120b,qwen/qwen3-235b-a22b"),
  LLM_MODEL_VISION: z
    .string()
    .default(
      "meta/llama-3.2-90b-vision-instruct,mistralai/mistral-large-3-675b-instruct-2512",
    ),
  NEXT_PUBLIC_SITE_URL: z.string().default("https://offscript.adityahq.me"),
  PORT: z.string().default("3000"),
  HOSTNAME: z.string().default("0.0.0.0"),
});

export type DeploymentEnv = z.infer<typeof DeploymentEnvSchema>;

/**
 * Validate deployment environment values. On failure, throw an error that
 * lists only the invalid field names — never the values (which may be keys).
 */
export function parseDeploymentEnv(
  input: Record<string, string | undefined>,
): DeploymentEnv {
  const parsed = DeploymentEnvSchema.safeParse(input);
  if (!parsed.success) {
    const fields = Array.from(
      new Set(
        parsed.error.issues
          .map((issue) => issue.path.join("."))
          .filter((part) => part.length > 0),
      ),
    );
    throw new Error(
      `Invalid deployment environment${fields.length > 0 ? `: ${fields.join(", ")}` : ""}`,
    );
  }
  return parsed.data;
}
