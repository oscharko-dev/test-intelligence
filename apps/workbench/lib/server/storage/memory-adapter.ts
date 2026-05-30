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

import { validateMigrationSequence } from "./migrations";
import type { WorkbenchMigration } from "./migrations";
import { WorkbenchStorageError } from "./storage-adapter";
import type { WorkbenchStorageAdapter } from "./storage-adapter";
import type {
  ArtifactMetadataRecord,
  ArtifactRepository,
  CreateArtifactInput,
  CreateExportInput,
  CreateGeneratedSeedInput,
  CreateRunInput,
  CreateScopeBasketInput,
  CreateSnapshotInput,
  ExportMetadataRecord,
  ExportRepository,
  GeneratedSeedMetadataRecord,
  GeneratedSeedRepository,
  RunIdFilter,
  RunMetadataRecord,
  RunRepository,
  ScopeBasketChanges,
  ScopeBasketFilter,
  ScopeBasketRecord,
  ScopeBasketRepository,
  SnapshotMetadataRecord,
  SnapshotRepository,
  TenantScopeFilter,
  WorkbenchRunStatus,
} from "./types";

interface MemoryState {
  snapshots: Map<string, SnapshotMetadataRecord>;
  runs: Map<string, RunMetadataRecord>;
  artifacts: Map<string, ArtifactMetadataRecord>;
  scopeBaskets: Map<string, ScopeBasketRecord>;
  generatedSeeds: Map<string, GeneratedSeedMetadataRecord>;
  exports: Map<string, ExportMetadataRecord>;
}

const createEmptyState = (): MemoryState => ({
  snapshots: new Map(),
  runs: new Map(),
  artifacts: new Map(),
  scopeBaskets: new Map(),
  generatedSeeds: new Map(),
  exports: new Map(),
});

const cloneState = (state: MemoryState): MemoryState => ({
  snapshots: new Map(state.snapshots),
  runs: new Map(state.runs),
  artifacts: new Map(state.artifacts),
  scopeBaskets: new Map(state.scopeBaskets),
  generatedSeeds: new Map(state.generatedSeeds),
  exports: new Map(state.exports),
});

const restoreState = (target: MemoryState, source: MemoryState): void => {
  target.snapshots = source.snapshots;
  target.runs = source.runs;
  target.artifacts = source.artifacts;
  target.scopeBaskets = source.scopeBaskets;
  target.generatedSeeds = source.generatedSeeds;
  target.exports = source.exports;
};

const snapshot = <T>(record: T): T => structuredClone(record);

const matchesTenant = (
  recordScope: string,
  filterScope: string | undefined,
): boolean => filterScope === undefined || recordScope === filterScope;

const nowIso = (): string => new Date().toISOString();

const createSnapshotRepository = (state: MemoryState): SnapshotRepository => ({
  create(input: CreateSnapshotInput): SnapshotMetadataRecord {
    const record: SnapshotMetadataRecord = {
      ...input,
      id: randomUUID(),
      createdAt: nowIso(),
    };
    state.snapshots.set(record.id, record);
    return snapshot(record);
  },
  get(id: string): SnapshotMetadataRecord | undefined {
    const record = state.snapshots.get(id);
    return record ? snapshot(record) : undefined;
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
    lifecycleState: string,
  ): SnapshotMetadataRecord | undefined {
    const existing = state.snapshots.get(id);
    if (!existing) return undefined;
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
    state.runs.set(record.id, record);
    return snapshot(record);
  },
  get(id: string): RunMetadataRecord | undefined {
    const record = state.runs.get(id);
    return record ? snapshot(record) : undefined;
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
    status: WorkbenchRunStatus,
  ): RunMetadataRecord | undefined {
    const existing = state.runs.get(id);
    if (!existing) return undefined;
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
    const record: ArtifactMetadataRecord = {
      ...input,
      id: randomUUID(),
      createdAt: nowIso(),
    };
    state.artifacts.set(record.id, record);
    return snapshot(record);
  },
  get(id: string): ArtifactMetadataRecord | undefined {
    const record = state.artifacts.get(id);
    return record ? snapshot(record) : undefined;
  },
  list(filter: RunIdFilter): readonly ArtifactMetadataRecord[] {
    return [...state.artifacts.values()]
      .filter((record) => record.runId === filter.runId)
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
    state.scopeBaskets.set(record.id, record);
    return snapshot(record);
  },
  get(id: string): ScopeBasketRecord | undefined {
    const record = state.scopeBaskets.get(id);
    return record ? snapshot(record) : undefined;
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
    changes: ScopeBasketChanges,
  ): ScopeBasketRecord | undefined {
    const existing = state.scopeBaskets.get(id);
    if (!existing) return undefined;
    const updated = applyScopeBasketChanges(existing, changes);
    state.scopeBaskets.set(id, updated);
    return snapshot(updated);
  },
});

const createGeneratedSeedRepository = (
  state: MemoryState,
): GeneratedSeedRepository => ({
  create(input: CreateGeneratedSeedInput): GeneratedSeedMetadataRecord {
    const record: GeneratedSeedMetadataRecord = {
      ...input,
      id: randomUUID(),
      createdAt: nowIso(),
    };
    state.generatedSeeds.set(record.id, record);
    return snapshot(record);
  },
  get(id: string): GeneratedSeedMetadataRecord | undefined {
    const record = state.generatedSeeds.get(id);
    return record ? snapshot(record) : undefined;
  },
  list(filter: RunIdFilter): readonly GeneratedSeedMetadataRecord[] {
    return [...state.generatedSeeds.values()]
      .filter((record) => record.runId === filter.runId)
      .map(snapshot);
  },
});

const createExportRepository = (state: MemoryState): ExportRepository => ({
  create(input: CreateExportInput): ExportMetadataRecord {
    const record: ExportMetadataRecord = {
      ...input,
      id: randomUUID(),
      createdAt: nowIso(),
    };
    state.exports.set(record.id, record);
    return snapshot(record);
  },
  get(id: string): ExportMetadataRecord | undefined {
    const record = state.exports.get(id);
    return record ? snapshot(record) : undefined;
  },
  list(filter: RunIdFilter): readonly ExportMetadataRecord[] {
    return [...state.exports.values()]
      .filter((record) => record.runId === filter.runId)
      .map(snapshot);
  },
});

interface MemoryAdapterOptions {
  readonly migrations?: readonly WorkbenchMigration[];
}

class MemoryWorkbenchStorageAdapter implements WorkbenchStorageAdapter {
  readonly snapshots: SnapshotRepository;
  readonly runs: RunRepository;
  readonly artifacts: ArtifactRepository;
  readonly scopeBaskets: ScopeBasketRepository;
  readonly generatedSeeds: GeneratedSeedRepository;
  readonly exports: ExportRepository;

  private readonly state: MemoryState;
  private readonly migrations: readonly WorkbenchMigration[];
  private schemaVersion = 0;
  private inTransaction = false;

  constructor(migrations: readonly WorkbenchMigration[]) {
    this.state = createEmptyState();
    this.migrations = migrations;
    this.snapshots = createSnapshotRepository(this.state);
    this.runs = createRunRepository(this.state);
    this.artifacts = createArtifactRepository(this.state);
    this.scopeBaskets = createScopeBasketRepository(this.state);
    this.generatedSeeds = createGeneratedSeedRepository(this.state);
    this.exports = createExportRepository(this.state);
  }

  getSchemaVersion(): number {
    return this.schemaVersion;
  }

  migrateToLatest(): number {
    validateMigrationSequence(this.migrations);
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
      const result = work(this);
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
  }
}

export const createMemoryWorkbenchStorageAdapter = (
  options?: MemoryAdapterOptions,
): WorkbenchStorageAdapter =>
  new MemoryWorkbenchStorageAdapter(options?.migrations ?? []);
