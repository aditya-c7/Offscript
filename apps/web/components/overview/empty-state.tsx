"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ScanSearch } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { errorMessageFrom, scanIdFrom } from "./scan-response";

export function EmptyState() {
  const router = useRouter();
  const [url, setUrl] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const trimmed = url.trim();
    if (trimmed === "") {
      setError("Enter a web address to scan.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });

      const raw: unknown = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(
          errorMessageFrom(raw) ??
            "We could not scan that address. Please check it and try again.",
        );
        return;
      }

      const id = scanIdFrom(raw);
      if (id === null) {
        setError("Unexpected response from the server.");
        return;
      }

      router.push("/scans/" + id);
    } catch {
      setError("We could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center py-10 text-center">
      <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 text-accent">
        <ScanSearch className="h-6 w-6" aria-hidden="true" />
      </div>
      <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
        Let&apos;s scan your first website.
      </h1>
      <p className="mt-3 max-w-md text-balance text-sm text-foreground/60 sm:text-base">
        Paste a web address below. The scan takes one to two minutes.
      </p>

      <Card className="mt-8 w-full p-5 text-left shadow-md">
        <form onSubmit={submit} noValidate>
          <label htmlFor="site-url" className="mb-2 block text-sm font-medium">
            Website address
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="site-url"
              name="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="your-store.com"
              autoComplete="url"
              inputMode="url"
              aria-invalid={error !== null}
              aria-describedby={error !== null ? "scan-error" : undefined}
            />
            <Button
              type="submit"
              size="md"
              disabled={submitting}
              className="shrink-0"
            >
              Scan your site -&gt;
            </Button>
          </div>
          {error !== null ? (
            <p
              id="scan-error"
              role="alert"
              className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700"
            >
              {error}
            </p>
          ) : null}
        </form>
      </Card>
    </div>
  );
}
