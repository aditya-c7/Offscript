"use client";

import * as React from "react";
import { z } from "zod";

import { ScanReportSchema, type ScanReport } from "@offscript/shared";

import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

import { AgentAnalysisSection } from "./agent-analysis-section";
import { DeveloperDrawer } from "./developer-drawer";
import { FixFirstSection } from "./fix-first-section";
import { copyToClipboard } from "./format";
import { OverviewSection } from "./overview-section";
import { ProtocolsSection } from "./protocols-section";
import { WhatWeCheckedSection } from "./what-we-checked-section";

const EnvelopeSchema = z.object({ scan: z.unknown() });
const StatusSchema = z.object({
  status: z.enum(["queued", "running", "complete", "failed"]),
});

type LoadState =
  | { kind: "loading" }
  | { kind: "progress"; status: "queued" | "running" }
  | { kind: "ready"; scan: ScanReport }
  | { kind: "error"; message: string };

interface ScanReportViewProps {
  scanId?: string;
  shareToken?: string;
  publicView?: boolean;
}

export function ScanReportView(props: ScanReportViewProps): React.JSX.Element {
  const publicView = props.publicView === true;
  const endpoint = props.shareToken
    ? `/api/r/${encodeURIComponent(props.shareToken)}`
    : `/api/scans/${encodeURIComponent(props.scanId ?? "")}`;

  const [state, setState] = React.useState<LoadState>({ kind: "loading" });
  const [attempt, setAttempt] = React.useState<number>(0);
  const [copied, setCopied] = React.useState<boolean>(false);

  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function load(): Promise<void> {
      try {
        const response = await fetch(endpoint, { cache: "no-store" });
        if (!response.ok)
          throw new Error(`Report request failed (${response.status}).`);

        const json: unknown = await response.json();
        const envelope = EnvelopeSchema.safeParse(json);
        if (!envelope.success)
          throw new Error("Unexpected response from the report service.");

        const status = StatusSchema.safeParse(envelope.data.scan);
        if (
          status.success &&
          (status.data.status === "queued" || status.data.status === "running")
        ) {
          if (!cancelled)
            setState({ kind: "progress", status: status.data.status });
          timer = setTimeout(() => void load(), 2000);
          return;
        }

        const parsed = ScanReportSchema.safeParse(envelope.data.scan);
        if (!parsed.success) throw new Error("The report is not ready yet.");
        if (!cancelled) setState({ kind: "ready", scan: parsed.data });
      } catch (caught) {
        if (!cancelled) {
          setState({
            kind: "error",
            message:
              caught instanceof Error
                ? caught.message
                : "Could not load the report.",
          });
        }
      }
    }

    setState({ kind: "loading" });
    void load();

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [endpoint, attempt]);

  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copyLink(scan: ScanReport): Promise<void> {
    if (typeof window === "undefined") return;
    const url = publicView
      ? `${window.location.origin}/r/${encodeURIComponent(scan.share_token)}`
      : window.location.href;
    if (await copyToClipboard(url)) setCopied(true);
  }

  if (state.kind === "loading" || state.kind === "progress") {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6">
        <p className="text-center text-muted-foreground">
          {state.kind === "loading" ? "Loading report…" : "Scanning your site…"}
        </p>
        {state.kind === "progress" ? (
          <p className="mt-2 text-center text-sm text-muted-foreground">
            Status: {state.status}
          </p>
        ) : null}
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6">
        <div className="mx-auto max-w-md space-y-4 text-center">
          <p className="text-foreground">{state.message}</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Try again
          </Button>
        </div>
      </main>
    );
  }

  const scan = state.scan;

  return (
    <main className="mx-auto w-full max-w-5xl space-y-12 px-4 py-10 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <p className="text-sm text-muted-foreground">
          {`${scan.host} · ${formatDate(scan.scanned_at)} · ${scan.pages_checked} of about ${scan.possible_pages_found} pages checked`}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void copyLink(scan)}
        >
          {copied ? "Link copied" : "Copy link"}
        </Button>
      </header>

      <OverviewSection scan={scan} />
      <AgentAnalysisSection scan={scan} publicView={publicView} />
      <WhatWeCheckedSection scan={scan} />
      <FixFirstSection scan={scan} />
      <ProtocolsSection scan={scan} />
      <DeveloperDrawer scan={scan} />
    </main>
  );
}
