"use client";

import type { ReactNode } from "react";
import { ActivityBar } from "./ActivityBar";
import { InspectorPane } from "./InspectorPane";
import { StatusBar } from "./StatusBar";
import { TopBar } from "./TopBar";
import { ui } from "@/lib/ui-classes";

export function AppShell({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className={ui.app}>
      <TopBar />
      <div className={ui.body}>
        <ActivityBar />
        <main className={ui.primary} tabIndex={-1}>
          {children}
        </main>
        <InspectorPane />
      </div>
      <StatusBar />
    </div>
  );
}
