"use client";

import { usePathname } from "next/navigation";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "@/components/primitives/IconButton";
import { useWorkbench } from "@/lib/workbench-context";
import { RunsInspector } from "@/components/runs/RunsInspector";
import { SettingsInspector } from "@/components/settings/SettingsInspector";
import { HistoryInspector } from "@/components/history/HistoryInspector";
import { cx, ui } from "@/lib/ui-classes";

function titleForPath(pathname: string): string {
  if (pathname.startsWith("/runs/history")) return "History";
  if (pathname.startsWith("/settings/model")) return "Settings";
  if (pathname.startsWith("/runs") || pathname === "/") return "Run preview";
  return "Inspector";
}

function contentForPath(pathname: string): ReactNode {
  if (pathname.startsWith("/runs/history")) return <HistoryInspector />;
  if (pathname.startsWith("/settings/model")) return <SettingsInspector />;
  if (pathname.startsWith("/runs") || pathname === "/") return <RunsInspector />;
  return (
    <div className={ui.inspectorGroup.empty}>
      No inspector panels available for this view.
    </div>
  );
}

export function InspectorPane(): ReactNode {
  const pathname = usePathname();
  const { inspectorCollapsed, toggleInspector } = useWorkbench();
  const title = titleForPath(pathname);

  return (
    <>
      <aside
        aria-label="Inspector"
        className={cx(ui.inspector.root, inspectorCollapsed && ui.inspector.collapsed)}
      >
        {!inspectorCollapsed && (
          <>
            <header className={ui.inspector.head}>
              <span className={ui.inspector.title}>{title}</span>
              <span className={ui.inspector.spacer} />
              <IconButton
                icon={PanelRightClose}
                label="Hide inspector (Cmd/Ctrl+I)"
                iconSize={14}
                onClick={toggleInspector}
              />
            </header>
            <div className={ui.inspector.body}>{contentForPath(pathname)}</div>
          </>
        )}
      </aside>
      {inspectorCollapsed && (
        <IconButton
          icon={PanelRightOpen}
          label="Show inspector (Cmd/Ctrl+I)"
          iconSize={14}
          variant="ghost-border"
          onClick={toggleInspector}
          className={ui.inspector.floating}
        />
      )}
    </>
  );
}
