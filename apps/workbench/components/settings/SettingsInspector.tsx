"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { Tabs } from "@/components/primitives/Tabs";
import {
  SETTINGS_BASELINE,
  diffSettings,
  formatDiffValue,
  prettyEnv,
  validateSettings,
} from "@/lib/settings-state";
import { cx, ui } from "@/lib/ui-classes";
import { useWorkbench } from "@/lib/workbench-context";

type TabId = "diff" | "validation";

export function SettingsInspector(): ReactNode {
  const { settings } = useWorkbench();
  const [tab, setTab] = useState<TabId>("diff");

  const diff = useMemo(
    () => diffSettings(settings, SETTINGS_BASELINE),
    [settings],
  );
  const issues = useMemo(() => validateSettings(settings), [settings]);

  return (
    <>
      <Tabs<TabId>
        idBase="set-insp"
        tabs={[
          {
            id: "diff",
            label: "Diff",
            ...(diff.length > 0 ? { count: diff.length } : {}),
          },
          {
            id: "validation",
            label: "Validation",
            ...(issues.length > 0 ? { count: issues.length } : {}),
          },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div className="py-3">
        {tab === "diff" && (
          <>
            {diff.length === 0 ? (
              <div className={ui.inspectorGroup.empty}>
                No changes against the baseline environment.
              </div>
            ) : (
              <div className={ui.diff.list}>
                {diff.map((d) => (
                  <div key={d.key} className={ui.diff.row}>
                    <div className={ui.diff.name}>{prettyEnv(d.key)}</div>
                    <div className={ui.diff.from}>
                      −&nbsp;
                      <b className={ui.diff.fromValue}>
                        {formatDiffValue(d.key, d.from)}
                      </b>
                    </div>
                    <div className={ui.diff.to}>
                      +&nbsp;
                      <b className={ui.diff.toValue}>
                        {formatDiffValue(d.key, d.to)}
                      </b>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {tab === "validation" && (
          <>
            {issues.length === 0 ? (
              <ul className={ui.validation.list}>
                <li className={cx(ui.validation.item, ui.validation.okItem)}>
                  <span className={ui.validation.success}>
                    <Check size={14} aria-hidden focusable={false} />{" "}
                    Configuration is complete and well-formed.
                  </span>
                </li>
              </ul>
            ) : (
              <ol className={ui.validation.list}>
                {issues.map((i, idx) => (
                  <li key={`${i.field}-${idx}`} className={ui.validation.item}>
                    <div>
                      <div className={ui.validation.label}>{i.label}</div>
                      <div className={ui.validation.message}>{i.message}</div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </div>
    </>
  );
}
