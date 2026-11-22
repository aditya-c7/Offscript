"use client";

import { useCallback, useEffect, useState } from "react";
import type { TaskInput } from "@offscript/shared";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { TaskPicker } from "@/components/analysis/task-picker";
import { TraceReplay } from "@/components/analysis/trace-replay";
import {
  AnalysisDetailSchema,
  CreateResponseSchema,
  OverviewResponseSchema,
  QuotaResponseSchema,
  groupRuns,
  isRunning,
  isTerminal,
  isWaiting,
  type AnalysisDetail,
  type OverviewSite,
} from "@/components/analysis/types";

const STEPS = [
  "01 Pick tasks",
  "02 Agents try them",
  "03 See every step",
] as const;

const ASSURANCE =
  "Real AI agents try tasks on your site, the way ChatGPT, Claude or a custom AI agent would. Read-only: nothing is bought, sent or changed. It usually takes 2–5 minutes.";

interface AgentAnalysisProps {
  initialSiteId?: string | null;
  initialAnalysisId?: string | null;
}

export function AgentAnalysis({
  initialSiteId,
  initialAnalysisId,
}: AgentAnalysisProps) {
  const deepLinkedAnalysis =
    typeof initialAnalysisId === "string" &&
    z.string().uuid().safeParse(initialAnalysisId).success
      ? initialAnalysisId
      : null;
  const [sites, setSites] = useState<OverviewSite[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState(initialSiteId ?? "");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [phase, setPhase] = useState<1 | 2 | 3>(deepLinkedAnalysis ? 2 : 1);
  const [analysisId, setAnalysisId] = useState<string | null>(
    deepLinkedAnalysis,
  );
  const [detail, setDetail] = useState<AnalysisDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [overviewRes, quotaRes] = await Promise.all([
          fetch("/api/overview", { cache: "no-store" }),
          fetch("/api/quota", { cache: "no-store" }),
        ]);
        if (!overviewRes.ok || !quotaRes.ok) throw new Error("load failed");
        const overviewRaw: unknown = await overviewRes.json();
        const quotaRaw: unknown = await quotaRes.json();
        const overview = OverviewResponseSchema.safeParse(overviewRaw);
        const quota = QuotaResponseSchema.safeParse(quotaRaw);
        if (cancelled) return;
        if (overview.success) {
          setSites(overview.data.sites);
          setSelectedSiteId((current) => {
            if (current) return current;
            const preferred = initialSiteId
              ? overview.data.sites.find((site) => site.id === initialSiteId)
              : undefined;
            return preferred?.id ?? overview.data.sites[0]?.id ?? "";
          });
        }
        if (quota.success) setRemaining(quota.data.remaining);
      } catch {
        if (!cancelled)
          setError("We could not load your sites. Please refresh the page.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [initialSiteId]);

  const refreshDetail = useCallback(
    async (id: string): Promise<AnalysisDetail | null> => {
      try {
        const response = await fetch(
          `/api/analyses/${encodeURIComponent(id)}`,
          {
            cache: "no-store",
          },
        );
        if (!response.ok) return null;
        const raw: unknown = await response.json();
        const parsed = AnalysisDetailSchema.safeParse(raw);
        if (!parsed.success) return null;
        setDetail(parsed.data);
        return parsed.data;
      } catch {
        return null;
      }
    },
    [],
  );

  useEffect(() => {
    if (!analysisId) return;
    let timer: number | undefined;

    const load = async () => {
      const result = await refreshDetail(analysisId);
      if (!result) return;
      const done =
        result.runs.length > 0 &&
        result.runs.every((run) => isTerminal(run.status));
      if (done) {
        setPhase(3);
        if (timer !== undefined) window.clearInterval(timer);
      }
    };

    void load();
    timer = window.setInterval(() => void load(), 2000);
    return () => {
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [analysisId, refreshDetail]);

  const selectedSite = sites.find((site) => site.id === selectedSiteId);
  const host = selectedSite?.host ?? "";

  async function start(tasks: TaskInput[]) {
    if (!selectedSiteId || tasks.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId: selectedSiteId, tasks }),
      });
      if (!response.ok) {
        const raw: unknown = await response.json().catch(() => ({}));
        const parsed = zErrorMessage.safeParse(raw);
        setError(
          parsed.success ? parsed.data.error : "Could not start the analysis.",
        );
        return;
      }
      const raw: unknown = await response.json();
      const created = CreateResponseSchema.safeParse(raw);
      if (!created.success) {
        setError("Could not start the analysis.");
        return;
      }
      setAnalysisId(created.data.id);
      setDetail(null);
      setPhase(2);
      setCopied(false);
    } catch {
      setError("Could not start the analysis.");
    } finally {
      setBusy(false);
    }
  }

  async function runAgain() {
    if (!analysisId) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/analyses/${encodeURIComponent(analysisId)}/again`,
        {
          method: "POST",
        },
      );
      if (!response.ok) {
        setError("Could not run the analysis again.");
        return;
      }
      const raw: unknown = await response.json();
      const created = CreateResponseSchema.safeParse(raw);
      if (!created.success) {
        setError("Could not run the analysis again.");
        return;
      }
      setAnalysisId(created.data.id);
      setDetail(null);
      setPhase(2);
    } catch {
      setError("Could not run the analysis again.");
    } finally {
      setBusy(false);
    }
  }

  async function copyTestId() {
    if (!analysisId) return;
    try {
      await navigator.clipboard.writeText(analysisId);
      setCopied(true);
    } catch {
      setError("Could not copy the test ID.");
    }
  }

  async function deleteArtifacts() {
    if (!analysisId) return;
    setDeleting(true);
    try {
      const response = await fetch(
        `/api/analyses/${encodeURIComponent(analysisId)}/artifacts`,
        { method: "DELETE" },
      );
      if (response.ok) await refreshDetail(analysisId);
      else setError("Could not delete screenshots and readings.");
    } catch {
      setError("Could not delete screenshots and readings.");
    } finally {
      setDeleting(false);
    }
  }

  const groups = detail ? groupRuns(detail.runs) : [];
  const taskCount = groups.length;
  const allTerminal = detail
    ? detail.runs.length > 0 &&
      detail.runs.every((run) => isTerminal(run.status))
    : false;
  const noClearResult =
    detail !== null &&
    allTerminal &&
    detail.runs.some((run) => run.verdict === "no_clear_result");
  const runningTaskCount = detail
    ? groups.filter((group) => group.runs.some((run) => isRunning(run.status)))
        .length
    : 0;
  const progress =
    detail && detail.runs.length > 0
      ? Math.round(
          (detail.runs.filter((run) => isTerminal(run.status)).length /
            detail.runs.length) *
            100,
        )
      : 0;

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-10">
      <header className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          {STEPS.map((step, index) => {
            const stepNumber = (index + 1) as 1 | 2 | 3;
            const active = phase === stepNumber;
            const done = phase > stepNumber;
            return (
              <div key={step} className="flex items-center gap-3">
                {index > 0 ? (
                  <span className="text-muted-foreground">→</span>
                ) : null}
                <span
                  className={cn(
                    "text-sm font-semibold",
                    active ? "text-foreground" : "text-muted-foreground",
                    done ? "text-primary" : "",
                  )}
                >
                  {step}
                </span>
              </div>
            );
          })}
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">
          Agent analysis
        </h1>
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
          {ASSURANCE}
        </div>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Site to test</CardTitle>
        </CardHeader>
        <CardContent>
          {sites.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Add a site from the overview first, then come back to run an
              analysis.
            </p>
          ) : (
            <select
              value={selectedSiteId}
              onChange={(event) => setSelectedSiteId(event.target.value)}
              className="w-full max-w-md rounded-md border border-input bg-background p-2 text-sm"
              disabled={phase !== 1}
            >
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.host} — {site.url}
                </option>
              ))}
            </select>
          )}
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {phase === 1 ? (
        <TaskPicker
          host={host}
          remaining={remaining}
          busy={busy}
          onSubmit={(tasks) => void start(tasks)}
        />
      ) : null}

      {phase === 2 && detail ? (
        <Card>
          <CardHeader>
            <CardTitle>02 Agents try them</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-sm">
              Testing {taskCount} tasks · {runningTaskCount} still running on{" "}
              {detail.analysis.host}. This page updates by itself.
            </p>
            <Progress value={progress} />
            <div className="grid gap-3 md:grid-cols-2">
              {groups.map((group, index) => {
                const waiting = group.runs.every((run) =>
                  isWaiting(run.status),
                );
                const running = group.runs.some((run) => isRunning(run.status));
                const primary =
                  group.runs.find((run) => run.profile === "text_structure") ??
                  group.runs[0];
                return (
                  <Card key={`${group.key}-${index}`}>
                    <CardContent className="space-y-2 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">
                          {group.taskText || group.key}
                        </span>
                        <Badge variant="secondary">
                          {waiting
                            ? "Waiting"
                            : running
                              ? "Running"
                              : (primary?.verdict ?? "Done")}
                        </Badge>
                      </div>
                      {waiting ? (
                        <p className="text-sm text-muted-foreground">
                          Waiting to start.
                        </p>
                      ) : running ? (
                        <p className="text-sm text-muted-foreground">
                          The agent is on your site.
                        </p>
                      ) : (
                        <div className="space-y-1 text-sm">
                          <p className="font-medium">
                            {primary?.verdict ?? "Done"}
                          </p>
                          <p className="text-muted-foreground">
                            {primary?.answer || "No answer was recorded."}
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {phase === 3 && detail ? (
        <div className="space-y-6">
          {noClearResult ? (
            <Card>
              <CardHeader>
                <CardTitle>No clear result</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {
                    "We couldn't finish this test. Our agent hit one of its own limits."
                  }
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={() => void runAgain()}
                    disabled={busy}
                  >
                    Run again
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void copyTestId()}
                  >
                    {copied ? "Copied" : "Copy test ID"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {detail.analysis.creditConsumed
                ? "One analysis credit was used because at least one task got a result."
                : "No credit was used for this analysis."}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => void runAgain()}
              disabled={busy}
            >
              Run again
            </Button>
          </div>
          <TraceReplay
            detail={detail}
            deleting={deleting}
            onDelete={() => void deleteArtifacts()}
          />
        </div>
      ) : null}
    </main>
  );
}

const zErrorMessage = z.object({ error: z.string() });
