import { Suspense } from "react";
import { AgentAnalysisPageContent } from "@/components/analysis/analysis-page-client";

export const metadata = {
  title: "Agent analysis · Offscript",
};

export default function AgentAnalysisPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-6xl px-4 py-10 text-sm text-muted-foreground">
          Loading agent analysis…
        </main>
      }
    >
      <AgentAnalysisPageContent />
    </Suspense>
  );
}
