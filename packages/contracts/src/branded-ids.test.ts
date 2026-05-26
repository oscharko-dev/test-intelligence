import assert from "node:assert/strict";
import test from "node:test";

import {
  isBrandedId,
  toJobId,
  toRoleStepId,
  validateBrandedIdLabel,
} from "./branded-ids.js";
import {
  generateJobId,
  generateRoleStepId,
} from "../../../src/test-intelligence/branded-id-generation.js";

void test("branded ids accept the ti-* shape and reject unrelated strings", () => {
  assert.equal(isBrandedId("ti-0123456789abcdef"), true);
  assert.equal(isBrandedId("ti-test-generation-0123456789abcdef"), true);
  assert.equal(isBrandedId("job-123"), false);
  assert.equal(isBrandedId("wd-0123456789abcdef"), false);
  assert.equal(toJobId("ti-0123456789abcdef"), "ti-0123456789abcdef");
  assert.equal(toRoleStepId("job-123"), null);
});

void test("branded id generation uses the ti-* format with optional normalized labels", () => {
  const jobId = generateJobId("Test-Generation");
  const roleStepId = generateRoleStepId();
  assert.match(jobId, /^ti-test-generation-[0-9a-f]{16}$/u);
  assert.match(roleStepId, /^ti-[0-9a-f]{16}$/u);
  assert.equal(validateBrandedIdLabel("Test-Generation"), "test-generation");
  assert.equal(validateBrandedIdLabel("bad label!"), null);
});
