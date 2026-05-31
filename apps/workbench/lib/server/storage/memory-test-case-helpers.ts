/**
 * Helper builders used by the in-memory test-case repository (Issue #58).
 * Extracted to keep `memory-adapter.ts` below the project 400-LOC ceiling.
 */

import { randomUUID } from "node:crypto";

import { assertCanonicalContentRef } from "./contract-validation";
import { WorkbenchStorageError } from "./storage-adapter";
import {
  canTransitionTestCaseStatus,
  validateTestCaseDraft,
} from "@/lib/server/test-case-validation";
import type {
  AppendTestCaseVersionInput,
  AuditEventRepository,
  PersistedTestCaseDetail,
  TestCaseRecord,
  TestCaseTraceLinkRecord,
  TestCaseVersionRecord,
  TransitionTestCaseStatusInput,
} from "./types";

export const MAX_CHANGE_REASON_LENGTH = 500;

export const truncateChangeReason = (
  reason: string | undefined,
): string | undefined =>
  reason === undefined ? undefined : reason.slice(0, MAX_CHANGE_REASON_LENGTH);

interface VersionBuildArgs {
  readonly testCaseId: string;
  readonly tenantScope: string;
  readonly versionIndex: number;
  readonly source: TestCaseVersionRecord["source"];
  readonly previousVersionId?: string;
  readonly changeReason?: string;
  readonly version: AppendTestCaseVersionInput["version"];
  readonly timestamp: string;
}

export interface BuiltVersion {
  readonly version: TestCaseVersionRecord;
  readonly traceLinks: readonly TestCaseTraceLinkRecord[];
}

export const buildVersionRecord = (args: VersionBuildArgs): BuiltVersion => {
  const versionId = randomUUID();
  const traceLinks: TestCaseTraceLinkRecord[] = args.version.traceTargets.map(
    (target) => ({
      id: randomUUID(),
      testCaseVersionId: versionId,
      tenantScope: args.tenantScope,
      createdAt: args.timestamp,
      targetKind: target.targetKind,
      targetId: target.targetId,
    }),
  );
  const truncated = truncateChangeReason(args.changeReason);
  const version: TestCaseVersionRecord = {
    id: versionId,
    testCaseId: args.testCaseId,
    tenantScope: args.tenantScope,
    createdAt: args.timestamp,
    versionIndex: args.versionIndex,
    source: args.source,
    title: args.version.title,
    objective: args.version.objective,
    preconditions: [...args.version.preconditions],
    steps: args.version.steps.map((step) => ({ ...step })),
    testData: [...args.version.testData],
    priority: args.version.priority,
    risk: args.version.risk,
    tags: [...args.version.tags],
    status: args.version.status,
    ...(args.version.description !== undefined
      ? { description: args.version.description }
      : {}),
    content: { ...args.version.content },
    traceLinks,
    ...(args.previousVersionId !== undefined
      ? { previousVersionId: args.previousVersionId }
      : {}),
    ...(truncated !== undefined ? { changeReason: truncated } : {}),
  };
  return { version, traceLinks };
};

export interface MemoryStateSlice {
  readonly testCases: Map<string, TestCaseRecord>;
  readonly testCaseVersions: Map<string, TestCaseVersionRecord>;
  readonly testCaseTraceLinks: Map<string, TestCaseTraceLinkRecord>;
}

const snapshotOf = <T>(record: T): T => structuredClone(record);

export const loadTestCaseDetail = (
  state: MemoryStateSlice,
  testCase: TestCaseRecord,
): PersistedTestCaseDetail => {
  const version = state.testCaseVersions.get(testCase.currentVersionId);
  if (version === undefined) {
    throw new WorkbenchStorageError(
      "REFERENTIAL_INTEGRITY",
      "test case current version row missing after write.",
    );
  }
  const links = [...state.testCaseTraceLinks.values()].filter(
    (l) =>
      l.testCaseVersionId === version.id &&
      l.tenantScope === testCase.tenantScope,
  );
  return {
    testCase: snapshotOf(testCase),
    currentVersion: snapshotOf({
      ...version,
      traceLinks: links.map(snapshotOf),
    }),
  };
};

const nowIso = (): string => new Date().toISOString();

export const appendVersionInMemory = (
  state: MemoryStateSlice,
  audit: AuditEventRepository,
  input: AppendTestCaseVersionInput,
): PersistedTestCaseDetail => {
  const existing = state.testCases.get(input.testCaseId);
  if (existing === undefined || existing.tenantScope !== input.tenantScope) {
    throw new WorkbenchStorageError(
      "REFERENTIAL_INTEGRITY",
      "test case not found.",
    );
  }
  const errors = validateTestCaseDraft({
    title: input.version.title,
    steps: input.version.steps,
    traceTargets: input.version.traceTargets,
  });
  if (errors.length > 0) {
    throw new WorkbenchStorageError(
      "VALIDATION_FAILED",
      "test case draft failed validation.",
      { details: errors },
    );
  }
  assertCanonicalContentRef(input.version.content, "test case version content");
  const currentVersion = state.testCaseVersions.get(existing.currentVersionId);
  if (currentVersion === undefined) {
    throw new WorkbenchStorageError(
      "REFERENTIAL_INTEGRITY",
      "test case current version row missing.",
    );
  }
  const timestamp = nowIso();
  const built = buildVersionRecord({
    testCaseId: existing.id,
    tenantScope: existing.tenantScope,
    versionIndex: currentVersion.versionIndex + 1,
    source: "manual",
    previousVersionId: currentVersion.id,
    ...(input.changeReason !== undefined
      ? { changeReason: input.changeReason }
      : {}),
    version: input.version,
    timestamp,
  });
  state.testCaseVersions.set(built.version.id, snapshotOf(built.version));
  for (const link of built.traceLinks) {
    state.testCaseTraceLinks.set(link.id, snapshotOf(link));
  }
  const updated: TestCaseRecord = {
    ...existing,
    currentVersionId: built.version.id,
    updatedAt: timestamp,
  };
  state.testCases.set(updated.id, snapshotOf(updated));
  audit.record({
    tenantScope: updated.tenantScope,
    payload: {
      kind: "test-case.version.created",
      testCaseId: updated.id,
      versionIndex: built.version.versionIndex,
      ...(built.version.changeReason !== undefined
        ? { changeReason: built.version.changeReason }
        : {}),
    },
  });
  return loadTestCaseDetail(state, updated);
};

export const transitionStatusInMemory = (
  state: MemoryStateSlice,
  audit: AuditEventRepository,
  input: TransitionTestCaseStatusInput,
): PersistedTestCaseDetail => {
  const existing = state.testCases.get(input.testCaseId);
  if (existing === undefined || existing.tenantScope !== input.tenantScope) {
    throw new WorkbenchStorageError(
      "REFERENTIAL_INTEGRITY",
      "test case not found.",
    );
  }
  if (!canTransitionTestCaseStatus(existing.status, input.newStatus)) {
    throw new WorkbenchStorageError(
      "INVALID_STATUS_TRANSITION",
      `Transition ${existing.status} -> ${input.newStatus} is not allowed.`,
      {
        details: {
          currentStatus: existing.status,
          newStatus: input.newStatus,
        },
      },
    );
  }
  const truncated = truncateChangeReason(input.changeReason);
  const updated: TestCaseRecord = {
    ...existing,
    status: input.newStatus,
    updatedAt: nowIso(),
  };
  state.testCases.set(updated.id, snapshotOf(updated));
  audit.record({
    tenantScope: updated.tenantScope,
    payload: {
      kind: "test-case.status.transitioned",
      testCaseId: updated.id,
      previousStatus: existing.status,
      newStatus: input.newStatus,
      ...(truncated !== undefined ? { changeReason: truncated } : {}),
    },
  });
  return loadTestCaseDetail(state, updated);
};

export const listVersionsInMemory = (
  state: MemoryStateSlice,
  testCaseId: string,
  tenantScope: string,
): readonly TestCaseVersionRecord[] =>
  [...state.testCaseVersions.values()]
    .filter(
      (version) =>
        version.testCaseId === testCaseId &&
        version.tenantScope === tenantScope,
    )
    .sort((a, b) => b.versionIndex - a.versionIndex)
    .map((version) => {
      const links = [...state.testCaseTraceLinks.values()].filter(
        (l) =>
          l.testCaseVersionId === version.id && l.tenantScope === tenantScope,
      );
      return snapshotOf({ ...version, traceLinks: links.map(snapshotOf) });
    });
