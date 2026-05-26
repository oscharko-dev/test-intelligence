#!/usr/bin/env node

/**
 * Zero-telemetry guard for the standalone repository.
 *
 * Scans the engine `src/`, every `packages/<name>/src/`, and `scripts/`
 * for known telemetry vendor imports, vendor endpoints, and generic browser telemetry primitives
 * (fetch/sendBeacon/XMLHttpRequest/WebSocket) to telemetry-shaped URLs.
 *
 * Scoped to the standalone package, which has no sub-templates.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");

const requiredScanRoot = (relativePath) => ({
  path: path.resolve(packageRoot, relativePath),
  required: true,
});

const toScanRoot = (root) =>
  typeof root === "string" ? { path: root, required: false } : root;

const toRelativePosixPath = (filePath) =>
  path.relative(packageRoot, filePath).split(path.sep).join("/");

const discoverPackageSrcRoots = async () => {
  const packagesRoot = path.resolve(packageRoot, "packages");
  const entries = await readdir(packagesRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      path: path.join(packagesRoot, entry.name, "src"),
      required: true,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
};

export const resolveDefaultScanRoots = async () => [
  requiredScanRoot("src"),
  ...(await discoverPackageSrcRoots()),
  requiredScanRoot("scripts"),
];

const INCLUDE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs"]);
const TEST_FILE_SUFFIXES = [
  ".test.ts",
  ".test.tsx",
  ".test.js",
  ".test.mjs",
  ".spec.ts",
  ".spec.tsx",
  ".spec.js",
  ".spec.mjs",
];
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
]);

const TELEMETRY_IMPORT_PATTERNS = [
  /from\s+["']posthog-js["']/,
  /from\s+["']@sentry\//,
  /from\s+["']mixpanel/,
  /from\s+["']amplitude/,
  /from\s+["']segment/,
  /from\s+["']@datadog\/browser-rum/,
];

const TELEMETRY_ENDPOINT_PATTERNS = [
  /https:\/\/api\.segment\.io/i,
  /https:\/\/app\.posthog\.com/i,
  /https:\/\/o\d+\.ingest\.sentry\.io/i,
  /https:\/\/api2?\.amplitude\.com/i,
];

const FETCH_CALL_PATTERN = /\bfetch\s*\(/;
const TELEMETRY_URL_IN_STRING_PATTERN =
  /["'`]https?:\/\/[^"'`\s]*(track|telemetry|analytics|event|metrics|collector|beacon)[^"'`\s]*["'`]/i;
const SEND_BEACON_PATTERN = /\.sendBeacon\s*\(/;
const XHR_NEW_PATTERN = /\bnew\s+XMLHttpRequest\b/;
const XHR_OPEN_PATTERN = /\.open\s*\(/;
const WEBSOCKET_NEW_PATTERN = /\bnew\s+WebSocket\s*\(/;
const WEBSOCKET_TELEMETRY_URL_PATTERN =
  /["'`]wss?:\/\/[^"'`\s]*(track|telemetry|analytics|event|metrics|collector|beacon)[^"'`\s]*["'`]/i;

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);
const URL_LITERAL_PATTERN = /["'`]((?:https?|wss?):\/\/[^"'`\s]+)["'`]/gi;

// File-level allowlist. Paths are package-root-relative POSIX-style. Every
// entry has a comment explaining the audited exemption.
const ALLOWED_FILES = new Set([
  // Issue #1945: operator-supplied OpenTelemetry sink. The runner only emits
  // spans/counters when the caller injects a tracer or meter; no exporter or
  // network transport is created automatically.
  "packages/production-runner/src/production-runner-events.ts",
  // Guard itself; must not be scanned.
  "scripts/check-no-telemetry.mjs",
]);

export const isTelemetryAllowlistedFile = (relativePath) =>
  ALLOWED_FILES.has(relativePath);

export const hasTestSuffix = (fileName) =>
  TEST_FILE_SUFFIXES.some((suffix) => fileName.endsWith(suffix));

export const hasIncludedExtension = (fileName) =>
  INCLUDE_EXTENSIONS.has(path.extname(fileName));

const collectFiles = async (scanRoot) => {
  const { path: dir, required } = toScanRoot(scanRoot);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      if (required) {
        throw new Error(
          `required scan root is missing: ${toRelativePosixPath(dir)}`,
        );
      }
      return [];
    }
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      files.push(...(await collectFiles(fullPath)));
      continue;
    }
    if (!entry.isFile() || !hasIncludedExtension(entry.name)) continue;
    if (hasTestSuffix(entry.name)) continue;
    files.push(fullPath);
  }
  return files;
};

export const isSafeDestination = (urlString) => {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return false;
  }
  const hostname = url.hostname;
  if (hostname === "api.figma.com" || hostname.endsWith(".figma.com"))
    return true;
  if (LOOPBACK_HOSTNAMES.has(hostname)) return true;
  return false;
};

const extractUrlLiterals = (line) => {
  const urls = [];
  for (const match of line.matchAll(URL_LITERAL_PATTERN)) {
    urls.push(match[1]);
  }
  return urls;
};

const lineUrlsAllSafe = (line) => {
  const urls = extractUrlLiterals(line);
  if (urls.length === 0) return false;
  return urls.every((url) => isSafeDestination(url));
};

export const findViolationsInLine = (line) => {
  const findings = [];

  for (const pattern of TELEMETRY_IMPORT_PATTERNS) {
    if (pattern.test(line)) {
      findings.push("vendor-import");
      break;
    }
  }
  for (const pattern of TELEMETRY_ENDPOINT_PATTERNS) {
    if (pattern.test(line)) {
      findings.push("vendor-endpoint");
      break;
    }
  }

  if (
    FETCH_CALL_PATTERN.test(line) &&
    TELEMETRY_URL_IN_STRING_PATTERN.test(line) &&
    !lineUrlsAllSafe(line)
  ) {
    findings.push("fetch-telemetry-url");
  }

  if (SEND_BEACON_PATTERN.test(line) && !lineUrlsAllSafe(line)) {
    findings.push("send-beacon");
  }

  if (XHR_NEW_PATTERN.test(line)) {
    findings.push("xhr-new");
  } else if (
    XHR_OPEN_PATTERN.test(line) &&
    TELEMETRY_URL_IN_STRING_PATTERN.test(line) &&
    !lineUrlsAllSafe(line)
  ) {
    findings.push("xhr-open-telemetry-url");
  }

  if (
    WEBSOCKET_NEW_PATTERN.test(line) &&
    (WEBSOCKET_TELEMETRY_URL_PATTERN.test(line) ||
      TELEMETRY_URL_IN_STRING_PATTERN.test(line)) &&
    !lineUrlsAllSafe(line)
  ) {
    findings.push("websocket-telemetry-url");
  }

  return findings;
};

const toRelativePosix = toRelativePosixPath;

export const runNoTelemetry = async ({
  scanRoots,
  stdout = console.log,
  stderr = console.error,
} = {}) => {
  try {
    const resolvedScanRoots =
      scanRoots === undefined
        ? await resolveDefaultScanRoots()
        : scanRoots.map(toScanRoot);
    const fileLists = await Promise.all(
      resolvedScanRoots.map((root) => collectFiles(root)),
    );
    const files = fileLists.flat();
    const violations = [];

    for (const filePath of files) {
      const relativePath = toRelativePosix(filePath);
      if (isTelemetryAllowlistedFile(relativePath)) continue;
      const content = await readFile(filePath, "utf8");
      const lines = content.split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        const findings = findViolationsInLine(line);
        for (const reason of findings) {
          violations.push({
            file: relativePath,
            line: index + 1,
            reason,
            content: line.trim(),
          });
        }
      }
    }

    if (violations.length > 0) {
      stderr(
        `[no-telemetry] Zero-telemetry guard failed. ${violations.length} finding(s):`,
      );
      for (const v of violations) {
        stderr(` - ${v.file}:${v.line} [${v.reason}] ${v.content}`);
      }
      return 1;
    }

    stdout(
      `[no-telemetry] Passed. Scanned ${files.length} file(s) across ${resolvedScanRoots.length} root(s).`,
    );
    return 0;
  } catch (error) {
    stderr(
      `[no-telemetry] Failed: ${error instanceof Error ? error.message : error}`,
    );
    return 1;
  }
};

const isCliEntry = () => {
  const entryPath = process.argv[1];
  return (
    typeof entryPath === "string" &&
    path.resolve(entryPath) === fileURLToPath(import.meta.url)
  );
};

if (isCliEntry()) {
  const exitCode = await runNoTelemetry();
  process.exit(exitCode);
}
