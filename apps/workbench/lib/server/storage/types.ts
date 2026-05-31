/**
 * Persistence DTOs and repository interfaces for the Workbench storage boundary.
 *
 * This module defines the contract that future Workbench persistence features
 * depend on (Epic #48). It is intentionally self-contained: it imports only
 * standard-library types and never references UI or domain modules. Where a
 * record mirrors an existing domain type, the alignment is documented in a WHY
 * comment so the persistence schema can evolve independently of the UI layer.
 */

export type IsoTimestamp = string;

export type Sha256Hex = string;

/**
 * Reference to a binary stored in the content-addressed artifact store rather
 * than inline in SQLite. Large node graphs, generated-seed JSON, and export
 * binaries are persisted as files and referenced by their content hash.
 * `storageRef` must be the canonical sharded path derived from `sha256`.
 */
export interface ContentRef {
  readonly sha256: Sha256Hex;
  readonly byteSize: number;
  readonly storageRef: string;
}

/**
 * WHY: a faithful copy of the `RunStatus` union in `lib/types.ts`. It is
 * redeclared locally instead of imported solely to keep the storage boundary
 * free of UI imports; `lib/types.ts` remains the source of truth, and this copy
 * is kept in sync with it member-for-member.
 */
export type WorkbenchRunStatus =
  | "idle"
  | "queued"
  | "running"
  | "judging"
  | "policy-gate"
  | "sealed"
  | "clean"
  | "blocked"
  | "blocked_failure"
  | "failed"
  | "degraded";

export type ArtifactKind =
  | "markdown"
  | "pdf"
  | "zip"
  | "json"
  | "image"
  | "other";

export type ExportFormat = "markdown" | "pdf" | "zip" | "json";

/**
 * WHY: aligns with `WorkbenchSnapshotCatalogRow` in `lib/snapshot-vault.ts`. The
 * large node graph is offloaded to the artifact store via `payload`; only the
 * catalog metadata is kept in SQLite.
 */
export interface SnapshotMetadataRecord {
  readonly id: string;
  readonly tenantScope: string;
  readonly createdAt: IsoTimestamp;
  readonly label?: string;
  readonly source: string;
  readonly nodeCount: number;
  readonly pageCount: number;
  readonly frameCount: number;
  readonly lifecycleState: string;
  readonly payload?: ContentRef;
}

/**
 * WHY: `status` aligns with `WorkbenchRunStatus` (see above). Large customer
 * outputs remain on disk and are referenced by `artifactDir`; only run metadata
 * is stored in SQLite.
 */
export interface RunMetadataRecord {
  readonly id: string;
  readonly tenantScope: string;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly status: WorkbenchRunStatus;
  readonly snapshotId?: string;
  readonly label?: string;
  readonly artifactDir?: string;
}

/**
 * Append-only record for a produced artifact. The binary lives in the
 * content-addressed store; `content` references it. WHY: `content.sha256` aligns
 * with the contracts package `ExportArtifactRecord.sha256` naming.
 */
export interface ArtifactMetadataRecord {
  readonly id: string;
  readonly runId: string;
  readonly tenantScope: string;
  readonly createdAt: IsoTimestamp;
  readonly name: string;
  readonly kind: ArtifactKind;
  readonly content: ContentRef;
  readonly customerFacing: boolean;
}

export interface ScopeSelection {
  readonly nodeIds: readonly string[];
  readonly pageIds: readonly string[];
  readonly frameIds: readonly string[];
}

/**
 * Scope basket is small and fully resident in SQLite (no artifact offload).
 */
export interface ScopeBasketRecord {
  readonly id: string;
  readonly tenantScope: string;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly label: string;
  readonly snapshotId?: string;
  readonly selection: ScopeSelection;
  readonly itemCount: number;
}

/**
 * WHY: the generated `GeneratedTestCaseList` JSON (contracts package) is large
 * and lives in the artifact store via `content`; only metadata is in SQLite.
 */
export interface GeneratedSeedMetadataRecord {
  readonly id: string;
  readonly runId: string;
  readonly tenantScope: string;
  readonly createdAt: IsoTimestamp;
  readonly status: string;
  readonly count: number;
  readonly content: ContentRef;
}

/**
 * WHY: `format` aligns with the contracts package `ExportArtifactRecord.format`.
 * The export binary lives in the artifact store via `content`.
 */
export interface ExportMetadataRecord {
  readonly id: string;
  readonly runId: string;
  readonly tenantScope: string;
  readonly createdAt: IsoTimestamp;
  readonly format: ExportFormat;
  readonly status: string;
  readonly content: ContentRef;
}

export interface CreateSnapshotInput {
  readonly tenantScope: string;
  readonly label?: string;
  readonly source: string;
  readonly nodeCount: number;
  readonly pageCount: number;
  readonly frameCount: number;
  readonly lifecycleState: string;
  readonly payload?: ContentRef;
}

export interface CreateRunInput {
  readonly tenantScope: string;
  readonly status: WorkbenchRunStatus;
  readonly snapshotId?: string;
  readonly label?: string;
  readonly artifactDir?: string;
}

export interface CreateArtifactInput {
  readonly runId: string;
  readonly tenantScope: string;
  readonly name: string;
  readonly kind: ArtifactKind;
  readonly content: ContentRef;
  readonly customerFacing: boolean;
}

export interface CreateScopeBasketInput {
  readonly tenantScope: string;
  readonly label: string;
  readonly snapshotId?: string;
  readonly selection: ScopeSelection;
  readonly itemCount: number;
}

export interface CreateGeneratedSeedInput {
  readonly runId: string;
  readonly tenantScope: string;
  readonly status: string;
  readonly count: number;
  readonly content: ContentRef;
}

export interface CreateExportInput {
  readonly runId: string;
  readonly tenantScope: string;
  readonly format: ExportFormat;
  readonly status: string;
  readonly content: ContentRef;
}

export interface TenantScopeFilter {
  readonly tenantScope?: string;
}

export interface RunIdFilter {
  readonly runId: string;
}

export interface RunTenantFilter extends RunIdFilter {
  readonly tenantScope: string;
}

export interface ScopeBasketFilter {
  readonly tenantScope?: string;
  readonly snapshotId?: string;
}

export interface ScopeBasketChanges {
  readonly label?: string;
  readonly selection?: ScopeSelection;
}

/**
 * Repositories return deep, immutable snapshots of stored state. `get` and
 * `update*` are tenant scoped and return `undefined` for an absent id or tenant
 * mismatch; `list` returns an empty array when nothing matches. Run-child
 * metadata creation validates that the referenced run exists in the same tenant
 * scope. Methods are synchronous because the concrete SQLite implementation
 * (better-sqlite3) and the in-memory double are both synchronous.
 */
export interface SnapshotRepository {
  create(input: CreateSnapshotInput): SnapshotMetadataRecord;
  get(id: string, tenantScope: string): SnapshotMetadataRecord | undefined;
  findBySource(
    tenantScope: string,
    source: string,
  ): SnapshotMetadataRecord | undefined;
  list(filter?: TenantScopeFilter): readonly SnapshotMetadataRecord[];
  updateLifecycleState(
    id: string,
    tenantScope: string,
    lifecycleState: string,
  ): SnapshotMetadataRecord | undefined;
}

export interface RunRepository {
  create(input: CreateRunInput): RunMetadataRecord;
  get(id: string, tenantScope: string): RunMetadataRecord | undefined;
  list(filter?: TenantScopeFilter): readonly RunMetadataRecord[];
  updateStatus(
    id: string,
    tenantScope: string,
    status: WorkbenchRunStatus,
  ): RunMetadataRecord | undefined;
}

export interface ArtifactRepository {
  create(input: CreateArtifactInput): ArtifactMetadataRecord;
  get(id: string, tenantScope: string): ArtifactMetadataRecord | undefined;
  list(filter: RunTenantFilter): readonly ArtifactMetadataRecord[];
}

export interface ScopeBasketRepository {
  create(input: CreateScopeBasketInput): ScopeBasketRecord;
  get(id: string, tenantScope: string): ScopeBasketRecord | undefined;
  list(filter?: ScopeBasketFilter): readonly ScopeBasketRecord[];
  update(
    id: string,
    tenantScope: string,
    changes: ScopeBasketChanges,
  ): ScopeBasketRecord | undefined;
}

export interface GeneratedSeedRepository {
  create(input: CreateGeneratedSeedInput): GeneratedSeedMetadataRecord;
  get(id: string, tenantScope: string): GeneratedSeedMetadataRecord | undefined;
  list(filter: RunTenantFilter): readonly GeneratedSeedMetadataRecord[];
}

export interface ExportRepository {
  create(input: CreateExportInput): ExportMetadataRecord;
  get(id: string, tenantScope: string): ExportMetadataRecord | undefined;
  list(filter: RunTenantFilter): readonly ExportMetadataRecord[];
}

/**
 * WHY a discriminated union for the version source: `"generated"` is the
 * seal-time ingestion path (Issue #56) and `"manual"` is operator edits via the
 * editor (Issue #58). Reserving more slots stays forwards-compatible.
 */
export type TestCaseSource = "generated" | "manual";

export type TestCaseLifecycleStatus = "draft" | "reviewed" | "approved";

export type TestCaseTraceLinkKind =
  | "run"
  | "snapshot"
  | "figma-node"
  | "scope-basket";

/**
 * A single ordered step. WHY only `action` + `expected`: the persisted editor
 * model is the canonical view, not a verbatim mirror of the generator payload
 * (which also carries `data` and a lifecycle id). Those engine-only fields stay
 * inside the immutable content-addressed snapshot that backs each version.
 */
export interface TestCaseStepRecord {
  readonly action: string;
  readonly expected: string;
}

export interface TestCaseTraceLinkRecord {
  readonly id: string;
  readonly testCaseVersionId: string;
  readonly tenantScope: string;
  readonly createdAt: IsoTimestamp;
  readonly targetKind: TestCaseTraceLinkKind;
  readonly targetId: string;
}

/**
 * Canonical persisted version of a test case. WHY `content` is required: each
 * version is anchored to an immutable artifact snapshot of the originating
 * generator payload, satisfying AC#3 (run artifacts referenced, not overwritten).
 * `previousVersionId` chains each operator-saved version to its predecessor;
 * `changeReason` carries an optional operator note (≤500 chars after truncation).
 */
export interface TestCaseVersionRecord {
  readonly id: string;
  readonly testCaseId: string;
  readonly tenantScope: string;
  readonly createdAt: IsoTimestamp;
  readonly versionIndex: number;
  readonly source: TestCaseSource;
  readonly title: string;
  readonly objective: string;
  readonly preconditions: readonly string[];
  readonly steps: readonly TestCaseStepRecord[];
  readonly testData: readonly string[];
  readonly priority: string;
  readonly risk: string;
  readonly tags: readonly string[];
  readonly status: string;
  readonly description?: string;
  readonly content: ContentRef;
  readonly traceLinks: readonly TestCaseTraceLinkRecord[];
  readonly previousVersionId?: string;
  readonly changeReason?: string;
}

export interface TestCaseRecord {
  readonly id: string;
  readonly tenantScope: string;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly sourceRunId: string;
  readonly sourceGeneratedSeedId: string;
  readonly sourceTestCaseId: string;
  readonly currentVersionId: string;
  readonly status: TestCaseLifecycleStatus;
}

/**
 * Enriched list row for the test-case list endpoint. WHY a separate type from
 * {@link TestCaseRecord}: the UI must filter by run, snapshot, status, priority,
 * risk, and tags without an O(N) follow-up fetch per row (Issue #57 AC#3). The
 * summary widens the canonical record with the current version's metadata plus
 * trace-link aggregates derived from `currentVersionId`. The `tags`,
 * `snapshotIds`, and `traceLinkKinds` arrays carry distinct values only.
 */
export interface TestCaseSummary {
  readonly id: string;
  readonly tenantScope: string;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly sourceRunId: string;
  readonly sourceGeneratedSeedId: string;
  readonly sourceTestCaseId: string;
  readonly currentVersionId: string;
  readonly status: TestCaseLifecycleStatus;
  readonly title: string;
  readonly priority: string;
  readonly risk: string;
  readonly tags: readonly string[];
  readonly versionStatus: string;
  readonly snapshotIds: readonly string[];
  readonly traceLinkKinds: readonly TestCaseTraceLinkKind[];
}

export interface PersistedTestCaseDetail {
  readonly testCase: TestCaseRecord;
  readonly currentVersion: TestCaseVersionRecord;
}

export interface TestCaseTraceTargetInput {
  readonly targetKind: TestCaseTraceLinkKind;
  readonly targetId: string;
}

export interface CreatePersistedTestCaseInput {
  readonly tenantScope: string;
  readonly sourceRunId: string;
  readonly sourceGeneratedSeedId: string;
  readonly sourceTestCaseId: string;
  readonly status: TestCaseLifecycleStatus;
  readonly initialVersion: {
    readonly source: TestCaseSource;
    readonly title: string;
    readonly objective: string;
    readonly preconditions: readonly string[];
    readonly steps: readonly TestCaseStepRecord[];
    readonly testData: readonly string[];
    readonly priority: string;
    readonly risk: string;
    readonly tags: readonly string[];
    readonly status: string;
    readonly description?: string;
    readonly content: ContentRef;
    readonly traceTargets: readonly TestCaseTraceTargetInput[];
  };
}

export interface TestCaseFilter {
  readonly tenantScope?: string;
  readonly runId?: string;
}

export interface AppendTestCaseVersionInput {
  readonly testCaseId: string;
  readonly tenantScope: string;
  readonly changeReason?: string;
  readonly version: {
    readonly title: string;
    readonly objective: string;
    readonly preconditions: readonly string[];
    readonly steps: readonly TestCaseStepRecord[];
    readonly testData: readonly string[];
    readonly priority: string;
    readonly risk: string;
    readonly tags: readonly string[];
    readonly status: string;
    readonly description?: string;
    readonly content: ContentRef;
    readonly traceTargets: readonly TestCaseTraceTargetInput[];
  };
}

export interface TransitionTestCaseStatusInput {
  readonly testCaseId: string;
  readonly tenantScope: string;
  readonly newStatus: TestCaseLifecycleStatus;
  readonly changeReason?: string;
}

export type AuditEventKind =
  | "test-case.version.created"
  | "test-case.status.transitioned";

interface AuditEventVersionCreatedPayload {
  readonly kind: "test-case.version.created";
  readonly testCaseId: string;
  readonly versionIndex: number;
  readonly changeReason?: string;
}

interface AuditEventStatusTransitionedPayload {
  readonly kind: "test-case.status.transitioned";
  readonly testCaseId: string;
  readonly previousStatus: TestCaseLifecycleStatus;
  readonly newStatus: TestCaseLifecycleStatus;
  readonly changeReason?: string;
}

export type AuditEventPayload =
  | AuditEventVersionCreatedPayload
  | AuditEventStatusTransitionedPayload;

export interface AuditEventRecord {
  readonly id: string;
  readonly tenantScope: string;
  readonly createdAt: IsoTimestamp;
  readonly payload: AuditEventPayload;
}

export interface AuditEventRepository {
  record(input: {
    readonly tenantScope: string;
    readonly payload: AuditEventPayload;
  }): AuditEventRecord;
  listForTestCase(
    testCaseId: string,
    tenantScope: string,
  ): readonly AuditEventRecord[];
}

export interface TestCaseRepository {
  create(input: CreatePersistedTestCaseInput): PersistedTestCaseDetail;
  get(id: string, tenantScope: string): PersistedTestCaseDetail | undefined;
  list(filter?: TestCaseFilter): readonly TestCaseSummary[];
  findBySource(
    tenantScope: string,
    sourceRunId: string,
    sourceTestCaseId: string,
  ): TestCaseRecord | undefined;
  appendVersion(input: AppendTestCaseVersionInput): PersistedTestCaseDetail;
  transitionStatus(
    input: TransitionTestCaseStatusInput,
  ): PersistedTestCaseDetail;
  listVersions(
    testCaseId: string,
    tenantScope: string,
  ): readonly TestCaseVersionRecord[];
}
