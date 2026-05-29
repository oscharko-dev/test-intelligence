"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Database,
  History,
  Play,
  Settings,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { ui } from "@/lib/ui-classes";

interface NavItem {
  href: "/runs" | "/snapshots" | "/settings/model" | "/runs/history";
  icon: LucideIcon;
  label: string;
}

const ITEMS: readonly NavItem[] = [
  { href: "/runs", icon: Play, label: "Runs" },
  { href: "/snapshots", icon: Database, label: "Snapshot Vault" },
  { href: "/settings/model", icon: Settings, label: "Model Settings" },
  { href: "/runs/history", icon: History, label: "Run History" },
];

function isActive(pathname: string, href: NavItem["href"]): boolean {
  if (href === "/runs") return pathname === "/runs" || pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ActivityBar(): ReactNode {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className={ui.activity.root}>
      {ITEMS.map((it) => {
        const Icon = it.icon;
        const active = isActive(pathname, it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            className={ui.activity.item}
            data-tip={it.label}
            aria-current={active ? "page" : undefined}
            aria-label={it.label}
          >
            <Icon size={18} strokeWidth={1.8} aria-hidden focusable={false} />
          </Link>
        );
      })}
      <span className={ui.activity.spacer} />
    </nav>
  );
}
