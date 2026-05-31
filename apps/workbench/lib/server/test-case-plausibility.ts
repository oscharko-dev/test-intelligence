/**
 * Non-blocking plausibility checks for a saved test-case version (Issue #58).
 * Warnings flow back to the client so the operator can act, but save proceeds.
 */

import type {
  SnapshotRepository,
  TestCaseTraceLinkKind,
  TestCaseTraceTargetInput,
} from "@/lib/server/storage/types";

export interface PlausibilityWarning {
  readonly kind: "trace-target-missing";
  readonly targetKind: TestCaseTraceLinkKind;
  readonly targetId: string;
  readonly message: string;
}

export const checkTestCasePlausibility = (
  traceTargets: readonly TestCaseTraceTargetInput[],
  snapshotRepo: Pick<SnapshotRepository, "get">,
  tenantScope: string,
): readonly PlausibilityWarning[] => {
  const warnings: PlausibilityWarning[] = [];
  for (const target of traceTargets) {
    if (target.targetKind !== "snapshot") continue;
    const found = snapshotRepo.get(target.targetId, tenantScope);
    if (found !== undefined) continue;
    warnings.push({
      kind: "trace-target-missing",
      targetKind: "snapshot",
      targetId: target.targetId,
      message: `Snapshot ${target.targetId} is not in the catalog for this tenant.`,
    });
  }
  return warnings;
};
