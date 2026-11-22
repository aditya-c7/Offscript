import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Static scan contracts                                               */
/* ------------------------------------------------------------------ */

export const VerdictSchema = z.enum([
  "pass",
  "partial",
  "fail",
  "not_applicable",
]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const ImpactSchema = z.enum(["major", "supporting"]);
export type Impact = z.infer<typeof ImpactSchema>;

export const AreaSchema = z.enum(["find", "understand", "act"]);
export type Area = z.infer<typeof AreaSchema>;

export const CategorySchema = z.enum([
  "reaching",
  "reading",
  "act",
  "identity",
]);
export type Category = z.infer<typeof CategorySchema>;

export const CheckResultSchema = z.object({
  key: z.string(),
  category: CategorySchema,
  area: AreaSchema,
  verdict: VerdictSchema,
  impact: ImpactSchema,
  confidence: z.number().min(0).max(1),
  page_url: z.string(),
  selector: z.string().nullable(),
  snippet: z.string().nullable(),
  reproduce_cmd: z.string(),
  fix_prompt_md: z.string(),
  evidence: z.record(z.string(), z.unknown()),
});
export type CheckResult = z.infer<typeof CheckResultSchema>;

/* ------------------------------------------------------------------ */
/* Agent protocol / standards                                          */
/* ------------------------------------------------------------------ */

export const ProtocolKeySchema = z.enum([
  "llms_txt",
  "mcp",
  "webmcp",
  "a2a",
  "openapi",
  "markdown_negotiation",
  "content_signals",
]);
export type ProtocolKey = z.infer<typeof ProtocolKeySchema>;

export const ProtocolResultSchema = z.object({
  key: ProtocolKeySchema,
  found: z.boolean(),
  detail: z.string(),
  evidence: z.record(z.string(), z.unknown()),
});
export type ProtocolResult = z.infer<typeof ProtocolResultSchema>;

export const StackSchema = z.enum([
  "generic",
  "nextjs",
  "shopify",
  "webflow",
  "wordpress",
  "builder",
]);
export type Stack = z.infer<typeof StackSchema>;

/* ------------------------------------------------------------------ */
/* Website interpretation (grounded)                                   */
/* ------------------------------------------------------------------ */

export const InterpretationSchema = z.object({
  name: z.string(),
  website_type: z.string(),
  category: z.string(),
  business_model: z.string(),
  confidence: z.object({
    label: z.enum(["low", "medium", "high"]),
    score: z.number().min(0).max(1),
  }),
  audiences: z.array(z.string()),
  offerings: z.array(z.string()),
  visitor_goals: z.array(z.string()),
  could_not_confirm: z.array(z.string()),
  model_id: z.string(),
  prompt_version: z.string(),
  unsupported_claims_stripped: z.number().int().nonnegative(),
  unsupported_urls_stripped: z.number().int().nonnegative(),
});
export type Interpretation = z.infer<typeof InterpretationSchema>;

/* ------------------------------------------------------------------ */
/* Observation v2 (dual-modality artifact)                             */
/* ------------------------------------------------------------------ */

export const ObservationTargetStateSchema = z
  .object({
    enabled: z.boolean().optional(),
    checked: z.boolean().optional(),
    expanded: z.boolean().optional(),
    value: z.string().optional(),
  })
  .passthrough();

export const ObservationTargetSchema = z.object({
  id: z.string(),
  role: z.string(),
  name: z.string(),
  destination: z.string().nullable(),
  state: ObservationTargetStateSchema,
  bounds: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
});
export type ObservationTarget = z.infer<typeof ObservationTargetSchema>;

export const ObservationNodeSchema = z
  .object({
    id: z.string(),
    role: z.string(),
    name: z.string(),
    depth: z.number().int().nonnegative(),
  })
  .passthrough();

export const ObservationHeadingSchema = z.object({
  level: z.number().int().min(1).max(6),
  text: z.string(),
});

export const ObservationNavSchema = z.object({
  text: z.string(),
  href: z.string().nullable(),
});

export const ObservationV2Schema = z.object({
  schema: z.literal("offscript.observation/v2"),
  observation_id: z.string(),
  state_token: z.string(),
  title: z.string(),
  url: z.string(),
  truncated: z.boolean(),
  omitted_nodes: z.array(z.string()),
  public_search_target_id: z.string().nullable(),
  errors: z.array(z.string()),
  content: z.string(),
  headings: z.array(ObservationHeadingSchema),
  navigation: z.array(ObservationNavSchema),
  nodes: z.array(ObservationNodeSchema),
  targets: z.array(ObservationTargetSchema),
});
export type ObservationV2 = z.infer<typeof ObservationV2Schema>;

/* ------------------------------------------------------------------ */
/* Agent actions & policy                                              */
/* ------------------------------------------------------------------ */

export const AgentActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("click"),
    target_id: z.string(),
    reasoning: z.string(),
  }),
  z.object({
    kind: z.literal("type"),
    target_id: z.string(),
    value: z.string(),
    reasoning: z.string(),
  }),
  z.object({
    kind: z.literal("navigate"),
    url: z.string(),
    reasoning: z.string(),
  }),
  z.object({
    kind: z.literal("scroll"),
    direction: z.enum(["up", "down"]),
    reasoning: z.string(),
  }),
  z.object({
    kind: z.literal("extract"),
    question: z.string(),
    reasoning: z.string(),
  }),
  z.object({
    kind: z.literal("done"),
    answer: z.string(),
    evidence_quotes: z.array(z.string()),
    reasoning: z.string(),
  }),
]);
export type AgentAction = z.infer<typeof AgentActionSchema>;

export const PolicyEventSchema = z.object({
  at: z.string(),
  rule: z.string(),
  detail: z.string(),
  blocked: z.boolean(),
});
export type PolicyEvent = z.infer<typeof PolicyEventSchema>;

export const RunVerdictSchema = z.enum([
  "pass",
  "fail",
  "no_clear_result",
  "infra_error",
]);
export type RunVerdict = z.infer<typeof RunVerdictSchema>;

export const VerifierResultSchema = z.object({
  verdict: RunVerdictSchema,
  reasons: z.array(z.string()),
  grounded: z.boolean(),
});
export type VerifierResult = z.infer<typeof VerifierResultSchema>;

/* ------------------------------------------------------------------ */
/* Task profiles                                                       */
/* ------------------------------------------------------------------ */

export const ProfileSchema = z.enum(["text_structure", "visual_screen"]);
export type Profile = z.infer<typeof ProfileSchema>;

export const TaskKeySchema = z.enum(["offers", "price", "contact", "custom"]);
export type TaskKey = z.infer<typeof TaskKeySchema>;

export const ImportanceConfidenceSchema = z.enum([
  "not_sure",
  "guess",
  "customers_told_us",
]);
export type ImportanceConfidence = z.infer<typeof ImportanceConfidenceSchema>;

export const TaskInputSchema = z.object({
  task_key: TaskKeySchema,
  task_text: z.string().max(1000),
  success_criteria: z.string().max(1000),
  persona: z.string().max(500).optional(),
  details_lines: z.array(z.string()).max(8).default([]),
  importance_confidence: ImportanceConfidenceSchema,
  why_it_matters: z.string().max(1000).optional(),
  consent: z.literal(true),
});
export type TaskInput = z.infer<typeof TaskInputSchema>;

/* ------------------------------------------------------------------ */
/* Scan report                                                         */
/* ------------------------------------------------------------------ */

export const ReportVerdictSchema = z.enum([
  "agents_can_use",
  "agents_struggle",
  "agents_cannot",
]);
export type ReportVerdict = z.infer<typeof ReportVerdictSchema>;

export const ScoreBlockSchema = z.object({
  find: z.number().min(0).max(100),
  understand: z.number().min(0).max(100),
  act: z.number().min(0).max(100),
  protocols: z.number().min(0).max(100),
  standards_modifier: z.number().min(0).max(5),
  overall: z.number().min(0).max(100),
});
export type ScoreBlock = z.infer<typeof ScoreBlockSchema>;

export const FixPromptSchema = z.object({
  stack: StackSchema,
  title: z.string(),
  reproduce: z.string(),
  observed: z.string(),
  snippet: z.string(),
  why: z.string(),
  where: z.string(),
  fix: z.string(),
  do_not: z.string(),
  stop_and_ask: z.string(),
  done_when: z.string(),
  combined_md: z.string(),
});
export type FixPrompt = z.infer<typeof FixPromptSchema>;

export const DefectSchema = z.object({
  check_key: z.string(),
  title: z.string(),
  priority: z.enum(["high", "important"]),
  area: AreaSchema,
  affected_urls: z.array(z.string()),
  fix_prompts: z.array(FixPromptSchema),
});
export type Defect = z.infer<typeof DefectSchema>;

export const ScanReportSchema = z.object({
  id: z.string(),
  share_token: z.string(),
  host: z.string(),
  submitted_url: z.string(),
  scanned_at: z.string(),
  status: z.enum(["queued", "running", "complete", "failed"]),
  rubric_version: z.string(),
  pipeline_version: z.string(),
  verdict: ReportVerdictSchema,
  headline: z.string(),
  scores: ScoreBlockSchema,
  checks_passed: z.number().int(),
  checks_total: z.number().int(),
  pages_checked: z.number().int(),
  pages_opened_browser: z.number().int(),
  possible_pages_found: z.number().int(),
  sampled_urls: z.array(z.string()),
  detected_stack: StackSchema,
  categories: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      subtitle: z.string(),
      passed: z.number().int(),
      total: z.number().int(),
      badge: z.enum(["good", "needs_work", "poor"]),
      checks: z.array(CheckResultSchema),
    }),
  ),
  defects: z.array(DefectSchema),
  protocols: z.array(ProtocolResultSchema),
  interpretation: InterpretationSchema.nullable(),
  findings: z.array(
    z.object({
      key: z.string(),
      verdict: VerdictSchema,
      confidence: z.number(),
      impact: ImpactSchema,
      url: z.string(),
      selector: z.string().nullable(),
      snippet: z.string().nullable(),
      evidence_json: z.record(z.string(), z.unknown()),
    }),
  ),
});
export type ScanReport = z.infer<typeof ScanReportSchema>;

/* ------------------------------------------------------------------ */
/* Env validation                                                      */
/* ------------------------------------------------------------------ */

/**
 * Role model lists are comma-separated. Reject strings with no usable entry
 * (empty, only whitespace, or only separators) so routing always has a model.
 */
const ModelListSchema = z
  .string()
  .refine(
    (value) => value.split(",").some((entry) => entry.trim().length > 0),
    { message: "must contain at least one non-empty comma-separated model" },
  );

export const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  LLM_PROVIDER: z
    .enum(["nvidia", "groq", "gemini", "openrouter", "openai"])
    .default("nvidia"),
  NVIDIA_API_KEY: z.string().default(""),
  OPENROUTER_API_KEY: z.string().default(""),
  GROQ_API_KEY: z.string().default(""),
  GEMINI_API_KEY: z.string().default(""),
  OPENAI_API_KEY: z.string().default(""),
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
  LLM_FALLBACK_PROVIDER: z.string().default("groq"),
  LLM_FALLBACK_MODEL_FAST: z.string().default("llama-3.3-70b-versatile"),
  STORAGE_DIR: z.string().default("./storage"),
});
export type Env = z.infer<typeof EnvSchema>;
