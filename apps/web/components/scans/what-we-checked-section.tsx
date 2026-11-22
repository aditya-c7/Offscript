"use client";

import {
  CATEGORY_META,
  CHECK_KEYS,
  CHECK_META,
  type CheckResult,
  type ScanReport,
} from "@offscript/shared";

import { Badge } from "@/components/ui/badge";
import { Disclosure } from "@/components/ui/disclosure";

import {
  displayValue,
  ratioBadge,
  verdictLabel,
  verdictVariant,
} from "./format";

interface WhatWeCheckedSectionProps {
  scan: ScanReport;
}

function titleForKey(key: string): string {
  const match = CHECK_KEYS.find((candidate) => candidate === key);
  return match ? CHECK_META[match].title : key;
}

function ObservationList({
  data,
}: {
  data: Record<string, unknown>;
}): React.JSX.Element {
  const entries = Object.entries(data);
  if (entries.length === 0) {
    return (
      <p className="text-sm italic text-muted-foreground">
        No observed metrics recorded.
      </p>
    );
  }
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="flex min-w-0 gap-2 text-sm">
          <dt className="shrink-0 font-medium text-foreground">{key}:</dt>
          <dd className="min-w-0 break-words text-muted-foreground">
            {displayValue(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function CheckRow({ check }: { check: CheckResult }): React.JSX.Element {
  return (
    <li className="rounded-lg border border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="font-medium text-foreground">
            {titleForKey(check.key)}
          </p>
          <p className="break-all font-mono text-xs text-muted-foreground">
            {check.key}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant={verdictVariant(check.verdict)}>
            {verdictLabel(check.verdict)}
          </Badge>
          <Badge variant="muted" className="capitalize">
            {check.impact}
          </Badge>
        </div>
      </div>

      <div className="mt-3 space-y-3 text-sm">
        <div>
          <p className="font-medium text-foreground">Observed metrics</p>
          <div className="mt-1">
            <ObservationList data={check.evidence} />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <p className="font-medium text-foreground">Selector</p>
            <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
              {check.selector ?? "No selector recorded"}
            </p>
          </div>
          <div>
            <p className="font-medium text-foreground">Confidence</p>
            <p className="mt-1 text-muted-foreground">
              {Math.round(check.confidence * 100)}%
            </p>
          </div>
        </div>
        {check.snippet ? (
          <div>
            <p className="font-medium text-foreground">Snippet</p>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-xs text-foreground">
              {check.snippet}
            </pre>
          </div>
        ) : null}
        <div>
          <p className="font-medium text-foreground">Reproduce</p>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-xs text-foreground">
            {check.reproduce_cmd}
          </pre>
        </div>
        <p className="break-all text-xs text-muted-foreground">
          {check.page_url}
        </p>
      </div>
    </li>
  );
}

export function WhatWeCheckedSection({
  scan,
}: WhatWeCheckedSectionProps): React.JSX.Element {
  const allChecks: CheckResult[] = scan.categories.flatMap(
    (category) => category.checks,
  );

  return (
    <section aria-labelledby="checked-heading" className="space-y-5">
      <h2
        id="checked-heading"
        className="text-xl font-semibold tracking-tight text-foreground"
      >
        03 · What we checked
      </h2>
      <p className="text-sm text-muted-foreground">
        Every check is shown, including the ones that passed. No results are
        hidden.
      </p>

      <div className="space-y-3">
        {CATEGORY_META.map((meta) => {
          const category = scan.categories.find(
            (entry) => entry.key === meta.key,
          );
          const checks =
            category?.checks ??
            allChecks.filter((check) => check.category === meta.key);
          const passed =
            category?.passed ??
            checks.filter((check) => check.verdict === "pass").length;
          const total = category?.total ?? checks.length;
          const badge = ratioBadge(passed, total);

          return (
            <Disclosure
              key={meta.key}
              title={meta.title}
              subtitle={meta.subtitle}
              badge={
                <span className="flex items-center gap-3">
                  <span className="text-sm tabular-nums text-foreground/55">
                    {passed}/{total}
                  </span>
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </span>
              }
            >
              {checks.length === 0 ? (
                <p className="text-sm italic text-muted-foreground">
                  No checks recorded for this category.
                </p>
              ) : (
                <ul className="space-y-3">
                  {checks.map((check) => (
                    <CheckRow key={check.key} check={check} />
                  ))}
                </ul>
              )}
            </Disclosure>
          );
        })}
      </div>
    </section>
  );
}
