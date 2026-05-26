/**
 * Structural validator for `GeneratedTestCaseList` objects.
 *
 * The validator is intentionally minimal: it enforces the same shape as the
 * exported JSON schema without pulling in a third-party runtime on the
 * cache-hit read path. It depends one-directionally on `src/contracts/`.
 *
 * This module holds the validator orchestration. The leaf primitive helpers
 * live in `./generated-test-case-validator-helpers.js`, the enum and key
 * tables in `./generated-test-case-validator-tables.js`, and the
 * nested-object field validators in `./generated-test-case-validator-fields.js`.
 * The public entry point is re-exported from `generated-test-case-schema.ts`.
 */

import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
} from "@oscharko-dev/ti-contracts";
import {
  expectAudit,
  expectConfidenceComponents,
  expectQcMapping,
  expectQualitySignals,
  expectRegulatoryRelevance,
  expectStepsArray,
  expectTraceRefs,
} from "./generated-test-case-validator-fields.js";
import {
  expectConst,
  expectEnum,
  expectExactKeys,
  expectString,
  expectStringArray,
  expectUnitIntervalNumber,
  isObject,
  type GeneratedTestCaseValidationError,
  type GeneratedTestCaseValidationResult,
} from "./generated-test-case-validator-helpers.js";
import {
  CASE_CATEGORIES,
  LEVELS,
  POLARITIES,
  PRIORITIES,
  REVIEW_STATES,
  RISK_CATEGORIES,
  ROOT_KEYS,
  TECHNIQUES,
  TEST_CASE_KEYS,
  TYPES,
} from "./generated-test-case-validator-tables.js";

export type {
  GeneratedTestCaseValidationError,
  GeneratedTestCaseValidationResult,
};

/**
 * Lightweight structural validator for `GeneratedTestCaseList` objects.
 *
 * Enforces the same shape as the exported JSON schema without a third-party
 * runtime. Used to reject corrupted entries before they reach the consumer.
 */
export const validateGeneratedTestCaseList = (
  value: unknown,
): GeneratedTestCaseValidationResult => {
  const errors: GeneratedTestCaseValidationError[] = [];
  if (!isObject(value)) {
    errors.push({ path: "$", message: "expected object" });
    return { valid: false, errors };
  }
  const root = value;
  expectExactKeys(root, ROOT_KEYS, "$", errors);
  if (root["schemaVersion"] !== GENERATED_TEST_CASE_SCHEMA_VERSION) {
    errors.push({
      path: "$.schemaVersion",
      message: `expected "${GENERATED_TEST_CASE_SCHEMA_VERSION}"`,
    });
  }
  if (typeof root["jobId"] !== "string" || root["jobId"].length === 0) {
    errors.push({ path: "$.jobId", message: "expected non-empty string" });
  }
  if (!Array.isArray(root["testCases"])) {
    errors.push({ path: "$.testCases", message: "expected array" });
    return { valid: errors.length === 0, errors };
  }
  for (let i = 0; i < root["testCases"].length; i++) {
    validateTestCase(root["testCases"][i], `$.testCases[${i}]`, errors);
  }
  return { valid: errors.length === 0, errors };
};

const validateTestCase = (
  value: unknown,
  path: string,
  errors: GeneratedTestCaseValidationError[],
): void => {
  if (!isObject(value)) {
    errors.push({ path, message: "expected object" });
    return;
  }
  expectExactKeys(value, TEST_CASE_KEYS, path, errors);
  validateTestCaseIdentity(value, path, errors);
  validateTestCaseClassification(value, path, errors);
  validateTestCaseBody(value, path, errors);
};

const validateTestCaseIdentity = (
  tc: Record<string, unknown>,
  path: string,
  errors: GeneratedTestCaseValidationError[],
): void => {
  expectString(tc["id"], `${path}.id`, errors);
  expectString(tc["sourceJobId"], `${path}.sourceJobId`, errors);
  expectConst(
    tc["contractVersion"],
    TEST_INTELLIGENCE_CONTRACT_VERSION,
    `${path}.contractVersion`,
    errors,
  );
  expectConst(
    tc["schemaVersion"],
    GENERATED_TEST_CASE_SCHEMA_VERSION,
    `${path}.schemaVersion`,
    errors,
  );
  expectConst(
    tc["promptTemplateVersion"],
    TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    `${path}.promptTemplateVersion`,
    errors,
  );
  expectString(tc["title"], `${path}.title`, errors);
  expectString(tc["objective"], `${path}.objective`, errors);
};

const validateTestCaseClassification = (
  tc: Record<string, unknown>,
  path: string,
  errors: GeneratedTestCaseValidationError[],
): void => {
  expectEnum(tc["level"], LEVELS, `${path}.level`, errors);
  expectEnum(tc["type"], TYPES, `${path}.type`, errors);
  if ("polarity" in tc && tc["polarity"] !== undefined) {
    expectEnum(tc["polarity"], POLARITIES, `${path}.polarity`, errors);
  }
  if ("category" in tc && tc["category"] !== undefined) {
    expectEnum(tc["category"], CASE_CATEGORIES, `${path}.category`, errors);
  }
  expectEnum(tc["priority"], PRIORITIES, `${path}.priority`, errors);
  expectEnum(
    tc["riskCategory"],
    RISK_CATEGORIES,
    `${path}.riskCategory`,
    errors,
  );
  expectEnum(tc["technique"], TECHNIQUES, `${path}.technique`, errors);
  expectEnum(tc["reviewState"], REVIEW_STATES, `${path}.reviewState`, errors);
};

const validateTestCaseBody = (
  tc: Record<string, unknown>,
  path: string,
  errors: GeneratedTestCaseValidationError[],
): void => {
  expectStringArray(tc["preconditions"], `${path}.preconditions`, errors);
  expectStringArray(tc["testData"], `${path}.testData`, errors);
  expectStepsArray(tc["steps"], `${path}.steps`, errors);
  expectStringArray(tc["expectedResults"], `${path}.expectedResults`, errors);
  expectTraceRefs(tc["figmaTraceRefs"], `${path}.figmaTraceRefs`, errors);
  expectStringArray(tc["assumptions"], `${path}.assumptions`, errors);
  expectStringArray(tc["openQuestions"], `${path}.openQuestions`, errors);
  expectQcMapping(tc["qcMappingPreview"], `${path}.qcMappingPreview`, errors);
  expectQualitySignals(tc["qualitySignals"], `${path}.qualitySignals`, errors);
  if ("confidence" in tc && tc["confidence"] !== undefined) {
    expectUnitIntervalNumber(tc["confidence"], `${path}.confidence`, errors);
  }
  if (
    "confidenceComponents" in tc &&
    tc["confidenceComponents"] !== undefined
  ) {
    expectConfidenceComponents(
      tc["confidenceComponents"],
      `${path}.confidenceComponents`,
      errors,
    );
  }
  expectAudit(tc["audit"], `${path}.audit`, errors);
  if ("regulatoryRelevance" in tc && tc["regulatoryRelevance"] !== undefined) {
    expectRegulatoryRelevance(
      tc["regulatoryRelevance"],
      `${path}.regulatoryRelevance`,
      errors,
    );
  }
};
