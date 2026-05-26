import type { ReactNode } from "react";
import { MetadataRow } from "@/components/primitives/MetadataRow";
import { HISTORY_SEED } from "@/lib/history-seed";
import { ui } from "@/lib/ui-classes";

function countBy(status: string): number {
  return HISTORY_SEED.filter((r) => r.status === status).length;
}

export function HistoryInspector(): ReactNode {
  return (
    <>
      <div className={ui.inspectorGroup.group}>
        <span className={ui.inspectorGroup.title}>Filter</span>
        <div className={ui.inspectorGroup.empty}>
          Filter controls (status, contract, region) land alongside the detail
          view.
        </div>
      </div>
      <div className={ui.inspectorGroup.group}>
        <span className={ui.inspectorGroup.title}>Counts</span>
        <MetadataRow label="total" value={HISTORY_SEED.length} />
        <MetadataRow label="clean" value={countBy("clean")} />
        <MetadataRow label="blocked" value={countBy("blocked")} />
        <MetadataRow
          label="blocked·failure"
          value={countBy("blocked_failure")}
        />
        <MetadataRow label="failed" value={countBy("failed")} />
        <MetadataRow label="degraded" value={countBy("degraded")} />
      </div>
    </>
  );
}
