/**
 * Enum value lists and exact-key tables for the `GeneratedTestCaseList`
 * structural validator.
 *
 * These tables are pure data shared by the validator orchestration and its
 * nested-object field validators. The module depends one-directionally on
 * `src/contracts/`.
 */

import {
  ALLOWED_GENERATED_TEST_CASE_CATEGORIES,
  ALLOWED_GENERATED_TEST_CASE_POLARITIES,
  type GeneratedTestCaseCategory,
  type GeneratedTestCasePolarity,
  type GeneratedTestCaseReviewState,
  type TestCaseLevel,
  type TestCasePriority,
  type TestCaseRiskCategory,
  type TestCaseTechnique29119,
  type TestCaseType,
} from "@oscharko-dev/ti-contracts";

/** ISO-8601 timestamp pattern accepted in audit metadata. */
export const ISO_8601_PATTERN =
  "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?(?:Z|[+-]\\d{2}:\\d{2})$";

/** Allowed ISO/IEC/IEEE 29119-4 technique tags. */
export const TECHNIQUES: readonly TestCaseTechnique29119[] = [
  "equivalence_partitioning",
  "boundary_value_analysis",
  "decision_table",
  "state_transition",
  "use_case",
  "exploratory",
  "error_guessing",
  "syntax_testing",
  "classification_tree",
];

/** Allowed coarse-grain test levels. */
export const LEVELS: readonly TestCaseLevel[] = [
  "unit",
  "component",
  "integration",
  "system",
  "acceptance",
];

/** Allowed coarse-grain test types. */
export const TYPES: readonly TestCaseType[] = [
  "functional",
  "negative",
  "boundary",
  "validation",
  "navigation",
  "regression",
  "exploratory",
  "accessibility",
];

/** Allowed priority bands. */
export const PRIORITIES: readonly TestCasePriority[] = ["p0", "p1", "p2", "p3"];

/** Allowed polarity labels, re-typed from the contract source of truth. */
export const POLARITIES: readonly GeneratedTestCasePolarity[] =
  ALLOWED_GENERATED_TEST_CASE_POLARITIES;

/** Allowed rubric categories, re-typed from the contract source of truth. */
export const CASE_CATEGORIES: readonly GeneratedTestCaseCategory[] =
  ALLOWED_GENERATED_TEST_CASE_CATEGORIES;

/** Allowed risk categories. */
export const RISK_CATEGORIES: readonly TestCaseRiskCategory[] = [
  "low",
  "medium",
  "high",
  "regulated_data",
  "financial_transaction",
];

/** Allowed review states. */
export const REVIEW_STATES: readonly GeneratedTestCaseReviewState[] = [
  "draft",
  "auto_approved",
  "needs_review",
  "rejected",
];

/** Exact keys permitted on a `GeneratedTestCaseList` root object. */
export const ROOT_KEYS = ["schemaVersion", "jobId", "testCases"] as const;

/** Exact keys permitted on a single `GeneratedTestCase` object. */
export const TEST_CASE_KEYS = [
  "id",
  "sourceJobId",
  "contractVersion",
  "schemaVersion",
  "promptTemplateVersion",
  "title",
  "objective",
  "level",
  "type",
  "polarity",
  "category",
  "priority",
  "riskCategory",
  "technique",
  "preconditions",
  "testData",
  "steps",
  "expectedResults",
  "figmaTraceRefs",
  "assumptions",
  "openQuestions",
  "qcMappingPreview",
  "qualitySignals",
  "confidence",
  "confidenceComponents",
  "reviewState",
  "audit",
  "regulatoryRelevance",
] as const;

/** Exact keys permitted on a `RegulatoryRelevance` object. */
export const REGULATORY_RELEVANCE_KEYS = ["domain", "rationale"] as const;

/** Exact keys permitted on a `GeneratedTestCaseStep` object. */
export const STEP_KEYS = [
  "index",
  "action",
  "data",
  "expected",
  "fieldLifecycleTransitionId",
] as const;

/** Exact keys permitted on a `GeneratedTestCaseFigmaTrace` object. */
export const FIGMA_TRACE_REF_KEYS = [
  "screenId",
  "nodeId",
  "nodeName",
  "nodePath",
] as const;

/** Exact keys permitted on a `GeneratedTestCaseQcMapping` object. */
export const QC_MAPPING_KEYS = [
  "folderHint",
  "mappingProfileId",
  "decisionBasis",
  "exportable",
  "blockingReasons",
] as const;

/** Exact keys permitted on a `GeneratedTestCaseQualitySignals` object. */
export const QUALITY_SIGNAL_KEYS = [
  "coveredFieldIds",
  "coveredActionIds",
  "coveredValidationIds",
  "coveredNavigationIds",
  "coveredRequirementIds",
  "confidence",
  "ambiguity",
] as const;

/** Exact keys permitted on a `GeneratedTestCaseConfidenceComponents` object. */
export const CONFIDENCE_COMPONENT_KEYS = [
  "judgePanelAgreement",
  "faithfulnessScore",
  "selfConsistencyAgreement",
  "ragHitStrength",
  "oracleResolved",
  "rawScore",
] as const;

/** Exact keys permitted on an `IntentAmbiguity` object. */
export const AMBIGUITY_KEYS = ["reason"] as const;

/** Exact keys permitted on a `GeneratedTestCaseAuditMetadata` object. */
export const AUDIT_KEYS = [
  "jobId",
  "generatedAt",
  "contractVersion",
  "schemaVersion",
  "promptTemplateVersion",
  "redactionPolicyVersion",
  "visualSidecarSchemaVersion",
  "cacheHit",
  "cacheKey",
  "inputHash",
  "promptHash",
  "schemaHash",
  "truncatedInstructionCount",
] as const;
