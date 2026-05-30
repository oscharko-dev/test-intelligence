/**
 * Forward-only migration contract for the Workbench storage boundary.
 *
 * Migrations carry no SQL in this module: a migration is an ordered, versioned
 * unit of work that runs against the storage adapter inside a transaction. The
 * concrete SQLite implementation (a later child issue) supplies the schema
 * statements; #51 only pins the ordering invariant and validation rule.
 */

import { WorkbenchStorageError } from "./storage-adapter";
import type { WorkbenchStorageAdapter } from "./storage-adapter";

export interface WorkbenchMigration {
  readonly version: number;
  readonly description: string;
  up(tx: WorkbenchStorageAdapter): void;
}

/**
 * No schema exists yet for #51. The storage-bootstrap issue (#52) introduces
 * the first migration (version 1) that creates the metadata tables.
 */
export const WORKBENCH_MIGRATIONS: readonly WorkbenchMigration[] = [];

/**
 * Validates that migration versions are integers, each at least 1, strictly
 * increasing, and contiguous starting at 1 (`[1, 2, 3, ...]`). Throws
 * `WorkbenchStorageError` with code `MIGRATION_SEQUENCE_INVALID` otherwise.
 *
 * The forward-only, contiguous-from-1 rule keeps the applied version equal to
 * the migration count and lets startup advance the schema deterministically
 * without reversible (down) steps.
 */
export const validateMigrationSequence = (
  migrations: readonly WorkbenchMigration[],
): void => {
  migrations.forEach((migration, index) => {
    const expectedVersion = index + 1;
    if (!Number.isInteger(migration.version)) {
      throw new WorkbenchStorageError(
        "MIGRATION_SEQUENCE_INVALID",
        `Migration at index ${index} has a non-integer version.`,
      );
    }
    if (migration.version !== expectedVersion) {
      throw new WorkbenchStorageError(
        "MIGRATION_SEQUENCE_INVALID",
        `Migration versions must be contiguous from 1; expected ${expectedVersion} at index ${index} but found ${migration.version}.`,
      );
    }
  });
};

/**
 * Fails closed when local data was written by a newer Workbench build. A
 * forward-only migration strategy cannot safely downgrade or reinterpret future
 * rows, so startup must stop before repository calls run against unknown schema.
 */
export const assertSchemaVersionSupported = (
  currentVersion: number,
  migrations: readonly WorkbenchMigration[],
): void => {
  validateMigrationSequence(migrations);
  const latestKnownVersion = migrations.length;
  if (currentVersion > latestKnownVersion) {
    throw new WorkbenchStorageError(
      "SCHEMA_VERSION_UNSUPPORTED",
      `Stored Workbench schema version ${currentVersion} is newer than the latest supported version ${latestKnownVersion}.`,
    );
  }
};
