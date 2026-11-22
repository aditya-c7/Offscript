"use client";

import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSites } from "@/components/shell/site-provider";
import { EmptyState } from "./empty-state";
import { SiteDetail } from "./site-detail";
import { SiteGrid } from "./site-grid";

function OverviewSkeleton() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true">
      <div className="space-y-2">
        <div className="h-7 w-40 rounded bg-muted" />
        <div className="h-4 w-72 rounded bg-muted" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((key) => (
          <div
            key={key}
            className="h-72 rounded-xl border border-border bg-card"
          />
        ))}
      </div>
    </div>
  );
}

export function Overview() {
  const { sites, loading, error, selectedSiteId, reload } = useSites();

  if (loading) return <OverviewSkeleton />;

  if (error !== null) {
    return (
      <Card className="mx-auto max-w-lg">
        <CardHeader className="flex-row items-center gap-2">
          <AlertCircle className="h-4 w-4 text-rose-600" aria-hidden="true" />
          <CardTitle>Could not load your sites</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-foreground/60">{error}</p>
          <Button variant="outline" onClick={reload}>
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (sites.length === 0) return <EmptyState />;

  if (selectedSiteId !== null) {
    const site = sites.find((candidate) => candidate.id === selectedSiteId);
    if (site !== undefined) return <SiteDetail site={site} />;
  }

  return <SiteGrid />;
}
