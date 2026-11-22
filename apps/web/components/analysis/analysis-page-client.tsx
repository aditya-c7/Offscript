"use client";

import { useSearchParams } from "next/navigation";
import { AgentAnalysis } from "@/components/analysis/agent-analysis";

export function AgentAnalysisPageContent() {
  const searchParams = useSearchParams();
  return (
    <AgentAnalysis
      initialSiteId={searchParams.get("site")}
      initialAnalysisId={searchParams.get("analysis")}
    />
  );
}
