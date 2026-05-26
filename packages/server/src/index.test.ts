import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getPackageIdentity,
  PACKAGE_NAME,
  PACKAGE_VERSION,
  resolveReleaseStage,
} from "./index.js";

// `node:test` returns a Promise from `test()`; the runner awaits it
// internally, so the returned value is intentionally discarded with `void`.
void test("resolveReleaseStage classifies a plain version as stable", () => {
  assert.equal(resolveReleaseStage("1.2.3"), "stable");
});

void test("resolveReleaseStage classifies a beta pre-release as beta", () => {
  assert.equal(resolveReleaseStage("0.0.1-beta.0"), "beta");
});

void test("resolveReleaseStage classifies a non-beta pre-release as pre-beta", () => {
  assert.equal(resolveReleaseStage("0.0.1-alpha.4"), "pre-beta");
});

void test("resolveReleaseStage classifies an empty string as stable", () => {
  assert.equal(resolveReleaseStage(""), "stable");
});

void test("resolveReleaseStage classifies a separator with empty pre-release as pre-beta", () => {
  assert.equal(resolveReleaseStage("1.0.0-"), "pre-beta");
});

void test("getPackageIdentity reports name, version, and derived stage", () => {
  const identity = getPackageIdentity();
  assert.equal(identity.name, PACKAGE_NAME);
  assert.equal(identity.version, PACKAGE_VERSION);
  assert.equal(identity.stage, resolveReleaseStage(PACKAGE_VERSION));
});
