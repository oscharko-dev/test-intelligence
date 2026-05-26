import assert from "node:assert/strict";
import test from "node:test";

import { TEST_INTELLIGENCE_ENV } from "@oscharko-dev/ti-contracts";
import {
  DEFAULT_OUTPUT_ROOT,
  resolveTestIntelligenceEnabled,
} from "./cli-defaults.js";

void test("DEFAULT_OUTPUT_ROOT is the product namespace", () => {
  assert.equal(DEFAULT_OUTPUT_ROOT, ".test-intelligence");
});

void test("resolveTestIntelligenceEnabled returns false when env is empty", () => {
  assert.equal(resolveTestIntelligenceEnabled({}), false);
});

void test("resolveTestIntelligenceEnabled accepts canonical truthy values", () => {
  for (const value of ["1", "true", "yes", "on"]) {
    assert.equal(
      resolveTestIntelligenceEnabled({ [TEST_INTELLIGENCE_ENV]: value }),
      true,
      `expected "${value}" to enable the feature gate`,
    );
  }
});

void test("resolveTestIntelligenceEnabled is case-insensitive and whitespace-tolerant", () => {
  for (const value of [" TRUE ", "On", "  yes\t", "\t1\n", "Yes"]) {
    assert.equal(
      resolveTestIntelligenceEnabled({ [TEST_INTELLIGENCE_ENV]: value }),
      true,
      `expected "${value}" to enable the feature gate after normalisation`,
    );
  }
});

void test("resolveTestIntelligenceEnabled rejects unknown values", () => {
  for (const value of ["", "0", "false", "no", "off", "enabled", "2", " "]) {
    assert.equal(
      resolveTestIntelligenceEnabled({ [TEST_INTELLIGENCE_ENV]: value }),
      false,
      `expected "${value}" to leave the feature gate closed`,
    );
  }
});

void test("resolveTestIntelligenceEnabled reads process.env by default", () => {
  const previous = process.env[TEST_INTELLIGENCE_ENV];
  try {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete process.env[TEST_INTELLIGENCE_ENV];
    assert.equal(resolveTestIntelligenceEnabled(), false);
    process.env[TEST_INTELLIGENCE_ENV] = "1";
    assert.equal(resolveTestIntelligenceEnabled(), true);
  } finally {
    if (previous === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete process.env[TEST_INTELLIGENCE_ENV];
    } else {
      process.env[TEST_INTELLIGENCE_ENV] = previous;
    }
  }
});
