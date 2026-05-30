/**
 * Pre-migration SQLite backup (Issue #55, AC#3).
 *
 * WHY this exists: a future schema-changing migration could irreversibly mutate
 * an already-populated database. `migrateToLatest()` runs all pending steps in a
 * single transaction that rolls DDL back on failure, but a logically-wrong (yet
 * successful) migration cannot be rolled back. A consistent on-disk snapshot
 * taken BEFORE the transaction opens gives an operator a recoverable restore
 * point for exactly that case.
 *
 * WHY `VACUUM INTO`: it produces a single-file, transactionally-consistent copy
 * that is WAL-safe (it reads a consistent view even with an active WAL) and runs
 * OUTSIDE any transaction. It cannot run while a transaction is open, which is
 * why the call site invokes this before opening the migration transaction.
 *
 * WHY write-then-rename: `VACUUM INTO` to a `.tmp` path followed by an atomic
 * rename means a partial/failed backup never appears under a final `.db` name a
 * restore could mistake for a complete snapshot (fail-closed).
 */

import {
  chmodSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  renameSync,
} from "node:fs";
import path from "node:path";

import type BetterSqlite3 from "better-sqlite3";

const BACKUPS_DIR_SEGMENT = "backups";

const DIRECTORY_MODE_OWNER_ONLY = 0o700;
const FILE_MODE_OWNER_READ_WRITE = 0o600;

const pathIsInsideOrEqual = (candidate: string, root: string): boolean => {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
};

const ensurePrivateBackupsDirectory = (
  dataRoot: string,
  backupsDir: string,
): void => {
  mkdirSync(backupsDir, {
    recursive: true,
    mode: DIRECTORY_MODE_OWNER_ONLY,
  });
  const info = lstatSync(backupsDir);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error("SQLite backup destination must be a real directory.");
  }
  chmodSync(backupsDir, DIRECTORY_MODE_OWNER_ONLY);

  const realDataRoot = realpathSync(dataRoot);
  const realBackupsDir = realpathSync(backupsDir);
  if (!pathIsInsideOrEqual(realBackupsDir, realDataRoot)) {
    throw new Error(
      "SQLite backup destination must remain inside the data root.",
    );
  }
};

/**
 * Replaces filesystem-hostile characters in an ISO timestamp (`:` and `.`) with
 * `-` so the backup filename is portable across filesystems.
 */
const filesystemSafeStamp = (now: Date): string =>
  now.toISOString().replace(/[:.]/gu, "-");

const backupFileName = (
  fromVersion: number,
  toVersion: number,
  now: Date,
): string =>
  `workbench-v${fromVersion}-to-v${toVersion}-${filesystemSafeStamp(now)}.db`;

export interface PreMigrationBackupParams {
  readonly db: BetterSqlite3.Database;
  readonly databaseFile: string;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly now?: Date;
}

/**
 * Writes a transactionally-consistent snapshot of `db` into
 * `<dirname(databaseFile)>/backups/` and returns the absolute path of the final
 * backup file. Throws on any I/O failure so the caller can abort the migration
 * (fail-closed). The destination directory is created if missing (directories
 * only — no existing file is touched).
 */
export const writePreMigrationBackup = (
  params: PreMigrationBackupParams,
): string => {
  const { db, databaseFile, fromVersion, toVersion } = params;
  const now = params.now ?? new Date();
  const dataRoot = path.dirname(databaseFile);
  const backupsDir = path.join(dataRoot, BACKUPS_DIR_SEGMENT);
  ensurePrivateBackupsDirectory(dataRoot, backupsDir);

  const finalPath = path.join(
    backupsDir,
    backupFileName(fromVersion, toVersion, now),
  );
  const tempPath = `${finalPath}.tmp`;

  // Parameter binding is supported for VACUUM INTO on this SQLite build, so the
  // path is never interpolated (no injection surface).
  db.prepare("VACUUM INTO ?").run(tempPath);
  chmodSync(tempPath, FILE_MODE_OWNER_READ_WRITE);
  renameSync(tempPath, finalPath);
  chmodSync(finalPath, FILE_MODE_OWNER_READ_WRITE);
  return finalPath;
};
