CREATE TABLE "analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"share_token" varchar(64) NOT NULL,
	"status" varchar(32) DEFAULT 'queued' NOT NULL,
	"attested_at" timestamp with time zone,
	"credit_consumed" boolean DEFAULT false NOT NULL,
	"artifacts_expires_at" timestamp with time zone,
	"artifacts_deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analyses_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
CREATE TABLE "browser_quotas" (
	"owner_cookie_id" varchar(128) PRIMARY KEY NOT NULL,
	"analyses_remaining" integer DEFAULT 3 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid NOT NULL,
	"key" varchar(128) NOT NULL,
	"category" varchar(32) NOT NULL,
	"area" varchar(32) NOT NULL,
	"verdict" varchar(32) NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"impact" varchar(32) NOT NULL,
	"page_url" text NOT NULL,
	"selector" text,
	"snippet" text,
	"reproduce_cmd" text DEFAULT '' NOT NULL,
	"fix_prompts_json" jsonb,
	"evidence_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"task_key" varchar(32) NOT NULL,
	"profile" varchar(32) NOT NULL,
	"model_id" varchar(128) DEFAULT '' NOT NULL,
	"task_text" text NOT NULL,
	"success_criteria" text NOT NULL,
	"persona" text,
	"details_json" jsonb,
	"importance_confidence" varchar(32),
	"why_it_matters" text,
	"status" varchar(32) DEFAULT 'waiting' NOT NULL,
	"verdict" varchar(32),
	"answer" text,
	"verifier_json" jsonb,
	"token_input_total" integer DEFAULT 0 NOT NULL,
	"token_output_total" integer DEFAULT 0 NOT NULL,
	"test_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"share_token" varchar(64) NOT NULL,
	"status" varchar(32) DEFAULT 'queued' NOT NULL,
	"rubric_version" varchar(64) NOT NULL,
	"pipeline_version" varchar(64) NOT NULL,
	"score_find" real,
	"score_understand" real,
	"score_act" real,
	"score_protocols" real,
	"standards_modifier" real,
	"score_overall" real,
	"coverage_json" jsonb,
	"interpretation_json" jsonb,
	"protocols_json" jsonb,
	"error_code" varchar(128),
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scans_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_cookie_id" varchar(128) NOT NULL,
	"url" text NOT NULL,
	"normalized_host" varchar(255) NOT NULL,
	"detected_stack" varchar(64) DEFAULT 'generic' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"idx" integer NOT NULL,
	"url" text NOT NULL,
	"state_token" varchar(128) DEFAULT '' NOT NULL,
	"perception_mode" varchar(32) NOT NULL,
	"action_json" jsonb,
	"policy_events_json" jsonb,
	"reasoning_summary" varchar(280),
	"screenshot_path" text,
	"observation_path" text,
	"result_status" varchar(32) DEFAULT 'ok' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checks" ADD CONSTRAINT "checks_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "steps" ADD CONSTRAINT "steps_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analyses_site_idx" ON "analyses" USING btree ("site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "checks_scan_key_idx" ON "checks" USING btree ("scan_id","key");--> statement-breakpoint
CREATE INDEX "runs_analysis_idx" ON "runs" USING btree ("analysis_id");--> statement-breakpoint
CREATE INDEX "scans_site_idx" ON "scans" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "sites_owner_idx" ON "sites" USING btree ("owner_cookie_id");--> statement-breakpoint
CREATE UNIQUE INDEX "steps_run_idx_idx" ON "steps" USING btree ("run_id","idx");