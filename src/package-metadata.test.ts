import assert from "node:assert/strict";
import test from "node:test";

import packageJson from "../package.json" with { type: "json" };

// The standalone package's optional peer surface is `@opentelemetry/api`
// (the only optional peer declared in package.json). TypeScript is a dev tool
// only — never imported by consumers of the runtime library.

void test("package manifest exposes repository metadata for npm consumers", () => {
  assert.equal(packageJson.repository.type, "git");
  assert.equal(
    packageJson.repository.url,
    "git+https://github.com/oscharko-dev/test-intelligence.git",
  );
  assert.equal(
    packageJson.homepage,
    "https://github.com/oscharko-dev/test-intelligence#readme",
  );
  assert.equal(
    packageJson.bugs.url,
    "https://github.com/oscharko-dev/test-intelligence/issues",
  );
});

void test("package manifest declares the supported peer-dependency floor", () => {
  assert.equal(packageJson.peerDependencies["@opentelemetry/api"], "^1.9.0");
  assert.equal(
    packageJson.peerDependenciesMeta["@opentelemetry/api"].optional,
    true,
  );
});
