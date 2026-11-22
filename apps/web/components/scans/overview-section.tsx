"use client";

import type { ScanReport } from "@offscript/shared";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

import { AgentAnalysisCta } from "./agent-cta";

interface OverviewSectionProps {
  scan: ScanReport;
}

const HEADLINE: Record<ScanReport["verdict"], string> = {
  agents_can_use: "Agents can use this site",
  agents_struggle: "Agents will struggle with parts of this site",
  agents_cannot: "Agents cannot reliably use this site",
};

export function OverviewSection({
  scan,
}: OverviewSectionProps): React.JSX.Element {
  const overall = Math.round(scan.scores.overall);
  const total = scan.checks_total > 0 ? scan.checks_total : 31;

  return (
    <section aria-labelledby="overview-heading" className="space-y-5">
      <h2
        id="overview-heading"
        className="text-xl font-semibold tracking-tight text-foreground"
      >
        01 · Overview
      </h2>

      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="space-y-3">
            <p className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {HEADLINE[scan.verdict]}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>
                {scan.checks_passed} of {total} checks passed
              </span>
              <span aria-hidden="true">·</span>
              <Badge variant="muted" className="font-mono">
                {`agent://${scan.host}`}
              </Badge>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-4xl font-bold tabular-nums text-foreground">
              {overall}/100
            </div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Overall score
            </p>
          </div>
        </div>
        <div className="mt-5 max-w-xl">
          <Progress value={overall} label="Overall score out of 100" />
        </div>
      </div>

      <AgentAnalysisCta
        scanId={scan.id}
        url={scan.submitted_url}
        host={scan.host}
      />
    </section>
  );
}
