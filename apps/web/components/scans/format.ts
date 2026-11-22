import type { Stack, Verdict } from "@offscript/shared";
import { STACKS } from "@offscript/shared";

export type ToneVariant =
  "default" | "success" | "warning" | "danger" | "muted";

/** Semantic badge variant for a deterministic check verdict. */
export function verdictVariant(verdict: Verdict): ToneVariant {
  switch (verdict) {
    case "pass":
      return "success";
    case "partial":
      return "warning";
    case "fail":
      return "danger";
    case "not_applicable":
      return "muted";
  }
}

/** Human label for a deterministic check verdict. */
export function verdictLabel(verdict: Verdict): string {
  switch (verdict) {
    case "pass":
      return "Pass";
    case "partial":
      return "Partial";
    case "fail":
      return "Fail";
    case "not_applicable":
      return "Not applicable";
  }
}

/** Category badge derived from the pass ratio (>=80% good, >=50% needs work). */
export function ratioBadge(
  passed: number,
  total: number,
): { label: string; variant: ToneVariant } {
  const ratio = total > 0 ? passed / total : 0;
  if (ratio >= 0.8) return { label: "Good", variant: "success" };
  if (ratio >= 0.5) return { label: "Needs work", variant: "warning" };
  return { label: "Poor", variant: "danger" };
}

/** Render an untrusted JSON value as a short, readable string. */
export function displayValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  try {
    const serialized: string | undefined = JSON.stringify(value);
    return serialized ?? String(value);
  } catch {
    return String(value);
  }
}

export function stackLabel(stack: Stack): string {
  return STACKS.find((entry) => entry.key === stack)?.label ?? stack;
}

/** Copy text to the clipboard, returning whether it succeeded. */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
