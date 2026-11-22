"use client";

import { ArrowUpRight, Clock3 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { SiteSummary } from "@/components/shell/site-provider";
import { useSites } from "@/components/shell/site-provider";
import { formatDate } from "@/lib/utils";
import { scoreTone, verdictDisplay } from "./format";

interface SiteCardProps {
  site: SiteSummary;
  onOpen: () => void;
}

function SiteCard({ site, onOpen }: SiteCardProps) {
  const verdict = verdictDisplay(site.latestVerdict);

  return (
    <Card>
      <button
        type="button"
        onClick={onOpen}
        className="block w-full rounded-xl p-5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-foreground/45">
              Agent endpoint
            </p>
            <p className="mt-0.5 truncate font-mono text-sm font-medium text-foreground">
              agent://{site.host}
            </p>
          </div>
          <ArrowUpRight
            className="h-4 w-4 shrink-0 text-foreground/35"
            aria-hidden="true"
          />
        </div>

        <div className="mt-5 flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-foreground/45">
              Overall score
            </p>
            <p className="mt-0.5 text-3xl font-semibold tabular-nums leading-none">
              {site.scoreOverall === null ? "—" : Math.round(site.scoreOverall)}
            </p>
          </div>
          <Badge variant={verdict.variant}>{verdict.label}</Badge>
        </div>

        <div className="mt-5 space-y-2.5">
          <Progress
            label="Find"
            value={site.find ?? 0}
            tone={scoreTone(site.find)}
          />
          <Progress
            label="Understand"
            value={site.understand ?? 0}
            tone={scoreTone(site.understand)}
          />
          <Progress
            label="Act"
            value={site.act ?? 0}
            tone={scoreTone(site.act)}
          />
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-foreground/55">
          <span className="inline-flex items-center gap-1.5">
            <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
            {site.lastScanAt === null
              ? "Never scanned"
              : `Last scan ${formatDate(site.lastScanAt)}`}
          </span>
          <span className="tabular-nums">
            {site.checksPassed}/{site.checksTotal} checks passed
          </span>
        </div>
      </button>
    </Card>
  );
}

export function SiteGrid() {
  const { sites, selectSite } = useSites();

  return (
    <section>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="mt-1 text-sm text-foreground/55">
          How agents currently experience each of your sites.
        </p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {sites.map((site) => (
          <SiteCard
            key={site.id}
            site={site}
            onOpen={() => selectSite(site.id)}
          />
        ))}
      </div>
    </section>
  );
}
