/**
 * Nested-object field validators for the `GeneratedTestCaseList` structural
 * validator: steps, Figma trace refs, QC mapping, quality signals,
 * confidence components, audit metadata, ambiguity, and regulatory
 * relevance.
 *
 * The validator orchestration (`generated-test-case-validator.ts`) delegates
 * each compound field to one function here. This module depends
 * one-directionally on `src/contracts/`.
 */

import {
  ALLOWED_REGULATORY_RELEVANCE_DOMAINS,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type RegulatoryRelevanceDomain,
} from "@oscharko-dev/ti-contracts";
import {
  expectConst,
  expectExactKeys,
  expectHash,
  expectString,
  expectStringArray,
  expectUnitIntervalNumber,
  isObject,
  type GeneratedTestCaseValidationError,
} from "./generated-test-case-validator-helpers.js";
import {
  AMBIGUITY_KEYS,
  AUDIT_KEYS,
  CONFIDENCE_COMPONENT_KEYS,
  FIGMA_TRACE_REF_KEYS,
  ISO_8601_PATTERN,
  QC_MAPPING_KEYS,
  QUALITY_SIGNAL_KEYS,
  REGULATORY_RELEVANCE_KEYS,
  STEP_KEYS,
} from "./generated-test-case-validator-tables.js";

/** Validates a non-empty array of `GeneratedTestCaseStep` objects. */
export const expectStepsArray = (
  value: unknown,
  path: string,
  errors: GeneratedTestCaseValidationError[],
): void => {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push({ path, message: "expected non-empty array" });
    return;
  }
  for (let i = 0; i < value.length; i++) {
    expectStep(value[i], `${path}[${i}]`, errors);
  }
};

const expectStep = (
  step: unknown,
  path: string,
  errors: GeneratedTestCaseValidationError[],
): void => {
  if (!isObject(step)) {
    errors.push({ path, message: "expected object" });
    return;
  }
  expectExactKeys(step, STEP_KEYS, path, errors);
  if (
    typeof step["index"] !== "number" ||
    !Number.isInteger(step["index"]) ||
    step["index"] < 1
  ) {
    errors.push({ path: `${path}.index`, message: "expected integer >= 1" });
  }
  expectString(step["action"], `${path}.action`, errors);
  if (step["data"] !== undefined) {
    expectString(step["data"], `${path}.data`, errors);
  }
  if (step["expected"] !== undefined) {
    expectString(step["expected"], `${path}.expected`, errors);
  }
  if (step["fieldLifecycleTransitionId"] !== undefined) {
    expectString(
      step["fieldLifecycleTransitionId"],
      `${path}.fieldLifecycleTransitionId`,
      errors,
    );
  }
};

/** Validates an array of `GeneratedTestCaseFigmaTrace` objects. */
export const expectTraceRefs = (
  value: unknown,
  path: string,
  errors: GeneratedTestCaseValidationError[],
): void => {
  if (!Array.isArray(value)) {
    errors.push({ path, message: "expected array" });
    return;
  }
  for (let i = 0; i < value.length; i++) {
    expectTraceRef(value[i], `${path}[${i}]`, errors);
  }
};

const expectTraceRef = (
  ref: unknown,
  path: string,
  errors: GeneratedTestCaseValidationError[],
): void => {
  if (!isObject(ref)) {
    errors.push({ path, message: "expected object" });
    return;
  }
  expectExactKeys(ref, FIGMA_TRACE_REF_KEYS, path, errors);
  expectString(ref["screenId"], `${path}.screenId`, errors);
  if (ref["nodeId"] !== undefined) {
    expectString(ref["nodeId"], `${path}.nodeId`, errors);
  }
  if (ref["nodeName"] !== undefined) {
    expectString(ref["nodeName"], `${path}.nodeName`, errors);
  }
  if (ref["nodePath"] !== undefined) {
    expectString(ref["nodePath"], `${path}.nodePath`, errors);
  }
};

/** Validates a `GeneratedTestCaseQcMapping` object. */
export const expectQcMapping = (
  value: unknown,
  path: string,
  errors: GeneratedTestCaseValidationError[],
): void => {
  if (!isObject(value)) {
    errors.push({ path, message: "expected object" });
    return;
  }
  expectExactKeys(value, QC_MAPPING_KEYS, path, errors);
  if (typeof value["exportable"] !== "boolean") {
    errors.push({ path: `${path}.exportable`, message: "expected boolean" });
  }
  if (value["folderHint"] !== undefined) {
    expectString(value["folderHint"], `${path}.folderHint`, errors);
  }
  if (value["mappingProfileId"] !== undefined) {
    expectString(value["mappingProfileId"], `${path}.mappingProfileId`, errors);
  }
  if (value["decisionBasis"] !== undefined) {
    expectConst(
      value["decisionBasis"],
      "mapping_preview_only",
      `${path}.decisionBasis`,
      errors,
    );
  }
  if (value["blockingReasons"] !== undefined) {
    expectStringArray(
      value["blockingReasons"],
      `${path}.blockingReasons`,
      errors,
    );
  }
};

/** Validates a `GeneratedTestCaseQualitySignals` object. */
export const expectQualitySignals = (
  value: unknown,
  path: string,
  errors: GeneratedTestCaseValidationError[],
): void => {
  if (!isObject(value)) {
    errors.push({ path, message: "expected object" });
    return;
  }
  expectExactKeys(value, QUALITY_SIGNAL_KEYS, path, errors);
  expectStringArray(
    value["coveredFieldIds"],
    `${path}.coveredFieldIds`,
    errors,
  );
  expectStringArray(
    value["coveredActionIds"],
    `${path}.coveredActionIds`,
    errors,
  );
  expectStringArray(
    value["coveredValidationIds"],
    `${path}.coveredValidationIds`,
    errors,
  );
  expectStringArray(
    value["coveredNavigationIds"],
    `${path}.coveredNavigationIds`,
    errors,
  );
  if (value["coveredRequirementIds"] !== undefined) {
    expectStringArray(
      value["coveredRequirementIds"],
      `${path}.coveredRequirementIds`,
      errors,
    );
  }
  if (
    typeof value["confidence"] !== "number" ||
    value["confidence"] < 0 ||
    value["confidence"] > 1
  ) {
    errors.push({
      path: `${path}.confidence`,
      message: "expected number in [0, 1]",
    });
  }
  if (value["ambiguity"] !== undefined) {
    expectAmbiguity(value["ambiguity"], `${path}.ambiguity`, errors);
  }
};

/** Validates a `GeneratedTestCaseConfidenceComponents` object. */
export const expectConfidenceComponents = (
  value: unknown,
  path: string,
  errors: GeneratedTestCaseValidationError[],
): void => {
  if (!isObject(value)) {
    errors.push({ path, message: "expected object" });
    return;
  }
  expectExactKeys(value, CONFIDENCE_COMPONENT_KEYS, path, errors);
  expectUnitIntervalNumber(
    value["judgePanelAgreement"],
    `${path}.judgePanelAgreement`,
    errors,
  );
  expectUnitIntervalNumber(
    value["faithfulnessScore"],
    `${path}.faithfulnessScore`,
    errors,
  );
  expectUnitIntervalNumber(
    value["selfConsistencyAgreement"],
    `${path}.selfConsistencyAgreement`,
    errors,
  );
  expectUnitIntervalNumber(
    value["ragHitStrength"],
    `${path}.ragHitStrength`,
    errors,
  );
  if (typeof value["oracleResolved"] !== "boolean") {
    errors.push({
      path: `${path}.oracleResolved`,
      message: "expected boolean",
    });
  }
  expectUnitIntervalNumber(value["rawScore"], `${path}.rawScore`, errors);
};

/** Validates a `GeneratedTestCaseAuditMetadata` object. */
export const expectAudit = (
  value: unknown,
  path: string,
  errors: GeneratedTestCaseValidationError[],
): void => {
  if (!isObject(value)) {
    errors.push({ path, message: "expected object" });
    return;
  }
  expectExactKeys(value, AUDIT_KEYS, path, errors);
  expectString(value["jobId"], `${path}.jobId`, errors);
  if (
    typeof value["generatedAt"] !== "string" ||
    !new RegExp(ISO_8601_PATTERN).test(value["generatedAt"])
  ) {
    errors.push({
      path: `${path}.generatedAt`,
      message: "expected ISO-8601 timestamp",
    });
  }
  expectConst(
    value["contractVersion"],
    TEST_INTELLIGENCE_CONTRACT_VERSION,
    `${path}.contractVersion`,
    errors,
  );
  expectConst(
    value["schemaVersion"],
    GENERATED_TEST_CASE_SCHEMA_VERSION,
    `${path}.schemaVersion`,
    errors,
  );
  expectConst(
    value["promptTemplateVersion"],
    TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    `${path}.promptTemplateVersion`,
    errors,
  );
  expectString(
    value["redactionPolicyVersion"],
    `${path}.redactionPolicyVersion`,
    errors,
  );
  expectString(
    value["visualSidecarSchemaVersion"],
    `${path}.visualSidecarSchemaVersion`,
    errors,
  );
  if (typeof value["cacheHit"] !== "boolean") {
    errors.push({ path: `${path}.cacheHit`, message: "expected boolean" });
  }
  expectString(value["cacheKey"], `${path}.cacheKey`, errors);
  expectHash(value["inputHash"], `${path}.inputHash`, errors);
  expectHash(value["promptHash"], `${path}.promptHash`, errors);
  expectHash(value["schemaHash"], `${path}.schemaHash`, errors);
  if (
    value["truncatedInstructionCount"] !== undefined &&
    (!Number.isInteger(value["truncatedInstructionCount"]) ||
      (value["truncatedInstructionCount"] as number) < 0)
  ) {
    errors.push({
      path: `${path}.truncatedInstructionCount`,
      message: "expected non-negative integer when present",
    });
  }
};

const expectAmbiguity = (
  value: unknown,
  path: string,
  errors: GeneratedTestCaseValidationError[],
): void => {
  if (!isObject(value)) {
    errors.push({ path, message: "expected object" });
    return;
  }
  expectExactKeys(value, AMBIGUITY_KEYS, path, errors);
  expectString(value["reason"], `${path}.reason`, errors);
};

/** Validates a `RegulatoryRelevance` object. */
export const expectRegulatoryRelevance = (
  value: unknown,
  path: string,
  errors: GeneratedTestCaseValidationError[],
): void => {
  if (!isObject(value)) {
    errors.push({ path, message: "expected object" });
    return;
  }
  expectExactKeys(value, REGULATORY_RELEVANCE_KEYS, path, errors);
  const domain = value["domain"];
  if (
    typeof domain !== "string" ||
    !ALLOWED_REGULATORY_RELEVANCE_DOMAINS.includes(
      domain as RegulatoryRelevanceDomain,
    )
  ) {
    errors.push({
      path: `${path}.domain`,
      message: `expected one of ${ALLOWED_REGULATORY_RELEVANCE_DOMAINS.join(", ")}`,
    });
  }
  const rationale = value["rationale"];
  if (
    typeof rationale !== "string" ||
    rationale.length === 0 ||
    rationale.length > 240
  ) {
    errors.push({
      path: `${path}.rationale`,
      message: "expected non-empty string of length 1..240",
    });
  }
};
