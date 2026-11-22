import * as React from "react";
import { cn } from "@/lib/utils";

type CardProps = React.HTMLAttributes<HTMLDivElement>;

export function Card({ className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card text-foreground shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: CardProps) {
  return (
    <div className={cn("flex flex-col gap-1 p-5", className)} {...props} />
  );
}

export function CardTitle({ className, ...props }: CardProps) {
  return (
    <h3
      className={cn(
        "text-base font-semibold leading-tight tracking-tight",
        className,
      )}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: CardProps) {
  return (
    <p className={cn("text-sm text-foreground/55", className)} {...props} />
  );
}

export function CardContent({ className, ...props }: CardProps) {
  return <div className={cn("p-5 pt-0", className)} {...props} />;
}

export function CardFooter({ className, ...props }: CardProps) {
  return (
    <div
      className={cn("flex items-center gap-2 p-5 pt-0", className)}
      {...props}
    />
  );
}
