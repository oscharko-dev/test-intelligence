import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { test } from "node:test";

import {
  assertReproducibleIterations,
  buildArtifactReport,
  findSingleTarballPath,
} from "./verify-reproducible-build.mjs";

test("findSingleTarballPath returns the only packed tarball", async () => {
  const packDir = await mkdtemp(
    path.join(os.tmpdir(), "test-intelligence-pack-test-"),
  );

  try {
    const tarballPath = path.join(
      packDir,
      "oscharko-dev-test-intelligence-0.0.1.tgz",
    );
    await writeFile(tarballPath, "packed", "utf8");

    await assert.doesNotReject(findSingleTarballPath(packDir));
    assert.strictEqual(await findSingleTarballPath(packDir), tarballPath);
  } finally {
    await rm(packDir, { recursive: true, force: true });
  }
});

test("findSingleTarballPath rejects pack directories without exactly one tarball", async () => {
  const emptyPackDir = await mkdtemp(
    path.join(os.tmpdir(), "test-intelligence-pack-empty-"),
  );
  const multiPackDir = await mkdtemp(
    path.join(os.tmpdir(), "test-intelligence-pack-multi-"),
  );

  try {
    await writeFile(
      path.join(multiPackDir, "oscharko-dev-test-intelligence-0.0.1.tgz"),
      "first",
      "utf8",
    );
    await writeFile(
      path.join(multiPackDir, "oscharko-dev-test-intelligence-0.0.2.tgz"),
      "second",
      "utf8",
    );

    await assert.rejects(
      findSingleTarballPath(emptyPackDir),
      /Expected exactly one \.tgz/,
    );
    await assert.rejects(
      findSingleTarballPath(multiPackDir),
      /Expected exactly one \.tgz/,
    );
  } finally {
    await rm(emptyPackDir, { recursive: true, force: true });
    await rm(multiPackDir, { recursive: true, force: true });
  }
});

test("buildArtifactReport records dist and tarball reproducibility evidence", () => {
  const report = buildArtifactReport({
    generatedAt: "2026-04-17T00:00:00.000Z",
    distHashes: [{ file: "dist/index.js", sha256: "abc123" }],
    tarballs: {
      first: {
        file: "oscharko-dev-test-intelligence-0.0.1.tgz",
        sha256: "tar123",
      },
      second: {
        file: "oscharko-dev-test-intelligence-0.0.1.tgz",
        sha256: "tar123",
      },
    },
  });

  assert.deepStrictEqual(report, {
    generatedAt: "2026-04-17T00:00:00.000Z",
    dist: {
      reproducible: true,
      files: [{ file: "dist/index.js", sha256: "abc123" }],
    },
    tarball: {
      reproducible: true,
      first: {
        file: "oscharko-dev-test-intelligence-0.0.1.tgz",
        sha256: "tar123",
      },
      second: {
        file: "oscharko-dev-test-intelligence-0.0.1.tgz",
        sha256: "tar123",
      },
    },
  });
});

test("assertReproducibleIterations passes when both iterations match", () => {
  assert.doesNotThrow(() =>
    assertReproducibleIterations(
      {
        distHashes: [{ file: "dist/index.js", sha256: "dist123" }],
        tarball: {
          file: "oscharko-dev-test-intelligence-0.0.1.tgz",
          sha256: "tar123",
        },
      },
      {
        distHashes: [{ file: "dist/index.js", sha256: "dist123" }],
        tarball: {
          file: "oscharko-dev-test-intelligence-0.0.1.tgz",
          sha256: "tar123",
        },
      },
    ),
  );
});

test("assertReproducibleIterations rejects dist hash mismatches", () => {
  assert.throws(
    () =>
      assertReproducibleIterations(
        {
          distHashes: [{ file: "dist/index.js", sha256: "dist123" }],
          tarball: {
            file: "oscharko-dev-test-intelligence-0.0.1.tgz",
            sha256: "tar123",
          },
        },
        {
          distHashes: [{ file: "dist/index.js", sha256: "dist456" }],
          tarball: {
            file: "oscharko-dev-test-intelligence-0.0.1.tgz",
            sha256: "tar123",
          },
        },
      ),
    /Dist hashes differ between consecutive clean iterations/,
  );
});

test("assertReproducibleIterations rejects tarball hash mismatches", () => {
  assert.throws(
    () =>
      assertReproducibleIterations(
        {
          distHashes: [{ file: "dist/index.js", sha256: "dist123" }],
          tarball: {
            file: "oscharko-dev-test-intelligence-0.0.1.tgz",
            sha256: "tar123",
          },
        },
        {
          distHashes: [{ file: "dist/index.js", sha256: "dist123" }],
          tarball: {
            file: "oscharko-dev-test-intelligence-0.0.1.tgz",
            sha256: "tar456",
          },
        },
      ),
    /Tarball hashes differ between consecutive clean iterations/,
  );
});
