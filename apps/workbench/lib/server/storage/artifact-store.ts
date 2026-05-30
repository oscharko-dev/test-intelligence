/**
 * Byte I/O for the content-addressed artifact store.
 *
 * Large binaries (node graphs, run-state docs, generated-seed JSON, export
 * bytes) live on disk under the sharded artifact root and are referenced from
 * SQLite by `ContentRef`. This module is the single primitive that reads and
 * writes those bytes; addressing and hashing are delegated to `db-path.ts`.
 *
 * Self-contained: imports only Node built-ins plus the existing path/hash
 * helpers and the `ContentRef` shape. No SQLite, UI, or domain imports.
 */

import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { artifactAbsolutePath, artifactStorageRef, sha256Hex } from "./db-path";
import type { WorkbenchStoragePaths } from "./db-path";
import type { ContentRef } from "./types";

export type ArtifactStoreErrorCode =
  | "ARTIFACT_MISSING"
  | "ARTIFACT_CHECKSUM_MISMATCH";

/**
 * WHY operator-safe messages: this error surfaces in operator-facing logs and
 * responses, so messages reference an artifact by its sha256 only — never an
 * absolute filesystem path or any byte content that could leak a secret.
 */
export class ArtifactStoreError extends Error {
  readonly code: ArtifactStoreErrorCode;

  constructor(
    code: ArtifactStoreErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ArtifactStoreError";
    this.code = code;
  }
}

export interface ArtifactVerification {
  readonly present: boolean;
  readonly checksumValid: boolean;
  readonly actualByteSize: number | undefined;
}

const isErrnoCode = (error: unknown, code: string): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as NodeJS.ErrnoException).code === code;

/**
 * True only when the file already at `absolute` holds EXACTLY the canonical
 * bytes for `sha256`/`byteSize` (length matches and the recomputed digest
 * matches). Any read error (absent, unreadable) returns `false` so the caller
 * (re)writes. `absolute` is derived from the validated `sha256`, never from user
 * input, so reading it is not a path-injection sink.
 */
const existingShardMatches = (
  absolute: string,
  sha256: string,
  byteSize: number,
): boolean => {
  try {
    const bytes = readFileSync(absolute);
    return bytes.byteLength === byteSize && sha256Hex(bytes) === sha256;
  } catch {
    return false;
  }
};

/**
 * Persists `bytes` under their content hash and returns the reference.
 *
 * WHY temp-file + atomic rename: `writeFileSync` to the final path is not
 * atomic — a crash mid-write would leave a truncated shard. Instead the bytes
 * are written to a uniquely named temp file in the SAME shard directory (same
 * filesystem, so `renameSync` is atomic) and renamed onto `<hash>.bin`. The
 * rename atomically REPLACES whatever was at the target, so an absent shard is
 * created and a corrupt/truncated one is repaired in a single step; a crash
 * leaves only an orphan temp file, never a partial final shard. The temp name
 * carries a `randomUUID()`, so concurrent writers for the same hash never
 * collide on the temp path and the rename needs no `wx` guard.
 *
 * WHY skip only an already-correct shard: the store is content-addressed and
 * immutable, so the canonical bytes for a hash are fixed. When the existing
 * shard already holds those exact bytes the rewrite is skipped (write-once,
 * never needlessly overwritten); otherwise — absent OR corrupt — the atomic
 * rename writes the canonical bytes, which RESTORES a corrupt shard to its one
 * correct value (restoration, not mutation). The temp file is cleaned up
 * best-effort so orphans never accumulate.
 */
export const writeArtifact = (
  paths: WorkbenchStoragePaths,
  bytes: Uint8Array,
): ContentRef => {
  const sha256 = sha256Hex(bytes);
  const byteSize = bytes.byteLength;
  const storageRef = artifactStorageRef(sha256);
  const absolute = artifactAbsolutePath(paths, sha256);
  const shardDir = path.dirname(absolute);
  const ref: ContentRef = { sha256, byteSize, storageRef };

  mkdirSync(shardDir, { recursive: true });
  if (
    existsSync(absolute) &&
    existingShardMatches(absolute, sha256, byteSize)
  ) {
    return ref;
  }

  const tempPath = path.join(shardDir, `${sha256}.${randomUUID()}.tmp`);
  try {
    writeFileSync(tempPath, bytes);
    renameSync(tempPath, absolute);
  } finally {
    rmSync(tempPath, { force: true });
  }

  return ref;
};

/**
 * Reads the bytes for `ref`. The filesystem is a system boundary, so a missing
 * artifact is mapped to a typed `ArtifactStoreError`; any other fs error
 * propagates unchanged.
 */
export const readArtifact = (
  paths: WorkbenchStoragePaths,
  ref: ContentRef,
): Uint8Array => {
  const absolute = artifactAbsolutePath(paths, ref.sha256);
  try {
    // WHY copy into a plain Uint8Array: readFileSync returns a Node Buffer
    // (a Uint8Array subclass) whose pooled backing store and subtype leak into
    // callers; the declared contract is a plain, independently-owned Uint8Array.
    return Uint8Array.from(readFileSync(absolute));
  } catch (error: unknown) {
    if (isErrnoCode(error, "ENOENT")) {
      throw new ArtifactStoreError(
        "ARTIFACT_MISSING",
        `Artifact ${ref.sha256} is missing from the store.`,
        { cause: error },
      );
    }
    throw error;
  }
};

/**
 * Non-throwing integrity probe used to report missing or corrupt artifacts
 * without exceptions. `checksumValid` is true only when both the recomputed
 * sha256 and the on-disk byte length match the reference.
 */
export const verifyArtifact = (
  paths: WorkbenchStoragePaths,
  ref: ContentRef,
): ArtifactVerification => {
  const absolute = artifactAbsolutePath(paths, ref.sha256);

  let actual: Uint8Array;
  try {
    actual = readFileSync(absolute);
  } catch (error: unknown) {
    if (isErrnoCode(error, "ENOENT")) {
      return {
        present: false,
        checksumValid: false,
        actualByteSize: undefined,
      };
    }
    throw error;
  }

  const actualByteSize = actual.byteLength;
  const checksumValid =
    sha256Hex(actual) === ref.sha256 && actualByteSize === ref.byteSize;
  return { present: true, checksumValid, actualByteSize };
};
