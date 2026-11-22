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
} from "@/components/analysis/types";

interface TraceReplayProps {
  detail: AnalysisDetail;
  deleting: boolean;
  onDelete: () => void;
}

const PROFILE_LABELS: Readonly<Record<string, string>> = {
  text_structure: "An agent reading the page's text",
  visual_screen: "An agent looking at the screen",
};

const PROFILES: ReadonlyArray<{ value: string; label: string }> = [
  {
    value: "text_structure",
    label: "Check 1 · An agent reading the page's text",
  },
  { value: "visual_screen", label: "Check 2 · An agent looking at the screen" },
];

export function TraceReplay({ detail, deleting, onDelete }: TraceReplayProps) {
  const groups = useMemo(() => groupRuns(detail.runs), [detail.runs]);
  const [groupIdx, setGroupIdx] = useState(0);
  const [profile, setProfile] = useState("text_structure");
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    setStepIdx(0);
  }, [groupIdx, profile]);

  const group = groups[groupIdx] ?? groups[0];
  if (!group) {
    return (
      <p className="text-sm text-muted-foreground">No steps were recorded.</p>
    );
  }

  const run =
    group.runs.find((candidate) => candidate.profile === profile) ??
    group.runs[0];
  const steps = run?.steps ?? [];
  const step = steps[stepIdx];
  const finalStep = [...steps]
    .reverse()
    .find((candidate) => candidate.screenshotPath);
  const screenshotSrc = artifactUrl(
    run?.id ?? "",
    step?.screenshotPath ?? null,
  );
  const finalSrc = artifactUrl(
    run?.id ?? "",
    finalStep?.screenshotPath ?? null,
  );

  const check1Run =
    group.runs.find((candidate) => candidate.profile === "text_structure") ??
    run;
  const check1Steps = check1Run?.steps ?? [];
  const check1Step =
    check1Steps[Math.min(stepIdx, Math.max(0, check1Steps.length - 1))];
  const observation = parseObservation(check1Step?.observation);
  const targets = observation.success ? observation.data.targets : [];

  const policyEvents = z
    .array(PolicyEventSchema)
    .safeParse(step?.policyEventsJson);
  const action = AgentActionSchema.safeParse(step?.actionJson);
  const verifier = VerifierResultSchema.safeParse(check1Run?.verifierJson);

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
        <Button
          type="button"
          variant="outline"
          disabled={deleted || deleting}
          onClick={onDelete}
        >
          {deleting ? "Deleting…" : "Delete screenshots and readings"}
        </Button>
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

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)]">
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
            <CardTitle className="text-sm">What the agent saw</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Sensitive values redacted</Badge>
              <span className="text-xs text-muted-foreground">
                {expiresAt
                  ? `Screenshots expire after 30 days · ${formatDate(expiresAt)}`
                  : "Screenshots expire after 30 days"}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {PROFILES.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  size="sm"
                  variant={profile === option.value ? "default" : "outline"}
                  onClick={() => setProfile(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
            <p className="text-xs font-medium">
              {PROFILE_LABELS[profile] ?? "Agent view"}
            </p>
            {screenshotSrc && !deleted ? (
              <div className="relative overflow-hidden rounded-md border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={screenshotSrc}
                  alt="What the agent saw"
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
            {targets.length > 0 ? (
              <ol className="grid gap-1 text-xs text-muted-foreground">
                {targets.slice(0, 10).map((target, index) => (
                  <li key={`${target.id}-legend-${index}`}>
                    {index + 1}. {target.role} · {target.name || "unnamed"}
                  </li>
                ))}
              </ol>
            ) : null}
            {action.success ? (
              <p className="text-xs text-muted-foreground">
                Action: <span className="font-medium">{action.data.kind}</span>
                {action.data.reasoning ? ` — ${action.data.reasoning}` : ""}
              </p>
            ) : null}
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

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              An agent reading the page&apos;s text
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="mb-1 text-xs font-semibold">Observation v2</p>
              <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-[11px] leading-relaxed">
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
      </div>
    </div>
  );
}
