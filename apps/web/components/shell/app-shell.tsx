"use client";

import * as React from "react";
import { Menu } from "lucide-react";

import { QuotaBadge } from "./quota-badge";
import { Sidebar } from "./sidebar";
import { SiteProvider } from "./site-provider";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <SiteProvider>
      <div className="flex min-h-screen">
        <Sidebar
          mobileOpen={mobileOpen}
          onCloseMobile={() => setMobileOpen(false)}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur md:px-8">
            <button
              type="button"
              aria-label="Open menu"
              onClick={() => setMobileOpen(true)}
              className="-ml-1 rounded-md p-1.5 text-foreground/70 hover:bg-muted md:hidden"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
            <span className="text-sm font-semibold tracking-tight md:hidden">
              Offscript
            </span>
            <div className="ml-auto">
              <QuotaBadge />
            </div>
          </header>
          <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
        </div>
      </div>
    </SiteProvider>
  );
}
