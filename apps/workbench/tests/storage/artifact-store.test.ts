// @vitest-environment node
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ArtifactStoreError,
  readArtifact,
  verifyArtifact,
  writeArtifact,
} from "@/lib/server/storage/artifact-store";
import { artifactAbsolutePath, sha256Hex } from "@/lib/server/storage/db-path";
import type { WorkbenchStoragePaths } from "@/lib/server/storage/db-path";
import type { ContentRef } from "@/lib/server/storage/types";

const HEX_64 = /^[0-9a-f]{64}$/u;
const SHARD = /^[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.bin$/u;

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("artifact-store", () => {
  let root: string;
  let paths: WorkbenchStoragePaths;

  beforeEach(() => {
    root = path.join(tmpdir(), `ti-artifact-store-${randomUUID()}`);
    paths = {
      databaseFile: path.join(root, "workbench.db"),
      artifactRoot: path.join(root, "storage-artifacts"),
    };
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe("writeArtifact", () => {
    it("returns a ContentRef and writes the bytes to the sharded path", () => {
      const bytes = bytesOf("hello-artifact");
      const ref = writeArtifact(paths, bytes);

      expect(ref.sha256).toMatch(HEX_64);
      expect(ref.sha256).toBe(sha256Hex(bytes));
      expect(ref.byteSize).toBe(bytes.byteLength);
      expect(ref.storageRef).toMatch(SHARD);
      expect(ref.storageRef).toBe(
        `${ref.sha256.slice(0, 2)}/${ref.sha256.slice(2, 4)}/${ref.sha256}.bin`,
      );

      const absolute = artifactAbsolutePath(paths, ref.sha256);
      expect(existsSync(absolute)).toBe(true);
      expect(new Uint8Array(readFileSync(absolute))).toStrictEqual(bytes);
    });

    it("handles a zero-byte artifact", () => {
      const empty = new Uint8Array(0);
      const ref = writeArtifact(paths, empty);

      expect(ref.byteSize).toBe(0);
      expect(ref.sha256).toBe(sha256Hex(empty));
      const absolute = artifactAbsolutePath(paths, ref.sha256);
      expect(existsSync(absolute)).toBe(true);
      expect(readFileSync(absolute).byteLength).toBe(0);
    });

    it("is idempotent: rewriting identical bytes yields an equal ref and preserves content", () => {
      const bytes = bytesOf("idempotent-bytes");
      const first = writeArtifact(paths, bytes);
      const absolute = artifactAbsolutePath(paths, first.sha256);
      const before = readFileSync(absolute);

      const second = writeArtifact(paths, bytes);
      expect(second).toStrictEqual(first);
      expect(new Uint8Array(readFileSync(absolute))).toStrictEqual(
        new Uint8Array(before),
      );
    });

    it("repairs a pre-existing corrupt shard at the target path (self-heal)", () => {
      // A truncated/corrupt shard already sits at the final path (e.g. a prior
      // crash mid-write). writeArtifact for the SAME hash must atomically replace
      // it with the canonical bytes — restoration, not mutation, since a content
      // hash has exactly one valid byte sequence.
      const bytes = bytesOf("content-addressed-payload");
      const sha256 = sha256Hex(bytes);
      const absolute = artifactAbsolutePath(paths, sha256);
      mkdirSync(path.dirname(absolute), { recursive: true });
      // Wrong bytes (and wrong length) at the canonical path.
      writeFileSync(absolute, bytesOf("partial-corrupt-shard"));

      const ref = writeArtifact(paths, bytes);

      expect(ref.sha256).toBe(sha256);
      expect(ref.byteSize).toBe(bytes.byteLength);
      expect(ref.storageRef).toBe(
        `${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}.bin`,
      );
      // The corrupt shard was repaired to the canonical bytes on disk.
      expect(new Uint8Array(readFileSync(absolute))).toStrictEqual(bytes);
      // Read/verify of the artifact now succeed against the repaired shard.
      expect(readArtifact(paths, ref)).toStrictEqual(bytes);
      expect(verifyArtifact(paths, ref)).toStrictEqual({
        present: true,
        checksumValid: true,
        actualByteSize: ref.byteSize,
      });
      // No leftover temp files accumulate in the shard directory.
      expect(readdirSync(path.dirname(absolute))).toStrictEqual([
        `${sha256}.bin`,
      ]);
    });

    it("repairs a corrupt shard that happens to share the correct byte length", () => {
      // A same-length corrupt shard would slip past a length-only check; the
      // sha256 comparison must still detect it and trigger the atomic rewrite.
      const bytes = bytesOf("same-length-AAAA");
      const sha256 = sha256Hex(bytes);
      const absolute = artifactAbsolutePath(paths, sha256);
      mkdirSync(path.dirname(absolute), { recursive: true });
      const corrupt = bytesOf("same-length-BBBB");
      expect(corrupt.byteLength).toBe(bytes.byteLength);
      writeFileSync(absolute, corrupt);

      const ref = writeArtifact(paths, bytes);

      expect(new Uint8Array(readFileSync(absolute))).toStrictEqual(bytes);
      expect(verifyArtifact(paths, ref).checksumValid).toBe(true);
      expect(readdirSync(path.dirname(absolute))).toStrictEqual([
        `${sha256}.bin`,
      ]);
    });

    it("leaves an already-correct shard byte-identical and writes no temp file", () => {
      // A correct existing shard must NOT be rewritten (write-once): capture the
      // inode/mtime-bearing bytes, rewrite, and assert the on-disk bytes and the
      // sole directory entry are unchanged.
      const bytes = bytesOf("already-correct-shard");
      const first = writeArtifact(paths, bytes);
      const absolute = artifactAbsolutePath(paths, first.sha256);
      const before = new Uint8Array(readFileSync(absolute));

      const second = writeArtifact(paths, bytes);

      expect(second).toStrictEqual(first);
      expect(new Uint8Array(readFileSync(absolute))).toStrictEqual(before);
      expect(readArtifact(paths, second)).toStrictEqual(bytes);
      // No temp residue from the skipped rewrite.
      expect(readdirSync(path.dirname(absolute))).toStrictEqual([
        `${first.sha256}.bin`,
      ]);
    });

    it("writes atomically with no temp-file residue and round-trips", () => {
      const bytes = bytesOf("atomic-roundtrip-payload");
      const ref = writeArtifact(paths, bytes);
      const absolute = artifactAbsolutePath(paths, ref.sha256);

      expect(new Uint8Array(readFileSync(absolute))).toStrictEqual(bytes);
      expect(readArtifact(paths, ref)).toStrictEqual(bytes);
      // Only the final shard remains; the temp file was renamed/cleaned up.
      expect(readdirSync(path.dirname(absolute))).toStrictEqual([
        `${ref.sha256}.bin`,
      ]);
    });

    it("is deterministic across content: same bytes match, different bytes differ", () => {
      const a1 = writeArtifact(paths, bytesOf("alpha"));
      const a2 = writeArtifact(paths, bytesOf("alpha"));
      const b = writeArtifact(paths, bytesOf("beta"));

      expect(a2.sha256).toBe(a1.sha256);
      expect(a2.storageRef).toBe(a1.storageRef);
      expect(b.sha256).not.toBe(a1.sha256);
      expect(b.storageRef).not.toBe(a1.storageRef);
    });
  });

  describe("readArtifact", () => {
    it("round-trips written bytes exactly", () => {
      const bytes = bytesOf("round-trip-payload");
      const ref = writeArtifact(paths, bytes);
      expect(readArtifact(paths, ref)).toStrictEqual(bytes);
    });

    it("round-trips a zero-byte artifact", () => {
      const ref = writeArtifact(paths, new Uint8Array(0));
      expect(readArtifact(paths, ref).byteLength).toBe(0);
    });

    it("throws ArtifactStoreError ARTIFACT_MISSING for an absent ref", () => {
      const ref: ContentRef = {
        sha256: sha256Hex(bytesOf("never-written")),
        byteSize: 13,
        storageRef: "",
      };

      let thrown: unknown;
      try {
        readArtifact(paths, ref);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ArtifactStoreError);
      expect((thrown as ArtifactStoreError).code).toBe("ARTIFACT_MISSING");
      // Operator-safe: the message references the sha256, never the disk path.
      expect((thrown as ArtifactStoreError).message).toContain(ref.sha256);
      expect((thrown as ArtifactStoreError).message).not.toContain(root);
    });
  });

  describe("verifyArtifact", () => {
    it("reports present and checksum-valid after a write", () => {
      const ref = writeArtifact(paths, bytesOf("verify-me"));
      expect(verifyArtifact(paths, ref)).toStrictEqual({
        present: true,
        checksumValid: true,
        actualByteSize: ref.byteSize,
      });
    });

    it("reports absent without throwing for an unwritten ref", () => {
      const ref: ContentRef = {
        sha256: sha256Hex(bytesOf("absent")),
        byteSize: 6,
        storageRef: "",
      };
      expect(verifyArtifact(paths, ref)).toStrictEqual({
        present: false,
        checksumValid: false,
        actualByteSize: undefined,
      });
    });

    it("flags checksumValid:false when on-disk bytes are tampered to a different length", () => {
      const ref = writeArtifact(paths, bytesOf("original-content"));
      const absolute = artifactAbsolutePath(paths, ref.sha256);
      const tampered = bytesOf("longer-tampered-content-of-different-length");
      writeFileSync(absolute, tampered);

      const result = verifyArtifact(paths, ref);
      expect(result.present).toBe(true);
      expect(result.checksumValid).toBe(false);
      expect(result.actualByteSize).toBe(tampered.byteLength);
    });

    it("flags checksumValid:false when bytes are tampered but keep the same length", () => {
      const original = bytesOf("same-length-AAAA");
      const ref = writeArtifact(paths, original);
      const absolute = artifactAbsolutePath(paths, ref.sha256);
      const tampered = bytesOf("same-length-BBBB");
      expect(tampered.byteLength).toBe(original.byteLength);
      writeFileSync(absolute, tampered);

      const result = verifyArtifact(paths, ref);
      expect(result.present).toBe(true);
      // Proves sha256 is checked even when byteSize alone would pass.
      expect(result.checksumValid).toBe(false);
      expect(result.actualByteSize).toBe(ref.byteSize);
    });

    it("flags checksumValid:false when only byteSize disagrees with the ref", () => {
      const bytes = bytesOf("size-claim-mismatch");
      const written = writeArtifact(paths, bytes);
      // sha256 matches the real file, but the recorded byteSize is wrong.
      const ref: ContentRef = { ...written, byteSize: written.byteSize + 1 };

      const result = verifyArtifact(paths, ref);
      expect(result.present).toBe(true);
      // Proves byteSize is part of the validation, not just sha256.
      expect(result.checksumValid).toBe(false);
      expect(result.actualByteSize).toBe(bytes.byteLength);
    });
  });
});
