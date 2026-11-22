import * as React from "react";
import { cn } from "@/lib/utils";

export interface ProgressProps {
  value: number;
  label?: string;
  tone?: "good" | "warn" | "bad";
  className?: string;
}

const toneClasses: Record<NonNullable<ProgressProps["tone"]>, string> = {
  good: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-rose-500",
};

export function Progress({ value, label, tone, className }: ProgressProps) {
  const numeric = Number.isFinite(value) ? value : 0;
  const clamped = Math.max(0, Math.min(100, numeric));
  const rounded = Math.round(clamped);
  const barTone = tone ? toneClasses[tone] : "bg-accent";

  return (
    <div className={cn("w-full", className)}>
      {label !== undefined ? (
        <div className="mb-1 flex items-center justify-between gap-2 text-xs">
          <span className="text-foreground/60">{label}</span>
          <span className="font-medium tabular-nums text-foreground/80">
            {rounded}
          </span>
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuenow={rounded}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            barTone,
          )}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
