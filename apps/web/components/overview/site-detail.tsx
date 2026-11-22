"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Clock3,
  ListChecks,
  RotateCw,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { SiteSummary } from "@/components/shell/site-provider";
import { useSites } from "@/components/shell/site-provider";
import { formatDate } from "@/lib/utils";
import { scoreTone, verdictDisplay } from "./format";
import { errorMessageFrom, scanIdFrom } from "./scan-response";

interface SiteDetailProps {
  site: SiteSummary;
}

export function SiteDetail({ site }: SiteDetailProps) {
  const router = useRouter();
  const { selectSite, reload } = useSites();
  const [scanning, setScanning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const verdict = verdictDisplay(site.latestVerdict);
  const topFixes = (site.topFixes ?? []).slice(0, 3);

  const scanAgain = async () => {
    setError(null);
    setScanning(true);
    try {
      const response = await fetch(`/api/scans/${site.id}/again`, {
        method: "POST",
      });
      const raw: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(
          errorMessageFrom(raw) ??
            "We could not start a new scan. Please try again.",
        );
        return;
      }
      const id = scanIdFrom(raw);
      if (id === null) {
        setError("Unexpected response from the server.");
        return;
      }
      reload();
      router.push("/scans/" + id);
    } catch {
      setError("We could not reach the server. Please try again.");
    } finally {
      setScanning(false);
    }
  };

  return (
    <section className="mx-auto max-w-5xl">
      <button
        type="button"
        onClick={() => selectSite(null)}
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-foreground/55 transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All sites
      </button>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-foreground/45">
            Agent endpoint
          </p>
          <h1 className="mt-0.5 break-all font-mono text-2xl font-semibold tracking-tight">
            agent://{site.host}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-foreground/55">
            <Badge variant={verdict.variant}>{verdict.label}</Badge>
            <span>{site.detectedStack}</span>
            <span className="inline-flex items-center gap-1.5">
              <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
              {site.lastScanAt === null
                ? "Never scanned"
                : `Last scan ${formatDate(site.lastScanAt)}`}
            </span>
          </div>
        </div>
      </header>

      {error !== null ? (
        <div
          role="alert"
          className="mb-5 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700"
        >
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Overall score</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-5xl font-semibold tabular-nums leading-none">
              {site.scoreOverall === null ? "—" : Math.round(site.scoreOverall)}
            </p>
            <p className="mt-2 text-xs text-foreground/55">
              {site.checksPassed}/{site.checksTotal} checks passed
            </p>
            <div className="mt-5 space-y-3">
              <Progress
                label="Find"
                value={site.find ?? 0}
                tone={scoreTone(site.find)}
              />
              <Progress
                label="Understand"
                value={site.understand ?? 0}
                tone={scoreTone(site.understand)}
              />
              <Progress
                label="Act"
                value={site.act ?? 0}
                tone={scoreTone(site.act)}
              />
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="flex-row items-center gap-2">
              <ListChecks className="h-4 w-4 text-accent" aria-hidden="true" />
              <CardTitle>Top priority fixes</CardTitle>
            </CardHeader>
            <CardContent>
              {topFixes.length === 0 ? (
                <p className="text-sm text-foreground/55">
                  No priority fixes recorded yet.
                </p>
              ) : (
                <ol className="space-y-3">
                  {topFixes.map((fix, index) => (
                    <li key={`${index}-${fix}`} className="flex gap-3 text-sm">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent">
                        {index + 1}
                      </span>
                      <span className="leading-relaxed text-foreground/80">
                        {fix}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Next steps</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={scanAgain} disabled={scanning}>
                <RotateCw
                  className={`h-4 w-4 ${scanning ? "animate-spin" : ""}`}
                  aria-hidden="true"
                />
                Scan again
              </Button>
              <Button
                onClick={() => router.push(`/agent-analysis?site=${site.id}`)}
              >
                <Bot className="h-4 w-4" aria-hidden="true" />
                Run agent analysis -&gt;
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
