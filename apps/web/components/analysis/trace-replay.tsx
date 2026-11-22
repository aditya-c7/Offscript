"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AgentActionSchema,
  PolicyEventSchema,
  VerifierResultSchema,
} from "@offscript/shared";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatDate } from "@/lib/utils";
import {
  artifactUrl,
  groupRuns,
  parseObservation,
  type AnalysisDetail,
  type AnalysisRun,
  type AnalysisStep,
} from "@/components/analysis/types";

const CHECK1_LABEL = "An agent reading the page's text";
const CHECK2_LABEL = "An agent looking at the screen";

interface TraceReplayProps {
  detail: AnalysisDetail;
  deleting: boolean;
  onDelete: () => void;
}

export function TraceReplay({ detail, deleting, onDelete }: TraceReplayProps) {
  const groups = useMemo(() => groupRuns(detail.runs), [detail.runs]);
  const [groupIdx, setGroupIdx] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    setStepIdx(0);
  }, [groupIdx]);

  const group = groups[groupIdx] ?? groups[0];
  if (!group) {
    return (
      <p className="text-sm text-muted-foreground">No steps were recorded.</p>
    );
  }

  const check1Run =
    group.runs.find((candidate) => candidate.profile === "text_structure") ??
    group.runs[0];
  const check2Run =
    group.runs.find((candidate) => candidate.profile === "visual_screen") ??
    group.runs[0];
  const navRun = check1Run ?? check2Run;
  const steps = navRun?.steps ?? [];
  const step = steps[Math.min(stepIdx, Math.max(0, steps.length - 1))];

  const check1Step = stepForRun(check1Run, stepIdx);
  const check2Step = stepForRun(check2Run, stepIdx);

  const observation = parseObservation(check1Step?.observation);
  const targets = observation.success ? observation.data.targets : [];

  const policyEvents = z
    .array(PolicyEventSchema)
    .safeParse(check1Step?.policyEventsJson);
  const action = AgentActionSchema.safeParse(check1Step?.actionJson);
  const verifier = VerifierResultSchema.safeParse(check1Run?.verifierJson);

  const check2Final = [...(check2Run?.steps ?? [])]
    .reverse()
    .find((candidate) => candidate.screenshotPath);
  const screenshotSrc = artifactUrl(
    check2Run?.id ?? "",
    check2Step?.screenshotPath ?? null,
  );
  const finalSrc = artifactUrl(
    check2Run?.id ?? "",
    check2Final?.screenshotPath ?? null,
  );

  const deleted = detail.analysis.artifactsDeletedAt !== null;
  const expiresAt = detail.analysis.artifactsExpiresAt;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">03 See every step</h3>
          <p className="text-sm text-muted-foreground">
            Replay what each agent saw and did, step by step.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button
            type="button"
            variant="outline"
            disabled={deleted || deleting}
            onClick={onDelete}
          >
            {deleting ? "Deleting…" : "Delete screenshots and readings"}
          </Button>
          <span className="text-xs text-muted-foreground">
            {expiresAt
              ? `Screenshots expire after 30 days · ${formatDate(expiresAt)}`
              : "Screenshots expire after 30 days"}
          </span>
        </div>
      </div>

      {deleted ? (
        <p className="rounded-md border p-3 text-sm text-muted-foreground">
          Screenshots and readings were deleted.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {groups.map((candidate, index) => (
          <Button
            key={`${candidate.key}-${index}`}
            type="button"
            size="sm"
            variant={index === groupIdx ? "default" : "outline"}
            onClick={() => setGroupIdx(index)}
          >
            {candidate.taskText || candidate.key}
          </Button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Steps</CardTitle>
          </CardHeader>
          <CardContent>
            {steps.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No steps recorded.
              </p>
            ) : (
              <ol className="space-y-1">
                {steps.map((candidate, index) => (
                  <li key={`${candidate.idx}-${index}`}>
                    <button
                      type="button"
                      onClick={() => setStepIdx(index)}
                      className={cn(
                        "w-full rounded-md px-2 py-1 text-left text-xs",
                        index === stepIdx
                          ? "bg-primary/10 font-semibold text-foreground"
                          : "text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {index + 1}. {candidate.perceptionMode}
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <p className="text-xs font-medium text-muted-foreground">Check 1</p>
            <CardTitle className="text-sm">{CHECK1_LABEL}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="mb-1 text-xs font-semibold">Observation v2</p>
              <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-[11px] leading-relaxed">
                {observation.success
                  ? JSON.stringify(observation.data, null, 2)
                  : "No page-structure reading was saved for this step."}
              </pre>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold">Policy events</p>
              {policyEvents.success && policyEvents.data.length > 0 ? (
                <ul className="space-y-1 text-xs">
                  {policyEvents.data.map((event, index) => (
                    <li key={`${event.rule}-${index}`} className="flex gap-2">
                      <Badge
                        variant={event.blocked ? "destructive" : "secondary"}
                      >
                        {event.blocked ? "Blocked" : "Allowed"}
                      </Badge>
                      <span>
                        {event.rule} — {event.detail}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No policy events.
                </p>
              )}
            </div>
            {action.success ? (
              <p className="text-xs text-muted-foreground">
                Action: <span className="font-medium">{action.data.kind}</span>
                {action.data.reasoning ? ` — ${action.data.reasoning}` : ""}
              </p>
            ) : null}
            <div>
              <p className="mb-1 text-xs font-semibold">Verifier verdict</p>
              {verifier.success ? (
                <div className="space-y-1 text-xs">
                  <Badge variant="outline">{verifier.data.verdict}</Badge>
                  <p>
                    {verifier.data.reasons.join(" ") || "No reasons recorded."}
                  </p>
                  <p className="text-muted-foreground">
                    Grounded: {verifier.data.grounded ? "yes" : "no"}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No verdict recorded.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <p className="text-xs font-medium text-muted-foreground">Check 2</p>
            <CardTitle className="text-sm">{CHECK2_LABEL}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Sensitive values redacted</Badge>
            </div>
            {screenshotSrc && !deleted ? (
              <div className="relative overflow-hidden rounded-md border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={screenshotSrc}
                  alt={CHECK2_LABEL}
                  className="block w-full"
                />
                {targets.map((target, index) => (
                  <span
                    key={`${target.id}-${index}`}
                    className="absolute flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground"
                    style={{
                      left: `${Math.max(0, target.bounds.x)}px`,
                      top: `${Math.max(0, target.bounds.y)}px`,
                    }}
                  >
                    {index + 1}
                  </span>
                ))}
              </div>
            ) : (
              <p className="rounded-md border p-4 text-xs text-muted-foreground">
                No screenshot for this step.
              </p>
            )}
            <div className="border-t pt-3">
              <p className="mb-2 text-xs font-semibold">Final page</p>
              {finalSrc && !deleted ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={finalSrc}
                  alt="Final page screenshot"
                  className="block w-full rounded-md border"
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  No final screenshot was captured.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function stepForRun(
  run: AnalysisRun | undefined,
  index: number,
): AnalysisStep | undefined {
  if (!run || run.steps.length === 0) return undefined;
  return run.steps[Math.min(index, run.steps.length - 1)];
}
