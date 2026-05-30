// @vitest-environment node
import { randomUUID } from "node:crypto";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { register } from "../instrumentation";
import {
  getWorkbenchStorage,
  resetWorkbenchStorageForTests,
} from "@/lib/server/storage/bootstrap";
import { resolveWorkbenchStoragePaths } from "@/lib/server/storage/db-path";
import { resetLegacyIndexForTests } from "@/lib/server/workbench-legacy-indexer";

describe("Workbench instrumentation startup", () => {
  let root: string;

  beforeEach(() => {
    root = path.join(tmpdir(), `ti-instrumentation-${randomUUID()}`);
    resetWorkbenchStorageForTests();
    resetLegacyIndexForTests();
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("WORKBENCH_REPO_ROOT", root);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetWorkbenchStorageForTests();
    resetLegacyIndexForTests();
    rmSync(root, { recursive: true, force: true });
  });

  it("creates and primes the local database during Node startup", async () => {
    const paths = resolveWorkbenchStoragePaths(process.env);
    expect(existsSync(paths.databaseFile)).toBe(false);

    await register();

    expect(existsSync(paths.databaseFile)).toBe(true);
    expect(getWorkbenchStorage().getSchemaVersion()).toBeGreaterThan(0);
  });

  it("logs a sanitized bootstrap failure and skips dependent startup work", async () => {
    writeFileSync(root, "not-a-directory", "utf8");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await register();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const message = String(errorSpy.mock.calls[0]?.[0] ?? "");
    expect(message).toContain("Local storage bootstrap failed");
    expect(message).toContain("WorkbenchStorageError:MIGRATION_FAILED");
    expect(message).not.toContain(root);
    expect(message).not.toContain(".test-intelligence");
  });
});
