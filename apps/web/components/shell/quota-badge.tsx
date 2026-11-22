"use client";

import * as React from "react";
import { Activity } from "lucide-react";
import { z } from "zod";

const QuotaSchema = z.object({
  remaining: z.number().int().nonnegative(),
});

function quotaLabel(remaining: number): string {
  if (remaining === 1) return "1 agent analysis left";
  return `${remaining} agent analyses left`;
}

export function QuotaBadge() {
  const [remaining, setRemaining] = React.useState<number | null>(null);

  React.useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const response = await fetch("/api/quota");
        if (!response.ok) return;
        const raw: unknown = await response.json();
        const parsed = QuotaSchema.safeParse(raw);
        if (parsed.success && active) setRemaining(parsed.data.remaining);
      } catch {
        // Keep the neutral placeholder when the quota cannot be loaded.
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div
      className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground/70 shadow-sm"
      aria-live="polite"
    >
      <Activity className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
      <span className="tabular-nums">
        {remaining === null ? "…" : quotaLabel(remaining)}
      </span>
    </div>
  );
}
