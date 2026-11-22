"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DisclosureProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
  aside?: React.ReactNode;
}

export function Disclosure({
  title,
  subtitle,
  children,
  defaultOpen = false,
  badge,
  aside,
}: DisclosureProps) {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
      >
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-foreground/45 transition-transform duration-200",
            open && "rotate-180",
          )}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{title}</div>
          {subtitle !== undefined ? (
            <div className="mt-0.5 text-xs text-foreground/55">{subtitle}</div>
          ) : null}
        </div>
        {aside !== undefined ? <div className="shrink-0">{aside}</div> : null}
        {badge !== undefined ? <div className="shrink-0">{badge}</div> : null}
      </button>
      {open ? (
        <div className="border-t border-border px-4 py-3">{children}</div>
      ) : null}
    </div>
  );
}
