"use client";

import { useState } from "react";
import {
  ImportanceConfidenceSchema,
  PRESETS,
  type ImportanceConfidence,
  type TaskInput,
  type TaskKey,
} from "@offscript/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface TaskPickerProps {
  host: string;
  remaining: number | null;
  busy: boolean;
  onSubmit: (tasks: TaskInput[]) => void;
}

const CONFIDENCE_OPTIONS: ReadonlyArray<{
  value: ImportanceConfidence;
  label: string;
}> = [
  { value: "not_sure", label: "Not sure" },
  { value: "guess", label: "It's a guess" },
  { value: "customers_told_us", label: "Customers told us" },
];

export function TaskPicker({
  host,
  remaining,
  busy,
  onSubmit,
}: TaskPickerProps) {
  const [selectedPresets, setSelectedPresets] = useState<TaskKey[]>(["offers"]);
  const [customOpen, setCustomOpen] = useState(false);
  const [taskText, setTaskText] = useState("");
  const [success, setSuccess] = useState("");
  const [persona, setPersona] = useState("");
  const [details, setDetails] = useState("");
  const [confidence, setConfidence] =
    useState<ImportanceConfidence>("not_sure");
  const [why, setWhy] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detailLines = details
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 8);

  function togglePreset(key: TaskKey) {
    setSelectedPresets((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  }

  function submit() {
    setError(null);

    const tasks: TaskInput[] = PRESETS.filter((preset) =>
      selectedPresets.includes(preset.key),
    ).map((preset) => ({
      task_key: preset.key,
      task_text: preset.task,
      success_criteria: preset.success,
      details_lines: [],
      importance_confidence: "not_sure",
      consent: true,
    }));

    if (customOpen) {
      if (taskText.trim().length === 0 || success.trim().length === 0) {
        setError("Add what the agent should try and what counts as success.");
        return;
      }
      if (detailLines.some((line) => !line.includes("="))) {
        setError(
          "Use Label = value for each detail line, with synthetic values only.",
        );
        return;
      }
      const parsedConfidence = ImportanceConfidenceSchema.safeParse(confidence);
      tasks.push({
        task_key: "custom",
        task_text: taskText.trim(),
        success_criteria: success.trim(),
        persona: persona.trim().length > 0 ? persona.trim() : undefined,
        details_lines: detailLines,
        importance_confidence: parsedConfidence.success
          ? parsedConfidence.data
          : "not_sure",
        why_it_matters: why.trim().length > 0 ? why.trim() : undefined,
        consent: true,
      });
    }

    if (tasks.length === 0) {
      setError("Pick at least one task.");
      return;
    }
    if (!consent) {
      setError("Please confirm you are allowed to test this site.");
      return;
    }
    onSubmit(tasks);
  }

  const totalSelected = selectedPresets.length + (customOpen ? 1 : 0);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>01 Pick tasks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Choose what the agents should try on your site. Every preset below
            is one task.
          </p>
          <div className="grid gap-3 md:grid-cols-3">
            {PRESETS.map((preset) => {
              const active = selectedPresets.includes(preset.key);
              return (
                <button
                  key={preset.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => togglePreset(preset.key)}
                  className={cn(
                    "rounded-lg border p-4 text-left transition-colors",
                    active
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-foreground/30",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">
                      {preset.label}
                    </span>
                    {active ? <Badge>Selected</Badge> : null}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {preset.task}
                  </p>
                </button>
              );
            })}
          </div>

          <details
            className="rounded-lg border p-4"
            open={customOpen}
            onToggle={(event) => setCustomOpen(event.currentTarget.open)}
          >
            <summary className="cursor-pointer text-sm font-semibold">
              Try a harder task
            </summary>
            <div className="mt-4 space-y-4">
              <Field
                label="What should the agent try?"
                count={`${taskText.length}/1000`}
              >
                <textarea
                  className="min-h-20 w-full rounded-md border border-input bg-background p-2 text-sm"
                  maxLength={1000}
                  value={taskText}
                  onChange={(event) => setTaskText(event.target.value)}
                  placeholder="Describe the task in plain language"
                />
              </Field>
              <Field
                label="What counts as success?"
                count={`${success.length}/1000`}
              >
                <textarea
                  className="min-h-20 w-full rounded-md border border-input bg-background p-2 text-sm"
                  maxLength={1000}
                  value={success}
                  onChange={(event) => setSuccess(event.target.value)}
                  placeholder="Describe a good answer"
                />
              </Field>
              <Field
                label="Who is the visitor?"
                optional
                count={`${persona.length}/500`}
              >
                <Input
                  value={persona}
                  maxLength={500}
                  onChange={(event) => setPersona(event.target.value)}
                  placeholder="For example: a first-time visitor comparing plans"
                />
              </Field>
              <Field
                label="Details the agent may use"
                optional
                count={`${detailLines.length}/8 lines`}
                hint="Label = value, synthetic only"
              >
                <textarea
                  className="min-h-24 w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
                  rows={8}
                  value={details}
                  onChange={(event) =>
                    setDetails(
                      event.target.value.split(/\r?\n/).slice(0, 8).join("\n"),
                    )
                  }
                  placeholder={
                    "Example product = Acme Runner\nExample price = 49 USD"
                  }
                />
              </Field>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">
                  How sure are you it matters?
                </legend>
                <div className="flex flex-wrap gap-4">
                  {CONFIDENCE_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="radio"
                        name="importance_confidence"
                        value={option.value}
                        checked={confidence === option.value}
                        onChange={() => setConfidence(option.value)}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <Field
                label="Why it matters"
                optional
                count={`${why.length}/1000`}
              >
                <textarea
                  className="min-h-20 w-full rounded-md border border-input bg-background p-2 text-sm"
                  maxLength={1000}
                  value={why}
                  onChange={(event) => setWhy(event.target.value)}
                />
              </Field>
            </div>
          </details>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              className="mt-1"
            />
            <span>
              I own {host || "this site"} or I&apos;m allowed to test it.
            </span>
          </label>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-md text-xs text-muted-foreground">
              {
                "One agent analysis covers all of these. It's only used if at least one task gets a result."
              }
            </p>
            <Button
              type="button"
              onClick={submit}
              disabled={busy || totalSelected === 0}
            >
              {busy ? "Starting…" : "Run free agent analysis ->"}
            </Button>
          </div>
          {remaining !== null ? (
            <p className="text-xs text-muted-foreground">
              {remaining} agent {remaining === 1 ? "analysis" : "analyses"}{" "}
              remaining.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  count,
  hint,
  optional,
  children,
}: {
  label: string;
  count: string;
  hint?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {label}
          {optional ? (
            <span className="ml-1 font-normal text-muted-foreground">
              (optional)
            </span>
          ) : null}
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {count}
        </span>
      </div>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
