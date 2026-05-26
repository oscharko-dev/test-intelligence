import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  INVALID_PATH_ENCODING,
  isSafeIdSegment,
  normalizePlatformPath,
  safeDecode,
  stripTrailingSlash,
} from "./route-params.js";

void describe("safeDecode", () => {
  void test("returns decoded string on valid input", () => {
    assert.equal(safeDecode("hello%20world"), "hello world");
    assert.equal(safeDecode("plain"), "plain");
  });

  void test("returns INVALID_PATH_ENCODING on malformed sequence", () => {
    assert.equal(safeDecode("%"), INVALID_PATH_ENCODING);
    assert.equal(safeDecode("%E0%A4"), INVALID_PATH_ENCODING);
    assert.equal(safeDecode("%ZZ"), INVALID_PATH_ENCODING);
  });
});

void describe("normalizePlatformPath", () => {
  void test("rejects Windows drive-letter paths", () => {
    const result = normalizePlatformPath("C:\\Users\\op");
    assert.equal(result.ok, false);
    assert.match(result.reason, /Windows drive-letter/);
  });

  void test("rejects UNC paths", () => {
    const result = normalizePlatformPath("\\\\server\\share");
    assert.equal(result.ok, false);
    assert.match(result.reason, /UNC/);
  });

  void test("rejects absolute paths", () => {
    const result = normalizePlatformPath("/etc/passwd");
    assert.equal(result.ok, false);
    assert.match(result.reason, /Absolute/);
  });

  void test("rejects null bytes", () => {
    const result = normalizePlatformPath("foo\0bar");
    assert.equal(result.ok, false);
    assert.match(result.reason, /Null bytes/);
  });

  void test("canonicalises backslashes to forward slashes", () => {
    const result = normalizePlatformPath("a\\b\\c");
    assert.equal(result.ok, true);
    assert.equal(result.normalized, "a/b/c");
  });

  void test("passes plain relative paths through unchanged", () => {
    const result = normalizePlatformPath("a/b/c");
    assert.equal(result.ok, true);
    assert.equal(result.normalized, "a/b/c");
  });
});

void describe("isSafeIdSegment", () => {
  for (const ok of ["abc", "ABC", "0", "a_b-c.d", "a".repeat(128)]) {
    void test(`accepts ${JSON.stringify(ok)}`, () => {
      assert.equal(isSafeIdSegment(ok), true);
    });
  }

  for (const bad of [
    "",
    "a/b",
    "a b",
    "a\nb",
    "a\0b",
    "../a",
    ".",
    "..",
    "a".repeat(129),
  ]) {
    void test(`rejects ${JSON.stringify(bad)}`, () => {
      assert.equal(isSafeIdSegment(bad), false);
    });
  }
});

void describe("stripTrailingSlash", () => {
  void test("strips a single trailing slash", () => {
    assert.equal(stripTrailingSlash("/api/v1/jobs/"), "/api/v1/jobs");
  });

  void test("leaves a path without trailing slash unchanged", () => {
    assert.equal(stripTrailingSlash("/api/v1/jobs"), "/api/v1/jobs");
  });

  void test("does not strip the root slash", () => {
    assert.equal(stripTrailingSlash("/"), "/");
  });
});
