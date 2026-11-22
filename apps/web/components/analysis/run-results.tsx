"use client";

import { useMemo } from "react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  evidenceQuotesForRun,
  groupRuns,
  verifierForRun,
  type AnalysisDetail,
  type AnalysisRun,
} from "@/components/analysis/types";

const CHECK1_LABEL = "An agent reading the page's text";
const CHECK2_LABEL = "An agent looking at the screen";

interface RunResultsProps {
  detail: AnalysisDetail;
}

/** The verdict and its evidence, rendered directly from the loaded detail so
 * they stay visible on a fresh page load / refresh of the deep link. */
export function RunResults({ detail }: RunResultsProps) {
  const groups = useMemo(() => groupRuns(detail.runs), [detail.runs]);

  return (
    <section className="space-y-4" aria-label="Agent analysis results">
      <div>
        <h2 className="text-lg font-semibold">Results</h2>
        <p className="text-sm text-muted-foreground">
          The verdict and evidence for each task. These stay available after a
          refresh.
        </p>
      </div>
      {groups.map((group, groupIndex) => (
        <Card key={`${group.key}-${groupIndex}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              {group.taskText || group.key}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {group.runs.map((run) => (
              <RunResultRow key={run.id} run={run} />
            ))}
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

function RunResultRow({ run }: { run: AnalysisRun }) {
  const verifier = verifierForRun(run);
  const quotes = evidenceQuotesForRun(run);
  const check2 = run.profile === "visual_screen";

  return (
    <div className="space-y-3 border-t pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={verdictVariant(run.verdict)}>
          {run.verdict ?? "Done"}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {check2 ? CHECK2_LABEL : CHECK1_LABEL}
        </span>
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold">Answer</p>
        <p className="whitespace-pre-wrap text-sm">
          {run.answer || "No answer was recorded."}
        </p>
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold">Verifier reasons</p>
        {verifier && verifier.reasons.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {verifier.reasons.map((reason, index) => (
              <li key={`${index}-${reason}`}>{reason}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No reasons recorded.</p>
        )}
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold">Evidence quotes</p>
        {quotes.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {quotes.map((quote, index) => (
              <li key={`${index}-${quote}`} className="border-l-2 pl-3">
                {quote}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No evidence quotes were recorded.
          </p>
        )}
      </div>
    </div>
  );
}

function verdictVariant(verdict: string | null): BadgeVariant {
  if (verdict === "pass") return "success";
  if (verdict === "fail") return "danger";
  if (verdict === "infra_error") return "warning";
  if (verdict === "no_clear_result") return "muted";
  return "secondary";
}
