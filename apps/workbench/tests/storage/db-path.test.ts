import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  artifactAbsolutePath,
  artifactStorageRef,
  resolveWorkbenchStoragePaths,
  sha256Hex,
} from "@/lib/server/storage";

const VALID_HASH =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const repoRootEnv = (repoRoot: string): NodeJS.ProcessEnv => ({
  ...process.env,
  WORKBENCH_REPO_ROOT: repoRoot,
});

describe("resolveWorkbenchStoragePaths", () => {
  it("anchors the database and artifact root under an explicit repo root", () => {
    const root = path.resolve("/srv/workspace");
    const paths = resolveWorkbenchStoragePaths(repoRootEnv(root));
    expect(paths.databaseFile).toBe(
      path.join(root, ".test-intelligence", "workbench.db"),
    );
    expect(paths.artifactRoot).toBe(
      path.join(root, ".test-intelligence", "storage-artifacts"),
    );
  });

  it("resolves a relative repo root to an absolute path", () => {
    const paths = resolveWorkbenchStoragePaths(repoRootEnv("."));
    expect(path.isAbsolute(paths.databaseFile)).toBe(true);
  });
});

describe("artifactStorageRef", () => {
  it("produces a two-level sharded path for a valid hash", () => {
    expect(artifactStorageRef(VALID_HASH)).toBe(`e3/b0/${VALID_HASH}.bin`);
  });

  it("rejects an uppercase or wrong-length hash", () => {
    expect(() => artifactStorageRef(VALID_HASH.toUpperCase())).toThrow();
    expect(() => artifactStorageRef("abc")).toThrow();
    expect(() => artifactStorageRef(`${VALID_HASH}f`)).toThrow();
  });
});

describe("artifactAbsolutePath", () => {
  it("joins the artifact root with the sharded reference", () => {
    const paths = resolveWorkbenchStoragePaths(
      repoRootEnv(path.resolve("/srv/workspace")),
    );
    expect(artifactAbsolutePath(paths, VALID_HASH)).toBe(
      path.join(paths.artifactRoot, "e3", "b0", `${VALID_HASH}.bin`),
    );
  });
});

describe("sha256Hex", () => {
  it("matches the known empty-string vector", () => {
    expect(sha256Hex("")).toBe(VALID_HASH);
  });

  it("hashes byte input identically to its string form", () => {
    expect(sha256Hex(new Uint8Array([97, 98, 99]))).toBe(sha256Hex("abc"));
  });
});
