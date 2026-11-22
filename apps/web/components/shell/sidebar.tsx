"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  Globe2,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  ScanLine,
  X,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useSites } from "./site-provider";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  match: (pathname: string) => boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Overview",
    icon: LayoutDashboard,
    match: (pathname) => pathname === "/",
  },
  {
    href: "/agent-analysis",
    label: "Agent analysis",
    icon: Bot,
    match: (pathname) => pathname.startsWith("/agent-analysis"),
  },
  {
    href: "/scans",
    label: "Scans",
    icon: ScanLine,
    match: (pathname) => pathname.startsWith("/scans"),
  },
];

interface SidebarContentProps {
  collapsed: boolean;
  onToggleCollapse?: () => void;
  onNavigate?: () => void;
  onClose?: () => void;
}

function SidebarContent({
  collapsed,
  onToggleCollapse,
  onNavigate,
  onClose,
}: SidebarContentProps) {
  const pathname = usePathname();
  const { sites, selectedSiteId, selectSite } = useSites();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 px-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white shadow-sm">
          O
        </div>
        {!collapsed ? (
          <span className="text-base font-semibold tracking-tight">
            Offscript
          </span>
        ) : null}
        {onClose ? (
          <button
            type="button"
            aria-label="Close menu"
            onClick={onClose}
            className="ml-auto rounded-md p-1.5 text-foreground/55 hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <nav aria-label="Main" className="px-2 py-2">
        {!collapsed ? (
          <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-foreground/40">
            Workspace
          </div>
        ) : null}
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const active = item.match(pathname);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  title={collapsed ? item.label : undefined}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors",
                    active
                      ? "bg-accent/10 font-medium text-accent"
                      : "text-foreground/70 hover:bg-muted hover:text-foreground",
                    collapsed && "justify-center px-0",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {!collapsed ? <span>{item.label}</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-3 px-2">
        {!collapsed ? (
          <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-foreground/40">
            Site switcher
          </div>
        ) : null}
        <ul className="space-y-1">
          <li>
            <button
              type="button"
              title={collapsed ? "All sites" : undefined}
              onClick={() => {
                selectSite(null);
                onNavigate?.();
              }}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                selectedSiteId === null
                  ? "bg-muted font-medium text-foreground"
                  : "text-foreground/70 hover:bg-muted hover:text-foreground",
                collapsed && "justify-center px-0",
              )}
            >
              <Globe2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              {!collapsed ? <span className="truncate">All sites</span> : null}
            </button>
          </li>
          {sites.map((site) => {
            const active = selectedSiteId === site.id;
            return (
              <li key={site.id}>
                <button
                  type="button"
                  title={collapsed ? site.host : undefined}
                  onClick={() => {
                    selectSite(site.id);
                    onNavigate?.();
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                    active
                      ? "bg-muted font-medium text-foreground"
                      : "text-foreground/70 hover:bg-muted hover:text-foreground",
                    collapsed && "justify-center px-0",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[8px] font-semibold",
                      active
                        ? "border-accent bg-accent text-white"
                        : "border-foreground/25 text-foreground/50",
                    )}
                    aria-hidden="true"
                  >
                    {site.host.charAt(0).toUpperCase()}
                  </span>
                  {!collapsed ? (
                    <span className="truncate">{site.host}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {onToggleCollapse ? (
        <div className="mt-auto p-2">
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-foreground/55 transition-colors hover:bg-muted hover:text-foreground",
              collapsed && "justify-center px-0",
            )}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            {!collapsed ? <span>Collapse</span> : null}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export interface SidebarProps {
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({ mobileOpen, onCloseMobile }: SidebarProps) {
  const [collapsed, setCollapsed] = React.useState(false);

  return (
    <>
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 border-r border-border bg-card transition-[width] duration-200 md:block",
          collapsed ? "w-16" : "w-64",
        )}
      >
        <SidebarContent
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((value) => !value)}
        />
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-foreground/30"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-border bg-card shadow-xl">
            <SidebarContent
              collapsed={false}
              onNavigate={onCloseMobile}
              onClose={onCloseMobile}
            />
          </aside>
        </div>
      ) : null}
    </>
  );
}
