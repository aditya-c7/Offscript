import type { BadgeVariant } from "@/components/ui/badge";

export function scoreTone(value: number | null): "good" | "warn" | "bad" {
  if (value === null) return "bad";
  if (value >= 75) return "good";
  if (value >= 50) return "warn";
  return "bad";
}

export function verdictDisplay(value: string | null): {
  label: string;
  variant: BadgeVariant;
} {
  if (value === null || value.trim() === "") {
    return { label: "Not analysed yet", variant: "muted" };
  }

  const normalized = value.toLowerCase().replace(/_/g, " ");

  if (normalized === "agents can use" || normalized === "pass") {
    return { label: "Agents can use", variant: "success" };
  }
  if (normalized === "agents struggle" || normalized === "partial") {
    return { label: "Agents struggle", variant: "warning" };
  }
  if (normalized === "agents cannot" || normalized === "fail") {
    return { label: "Agents cannot", variant: "danger" };
  }
  if (normalized === "no clear result") {
    return { label: "No clear result", variant: "muted" };
  }

  return {
    label: value.replace(/_/g, " "),
    variant: "muted",
  };
}
