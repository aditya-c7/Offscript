"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

const SummarySchema = z.object({
  id: z.string(),
  host: z.string().optional(),
  submitted_url: z.string().optional(),
  scanned_at: z.string().optional(),
  status: z.string().optional(),
  verdict: z.string().optional(),
  overall: z.number().optional(),
  overall_score: z.number().optional(),
  score: z.number().optional(),
  latest_score: z.number().optional(),
  scores: z.object({ overall: z.number() }).passthrough().optional(),
  checks_passed: z.number().optional(),
  checks_total: z.number().optional(),
});
type ScanSummary = z.infer<typeof SummarySchema>;

const ListResponseSchema = z.union([
  z.object({ scans: z.array(SummarySchema) }),
  z.array(SummarySchema),
]);
const AgainResponseSchema = z.object({ id: z.string().min(1) });
const OverviewSchema = z.object({
  sites: z.array(
    z.object({
      id: z.string(),
      host: z.string().optional(),
      url: z.string().optional(),
      lastScanAt: z.string().nullable().optional(),
      scoreOverall: z.number().nullable().optional(),
      latestVerdict: z.string().nullable().optional(),
      checksPassed: z.number().optional(),
      checksTotal: z.number().optional(),
    }),
  ),
});

interface ScanRow extends ScanSummary {
  source: "scan" | "site";
}

type ListState =
  | { kind: "loading" }
  | { kind: "ready"; scans: ScanRow[] }
  | { kind: "error"; message: string };

function hostOf(scan: ScanRow): string {
  if (scan.host) return scan.host;
  const raw = scan.submitted_url ?? "";
  try {
    return new URL(raw).host;
  } catch {
    return raw || "Unknown site";
  }
}

function scoreOf(scan: ScanRow): number | null {
  if (typeof scan.overall === "number") return scan.overall;
  if (typeof scan.overall_score === "number") return scan.overall_score;
  if (typeof scan.score === "number") return scan.score;
  if (typeof scan.latest_score === "number") return scan.latest_score;
  if (scan.scores && typeof scan.scores.overall === "number")
    return scan.scores.overall;
  return null;
}

function verdictText(verdict: string | undefined): string {
  switch (verdict) {
    case "agents_can_use":
      return "Agents can use this site";
    case "agents_struggle":
      return "Agents will struggle";
    case "agents_cannot":
      return "Agents cannot reliably use this site";
    default:
      return verdict ?? "Unknown";
  }
}

function newerScoreDelta(
  scans: ScanRow[],
  index: number,
): { delta: number; newer: number } | null {
  const current = scans[index];
  if (!current || current.source !== "scan") return null;
  const currentScore = scoreOf(current);
  if (currentScore === null) return null;
  const host = hostOf(current);
  for (let i = 0; i < index; i += 1) {
    const newer = scans[i];
    if (!newer || newer.source !== "scan" || hostOf(newer) !== host) continue;
    const newerScore = scoreOf(newer);
    if (newerScore === null) continue;
    return { delta: newerScore - currentScore, newer: newerScore };
  }
  return null;
}

export function ScanList(): React.JSX.Element {
  const router = useRouter();
  const [state, setState] = React.useState<ListState>({ kind: "loading" });
  const [attempt, setAttempt] = React.useState<number>(0);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const response = await fetch("/api/scans", { cache: "no-store" });
        if (response.ok) {
          const json: unknown = await response.json();
          const parsed = ListResponseSchema.safeParse(json);
          if (parsed.success) {
            const scans: ScanRow[] = (
              Array.isArray(parsed.data) ? parsed.data : parsed.data.scans
            ).map((scan) => ({ ...scan, source: "scan" }));
            if (!cancelled) setState({ kind: "ready", scans });
            return;
          }
        }

        // GET /api/scans is optional; the site overview is the stable fallback.
        const overviewResponse = await fetch("/api/overview", {
          cache: "no-store",
        });
        if (!overviewResponse.ok)
          throw new Error("Could not load saved scans.");
        const overviewJson: unknown = await overviewResponse.json();
        const overview = OverviewSchema.safeParse(overviewJson);
        if (!overview.success)
          throw new Error("Unexpected response from the overview service.");

        const scans: ScanRow[] = overview.data.sites.map((site) => ({
          id: site.id,
          source: "site",
          host: site.host,
          submitted_url: site.url,
          scanned_at: site.lastScanAt ?? undefined,
          verdict: site.latestVerdict ?? undefined,
          overall: site.scoreOverall ?? undefined,
          checks_passed: site.checksPassed,
          checks_total: site.checksTotal,
        }));
        if (!cancelled) setState({ kind: "ready", scans });
      } catch (caught) {
        if (!cancelled) {
          setState({
            kind: "error",
            message:
              caught instanceof Error
                ? caught.message
                : "Could not load saved scans.",
          });
        }
      }
    }

    setState({ kind: "loading" });
    void load();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  async function scanAgain(row: ScanRow): Promise<void> {
    setBusyId(row.id);
    setActionError(null);
    try {
      const response =
        row.source === "scan"
          ? await fetch(`/api/scans/${encodeURIComponent(row.id)}/again`, {
              method: "POST",
            })
          : await fetch("/api/scans", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                url: row.submitted_url ?? `https://${row.host}`,
              }),
            });
      if (!response.ok)
        throw new Error(`Could not start a new scan (${response.status}).`);
      const json: unknown = await response.json();
      const parsed = AgainResponseSchema.safeParse(json);
      if (!parsed.success)
        throw new Error("Unexpected response from the scans service.");
      router.push(`/scans/${encodeURIComponent(parsed.data.id)}`);
    } catch (caught) {
      setActionError(
        caught instanceof Error
          ? caught.message
          : "Could not start a new scan.",
      );
      setBusyId(null);
    }
  }

  const sorted = React.useMemo<ScanRow[]>(
    () =>
      state.kind === "ready"
        ? [...state.scans].sort((a, b) =>
            (b.scanned_at ?? "").localeCompare(a.scanned_at ?? ""),
          )
        : [],
    [state],
  );

  return (
    <main className="mx-auto w-full max-w-5xl space-y-8 px-4 py-10 sm:px-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Scans
        </h1>
        <p className="text-sm text-muted-foreground">
          Every report we have produced, newest first.
        </p>
      </div>

      {actionError ? (
        <p className="text-sm text-red-600 dark:text-red-400">{actionError}</p>
      ) : null}

      {state.kind === "loading" ? (
        <p className="text-muted-foreground">Loading scans…</p>
      ) : null}

      {state.kind === "error" ? (
        <div className="space-y-4">
          <p className="text-foreground">{state.message}</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Try again
          </Button>
        </div>
      ) : null}

      {state.kind === "ready" ? (
        sorted.length === 0 ? (
          <p className="text-muted-foreground">No saved scans yet.</p>
        ) : (
          <ul className="space-y-3">
            {sorted.map((scan, index) => {
              const score = scoreOf(scan);
              const delta = newerScoreDelta(sorted, index);
              return (
                <li
                  key={`${scan.source}-${scan.id}`}
                  className="rounded-xl border border-border bg-card p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 space-y-1">
                      {scan.source === "scan" ? (
                        <Link
                          href={`/scans/${encodeURIComponent(scan.id)}`}
                          className="text-lg font-semibold text-foreground hover:underline"
                        >
                          {hostOf(scan)}
                        </Link>
                      ) : (
                        <p className="text-lg font-semibold text-foreground">
                          {hostOf(scan)}
                        </p>
                      )}
                      <p className="text-sm text-muted-foreground">
                        {scan.scanned_at
                          ? formatDate(scan.scanned_at)
                          : "Date unknown"}
                        {typeof scan.checks_passed === "number" &&
                        typeof scan.checks_total === "number"
                          ? ` · ${scan.checks_passed} of ${scan.checks_total} checks passed`
                          : ""}
                      </p>
                      <Badge variant="muted">{verdictText(scan.verdict)}</Badge>
                    </div>
                    <div className="flex items-center gap-4">
                      {score !== null ? (
                        <span className="text-xl font-bold tabular-nums text-foreground">
                          {score}/100
                        </span>
                      ) : null}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busyId === scan.id}
                        onClick={() => void scanAgain(scan)}
                      >
                        Scan again
                      </Button>
                    </div>
                  </div>
                  {delta ? (
                    <p className="mt-3 text-xs text-muted-foreground">
                      {`${delta.delta >= 0 ? "+" : ""}${delta.delta} pts in a newer scan (${delta.newer}/100)`}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </main>
  );
}
