import * as React from "react";
import { cn } from "@/lib/utils";

export type BadgeVariant =
  | "default"
  | "outline"
  | "secondary"
  | "destructive"
  | "success"
  | "warning"
  | "danger"
  | "muted";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variants: Record<BadgeVariant, string> = {
  default: "bg-accent/10 text-accent ring-accent/20",
  outline: "bg-transparent text-foreground/70 ring-foreground/20",
  secondary: "bg-muted text-foreground/70 ring-foreground/10",
  destructive: "bg-rose-50 text-rose-700 ring-rose-600/20",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  warning: "bg-amber-50 text-amber-700 ring-amber-600/20",
  danger: "bg-rose-50 text-rose-700 ring-rose-600/20",
  muted: "bg-muted text-foreground/60 ring-foreground/10",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
