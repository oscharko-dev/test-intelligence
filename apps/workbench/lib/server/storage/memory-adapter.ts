/**
 * In-memory implementation of {@link WorkbenchStorageAdapter}.
 *
 * This is the test double permitted by Issue #51: it exercises the full
 * contract (repositories, transactions, migrations) without any SQLite or
 * filesystem dependency, so server code and tests can be written against the
 * boundary before the concrete store lands. Backed by `Map`s; identifiers come
 * from `randomUUID` and timestamps from `new Date().toISOString()` at the
 * create boundary. Every returned record is a deep copy (`structuredClone`) so
 * callers cannot mutate stored state.
 */

import { randomUUID } from "node:crypto";

import {
  assertCanonicalContentRef,
  assertSameTenantRun,
} from "./contract-validation";
import { assertSchemaVersionSupported } from "./migrations";
import type { WorkbenchMigration } from "./migrations";
import { WorkbenchStorageError } from "./storage-adapter";
import type { WorkbenchStorageAdapter } from "./storage-adapter";
import type {
  ArtifactMetadataRecord,
  ArtifactRepository,
  CreateArtifactInput,
  CreateExportInput,
  CreateGeneratedSeedInput,
  CreatePersistedTestCaseInput,
  CreateRunInput,
  CreateScopeBasketInput,
  CreateSnapshotInput,
  ExportMetadataRecord,
  ExportRepository,
  GeneratedSeedMetadataRecord,
  GeneratedSeedRepository,
  PersistedTestCaseDetail,
  RunMetadataRecord,
  RunRepository,
  RunTenantFilter,
  ScopeBasketChanges,
  ScopeBasketFilter,
  ScopeBasketRecord,
  ScopeBasketRepository,
  SnapshotMetadataRecord,
  SnapshotRepository,
  TenantScopeFilter,
  TestCaseFilter,
  TestCaseRecord,
  TestCaseRepository,
  TestCaseSummary,
  TestCaseTraceLinkKind,
  TestCaseTraceLinkRecord,
  TestCaseVersionRecord,
  WorkbenchRunStatus,
} from "./types";

interface MemoryState {
  snapshots: Map<string, SnapshotMetadataRecord>;
  runs: Map<string, RunMetadataRecord>;
  artifacts: Map<string, ArtifactMetadataRecord>;
  scopeBaskets: Map<string, ScopeBasketRecord>;
  generatedSeeds: Map<string, GeneratedSeedMetadataRecord>;
  exports: Map<string, ExportMetadataRecord>;
  testCases: Map<string, TestCaseRecord>;
  testCaseVersions: Map<string, TestCaseVersionRecord>;
  testCaseTraceLinks: Map<string, TestCaseTraceLinkRecord>;
}

const createEmptyState = (): MemoryState => ({
  snapshots: new Map(),
  runs: new Map(),
  artifacts: new Map(),
  scopeBaskets: new Map(),
  generatedSeeds: new Map(),
  exports: new Map(),
  testCases: new Map(),
  testCaseVersions: new Map(),
  testCaseTraceLinks: new Map(),
});

const snapshot = <T>(record: T): T => structuredClone(record);

const cloneMap = <T>(records: Map<string, T>): Map<string, T> =>
  new Map([...records].map(([id, record]) => [id, snapshot(record)]));

const cloneState = (state: MemoryState): MemoryState => ({
  snapshots: cloneMap(state.snapshots),
  runs: cloneMap(state.runs),
  artifacts: cloneMap(state.artifacts),
  scopeBaskets: cloneMap(state.scopeBaskets),
  generatedSeeds: cloneMap(state.generatedSeeds),
  exports: cloneMap(state.exports),
  testCases: cloneMap(state.testCases),
  testCaseVersions: cloneMap(state.testCaseVersions),
  testCaseTraceLinks: cloneMap(state.testCaseTraceLinks),
});

const restoreState = (target: MemoryState, source: MemoryState): void => {
  target.snapshots = source.snapshots;
  target.runs = source.runs;
  target.artifacts = source.artifacts;
  target.scopeBaskets = source.scopeBaskets;
  target.generatedSeeds = source.generatedSeeds;
  target.exports = source.exports;
  target.testCases = source.testCases;
  target.testCaseVersions = source.testCaseVersions;
  target.testCaseTraceLinks = source.testCaseTraceLinks;
};

const matchesTenant = (
  recordScope: string,
  filterScope: string | undefined,
): boolean => filterScope === undefined || recordScope === filterScope;

const nowIso = (): string => new Date().toISOString();

const isSameTenant = (
  record: { readonly tenantScope: string } | undefined,
  tenantScope: string,
): boolean => record !== undefined && record.tenantScope === tenantScope;

const createSnapshotRepository = (state: MemoryState): SnapshotRepository => ({
  create(input: CreateSnapshotInput): SnapshotMetadataRecord {
    if (input.payload !== undefined) {
      assertCanonicalContentRef(input.payload, "snapshot payload");
    }
    const record: SnapshotMetadataRecord = {
      ...input,
      id: randomUUID(),
      createdAt: nowIso(),
    };
    state.snapshots.set(record.id, snapshot(record));
    return snapshot(record);
  },
  get(id: string, tenantScope: string): SnapshotMetadataRecord | undefined {
    const record = state.snapshots.get(id);
    return isSameTenant(record, tenantScope) ? snapshot(record) : undefined;
  },
  findBySource(
    tenantScope: string,
    source: string,
  ): SnapshotMetadataRecord | undefined {
    const record = [...state.snapshots.values()].find(
      (candidate) =>
        candidate.tenantScope === tenantScope && candidate.source === source,
    );
    return record === undefined ? undefined : snapshot(record);
  },
  list(filter?: TenantScopeFilter): readonly SnapshotMetadataRecord[] {
    return [...state.snapshots.values()]
      .filter((record) =>
        matchesTenant(record.tenantScope, filter?.tenantScope),
      )
      .map(snapshot);
  },
  updateLifecycleState(
    id: string,
    tenantScope: string,
    lifecycleState: string,
  ): SnapshotMetadataRecord | undefined {
    const existing = state.snapshots.get(id);
    if (existing === undefined || existing.tenantScope !== tenantScope) {
      return undefined;
    }
    const updated: SnapshotMetadataRecord = { ...existing, lifecycleState };
    state.snapshots.set(id, updated);
    return snapshot(updated);
  },
});

const createRunRepository = (state: MemoryState): RunRepository => ({
  create(input: CreateRunInput): RunMetadataRecord {
    const timestamp = nowIso();
    const record: RunMetadataRecord = {
      ...input,
      id: randomUUID(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    state.runs.set(record.id, snapshot(record));
    return snapshot(record);
  },
  get(id: string, tenantScope: string): RunMetadataRecord | undefined {
    const record = state.runs.get(id);
    return isSameTenant(record, tenantScope) ? snapshot(record) : undefined;
  },
  list(filter?: TenantScopeFilter): readonly RunMetadataRecord[] {
    return [...state.runs.values()]
      .filter((record) =>
        matchesTenant(record.tenantScope, filter?.tenantScope),
      )
      .map(snapshot);
  },
  updateStatus(
    id: string,
    tenantScope: string,
    status: WorkbenchRunStatus,
  ): RunMetadataRecord | undefined {
    const existing = state.runs.get(id);
    if (existing === undefined || existing.tenantScope !== tenantScope) {
      return undefined;
    }
    const updated: RunMetadataRecord = {
      ...existing,
      status,
      updatedAt: nowIso(),
    };
    state.runs.set(id, updated);
    return snapshot(updated);
  },
});

const createArtifactRepository = (state: MemoryState): ArtifactRepository => ({
  create(input: CreateArtifactInput): ArtifactMetadataRecord {
    assertSameTenantRun(
      state.runs.get(input.runId),
      input.tenantScope,
      "artifact runId",
    );
    assertCanonicalContentRef(input.content, "artifact content");
    const record: ArtifactMetadataRecord = {
      ...input,
      id: randomUUID(),
      createdAt: nowIso(),
    };
    state.artifacts.set(record.id, snapshot(record));
    return snapshot(record);
  },
  get(id: string, tenantScope: string): ArtifactMetadataRecord | undefined {
    const record = state.artifacts.get(id);
    return isSameTenant(record, tenantScope) ? snapshot(record) : undefined;
  },
  list(filter: RunTenantFilter): readonly ArtifactMetadataRecord[] {
    return [...state.artifacts.values()]
      .filter(
        (record) =>
          record.runId === filter.runId &&
          record.tenantScope === filter.tenantScope,
      )
      .map(snapshot);
  },
});

const applyScopeBasketChanges = (
  existing: ScopeBasketRecord,
  changes: ScopeBasketChanges,
): ScopeBasketRecord => {
  const nextSelection = changes.selection ?? existing.selection;
  return {
    ...existing,
    label: changes.label ?? existing.label,
    selection: nextSelection,
    itemCount:
      nextSelection.nodeIds.length +
      nextSelection.pageIds.length +
      nextSelection.frameIds.length,
    updatedAt: nowIso(),
  };
};

const createScopeBasketRepository = (
  state: MemoryState,
): ScopeBasketRepository => ({
  create(input: CreateScopeBasketInput): ScopeBasketRecord {
    const timestamp = nowIso();
    const record: ScopeBasketRecord = {
      ...input,
      id: randomUUID(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    state.scopeBaskets.set(record.id, snapshot(record));
    return snapshot(record);
  },
  get(id: string, tenantScope: string): ScopeBasketRecord | undefined {
    const record = state.scopeBaskets.get(id);
    return isSameTenant(record, tenantScope) ? snapshot(record) : undefined;
  },
  list(filter?: ScopeBasketFilter): readonly ScopeBasketRecord[] {
    return [...state.scopeBaskets.values()]
      .filter((record) =>
        matchesTenant(record.tenantScope, filter?.tenantScope),
      )
      .filter(
        (record) =>
          filter?.snapshotId === undefined ||
          record.snapshotId === filter.snapshotId,
      )
      .map(snapshot);
  },
  update(
    id: string,
    tenantScope: string,
    changes: ScopeBasketChanges,
  ): ScopeBasketRecord | undefined {
    const existing = state.scopeBaskets.get(id);
    if (existing === undefined || existing.tenantScope !== tenantScope) {
      return undefined;
    }
    const updated = applyScopeBasketChanges(existing, changes);
    state.scopeBaskets.set(id, snapshot(updated));
    return snapshot(updated);
  },
});

const createGeneratedSeedRepository = (
  state: MemoryState,
): GeneratedSeedRepository => ({
  create(input: CreateGeneratedSeedInput): GeneratedSeedMetadataRecord {
    assertSameTenantRun(
      state.runs.get(input.runId),
      input.tenantScope,
      "generated seed runId",
    );
    assertCanonicalContentRef(input.content, "generated seed content");
    const record: GeneratedSeedMetadataRecord = {
      ...input,
      id: randomUUID(),
      createdAt: nowIso(),
    };
    state.generatedSeeds.set(record.id, snapshot(record));
    return snapshot(record);
  },
  get(
    id: string,
    tenantScope: string,
  ): GeneratedSeedMetadataRecord | undefined {
    const record = state.generatedSeeds.get(id);
    return isSameTenant(record, tenantScope) ? snapshot(record) : undefined;
  },
  list(filter: RunTenantFilter): readonly GeneratedSeedMetadataRecord[] {
    return [...state.generatedSeeds.values()]
      .filter(
        (record) =>
          record.runId === filter.runId &&
          record.tenantScope === filter.tenantScope,
      )
      .map(snapshot);
  },
});

const createExportRepository = (state: MemoryState): ExportRepository => ({
  create(input: CreateExportInput): ExportMetadataRecord {
    assertSameTenantRun(
      state.runs.get(input.runId),
      input.tenantScope,
      "export runId",
    );
    assertCanonicalContentRef(input.content, "export content");
    const record: ExportMetadataRecord = {
      ...input,
      id: randomUUID(),
      createdAt: nowIso(),
    };
    state.exports.set(record.id, snapshot(record));
    return snapshot(record);
  },
  get(id: string, tenantScope: string): ExportMetadataRecord | undefined {
    const record = state.exports.get(id);
    return isSameTenant(record, tenantScope) ? snapshot(record) : undefined;
  },
  list(filter: RunTenantFilter): readonly ExportMetadataRecord[] {
    return [...state.exports.values()]
      .filter(
        (record) =>
          record.runId === filter.runId &&
          record.tenantScope === filter.tenantScope,
      )
      .map(snapshot);
  },
});

const assertReferencedGeneratedSeed = (
  state: MemoryState,
  input: CreatePersistedTestCaseInput,
): void => {
  const seed = state.generatedSeeds.get(input.sourceGeneratedSeedId);
  if (
    seed === undefined ||
    seed.tenantScope !== input.tenantScope ||
    seed.runId !== input.sourceRunId
  ) {
    throw new WorkbenchStorageError(
      "REFERENTIAL_INTEGRITY",
      "test case sourceGeneratedSeedId must reference an existing generated seed in the same tenant and run.",
    );
  }
};

const assertTraceTargetsPresent = (
  input: CreatePersistedTestCaseInput,
): void => {
  if (input.initialVersion.traceTargets.length === 0) {
    throw new WorkbenchStorageError(
      "REFERENTIAL_INTEGRITY",
      "test case initialVersion.traceTargets must include at least one trace link.",
    );
  }
};

const distinctOrdered = <T>(values: readonly T[]): T[] => {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
};

const projectTestCaseSummary = (
  record: TestCaseRecord,
  version: TestCaseVersionRecord,
  links: readonly TestCaseTraceLinkRecord[],
): TestCaseSummary => {
  const snapshotIds = distinctOrdered(
    links.filter((l) => l.targetKind === "snapshot").map((l) => l.targetId),
  );
  const traceLinkKinds = distinctOrdered<TestCaseTraceLinkKind>(
    links.map((l) => l.targetKind),
  );
  return {
    id: record.id,
    tenantScope: record.tenantScope,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    sourceRunId: record.sourceRunId,
    sourceGeneratedSeedId: record.sourceGeneratedSeedId,
    sourceTestCaseId: record.sourceTestCaseId,
    currentVersionId: record.currentVersionId,
    status: record.status,
    title: version.title,
    priority: version.priority,
    risk: version.risk,
    tags: distinctOrdered([...version.tags]),
    versionStatus: version.status,
    snapshotIds,
    traceLinkKinds,
  };
};

const createTestCaseRepository = (state: MemoryState): TestCaseRepository => ({
  create(input: CreatePersistedTestCaseInput): PersistedTestCaseDetail {
    assertCanonicalContentRef(
      input.initialVersion.content,
      "test case version content",
    );
    assertSameTenantRun(
      state.runs.get(input.sourceRunId),
      input.tenantScope,
      "test case sourceRunId",
    );
    assertReferencedGeneratedSeed(state, input);
    assertTraceTargetsPresent(input);

    const testCaseId = randomUUID();
    const versionId = randomUUID();
    const timestamp = nowIso();
    const initial = input.initialVersion;
    const traceLinks: TestCaseTraceLinkRecord[] = initial.traceTargets.map(
      (target) => ({
        id: randomUUID(),
        testCaseVersionId: versionId,
        tenantScope: input.tenantScope,
        createdAt: timestamp,
        targetKind: target.targetKind,
        targetId: target.targetId,
      }),
    );
    const version: TestCaseVersionRecord = {
      id: versionId,
      testCaseId,
      tenantScope: input.tenantScope,
      createdAt: timestamp,
      versionIndex: 1,
      source: initial.source,
      title: initial.title,
      objective: initial.objective,
      preconditions: [...initial.preconditions],
      steps: initial.steps.map((step) => ({ ...step })),
      testData: [...initial.testData],
      priority: initial.priority,
      risk: initial.risk,
      tags: [...initial.tags],
      status: initial.status,
      ...(initial.description !== undefined
        ? { description: initial.description }
        : {}),
      content: { ...initial.content },
      traceLinks,
    };
    const testCase: TestCaseRecord = {
      id: testCaseId,
      tenantScope: input.tenantScope,
      createdAt: timestamp,
      updatedAt: timestamp,
      sourceRunId: input.sourceRunId,
      sourceGeneratedSeedId: input.sourceGeneratedSeedId,
      sourceTestCaseId: input.sourceTestCaseId,
      currentVersionId: versionId,
      status: input.status,
    };
    state.testCases.set(testCase.id, snapshot(testCase));
    state.testCaseVersions.set(version.id, snapshot(version));
    for (const link of traceLinks) {
      state.testCaseTraceLinks.set(link.id, snapshot(link));
    }
    return { testCase: snapshot(testCase), currentVersion: snapshot(version) };
  },
  get(id: string, tenantScope: string): PersistedTestCaseDetail | undefined {
    const record = state.testCases.get(id);
    if (record === undefined || !isSameTenant(record, tenantScope)) {
      return undefined;
    }
    const version = state.testCaseVersions.get(record.currentVersionId);
    if (version === undefined) return undefined;
    const links = [...state.testCaseTraceLinks.values()].filter(
      (link) => link.testCaseVersionId === version.id,
    );
    const currentVersion: TestCaseVersionRecord = {
      ...version,
      traceLinks: links.map(snapshot),
    };
    return {
      testCase: snapshot(record),
      currentVersion: snapshot(currentVersion),
    };
  },
  list(filter?: TestCaseFilter): readonly TestCaseSummary[] {
    const summaries: TestCaseSummary[] = [];
    for (const record of state.testCases.values()) {
      if (!matchesTenant(record.tenantScope, filter?.tenantScope)) continue;
      if (filter?.runId !== undefined && record.sourceRunId !== filter.runId) {
        continue;
      }
      const version = state.testCaseVersions.get(record.currentVersionId);
      if (version === undefined) continue;
      const links = [...state.testCaseTraceLinks.values()].filter(
        (l) =>
          l.testCaseVersionId === version.id &&
          l.tenantScope === record.tenantScope,
      );
      summaries.push(snapshot(projectTestCaseSummary(record, version, links)));
    }
    return summaries;
  },
  findBySource(
    tenantScope: string,
    sourceRunId: string,
    sourceTestCaseId: string,
  ): TestCaseRecord | undefined {
    const record = [...state.testCases.values()].find(
      (candidate) =>
        candidate.tenantScope === tenantScope &&
        candidate.sourceRunId === sourceRunId &&
        candidate.sourceTestCaseId === sourceTestCaseId,
    );
    return record === undefined ? undefined : snapshot(record);
  },
});

interface MemoryAdapterOptions {
  readonly migrations?: readonly WorkbenchMigration[];
  readonly initialSchemaVersion?: number;
}

class MemoryWorkbenchStorageAdapter implements WorkbenchStorageAdapter {
  readonly snapshots: SnapshotRepository;
  readonly runs: RunRepository;
  readonly artifacts: ArtifactRepository;
  readonly scopeBaskets: ScopeBasketRepository;
  readonly generatedSeeds: GeneratedSeedRepository;
  readonly exports: ExportRepository;
  readonly testCases: TestCaseRepository;

  private readonly state: MemoryState;
  private readonly migrations: readonly WorkbenchMigration[];
  private readonly txHandle: WorkbenchStorageAdapter;
  private schemaVersion: number;
  private inTransaction = false;

  constructor(
    migrations: readonly WorkbenchMigration[],
    initialSchemaVersion = 0,
  ) {
    this.state = createEmptyState();
    this.migrations = migrations;
    this.schemaVersion = initialSchemaVersion;
    this.snapshots = createSnapshotRepository(this.state);
    this.runs = createRunRepository(this.state);
    this.artifacts = createArtifactRepository(this.state);
    this.scopeBaskets = createScopeBasketRepository(this.state);
    this.generatedSeeds = createGeneratedSeedRepository(this.state);
    this.exports = createExportRepository(this.state);
    this.testCases = createTestCaseRepository(this.state);
    this.txHandle = this.buildTxHandle();
  }

  private buildTxHandle(): WorkbenchStorageAdapter {
    return {
      snapshots: this.snapshots,
      runs: this.runs,
      artifacts: this.artifacts,
      scopeBaskets: this.scopeBaskets,
      generatedSeeds: this.generatedSeeds,
      exports: this.exports,
      testCases: this.testCases,
      migrateToLatest: () => {
        throw new WorkbenchStorageError(
          "NESTED_TRANSACTION",
          "migrateToLatest() is not available inside a transaction.",
        );
      },
      getSchemaVersion: () => this.getSchemaVersion(),
      transaction: () => {
        throw new WorkbenchStorageError(
          "NESTED_TRANSACTION",
          "Nested transactions are not supported.",
        );
      },
      close: () => {
        throw new WorkbenchStorageError(
          "NESTED_TRANSACTION",
          "close() is not available inside a transaction.",
        );
      },
    };
  }

  getSchemaVersion(): number {
    return this.schemaVersion;
  }

  migrateToLatest(): number {
    assertSchemaVersionSupported(this.schemaVersion, this.migrations);
    const pending = this.migrations.filter(
      (migration) => migration.version > this.schemaVersion,
    );
    if (pending.length === 0) return this.schemaVersion;
    this.transaction((tx) => {
      for (const migration of pending) {
        migration.up(tx);
        this.schemaVersion = migration.version;
      }
    });
    return this.schemaVersion;
  }

  transaction<T>(work: (tx: WorkbenchStorageAdapter) => T): T {
    if (this.inTransaction) {
      throw new WorkbenchStorageError(
        "NESTED_TRANSACTION",
        "Nested transactions are not supported.",
      );
    }
    const backup = cloneState(this.state);
    const backupVersion = this.schemaVersion;
    this.inTransaction = true;
    try {
      const result = work(this.txHandle);
      this.inTransaction = false;
      return result;
    } catch (error) {
      restoreState(this.state, backup);
      this.schemaVersion = backupVersion;
      this.inTransaction = false;
      throw error;
    }
  }

  close(): void {
    this.state.snapshots.clear();
    this.state.runs.clear();
    this.state.artifacts.clear();
    this.state.scopeBaskets.clear();
    this.state.generatedSeeds.clear();
    this.state.exports.clear();
    this.state.testCases.clear();
    this.state.testCaseVersions.clear();
    this.state.testCaseTraceLinks.clear();
  }
}

export const createMemoryWorkbenchStorageAdapter = (
  options?: MemoryAdapterOptions,
): WorkbenchStorageAdapter =>
  new MemoryWorkbenchStorageAdapter(
    options?.migrations ?? [],
    options?.initialSchemaVersion,
  );
