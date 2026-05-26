import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  findViolationsInLine,
  hasIncludedExtension,
  hasTestSuffix,
  isSafeDestination,
  isTelemetryAllowlistedFile,
  resolveDefaultScanRoots,
} from "./check-no-telemetry.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

void describe("hasIncludedExtension", () => {
  void it("includes .ts/.tsx/.js/.mjs", () => {
    assert.equal(hasIncludedExtension("a.ts"), true);
    assert.equal(hasIncludedExtension("a.tsx"), true);
    assert.equal(hasIncludedExtension("a.js"), true);
    assert.equal(hasIncludedExtension("a.mjs"), true);
  });

  void it("excludes other extensions", () => {
    assert.equal(hasIncludedExtension("a.md"), false);
    assert.equal(hasIncludedExtension("a.json"), false);
  });
});

void describe("hasTestSuffix", () => {
  void it("matches .test.* and .spec.*", () => {
    assert.equal(hasTestSuffix("foo.test.ts"), true);
    assert.equal(hasTestSuffix("foo.spec.tsx"), true);
    assert.equal(hasTestSuffix("foo.test.mjs"), true);
  });

  void it("returns false for plain files", () => {
    assert.equal(hasTestSuffix("foo.ts"), false);
  });
});

void describe("isSafeDestination", () => {
  void it("permits api.figma.com and *.figma.com", () => {
    assert.equal(isSafeDestination("https://api.figma.com/v1/files/abc"), true);
    assert.equal(isSafeDestination("https://w.figma.com/x"), true);
  });

  void it("permits loopback addresses", () => {
    assert.equal(isSafeDestination("http://localhost:8080/x"), true);
    assert.equal(isSafeDestination("http://127.0.0.1/x"), true);
  });

  void it("rejects substring-spoofed hostnames", () => {
    assert.equal(
      isSafeDestination("https://evilfigma.com.attacker.net/x"),
      false,
    );
    assert.equal(isSafeDestination("https://figma.com.evil/x"), false);
  });

  void it("rejects unrelated hosts", () => {
    assert.equal(isSafeDestination("https://api.posthog.com/capture"), false);
  });

  void it("returns false for malformed URLs", () => {
    assert.equal(isSafeDestination("not a url"), false);
  });
});

void describe("isTelemetryAllowlistedFile", () => {
  void it("allows the audited production-runner-events file", () => {
    assert.equal(
      isTelemetryAllowlistedFile(
        "packages/production-runner/src/production-runner-events.ts",
      ),
      true,
    );
  });

  void it("allows the guard script itself", () => {
    assert.equal(
      isTelemetryAllowlistedFile("scripts/check-no-telemetry.mjs"),
      true,
    );
  });

  void it("rejects arbitrary paths", () => {
    assert.equal(isTelemetryAllowlistedFile("src/somewhere/else.ts"), false);
  });
});

void describe("resolveDefaultScanRoots", () => {
  void it("covers extracted packages, root src, and scripts", async () => {
    const roots = (await resolveDefaultScanRoots()).map((root) =>
      root.path.split(path.sep).join("/"),
    );
    const rootSrc = path.join(repoRoot, "src").split(path.sep).join("/");

    assert.equal(roots.includes(rootSrc), true);
    assert.equal(
      roots.some((root) => root.endsWith("/packages/core-engine/src")),
      true,
    );
    assert.equal(
      roots.some((root) => root.endsWith("/packages/server/src")),
      true,
    );
    assert.equal(roots.some((root) => root.endsWith("/apps/ui/src")), false);
    assert.equal(roots.some((root) => root.endsWith("/scripts")), true);
    assert.equal(roots.some((root) => root.includes("/ui-src/src")), false);
  });
});

void describe("findViolationsInLine", () => {
  void it("flags a vendor import (posthog)", () => {
    const r = findViolationsInLine('import posthog from "posthog-js";');
    assert.deepEqual(r, ["vendor-import"]);
  });

  void it("flags a vendor endpoint", () => {
    const r = findViolationsInLine(
      'const url = "https://api.segment.io/v1/track";',
    );
    assert.deepEqual(r, ["vendor-endpoint"]);
  });

  void it("flags fetch() to a telemetry URL", () => {
    const r = findViolationsInLine(
      'fetch("https://collector.example.com/track");',
    );
    assert.deepEqual(r, ["fetch-telemetry-url"]);
  });

  void it("allows fetch() to a safe destination", () => {
    const r = findViolationsInLine('fetch("http://localhost:8080/track")');
    assert.deepEqual(r, []);
  });

  void it("flags sendBeacon to unsafe URL", () => {
    const r = findViolationsInLine(
      'navigator.sendBeacon("https://analytics.example.com/beacon");',
    );
    assert.deepEqual(r, ["send-beacon"]);
  });

  void it("flags new XMLHttpRequest", () => {
    const r = findViolationsInLine("const x = new XMLHttpRequest();");
    assert.deepEqual(r, ["xhr-new"]);
  });

  void it("flags WebSocket to a telemetry URL", () => {
    const r = findViolationsInLine(
      'const ws = new WebSocket("wss://collector.example.com/socket");',
    );
    assert.deepEqual(r, ["websocket-telemetry-url"]);
  });

  void it("returns no findings on a clean line", () => {
    assert.deepEqual(findViolationsInLine("export const X = 42;"), []);
  });
});
