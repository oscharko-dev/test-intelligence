/**
 * SQLite row interfaces and pure row → DTO mappers shared between the legacy
 * test-case repository and the Issue #58 versioning helpers.
 */

import type {
  ContentRef,
  TestCaseLifecycleStatus,
  TestCaseRecord,
  TestCaseSource,
  TestCaseStepRecord,
  TestCaseTraceLinkKind,
  TestCaseTraceLinkRecord,
  TestCaseVersionRecord,
} from "./types";

export interface TestCaseRow {
  readonly id: string;
  readonly tenant_scope: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly source_run_id: string;
  readonly source_generated_seed_id: string;
  readonly source_test_case_id: string;
  readonly current_version_id: string;
  readonly status: string;
}

export interface TestCaseVersionRow {
  readonly id: string;
  readonly test_case_id: string;
  readonly tenant_scope: string;
  readonly created_at: string;
  readonly version_index: number;
  readonly source: string;
  readonly title: string;
  readonly objective: string;
  readonly preconditions: string;
  readonly steps: string;
  readonly test_data: string;
  readonly priority: string;
  readonly risk: string;
  readonly tags: string;
  readonly status: string;
  readonly description: string | null;
  readonly content_sha256: string;
  readonly content_byte_size: number;
  readonly content_storage_ref: string;
  readonly previous_version_id: string | null;
  readonly change_reason: string | null;
}

export interface TestCaseTraceLinkRow {
  readonly id: string;
  readonly test_case_version_id: string;
  readonly tenant_scope: string;
  readonly created_at: string;
  readonly target_kind: string;
  readonly target_id: string;
}

const asStringArray = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];

export const parseJsonArray = (json: string): readonly string[] =>
  asStringArray(JSON.parse(json) as unknown);

const asStepArray = (value: unknown): TestCaseStepRecord[] => {
  if (!Array.isArray(value)) return [];
  const steps: TestCaseStepRecord[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (
      typeof record.action !== "string" ||
      typeof record.expected !== "string"
    ) {
      continue;
    }
    steps.push({ action: record.action, expected: record.expected });
  }
  return steps;
};

export const parseJsonSteps = (json: string): readonly TestCaseStepRecord[] =>
  asStepArray(JSON.parse(json) as unknown);

export const mapTestCase = (row: TestCaseRow): TestCaseRecord => ({
  id: row.id,
  tenantScope: row.tenant_scope,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  sourceRunId: row.source_run_id,
  sourceGeneratedSeedId: row.source_generated_seed_id,
  sourceTestCaseId: row.source_test_case_id,
  currentVersionId: row.current_version_id,
  status: row.status as TestCaseLifecycleStatus,
});

export const mapTestCaseTraceLink = (
  row: TestCaseTraceLinkRow,
): TestCaseTraceLinkRecord => ({
  id: row.id,
  testCaseVersionId: row.test_case_version_id,
  tenantScope: row.tenant_scope,
  createdAt: row.created_at,
  targetKind: row.target_kind as TestCaseTraceLinkKind,
  targetId: row.target_id,
});

export const mapTestCaseVersion = (
  row: TestCaseVersionRow,
  traceLinks: readonly TestCaseTraceLinkRecord[],
): TestCaseVersionRecord => ({
  id: row.id,
  testCaseId: row.test_case_id,
  tenantScope: row.tenant_scope,
  createdAt: row.created_at,
  versionIndex: row.version_index,
  source: row.source as TestCaseSource,
  title: row.title,
  objective: row.objective,
  preconditions: parseJsonArray(row.preconditions),
  steps: parseJsonSteps(row.steps),
  testData: parseJsonArray(row.test_data),
  priority: row.priority,
  risk: row.risk,
  tags: parseJsonArray(row.tags),
  status: row.status,
  ...(row.description !== null ? { description: row.description } : {}),
  content: {
    sha256: row.content_sha256,
    byteSize: row.content_byte_size,
    storageRef: row.content_storage_ref,
  } satisfies ContentRef,
  traceLinks,
  ...(row.previous_version_id !== null
    ? { previousVersionId: row.previous_version_id }
    : {}),
  ...(row.change_reason !== null ? { changeReason: row.change_reason } : {}),
});
