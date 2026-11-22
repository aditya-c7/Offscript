"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";

import { PRESETS, type TaskInput, type TaskKey } from "@offscript/shared";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const AnalysisResponseSchema = z.object({ id: z.string().min(1) });
const OverviewSchema = z.object({
  sites: z.array(
    z.object({
      id: z.string(),
      url: z.string().optional(),
      host: z.string().optional(),
    }),
  ),
});

interface AgentAnalysisCtaProps {
  scanId: string;
  url: string;
  host: string;
  compact?: boolean;
}

/** Resolve the internal site id from the owner's sites list. */
async function resolveSiteId(
  url: string,
  host: string,
): Promise<string | null> {
  try {
    const response = await fetch("/api/overview", { cache: "no-store" });
    if (!response.ok) return null;
    const json: unknown = await response.json();
    const parsed = OverviewSchema.safeParse(json);
    if (!parsed.success) return null;
    const byUrl = parsed.data.sites.find((site) => site.url === url);
    const byHost = parsed.data.sites.find((site) => site.host === host);
    return (byUrl ?? byHost)?.id ?? null;
  } catch {
    return null;
  }
}

/** The shared "watch a real agent try it" call to action. */
export function AgentAnalysisCta({
  scanId,
  url,
  host,
  compact = false,
}: AgentAnalysisCtaProps): React.JSX.Element {
  const router = useRouter();
  const [selected, setSelected] = React.useState<ReadonlyArray<TaskKey>>([
    "offers",
  ]);
  const [submitting, setSubmitting] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);

  function toggle(key: TaskKey): void {
    setSelected((previous) =>
      previous.includes(key)
        ? previous.filter((entry) => entry !== key)
        : [...previous, key],
    );
  }

  async function run(): Promise<void> {
    if (submitting || selected.length === 0) return;
    setSubmitting(true);
    setError(null);

    try {
      const siteId = await resolveSiteId(url, host);
      if (!siteId) {
        throw new Error("We could not find this site in your saved sites.");
      }

      const tasks: TaskInput[] = PRESETS.filter((preset) =>
        selected.includes(preset.key),
      ).map((preset) => ({
        task_key: preset.key,
        task_text: preset.task,
        success_criteria: preset.success,
        importance_confidence: "not_sure",
        details_lines: [],
        consent: true,
      }));

      const response = await fetch("/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId, tasks }),
      });
      if (!response.ok)
        throw new Error(`Could not start the analysis (${response.status}).`);

      const json: unknown = await response.json();
      const parsed = AnalysisResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new Error(
          "The analysis service returned an unexpected response.",
        );
      }
      router.push(
        `/agent-analysis?analysis=${encodeURIComponent(parsed.data.id)}`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not start the analysis.",
      );
      setSubmitting(false);
    }
  }

  return (
    <Card className={cn("border-border bg-card", compact ? "p-0" : "")}>
      <CardContent
        className={cn("flex flex-col gap-4", compact ? "p-4" : "p-5")}
      >
        <div className="space-y-1">
          <p className="text-base font-semibold text-foreground">
            Now watch a real agent try it.
          </p>
          <p className="text-sm text-muted-foreground">
            Pick the questions you care about and run a live, read-only agent
            analysis.
          </p>
        </div>
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Preset tasks"
        >
          {PRESETS.map((preset) => {
            const active = selected.includes(preset.key);
            return (
              <button
                key={preset.key}
                type="button"
                aria-pressed={active}
                onClick={() => toggle(preset.key)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background text-foreground hover:bg-accent",
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
        <div>
          <Button
            type="button"
            onClick={() => void run()}
            disabled={submitting || selected.length === 0}
          >
            {"Run free agent analysis ->"}
          </Button>
          {error ? (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
