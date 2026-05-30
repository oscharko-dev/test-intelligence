/**
 * The Workbench storage boundary.
 *
 * A single adapter interface aggregates the per-entity repositories and the
 * lifecycle operations (migrations, transactions, teardown) that all future
 * Workbench persistence features depend on. The concrete implementation is a
 * later child issue; this module defines only the contract plus the shared
 * error type, and stays free of UI, domain, and external-dependency imports.
 */

import type {
  ArtifactRepository,
  ExportRepository,
  GeneratedSeedRepository,
  RunRepository,
  ScopeBasketRepository,
  SnapshotRepository,
} from "./types";

export type WorkbenchStorageErrorCode =
  | "NESTED_TRANSACTION"
  | "MIGRATION_SEQUENCE_INVALID"
  | "MIGRATION_FAILED";

export class WorkbenchStorageError extends Error {
  readonly code: WorkbenchStorageErrorCode;

  constructor(
    code: WorkbenchStorageErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorkbenchStorageError";
    this.code = code;
  }
}

/**
 * Aggregate persistence boundary. `transaction` receives a handle exposing the
 * same repositories, scoped to the active transaction: writes are atomic
 * (all-or-nothing), reads observe prior writes within the same transaction
 * (read-your-writes), the transaction rolls back when `work` throws, and
 * nesting is forbidden (a nested call throws `WorkbenchStorageError` with code
 * `NESTED_TRANSACTION`).
 *
 * WHY: the in-memory double passes itself as the transaction handle because its
 * repositories already mutate the live maps that the snapshot/restore protocol
 * guards. The concrete SQLite implementation will instead bind a distinct
 * handle whose repositories execute against the active better-sqlite3
 * transaction.
 */
export interface WorkbenchStorageAdapter {
  readonly snapshots: SnapshotRepository;
  readonly runs: RunRepository;
  readonly artifacts: ArtifactRepository;
  readonly scopeBaskets: ScopeBasketRepository;
  readonly generatedSeeds: GeneratedSeedRepository;
  readonly exports: ExportRepository;
  migrateToLatest(): number;
  getSchemaVersion(): number;
  transaction<T>(work: (tx: WorkbenchStorageAdapter) => T): T;
  close(): void;
}
