/**
 * SQLite-backed implementation of editor versioning, lifecycle transitions, and
 * version listing (Issue #58). Kept separate from `sqlite-repositories.ts` to
 * keep both files under the project 400-LOC ceiling.
 */

import { randomUUID } from "node:crypto";

import type BetterSqlite3Database from "better-sqlite3";

import { assertCanonicalContentRef } from "./contract-validation";
import { MAX_CHANGE_REASON_LENGTH } from "./memory-test-case-helpers";
import {
  mapTestCase,
  mapTestCaseTraceLink,
  mapTestCaseVersion,
  type TestCaseRow,
  type TestCaseTraceLinkRow,
  type TestCaseVersionRow,
} from "./sqlite-test-case-mappers";
import { WorkbenchStorageError } from "./storage-adapter";
import {
  canTransitionTestCaseStatus,
  validateTestCaseDraft,
} from "@/lib/server/test-case-validation";
import type {
  AppendTestCaseVersionInput,
  AuditEventRepository,
  PersistedTestCaseDetail,
  TestCaseLifecycleStatus,
  TestCaseRecord,
  TestCaseSource,
  TestCaseVersionRecord,
  TransitionTestCaseStatusInput,
} from "./types";

type Db = BetterSqlite3Database.Database;
type Stmt = BetterSqlite3Database.Statement<unknown[], unknown>;
type BindRow = Record<string, string | number | null>;

const nowIso = (): string => new Date().toISOString();

const truncateChangeReason = (
  reason: string | undefined,
): string | undefined =>
  reason === undefined ? undefined : reason.slice(0, MAX_CHANGE_REASON_LENGTH);

export interface VersioningStmts {
  readonly insertVersion: Stmt;
  readonly insertTraceLink: Stmt;
  readonly selectCaseByIdAndTenant: Stmt;
  readonly selectVersionById: Stmt;
  readonly selectTraceLinksByVersion: Stmt;
  readonly updateCaseCurrentVersion: Stmt;
  readonly updateCaseStatus: Stmt;
  readonly selectVersionsForCase: Stmt;
}

export const buildVersioningStmts = (db: Db): VersioningStmts => ({
  insertVersion: db.prepare(
    `INSERT INTO test_case_versions (id, test_case_id, tenant_scope, created_at,
       version_index, source, title, objective, preconditions, steps, test_data,
       priority, risk, tags, status, description,
       content_sha256, content_byte_size, content_storage_ref,
       previous_version_id, change_reason)
     VALUES (@id, @testCaseId, @tenantScope, @createdAt,
       @versionIndex, @source, @title, @objective, @preconditions, @steps, @testData,
       @priority, @risk, @tags, @status, @description,
       @contentSha256, @contentByteSize, @contentStorageRef,
       @previousVersionId, @changeReason)`,
  ),
  insertTraceLink: db.prepare(
    `INSERT INTO test_case_trace_links (id, test_case_version_id, tenant_scope,
       created_at, target_kind, target_id)
     VALUES (@id, @testCaseVersionId, @tenantScope, @createdAt, @targetKind, @targetId)`,
  ),
  selectCaseByIdAndTenant: db.prepare(
    `SELECT * FROM test_cases WHERE id = ? AND tenant_scope = ?`,
  ),
  selectVersionById: db.prepare(
    `SELECT * FROM test_case_versions WHERE id = ?`,
  ),
  selectTraceLinksByVersion: db.prepare(
    `SELECT * FROM test_case_trace_links
       WHERE test_case_version_id = ? AND tenant_scope = ?
       ORDER BY rowid`,
  ),
  updateCaseCurrentVersion: db.prepare(
    `UPDATE test_cases SET current_version_id = ?, updated_at = ?
       WHERE id = ? AND tenant_scope = ?`,
  ),
  updateCaseStatus: db.prepare(
    `UPDATE test_cases SET status = ?, updated_at = ?
       WHERE id = ? AND tenant_scope = ?`,
  ),
  selectVersionsForCase: db.prepare(
    `SELECT * FROM test_case_versions
       WHERE test_case_id = ? AND tenant_scope = ?
       ORDER BY version_index DESC`,
  ),
});

const loadDetail = (
  handles: VersioningStmts,
  testCase: TestCaseRecord,
): PersistedTestCaseDetail => {
  const versionRow = handles.selectVersionById.get(
    testCase.currentVersionId,
  ) as TestCaseVersionRow | undefined;
  if (versionRow === undefined) {
    throw new WorkbenchStorageError(
      "REFERENTIAL_INTEGRITY",
      "test case current version row missing.",
    );
  }
  const linkRows = handles.selectTraceLinksByVersion.all(
    versionRow.id,
    testCase.tenantScope,
  ) as TestCaseTraceLinkRow[];
  return {
    testCase,
    currentVersion: mapTestCaseVersion(
      versionRow,
      linkRows.map(mapTestCaseTraceLink),
    ),
  };
};

interface InsertVersionArgs {
  readonly testCaseId: string;
  readonly tenantScope: string;
  readonly versionIndex: number;
  readonly source: TestCaseSource;
  readonly previousVersionId: string;
  readonly changeReason: string | undefined;
  readonly version: AppendTestCaseVersionInput["version"];
  readonly timestamp: string;
}

const insertVersionRows = (
  handles: VersioningStmts,
  args: InsertVersionArgs,
): string => {
  const versionId = randomUUID();
  const truncated = truncateChangeReason(args.changeReason);
  const params: BindRow = {
    id: versionId,
    testCaseId: args.testCaseId,
    tenantScope: args.tenantScope,
    createdAt: args.timestamp,
    versionIndex: args.versionIndex,
    source: args.source,
    title: args.version.title,
    objective: args.version.objective,
    preconditions: JSON.stringify(args.version.preconditions),
    steps: JSON.stringify(args.version.steps),
    testData: JSON.stringify(args.version.testData),
    priority: args.version.priority,
    risk: args.version.risk,
    tags: JSON.stringify(args.version.tags),
    status: args.version.status,
    description: args.version.description ?? null,
    contentSha256: args.version.content.sha256,
    contentByteSize: args.version.content.byteSize,
    contentStorageRef: args.version.content.storageRef,
    previousVersionId: args.previousVersionId,
    changeReason: truncated ?? null,
  };
  handles.insertVersion.run(params);
  for (const target of args.version.traceTargets) {
    handles.insertTraceLink.run({
      id: randomUUID(),
      testCaseVersionId: versionId,
      tenantScope: args.tenantScope,
      createdAt: args.timestamp,
      targetKind: target.targetKind,
      targetId: target.targetId,
    });
  }
  return versionId;
};

const requireCase = (
  handles: VersioningStmts,
  testCaseId: string,
  tenantScope: string,
): TestCaseRow => {
  const row = handles.selectCaseByIdAndTenant.get(testCaseId, tenantScope) as
    | TestCaseRow
    | undefined;
  if (row === undefined) {
    throw new WorkbenchStorageError(
      "REFERENTIAL_INTEGRITY",
      "test case not found.",
    );
  }
  return row;
};

export const appendVersionInSqlite = (
  handles: VersioningStmts,
  audit: AuditEventRepository,
  input: AppendTestCaseVersionInput,
): PersistedTestCaseDetail => {
  const row = requireCase(handles, input.testCaseId, input.tenantScope);
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
  const currentVersion = handles.selectVersionById.get(
    row.current_version_id,
  ) as TestCaseVersionRow | undefined;
  if (currentVersion === undefined) {
    throw new WorkbenchStorageError(
      "REFERENTIAL_INTEGRITY",
      "test case current version row missing.",
    );
  }
  const timestamp = nowIso();
  const versionId = insertVersionRows(handles, {
    testCaseId: row.id,
    tenantScope: row.tenant_scope,
    versionIndex: currentVersion.version_index + 1,
    source: "manual",
    previousVersionId: currentVersion.id,
    changeReason: input.changeReason,
    version: input.version,
    timestamp,
  });
  handles.updateCaseCurrentVersion.run(
    versionId,
    timestamp,
    row.id,
    row.tenant_scope,
  );
  const truncated = truncateChangeReason(input.changeReason);
  audit.record({
    tenantScope: row.tenant_scope,
    payload: {
      kind: "test-case.version.created",
      testCaseId: row.id,
      versionIndex: currentVersion.version_index + 1,
      ...(truncated !== undefined ? { changeReason: truncated } : {}),
    },
  });
  const updatedRow = handles.selectCaseByIdAndTenant.get(
    row.id,
    row.tenant_scope,
  ) as TestCaseRow;
  return loadDetail(handles, mapTestCase(updatedRow));
};

export const transitionStatusInSqlite = (
  handles: VersioningStmts,
  audit: AuditEventRepository,
  input: TransitionTestCaseStatusInput,
): PersistedTestCaseDetail => {
  const row = requireCase(handles, input.testCaseId, input.tenantScope);
  if (!canTransitionTestCaseStatus(row.status, input.newStatus)) {
    throw new WorkbenchStorageError(
      "INVALID_STATUS_TRANSITION",
      `Transition ${row.status} -> ${input.newStatus} is not allowed.`,
      {
        details: { currentStatus: row.status, newStatus: input.newStatus },
      },
    );
  }
  const truncated = truncateChangeReason(input.changeReason);
  handles.updateCaseStatus.run(
    input.newStatus,
    nowIso(),
    row.id,
    row.tenant_scope,
  );
  audit.record({
    tenantScope: row.tenant_scope,
    payload: {
      kind: "test-case.status.transitioned",
      testCaseId: row.id,
      previousStatus: row.status as TestCaseLifecycleStatus,
      newStatus: input.newStatus,
      ...(truncated !== undefined ? { changeReason: truncated } : {}),
    },
  });
  const updatedRow = handles.selectCaseByIdAndTenant.get(
    row.id,
    row.tenant_scope,
  ) as TestCaseRow;
  return loadDetail(handles, mapTestCase(updatedRow));
};

export const listVersionsInSqlite = (
  handles: VersioningStmts,
  testCaseId: string,
  tenantScope: string,
): readonly TestCaseVersionRecord[] => {
  const rows = handles.selectVersionsForCase.all(
    testCaseId,
    tenantScope,
  ) as TestCaseVersionRow[];
  return rows.map((row) => {
    const linkRows = handles.selectTraceLinksByVersion.all(
      row.id,
      tenantScope,
    ) as TestCaseTraceLinkRow[];
    return mapTestCaseVersion(row, linkRows.map(mapTestCaseTraceLink));
  });
};
