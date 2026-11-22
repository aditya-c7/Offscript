import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const sites = pgTable(
  "sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerCookieId: varchar("owner_cookie_id", { length: 128 }).notNull(),
    url: text("url").notNull(),
    normalizedHost: varchar("normalized_host", { length: 255 }).notNull(),
    detectedStack: varchar("detected_stack", { length: 64 })
      .notNull()
      .default("generic"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    ownerIdx: index("sites_owner_idx").on(t.ownerCookieId),
  }),
);

export const scans = pgTable(
  "scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id),
    shareToken: varchar("share_token", { length: 64 }).notNull().unique(),
    status: varchar("status", { length: 32 }).notNull().default("queued"),
    rubricVersion: varchar("rubric_version", { length: 64 }).notNull(),
    pipelineVersion: varchar("pipeline_version", { length: 64 }).notNull(),
    scoreFind: real("score_find"),
    scoreUnderstand: real("score_understand"),
    scoreAct: real("score_act"),
    scoreProtocols: real("score_protocols"),
    standardsModifier: real("standards_modifier"),
    scoreOverall: real("score_overall"),
    coverageJson: jsonb("coverage_json"),
    interpretationJson: jsonb("interpretation_json"),
    protocolsJson: jsonb("protocols_json"),
    errorCode: varchar("error_code", { length: 128 }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    siteIdx: index("scans_site_idx").on(t.siteId),
  }),
);

export const checks = pgTable(
  "checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scanId: uuid("scan_id")
      .notNull()
      .references(() => scans.id),
    key: varchar("key", { length: 128 }).notNull(),
    category: varchar("category", { length: 32 }).notNull(),
    area: varchar("area", { length: 32 }).notNull(),
    verdict: varchar("verdict", { length: 32 }).notNull(),
    confidence: real("confidence").notNull().default(0),
    impact: varchar("impact", { length: 32 }).notNull(),
    pageUrl: text("page_url").notNull(),
    selector: text("selector"),
    snippet: text("snippet"),
    reproduceCmd: text("reproduce_cmd").notNull().default(""),
    fixPromptsJson: jsonb("fix_prompts_json"),
    evidenceJson: jsonb("evidence_json"),
  },
  (t) => ({
    scanKeyIdx: uniqueIndex("checks_scan_key_idx").on(t.scanId, t.key),
  }),
);

export const analyses = pgTable(
  "analyses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id),
    shareToken: varchar("share_token", { length: 64 }).notNull().unique(),
    status: varchar("status", { length: 32 }).notNull().default("queued"),
    attestedAt: timestamp("attested_at", { withTimezone: true }),
    creditConsumed: boolean("credit_consumed").notNull().default(false),
    artifactsExpiresAt: timestamp("artifacts_expires_at", {
      withTimezone: true,
    }),
    artifactsDeletedAt: timestamp("artifacts_deleted_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    siteIdx: index("analyses_site_idx").on(t.siteId),
  }),
);

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    analysisId: uuid("analysis_id")
      .notNull()
      .references(() => analyses.id),
    taskKey: varchar("task_key", { length: 32 }).notNull(),
    profile: varchar("profile", { length: 32 }).notNull(),
    modelId: varchar("model_id", { length: 128 }).notNull().default(""),
    taskText: text("task_text").notNull(),
    successCriteria: text("success_criteria").notNull(),
    persona: text("persona"),
    detailsJson: jsonb("details_json"),
    importanceConfidence: varchar("importance_confidence", { length: 32 }),
    whyItMatters: text("why_it_matters"),
    status: varchar("status", { length: 32 }).notNull().default("waiting"),
    verdict: varchar("verdict", { length: 32 }),
    answer: text("answer"),
    verifierJson: jsonb("verifier_json"),
    tokenInputTotal: integer("token_input_total").notNull().default(0),
    tokenOutputTotal: integer("token_output_total").notNull().default(0),
    testId: varchar("test_id", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    analysisIdx: index("runs_analysis_idx").on(t.analysisId),
  }),
);

export const steps = pgTable(
  "steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id),
    idx: integer("idx").notNull(),
    url: text("url").notNull(),
    stateToken: varchar("state_token", { length: 128 }).notNull().default(""),
    perceptionMode: varchar("perception_mode", { length: 32 }).notNull(),
    actionJson: jsonb("action_json"),
    policyEventsJson: jsonb("policy_events_json"),
    reasoningSummary: varchar("reasoning_summary", { length: 280 }),
    screenshotPath: text("screenshot_path"),
    observationPath: text("observation_path"),
    resultStatus: varchar("result_status", { length: 32 })
      .notNull()
      .default("ok"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    runIdxIdx: uniqueIndex("steps_run_idx_idx").on(t.runId, t.idx),
  }),
);

export const browserQuotas = pgTable("browser_quotas", {
  ownerCookieId: varchar("owner_cookie_id", { length: 128 }).primaryKey(),
  analysesRemaining: integer("analyses_remaining").notNull().default(3),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Site = typeof sites.$inferSelect;
export type Scan = typeof scans.$inferSelect;
export type Check = typeof checks.$inferSelect;
export type Analysis = typeof analyses.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type Step = typeof steps.$inferSelect;
export type BrowserQuota = typeof browserQuotas.$inferSelect;
