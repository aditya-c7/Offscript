"use client";

import {
  PIPELINE_VERSION,
  RUBRIC_VERSION,
  type Interpretation,
  type ScanReport,
} from "@offscript/shared";

import { Badge } from "@/components/ui/badge";
import { Disclosure } from "@/components/ui/disclosure";
import { Progress } from "@/components/ui/progress";

import { displayValue, verdictLabel, verdictVariant } from "./format";

interface DeveloperDrawerProps {
  scan: ScanReport;
}

function ScoreRow({
  label,
  value,
}: {
  label: string;
  value: number;
}): React.JSX.Element {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {Math.round(value)}/100
        </span>
      </div>
      <Progress value={value} label={`${label} score`} />
    </div>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 gap-2 text-sm">
      <dt className="shrink-0 font-medium text-foreground">{label}:</dt>
      <dd className="min-w-0 break-words text-muted-foreground">{children}</dd>
    </div>
  );
}

function ListFact({
  label,
  items,
}: {
  label: string;
  items: string[];
}): React.JSX.Element {
  return (
    <div>
      <p className="text-sm font-medium text-foreground">{label}:</p>
      {items.length === 0 ? (
        <p className="text-sm italic text-muted-foreground">None recorded.</p>
      ) : (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
          {items.map((item, index) => (
            <li key={`${item}-${index}`} className="break-words">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function InterpretationDetails({
  interpretation,
}: {
  interpretation: Interpretation;
}): React.JSX.Element {
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        <Fact label="Name">{interpretation.name || "Not recorded"}</Fact>
        <Fact label="Type">
          {interpretation.website_type || "Not recorded"}
        </Fact>
        <Fact label="Category">
          {interpretation.category || "Not recorded"}
        </Fact>
        <Fact label="Business model">
          {interpretation.business_model || "Not recorded"}
        </Fact>
        <Fact label="Confidence">
          {interpretation.confidence.label} (
          {Math.round(interpretation.confidence.score * 100)}%)
        </Fact>
        <Fact label="Model ID">
          {interpretation.model_id || "Not recorded"}
        </Fact>
        <Fact label="Prompt version">
          {interpretation.prompt_version || "Not recorded"}
        </Fact>
        <Fact label="Unsupported claims stripped">
          {interpretation.unsupported_claims_stripped}
        </Fact>
        <Fact label="Unsupported URLs stripped">
          {interpretation.unsupported_urls_stripped}
        </Fact>
      </dl>
      <ListFact label="Audiences" items={interpretation.audiences} />
      <ListFact label="Offerings" items={interpretation.offerings} />
      <ListFact label="Visitor goals" items={interpretation.visitor_goals} />
      <ListFact
        label="Could not confirm"
        items={interpretation.could_not_confirm}
      />
    </div>
  );
}

export function DeveloperDrawer({
  scan,
}: DeveloperDrawerProps): React.JSX.Element {
  const standards = scan.findings.filter((finding) =>
    finding.key.startsWith("standards."),
  );

  return (
    <section aria-label="Technical details" className="pt-2">
      <Disclosure title="For your developer: technical details">
        <div className="space-y-8">
          <div className="space-y-3">
            <h3 className="text-base font-semibold text-foreground">
              Scores by area
            </h3>
            <p className="text-sm text-muted-foreground">
              Find, understand and act are reported separately.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <ScoreRow label="Find" value={scan.scores.find} />
              <ScoreRow label="Understand" value={scan.scores.understand} />
              <ScoreRow label="Act" value={scan.scores.act} />
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-base font-semibold text-foreground">
              New agent standards (0..+5)
            </h3>
            <p className="text-sm text-muted-foreground">
              Modifier applied to the overall score: +
              {scan.scores.standards_modifier}
            </p>
            {standards.length === 0 ? (
              <p className="text-sm italic text-muted-foreground">
                No individual standard rows were recorded.
              </p>
            ) : (
              <div className="space-y-2">
                {standards.map((finding, index) => (
                  <div
                    key={`${finding.key}-${index}`}
                    className="rounded-lg border border-border bg-background p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <code className="break-all font-mono text-xs text-foreground">
                        {finding.key}
                      </code>
                      <Badge variant={verdictVariant(finding.verdict)}>
                        {verdictLabel(finding.verdict)}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Confidence {Math.round(finding.confidence * 100)}% ·
                      Impact {finding.impact}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="text-base font-semibold text-foreground">Method</h3>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
              <Fact label="Rubric">
                {scan.rubric_version || RUBRIC_VERSION}
              </Fact>
              <Fact label="Pipeline">
                {scan.pipeline_version || PIPELINE_VERSION}
              </Fact>
              <Fact label="Pages checked">{scan.pages_checked}</Fact>
              <Fact label="Opened in browser">{scan.pages_opened_browser}</Fact>
              <Fact label="Possible pages found">
                {scan.possible_pages_found}
              </Fact>
            </dl>
            <div>
              <p className="text-sm font-medium text-foreground">
                Sampled URLs:
              </p>
              {scan.sampled_urls.length === 0 ? (
                <p className="text-sm italic text-muted-foreground">
                  No URLs sampled.
                </p>
              ) : (
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
                  {scan.sampled_urls.map((url, index) => (
                    <li key={`${url}-${index}`} className="break-all">
                      <code>{url}</code>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              This is a snapshot of what our scanner could observe at scan time.
              It tests publicly reachable pages without a login and does not
              exercise authenticated areas, payments or destructive actions.
              Results can change when the site changes, and a passing check is
              not a guarantee for every visitor or agent.
            </p>
          </div>

          <div className="space-y-3">
            <h3 className="text-base font-semibold text-foreground">
              Grounded website interpretation
            </h3>
            {scan.interpretation ? (
              <InterpretationDetails interpretation={scan.interpretation} />
            ) : (
              <p className="text-sm italic text-muted-foreground">
                No grounded interpretation was produced.
              </p>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="text-base font-semibold text-foreground">
              Findings
            </h3>
            {scan.findings.length === 0 ? (
              <p className="text-sm italic text-muted-foreground">
                No raw findings were recorded.
              </p>
            ) : (
              <div className="space-y-2">
                {scan.findings.map((finding, index) => (
                  <Disclosure
                    key={`${finding.key}-${index}`}
                    title={finding.key}
                    subtitle={finding.url}
                    badge={
                      <Badge variant={verdictVariant(finding.verdict)}>
                        {verdictLabel(finding.verdict)}
                      </Badge>
                    }
                  >
                    <dl className="space-y-1">
                      <Fact label="Check ID">{finding.key}</Fact>
                      <Fact label="Result">
                        {verdictLabel(finding.verdict)}
                      </Fact>
                      <Fact label="Confidence">
                        {Math.round(finding.confidence * 100)}%
                      </Fact>
                      <Fact label="Impact">{finding.impact}</Fact>
                      <Fact label="URL">
                        <span className="break-all">{finding.url}</span>
                      </Fact>
                      <Fact label="Element selector">
                        <code className="break-all font-mono text-xs">
                          {finding.selector ?? "No selector recorded"}
                        </code>
                      </Fact>
                    </dl>
                    <p className="mt-3 text-sm font-medium text-foreground">
                      HTML snippet:
                    </p>
                    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-xs text-foreground">
                      {finding.snippet ?? "No snippet recorded"}
                    </pre>
                    <p className="mt-3 text-sm font-medium text-foreground">
                      evidence_json:
                    </p>
                    <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-xs text-foreground">
                      {displayValue(finding.evidence_json)}
                    </pre>
                  </Disclosure>
                ))}
              </div>
            )}
          </div>
        </div>
      </Disclosure>
    </section>
  );
}
