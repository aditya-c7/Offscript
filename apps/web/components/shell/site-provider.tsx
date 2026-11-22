"use client";

import * as React from "react";
import { z } from "zod";

import { SiteSchema } from "./site-schema";
import type { SiteSummary } from "./site-schema";

export type { SiteSummary } from "./site-schema";

const OverviewResponseSchema = z.object({
  sites: z.array(SiteSchema),
});

export interface SiteContextValue {
  sites: SiteSummary[];
  loading: boolean;
  error: string | null;
  selectedSiteId: string | null;
  selectSite: (id: string | null) => void;
  reload: () => void;
}

const SiteContext = React.createContext<SiteContextValue | null>(null);

export function SiteProvider({ children }: { children: React.ReactNode }) {
  const [sites, setSites] = React.useState<SiteSummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedSiteId, setSelectedSiteId] = React.useState<string | null>(
    null,
  );
  const [reloadKey, setReloadKey] = React.useState(0);

  const reload = React.useCallback(() => {
    setReloadKey((key) => key + 1);
  }, []);

  React.useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/overview");
        if (!response.ok) {
          throw new Error(`Request failed (${response.status})`);
        }
        const raw: unknown = await response.json();
        const parsed = OverviewResponseSchema.safeParse(raw);
        if (!parsed.success) {
          throw new Error("Unexpected response from the server.");
        }
        if (!active) return;
        setSites(parsed.data.sites);
        setSelectedSiteId((previous) => {
          if (previous === null) return null;
          return parsed.data.sites.some((site) => site.id === previous)
            ? previous
            : null;
        });
      } catch (cause: unknown) {
        if (!active) return;
        setError(
          cause instanceof Error ? cause.message : "Unable to load sites.",
        );
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const value = React.useMemo<SiteContextValue>(
    () => ({
      sites,
      loading,
      error,
      selectedSiteId,
      selectSite: setSelectedSiteId,
      reload,
    }),
    [sites, loading, error, selectedSiteId, reload],
  );

  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}

export function useSites(): SiteContextValue {
  const context = React.useContext(SiteContext);
  if (context === null) {
    throw new Error("useSites must be used within a SiteProvider");
  }
  return context;
}
