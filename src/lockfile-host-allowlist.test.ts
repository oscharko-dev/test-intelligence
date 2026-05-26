import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// The standalone package has a single tracked `pnpm-lock.yaml`. Tests cover:
//
//   - extractHosts() unit cases (tarball / standalone resolution / resolved /
//     repository / git+https specifiers, malformed-URL fail-closed, nested
//     query-string URL parsing).
//   - runLockfileHostAllowlist() helper-mode cases (allowed/rejected hosts,
//     CLI override forms, GitHub Actions refusal).
//   - CLI shape cases (unknown flag, malformed host value, empty entry).

const MODULE_DIR =
  typeof __dirname === "string"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(MODULE_DIR, "..");
const scriptPath = path.resolve(
  packageRoot,
  "scripts/check-lockfile-hosts.mjs",
);
const scriptModule = (await import(pathToFileURL(scriptPath).href)) as {
  extractHosts: (content: string) => Set<string>;
  runLockfileHostAllowlist: (options: {
    args?: string[];
    env?: NodeJS.ProcessEnv;
    lockfilePaths?: string[];
    readTextFile?: (filePath: string, encoding: string) => Promise<string>;
    stdout?: (line: string) => void;
    stderr?: (line: string) => void;
  }) => Promise<number>;
};
const { extractHosts, runLockfileHostAllowlist } = scriptModule;

const createLockfileFromEntries = (entries: string[]): string => {
  return `lockfileVersion: '9.0'\n\npackages:\n${entries.join("")}`;
};

const createLockfile = (hosts: string[]): string => {
  const entries = hosts.map((host, index) => {
    const dependencyName = `fixture-${index + 1}`;
    return `  ${dependencyName}@1.0.0:\n    resolution: {integrity: sha512-${index + 1}, tarball: https://${host}/${dependencyName}-${index + 1}.tgz}\n`;
  });

  return createLockfileFromEntries(entries);
};

const runCliCheck = async ({
  args = [],
  env = {},
  lockfilePath,
}: {
  args?: string[];
  env?: NodeJS.ProcessEnv;
  lockfilePath?: string;
}): Promise<{ code: number; stdout: string; stderr: string }> => {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: lockfilePath ?? packageRoot,
      env: {
        ...process.env,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (signal) {
        reject(
          new Error(`check-lockfile-hosts exited via signal '${signal}'.`),
        );
        return;
      }
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
};

const runHelperCheck = async ({
  args = [],
  env = {},
  rootHosts = ["registry.npmjs.org"],
  rootContent,
  readTextFile,
}: {
  args?: string[];
  env?: NodeJS.ProcessEnv;
  rootHosts?: string[];
  rootContent?: string;
  readTextFile?: (filePath: string, encoding: string) => Promise<string>;
}): Promise<{ code: number; stdout: string; stderr: string }> => {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const lockfilePath = "/virtual/pnpm-lock.yaml";
  const lockfileContent = rootContent ?? createLockfile(rootHosts);

  const code = await runLockfileHostAllowlist({
    args,
    env: {
      ...process.env,
      ...env,
    },
    lockfilePaths: [lockfilePath],
    readTextFile:
      readTextFile ??
      (async (filePath: string) => {
        if (filePath !== lockfilePath) {
          throw new Error(`Unexpected lockfile path: ${filePath}`);
        }
        return lockfileContent;
      }),
    stdout: (line: string) => {
      stdoutLines.push(line);
    },
    stderr: (line: string) => {
      stderrLines.push(line);
    },
  });

  return {
    code,
    stdout: stdoutLines.length > 0 ? `${stdoutLines.join("\n")}\n` : "",
    stderr: stderrLines.length > 0 ? `${stderrLines.join("\n")}\n` : "",
  };
};

void test("lockfile host allowlist scans the standalone repo's tracked pnpm-lock.yaml", async () => {
  const result = await runCliCheck({});

  assert.equal(
    result.code,
    0,
    `Expected success, got stderr:\n${result.stderr}`,
  );
  assert.match(
    result.stdout,
    /\[lockfile-host-allowlist\] Effective allowlist: registry\.npmjs\.org/,
  );
  assert.match(result.stdout, /\[lockfile-host-allowlist\] Passed\./);
});

void test("lockfile host allowlist passes when only registry.npmjs.org appears in the lockfile", async () => {
  const result = await runHelperCheck({
    rootHosts: ["registry.npmjs.org"],
  });

  assert.equal(
    result.code,
    0,
    `Expected success, got stderr:\n${result.stderr}`,
  );
  assert.match(result.stdout, /Passed\./);
  assert.equal(result.stderr, "");
});

void test("lockfile host allowlist fails closed when an unexpected host appears", async () => {
  const result = await runHelperCheck({
    rootHosts: ["mirror.local"],
  });

  assert.equal(
    result.code,
    1,
    `Expected failure, got stdout:\n${result.stdout}`,
  );
  assert.match(
    result.stdout,
    /\[lockfile-host-allowlist\] Effective allowlist: registry\.npmjs\.org/,
  );
  assert.match(result.stderr, /Unexpected hosts found in tracked lockfiles:/);
  assert.match(result.stderr, / - mirror\.local/);
});

void test("lockfile host allowlist accepts local CLI overrides via both supported flag forms", async () => {
  // The script refuses CLI overrides when GITHUB_ACTIONS=true (test 121
  // verifies that). This test asserts the LOCAL behaviour, so we must
  // explicitly clear GITHUB_ACTIONS — it is set on every GitHub-hosted
  // runner.
  const splitFlagResult = await runHelperCheck({
    args: [
      "--allow-hosts",
      " mirror.local , REGISTRY.NPMJS.ORG , mirror.local ",
    ],
    env: { GITHUB_ACTIONS: "" },
    rootHosts: ["mirror.local"],
  });
  const equalsFlagResult = await runHelperCheck({
    args: ["--allow-hosts=mirror.local,registry.npmjs.org"],
    env: { GITHUB_ACTIONS: "" },
    rootHosts: ["mirror.local"],
  });

  for (const result of [splitFlagResult, equalsFlagResult]) {
    assert.equal(
      result.code,
      0,
      `Expected success, got stderr:\n${result.stderr}`,
    );
    assert.match(
      result.stdout,
      /\[lockfile-host-allowlist\] Effective allowlist: mirror\.local, registry\.npmjs\.org/,
    );
    assert.match(
      result.stdout,
      /\[lockfile-host-allowlist\] Passed\. Observed hosts: mirror\.local/,
    );
    assert.equal(result.stderr, "");
  }
});

void test("lockfile host allowlist refuses CLI overrides in GitHub Actions before scanning lockfiles", async () => {
  let readCount = 0;
  const result = await runHelperCheck({
    args: ["--allow-hosts=mirror.local"],
    env: {
      GITHUB_ACTIONS: "true",
    },
    readTextFile: () => {
      readCount += 1;
      return Promise.reject(new Error("lockfile scan should not run"));
    },
  });

  assert.equal(
    result.code,
    1,
    `Expected GitHub Actions refusal, got stdout:\n${result.stdout}`,
  );
  assert.equal(readCount, 0, "Expected refusal before scanning lockfiles.");
  assert.match(
    result.stdout,
    /\[lockfile-host-allowlist\] Effective allowlist: mirror\.local/,
  );
  assert.match(
    result.stderr,
    /CLI host overrides are refused in GitHub Actions/,
  );
  assert.doesNotMatch(result.stderr, /lockfile scan should not run/);
});

void test("extractHosts surfaces tarball, standalone resolution, resolved, and repository hosts", () => {
  const content = createLockfileFromEntries([
    "  tarball-fixture@1.0.0:\n    resolution: {integrity: sha512-1, tarball: https://registry.npmjs.org/tarball-fixture-1.0.0.tgz}\n",
    "  standalone-resolution@1.0.0:\n    resolution: https://codeload.github.com/example/project/tar.gz/abcdef\n",
    "  resolved-fixture@1.0.0:\n    resolved: https://mirror.local/resolved-fixture-1.0.0.tgz\n",
    "  repository-fixture@1.0.0:\n    repository: https://repo.example.com/example/project.git\n",
    "  git-specifier-fixture@1.0.0:\n    resolution: git+https://git.example.com/example/project.git#deadbeef\n",
  ]);

  assert.deepEqual([...extractHosts(content)].sort(), [
    "codeload.github.com",
    "git.example.com",
    "mirror.local",
    "registry.npmjs.org",
    "repo.example.com",
  ]);
});

void test("extractHosts fails closed for malformed URL-like resolver content", () => {
  const content = createLockfileFromEntries([
    "  malformed-resolution@1.0.0:\n    resolution: https://\n",
  ]);

  assert.throws(
    () => extractHosts(content),
    /Malformed URL-like resolver content in resolution: https:\/\//,
  );
});

void test("extractHosts accepts inline resolver URLs whose query strings contain nested https tokens", () => {
  const content = createLockfileFromEntries([
    "  proxied-inline-resolution@1.0.0:\n    resolution: {tarball: https://proxy.example.com/fetch?url=https://registry.npmjs.org/pkg/-/pkg.tgz}\n",
  ]);

  assert.deepEqual([...extractHosts(content)], ["proxy.example.com"]);
});

void test("extractHosts fails closed for mixed inline resolver objects with malformed URL-like fragments", () => {
  const content = createLockfileFromEntries([
    "  mixed-inline-resolution@1.0.0:\n    resolution: {integrity: sha512-1, tarball: https://registry.npmjs.org/mixed-1.0.0.tgz, broken: https://}\n",
  ]);

  assert.throws(
    () => extractHosts(content),
    /Malformed URL-like resolver content in resolution: \{integrity: sha512-1, tarball: https:\/\/registry\.npmjs\.org\/mixed-1\.0\.0\.tgz, broken: https:\/\/\}/,
  );
});

void test("lockfile host allowlist fails clearly for unknown flags and malformed host values", async () => {
  const unknownFlagResult = await runHelperCheck({
    args: ["--unexpected-flag"],
  });
  const malformedHostResult = await runHelperCheck({
    args: ["--allow-hosts=https://registry.npmjs.org"],
  });
  const emptyHostEntryResult = await runHelperCheck({
    args: ["--allow-hosts=registry.npmjs.org, ,mirror.local"],
  });

  assert.equal(
    unknownFlagResult.code,
    1,
    `Expected unknown flag failure, got stdout:\n${unknownFlagResult.stdout}`,
  );
  assert.match(unknownFlagResult.stderr, /Unknown flag: --unexpected-flag/);

  assert.equal(
    malformedHostResult.code,
    1,
    `Expected malformed host failure, got stdout:\n${malformedHostResult.stdout}`,
  );
  assert.match(
    malformedHostResult.stderr,
    /--allow-hosts contains malformed host 'https:\/\/registry\.npmjs\.org'/,
  );

  assert.equal(
    emptyHostEntryResult.code,
    1,
    `Expected empty host entry failure, got stdout:\n${emptyHostEntryResult.stdout}`,
  );
  assert.match(
    emptyHostEntryResult.stderr,
    /--allow-hosts must not contain empty host entries/,
  );
});
