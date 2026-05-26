/**
 * Tests for the container ENTRYPOINT module.
 *
 * The entrypoint is the PID-1 process for the container image (#30). It owns
 * env-var parsing, logger construction, server start, and graceful SIGTERM /
 * SIGINT shutdown — concerns that do not belong on the operator CLI from
 * #20. These tests exercise the parsing surface and the bootstrap as a
 * unit; the end-to-end container smoke (real port bind, real `/healthz`)
 * runs in `.github/workflows/docker-build.yml`.
 */

import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import {
  CONTAINER_HELP_TEXT,
  isContainerHelpFlag,
  isEntryMatchingModuleUrl,
  parseServerEntrypointConfig,
  renderContainerHelp,
  ServerEntrypointConfigError,
} from "./server-entrypoint.js";

const baseEnv: NodeJS.ProcessEnv = {};

void describe("parseServerEntrypointConfig", () => {
  void test("returns container-appropriate defaults when env is empty", () => {
    const config = parseServerEntrypointConfig(baseEnv);
    assert.equal(config.host, "0.0.0.0");
    assert.equal(config.port, 1983);
    assert.equal(config.requestsPerMinute, 60);
    assert.deepEqual(config.allowedCorsOrigins, []);
    assert.equal(config.bearerToken, undefined);
    assert.equal(config.logFormat, "json");
    assert.equal(config.logLabel, "test-intelligence");
  });

  void test("honours TEST_INTELLIGENCE_HOST when provided", () => {
    const config = parseServerEntrypointConfig({
      ...baseEnv,
      TEST_INTELLIGENCE_HOST: "127.0.0.1",
    });
    assert.equal(config.host, "127.0.0.1");
  });

  void test("honours TEST_INTELLIGENCE_PORT when provided", () => {
    const config = parseServerEntrypointConfig({
      ...baseEnv,
      TEST_INTELLIGENCE_PORT: "8443",
    });
    assert.equal(config.port, 8443);
  });

  void test("rejects a non-numeric port", () => {
    assert.throws(
      () =>
        parseServerEntrypointConfig({
          ...baseEnv,
          TEST_INTELLIGENCE_PORT: "abc",
        }),
      ServerEntrypointConfigError,
    );
  });

  void test("rejects a negative port", () => {
    assert.throws(
      () =>
        parseServerEntrypointConfig({
          ...baseEnv,
          TEST_INTELLIGENCE_PORT: "-1",
        }),
      ServerEntrypointConfigError,
    );
  });

  void test("rejects a port above the IANA maximum", () => {
    assert.throws(
      () =>
        parseServerEntrypointConfig({
          ...baseEnv,
          TEST_INTELLIGENCE_PORT: "65536",
        }),
      ServerEntrypointConfigError,
    );
  });

  void test("accepts port 0 for ephemeral binding", () => {
    const config = parseServerEntrypointConfig({
      ...baseEnv,
      TEST_INTELLIGENCE_PORT: "0",
    });
    assert.equal(config.port, 0);
  });

  void test("honours TEST_INTELLIGENCE_REQUESTS_PER_MINUTE", () => {
    const config = parseServerEntrypointConfig({
      ...baseEnv,
      TEST_INTELLIGENCE_REQUESTS_PER_MINUTE: "30",
    });
    assert.equal(config.requestsPerMinute, 30);
  });

  void test("rejects a non-positive requests-per-minute", () => {
    assert.throws(
      () =>
        parseServerEntrypointConfig({
          ...baseEnv,
          TEST_INTELLIGENCE_REQUESTS_PER_MINUTE: "0",
        }),
      ServerEntrypointConfigError,
    );
  });

  void test("rejects a malformed requests-per-minute", () => {
    assert.throws(
      () =>
        parseServerEntrypointConfig({
          ...baseEnv,
          TEST_INTELLIGENCE_REQUESTS_PER_MINUTE: "many",
        }),
      ServerEntrypointConfigError,
    );
  });

  void test("parses comma-separated CORS origins, trimming whitespace and dropping empties", () => {
    const config = parseServerEntrypointConfig({
      ...baseEnv,
      TEST_INTELLIGENCE_CORS_ORIGINS:
        " https://a.example , https://b.example ,, ",
    });
    assert.deepEqual(config.allowedCorsOrigins, [
      "https://a.example",
      "https://b.example",
    ]);
  });

  void test("returns an empty CORS list when the env var is set to whitespace", () => {
    const config = parseServerEntrypointConfig({
      ...baseEnv,
      TEST_INTELLIGENCE_CORS_ORIGINS: "   ",
    });
    assert.deepEqual(config.allowedCorsOrigins, []);
  });

  void test("captures TEST_INTELLIGENCE_BEARER_TOKEN when set", () => {
    const config = parseServerEntrypointConfig({
      ...baseEnv,
      TEST_INTELLIGENCE_BEARER_TOKEN: "secret-token",
    });
    assert.equal(config.bearerToken, "secret-token");
  });

  void test("ignores an empty bearer token (operators clear via unset)", () => {
    const config = parseServerEntrypointConfig({
      ...baseEnv,
      TEST_INTELLIGENCE_BEARER_TOKEN: "",
    });
    assert.equal(config.bearerToken, undefined);
  });

  void test("honours TEST_INTELLIGENCE_LOG_FORMAT=text", () => {
    const config = parseServerEntrypointConfig({
      ...baseEnv,
      TEST_INTELLIGENCE_LOG_FORMAT: "text",
    });
    assert.equal(config.logFormat, "text");
  });

  void test("rejects an unknown TEST_INTELLIGENCE_LOG_FORMAT", () => {
    assert.throws(
      () =>
        parseServerEntrypointConfig({
          ...baseEnv,
          TEST_INTELLIGENCE_LOG_FORMAT: "xml",
        }),
      ServerEntrypointConfigError,
    );
  });
});

void describe("isContainerHelpFlag", () => {
  void test("recognises the canonical help flags", () => {
    assert.equal(isContainerHelpFlag(["--help"]), true);
    assert.equal(isContainerHelpFlag(["-h"]), true);
    assert.equal(isContainerHelpFlag(["help"]), true);
  });

  void test("returns false for non-help arguments", () => {
    assert.equal(isContainerHelpFlag([]), false);
    assert.equal(isContainerHelpFlag(["start"]), false);
    assert.equal(isContainerHelpFlag(["--verbose"]), false);
  });
});

void describe("renderContainerHelp", () => {
  void test("returns a non-empty help string mentioning the container envs", () => {
    const text = renderContainerHelp();
    assert.ok(text.length > 0);
    assert.equal(text, CONTAINER_HELP_TEXT);
    assert.ok(text.includes("TEST_INTELLIGENCE_HOST"));
    assert.ok(text.includes("TEST_INTELLIGENCE_PORT"));
    assert.ok(text.includes("/healthz"));
  });
});

void describe("ServerEntrypointConfigError", () => {
  void test("carries the offending env-var name", () => {
    try {
      parseServerEntrypointConfig({
        ...baseEnv,
        TEST_INTELLIGENCE_PORT: "abc",
      });
      assert.fail("expected throw");
    } catch (error) {
      assert.ok(error instanceof ServerEntrypointConfigError);
      assert.equal(error.envName, "TEST_INTELLIGENCE_PORT");
      assert.ok(error.message.includes("TEST_INTELLIGENCE_PORT"));
    }
  });
});

void describe("isEntryMatchingModuleUrl", () => {
  void test("returns false when the entry argv is undefined", () => {
    assert.equal(
      isEntryMatchingModuleUrl({
        entry: undefined,
        moduleUrl: "file:///opt/x.js",
      }),
      false,
    );
  });

  void test("returns false when the entry path does not exist on disk", () => {
    assert.equal(
      isEntryMatchingModuleUrl({
        entry: "/nonexistent/does/not/exist/file.js",
        moduleUrl: "file:///nonexistent/does/not/exist/file.js",
      }),
      false,
    );
  });

  void test("returns true when entry and module URL refer to the same realpath", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "ti-entry-")));
    const target = join(dir, "entry.js");
    writeFileSync(target, "// stub\n");
    assert.equal(
      isEntryMatchingModuleUrl({
        entry: target,
        moduleUrl: pathToFileURL(target).href,
      }),
      true,
    );
  });

  void test("resolves symlinked entry paths so import.meta.url matches", () => {
    // Reproduces the macOS /tmp -> /private/tmp symlink trap where
    // `process.argv[1]` and `import.meta.url` would otherwise diverge.
    const realDir = realpathSync(mkdtempSync(join(tmpdir(), "ti-real-")));
    const target = join(realDir, "entry.js");
    writeFileSync(target, "// stub\n");

    const linkDir = realpathSync(mkdtempSync(join(tmpdir(), "ti-link-")));
    const linkedEntry = join(linkDir, "linked-entry.js");
    symlinkSync(target, linkedEntry);

    // moduleUrl is the realpath URL (what Node would set for import.meta.url);
    // entry is the symlink path (what process.argv[1] sees when invoked
    // via the symlink). Without realpath normalisation the two would not match.
    assert.equal(
      isEntryMatchingModuleUrl({
        entry: linkedEntry,
        moduleUrl: pathToFileURL(target).href,
      }),
      true,
    );
  });

  void test("returns false when the entry resolves to a different file", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "ti-mismatch-")));
    const a = join(dir, "a.js");
    const b = join(dir, "b.js");
    writeFileSync(a, "// a\n");
    writeFileSync(b, "// b\n");
    assert.equal(
      isEntryMatchingModuleUrl({
        entry: a,
        moduleUrl: pathToFileURL(b).href,
      }),
      false,
    );
  });
});
