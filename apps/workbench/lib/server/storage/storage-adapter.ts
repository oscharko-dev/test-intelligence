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
  | "REFERENTIAL_INTEGRITY"
  | "CONTENT_REF_INVALID"
  | "MIGRATION_SEQUENCE_INVALID"
  | "MIGRATION_FAILED"
  | "SCHEMA_VERSION_UNSUPPORTED";

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
 * Aggregate persistence boundary. `transaction` receives a restricted handle
 * exposing the same repositories, scoped to the active transaction: writes are
 * atomic (all-or-nothing), reads observe prior writes within the same transaction
 * (read-your-writes), the transaction rolls back when `work` throws, and nesting
 * plus lifecycle methods (`migrateToLatest`, `close`) are forbidden with
 * `WorkbenchStorageError` code `NESTED_TRANSACTION`.
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
