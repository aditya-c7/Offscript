"use client";

import Link from "next/link";
import type { ScanReport } from "@offscript/shared";

import { AgentAnalysisCta } from "./agent-cta";

interface AgentAnalysisSectionProps {
  scan: ScanReport;
  publicView: boolean;
}

export function AgentAnalysisSection({
  scan,
  publicView,
}: AgentAnalysisSectionProps): React.JSX.Element {
  return (
    <section aria-labelledby="agent-analysis-heading" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="agent-analysis-heading"
          className="text-xl font-semibold tracking-tight text-foreground"
        >
          02 · Agent analysis
        </h2>
        {!publicView ? (
          <Link
            href={`/agent-analysis?scan=${encodeURIComponent(scan.id)}`}
            className="text-sm font-medium text-foreground underline underline-offset-4"
          >
            Open agent analysis
          </Link>
        ) : null}
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <p className="font-medium text-foreground">No agent analysis yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          We have not run a live agent against this site yet. Start one below to
          see what happens.
        </p>
      </div>

      <AgentAnalysisCta
        scanId={scan.id}
        url={scan.submitted_url}
        host={scan.host}
        compact
      />
    </section>
  );
}
