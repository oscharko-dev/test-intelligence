import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  extractHosts,
  normalizeHosts,
  parseArgs,
  resolveAllowedHosts,
  runLockfileHostAllowlist,
} from "./check-lockfile-hosts.mjs";

const fakeReader = (contentByPath) => async (lockfilePath) => {
  const content = contentByPath.get(lockfilePath);
  if (typeof content !== "string") {
    throw new Error(`No fake content for ${lockfilePath}`);
  }
  return content;
};

void describe("normalizeHosts", () => {
  void it("accepts comma-separated and trims", () => {
    assert.deepEqual(
      normalizeHosts(["registry.npmjs.org, example.com"], "--allow-hosts"),
      ["example.com", "registry.npmjs.org"],
    );
  });

  void it("rejects empty entries", () => {
    assert.throws(
      () => normalizeHosts([",foo.com"], "--allow-hosts"),
      /empty host entries/,
    );
  });

  void it("rejects malformed hosts", () => {
    assert.throws(
      () => normalizeHosts(["-bad.com"], "--allow-hosts"),
      /malformed host/,
    );
  });
});

void describe("parseArgs", () => {
  void it("returns no override by default", () => {
    assert.deepEqual(parseArgs([]), {
      hasOverride: false,
      overrideHosts: null,
    });
  });

  void it("parses --allow-hosts <value>", () => {
    assert.deepEqual(parseArgs(["--allow-hosts", "registry.npmjs.org"]), {
      hasOverride: true,
      overrideHosts: ["registry.npmjs.org"],
    });
  });

  void it("parses --allow-hosts=<value>", () => {
    assert.deepEqual(parseArgs(["--allow-hosts=registry.npmjs.org"]), {
      hasOverride: true,
      overrideHosts: ["registry.npmjs.org"],
    });
  });

  void it("rejects unknown flags", () => {
    assert.throws(() => parseArgs(["--bogus"]), /Unknown flag/);
  });

  void it("rejects positional arguments", () => {
    assert.throws(
      () => parseArgs(["registry"]),
      /Unexpected positional argument/,
    );
  });

  void it("requires a value for --allow-hosts", () => {
    assert.throws(() => parseArgs(["--allow-hosts"]), /Missing value/);
    assert.throws(
      () => parseArgs(["--allow-hosts", "--other"]),
      /Missing value/,
    );
  });
});

void describe("resolveAllowedHosts", () => {
  void it("defaults to registry.npmjs.org", () => {
    assert.deepEqual([...resolveAllowedHosts(null)], ["registry.npmjs.org"]);
  });

  void it("uses override when provided", () => {
    assert.deepEqual(
      [...resolveAllowedHosts(["example.com"])],
      ["example.com"],
    );
  });
});

void describe("extractHosts", () => {
  void it("extracts host from tarball:", () => {
    const hosts = extractHosts(
      "  tarball: https://registry.npmjs.org/zod/-/zod-4.4.2.tgz\n",
    );
    assert.deepEqual([...hosts], ["registry.npmjs.org"]);
  });

  void it("extracts host from resolved:", () => {
    const hosts = extractHosts(
      '  resolved: "https://registry.npmjs.org/x/-/x-1.tgz"\n',
    );
    assert.deepEqual([...hosts], ["registry.npmjs.org"]);
  });

  void it("extracts hosts from inline resolution: { ... }", () => {
    const hosts = extractHosts(
      "  resolution: { integrity: sha512-foo, tarball: https://r.example.org/x-1.tgz }\n",
    );
    assert.deepEqual([...hosts], ["r.example.org"]);
  });

  void it("rejects malformed URL-like content", () => {
    assert.throws(
      () => extractHosts("  resolved: https:// \n"),
      /Malformed URL-like resolver content/,
    );
  });

  void it("handles git+https:// specifiers", () => {
    const hosts = extractHosts(
      '  resolved: "git+https://github.com/foo/bar.git#abc"\n',
    );
    assert.deepEqual([...hosts], ["github.com"]);
  });
});

void describe("runLockfileHostAllowlist", () => {
  const okLockfile =
    "lockfileVersion: '9.0'\n" +
    "packages:\n" +
    "  /zod@4.4.2:\n" +
    "    resolution: {integrity: sha512-x, tarball: https://registry.npmjs.org/zod/-/zod-4.4.2.tgz}\n";

  void it("returns 0 when all hosts are allowed", async () => {
    let outBuf = "";
    let errBuf = "";
    const exitCode = await runLockfileHostAllowlist({
      args: [],
      env: {},
      lockfilePaths: ["/fake/pnpm-lock.yaml"],
      readTextFile: fakeReader(new Map([["/fake/pnpm-lock.yaml", okLockfile]])),
      stdout: (line) => {
        outBuf += `${line}\n`;
      },
      stderr: (line) => {
        errBuf += `${line}\n`;
      },
    });
    assert.equal(exitCode, 0, `stderr=${errBuf}`);
    assert.match(outBuf, /registry\.npmjs\.org/);
  });

  void it("returns 1 when a forbidden host is observed", async () => {
    const badLockfile =
      "packages:\n" +
      "  /evil@1.0.0:\n" +
      "    resolution: {tarball: http://localhost:8080/evil/-/evil-1.0.0.tgz}\n";
    let errBuf = "";
    const exitCode = await runLockfileHostAllowlist({
      args: [],
      env: {},
      lockfilePaths: ["/fake/pnpm-lock.yaml"],
      readTextFile: fakeReader(
        new Map([["/fake/pnpm-lock.yaml", badLockfile]]),
      ),
      stdout: () => {},
      stderr: (line) => {
        errBuf += `${line}\n`;
      },
    });
    assert.equal(exitCode, 1);
    assert.match(errBuf, /Unexpected hosts/);
    assert.match(errBuf, /localhost/);
  });

  void it("refuses CLI override under GITHUB_ACTIONS=true", async () => {
    let errBuf = "";
    const exitCode = await runLockfileHostAllowlist({
      args: ["--allow-hosts=registry.npmjs.org,evil.example.com"],
      env: { GITHUB_ACTIONS: "true" },
      lockfilePaths: ["/fake/pnpm-lock.yaml"],
      readTextFile: fakeReader(new Map([["/fake/pnpm-lock.yaml", okLockfile]])),
      stdout: () => {},
      stderr: (line) => {
        errBuf += `${line}\n`;
      },
    });
    assert.equal(exitCode, 1);
    assert.match(errBuf, /CLI host overrides are refused in GitHub Actions/);
  });

  void it("allows CLI override locally", async () => {
    const lockfile =
      "packages:\n" +
      "  /x@1.0.0:\n" +
      "    resolution: {tarball: https://r.example.org/x/-/x-1.0.0.tgz}\n";
    const exitCode = await runLockfileHostAllowlist({
      args: ["--allow-hosts=r.example.org"],
      env: {},
      lockfilePaths: ["/fake/pnpm-lock.yaml"],
      readTextFile: fakeReader(new Map([["/fake/pnpm-lock.yaml", lockfile]])),
      stdout: () => {},
      stderr: () => {},
    });
    assert.equal(exitCode, 0);
  });

  void it("returns 1 on a malformed lockfile (fail-closed)", async () => {
    let errBuf = "";
    const exitCode = await runLockfileHostAllowlist({
      args: [],
      env: {},
      lockfilePaths: ["/fake/pnpm-lock.yaml"],
      readTextFile: fakeReader(
        new Map([["/fake/pnpm-lock.yaml", "  resolved: https:// \n"]]),
      ),
      stdout: () => {},
      stderr: (line) => {
        errBuf += `${line}\n`;
      },
    });
    assert.equal(exitCode, 1);
    assert.match(errBuf, /Malformed URL-like resolver content/);
  });
});
