"use client";

import {
  PROTOCOL_META,
  PROTOCOL_KEYS,
  type ScanReport,
} from "@offscript/shared";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface ProtocolsSectionProps {
  scan: ScanReport;
}

export function ProtocolsSection({
  scan,
}: ProtocolsSectionProps): React.JSX.Element {
  const found = scan.protocols.filter((protocol) => protocol.found).length;
  const total = PROTOCOL_KEYS.length;

  return (
    <section aria-labelledby="protocols-heading" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="protocols-heading"
          className="text-xl font-semibold tracking-tight text-foreground"
        >
          05 · Agent protocols
        </h2>
        <p className="text-sm font-medium text-muted-foreground">{`${found} of ${total} found`}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PROTOCOL_META.map((meta) => {
          const result = scan.protocols.find(
            (protocol) => protocol.key === meta.key,
          );
          const isFound = result?.found === true;
          return (
            <Card key={meta.key} className="border-border bg-card">
              <CardHeader className="gap-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">{meta.title}</CardTitle>
                  <Badge variant={isFound ? "success" : "muted"}>
                    {isFound ? "Found" : "Not found"}
                  </Badge>
                </div>
                <CardDescription>{meta.description}</CardDescription>
              </CardHeader>
              {result?.detail ? (
                <CardContent className="pt-0 text-xs text-muted-foreground">
                  {result.detail}
                </CardContent>
              ) : null}
            </Card>
          );
        })}
      </div>
    </section>
  );
}
