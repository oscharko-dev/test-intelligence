// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GET as getLegacyIndex,
  POST as postLegacyIndex,
} from "@/app/api/workbench/legacy-index/route";
import { resetWorkbenchStorageForTests } from "@/lib/server/storage/bootstrap";
import { resetLegacyIndexForTests } from "@/lib/server/workbench-legacy-indexer";

describe("legacy index API route", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(path.join(os.tmpdir(), "ti-legacy-route-"));
    vi.stubEnv("WORKBENCH_REPO_ROOT", repoRoot);
    resetWorkbenchStorageForTests();
    resetLegacyIndexForTests();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    resetWorkbenchStorageForTests();
    resetLegacyIndexForTests();
    await rm(repoRoot, { recursive: true, force: true });
  });

  it("returns the cached summary shape and refreshes it on POST without request input", async () => {
    const cached = (await (await getLegacyIndex()).json()) as {
      summary: {
        indexed: number;
        alreadyIndexed: number;
        legacyReadOnly: number;
        skipped: number;
        warnings: unknown[];
        snapshots: unknown[];
        runs: unknown[];
      };
    };
    expect(cached.summary).toMatchObject({
      indexed: 0,
      alreadyIndexed: 0,
      legacyReadOnly: 0,
      skipped: 0,
      warnings: [],
      snapshots: [],
      runs: [],
    });

    const legacyRunDir = path.join(
      repoRoot,
      ".test-intelligence",
      "local-testcases",
      "ti-workbench-route-legacy",
    );
    await mkdir(legacyRunDir, { recursive: true });
    await writeFile(
      path.join(legacyRunDir, "generated-testcases.json"),
      JSON.stringify([{ id: "tc-route" }]),
      "utf8",
    );

    const refreshed = (await (await postLegacyIndex()).json()) as {
      summary: typeof cached.summary;
    };

    expect(refreshed.summary.runs).toContainEqual({
      id: "ti-workbench-route-legacy",
      classification: "legacy-read-only",
    });
    expect(refreshed.summary.legacyReadOnly).toBe(1);
  });
});
