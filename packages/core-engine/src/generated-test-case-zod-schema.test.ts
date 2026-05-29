/**
 * Behavioral tests for `generatedTestCaseListZodSchema` and
 * `buildGeneratedTestCaseListJsonSchemaFromZod` exported from
 * `generated-test-case-zod-schema.ts`.
 *
 * Strategy: the same valid fixture used in `generated-test-case-schema.test.ts`
 * is reproduced here (both validators describe the same shape). Each negative
 * test mutates a structural clone so exactly one validation rule is exercised
 * per test.
 *
 * Mutation robustness: every negative test calls `.safeParse` and asserts
 * `success === false`. If the corresponding Zod constraint were removed, the
 * parse would succeed and the assertion would fail.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  REDACTION_POLICY_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
} from "@oscharko-dev/ti-contracts";
import {
  buildGeneratedTestCaseListJsonSchemaFromZod,
  GENERATED_TEST_CASE_LIST_SCHEMA_NAME,
  generatedTestCaseListZodSchema,
} from "./generated-test-case-zod-schema.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const VALID_HASH = "a".repeat(64);
const VALID_HASH_2 = "b".repeat(64);
const VALID_HASH_3 = "c".repeat(64);
const VALID_ISO_TS = "2024-01-15T10:30:00Z";

/** Returns a fully-valid `GeneratedTestCaseList` with optionals populated. */
const makeValid = () => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId: "ti-job-0123456789abcdef",
  testCases: [
    {
      id: "ti-case-0000000000000001",
      sourceJobId: "ti-job-0123456789abcdef",
      contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
      schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
      promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
      title: "Successful login with valid credentials",
      objective: "Verify that a user with valid credentials can log in.",
      level: "system",
      type: "functional",
      polarity: "positive",
      category: "positive_path",
      priority: "p1",
      riskCategory: "medium",
      technique: "use_case",
      preconditions: ["User account exists"],
      testData: ["username=admin"],
      steps: [
        {
          index: 1,
          action: "Navigate to login page",
          data: "https://example.com/login",
          expected: "Login form is displayed",
          fieldLifecycleTransitionId: "ti-flt-0000000000000001",
        },
        { index: 2, action: "Submit credentials" },
      ],
      expectedResults: ["User is redirected to the dashboard"],
      figmaTraceRefs: [
        {
          screenId: "screen-login-01",
          nodeId: "node-42",
          nodeName: "LoginBtn",
        },
      ],
      assumptions: ["Network latency is negligible"],
      openQuestions: [],
      qcMappingPreview: {
        exportable: true,
        folderHint: "Authentication",
        mappingProfileId: "default",
        decisionBasis: "mapping_preview_only",
        blockingReasons: [],
      },
      qualitySignals: {
        coveredFieldIds: ["field-username"],
        coveredActionIds: ["action-submit"],
        coveredValidationIds: [],
        coveredNavigationIds: ["nav-dashboard"],
        confidence: 0.9,
      },
      confidence: 0.85,
      confidenceComponents: {
        judgePanelAgreement: 0.9,
        faithfulnessScore: 0.88,
        selfConsistencyAgreement: 0.85,
        ragHitStrength: 0.7,
        oracleResolved: true,
        rawScore: 0.83,
      },
      reviewState: "auto_approved",
      audit: {
        jobId: "ti-job-0123456789abcdef",
        generatedAt: VALID_ISO_TS,
        contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
        schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
        promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
        redactionPolicyVersion: REDACTION_POLICY_VERSION,
        visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
        cacheHit: false,
        cacheKey: "ck-abc123",
        inputHash: VALID_HASH,
        promptHash: VALID_HASH_2,
        schemaHash: VALID_HASH_3,
        truncatedInstructionCount: 3,
      },
      regulatoryRelevance: {
        domain: "banking",
        rationale: "Validates secure access to banking data.",
      },
    },
  ],
});

/** Returns the first test case from a cloned fixture (always present). */
const firstCase = (fixture: ReturnType<typeof makeValid>) =>
  fixture.testCases[0] as NonNullable<(typeof fixture.testCases)[0]>;

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

void test("valid fixture parses successfully with safeParse", () => {
  const result = generatedTestCaseListZodSchema.safeParse(makeValid());

  assert.equal(result.success, true);
});

void test("valid fixture parses successfully with parse (no throw)", () => {
  assert.doesNotThrow(() => {
    generatedTestCaseListZodSchema.parse(makeValid());
  });
});

void test("valid fixture parses with local snapshot source audit metadata", () => {
  const fixture = makeValid();
  firstCase(fixture).audit.snapshotSource = {
    snapshotId: "snapshot-20260529",
    snapshotDigest: VALID_HASH,
    nodeIndexDigest: VALID_HASH_2,
    scopeDigest: VALID_HASH_3,
    selectedNodeIds: ["node-1"],
    selectedPageIds: ["page-1"],
    selectedFrameIds: ["frame-1"],
  };

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, true);
});

void test("invalid snapshot source digest is rejected", () => {
  const fixture = makeValid();
  firstCase(fixture).audit.snapshotSource = {
    snapshotId: "snapshot-20260529",
    snapshotDigest: "not-a-digest",
    nodeIndexDigest: VALID_HASH_2,
    scopeDigest: VALID_HASH_3,
    selectedNodeIds: ["node-1"],
    selectedPageIds: [],
    selectedFrameIds: [],
  };

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, false);
});

// ---------------------------------------------------------------------------
// Wrong literal version fields
// ---------------------------------------------------------------------------

void test("wrong root schemaVersion literal is rejected", () => {
  const fixture = makeValid() as Record<string, unknown>;
  fixture["schemaVersion"] = "0.0.0";

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, false);
});

void test("wrong test case contractVersion literal is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture) as Record<string, unknown>)["contractVersion"] = "0.0";

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, false);
});

void test("wrong test case schemaVersion literal is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture) as Record<string, unknown>)["schemaVersion"] = "0.0.0";

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, false);
});

void test("wrong test case promptTemplateVersion literal is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture) as Record<string, unknown>)["promptTemplateVersion"] =
    "0.0.0";

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, false);
});

// ---------------------------------------------------------------------------
// Enum fields
// ---------------------------------------------------------------------------

void test("invalid level enum value is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture) as Record<string, unknown>)["level"] = "galactic";

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, false);
});

void test("invalid type enum value is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture) as Record<string, unknown>)["type"] = "chaos";

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, false);
});

void test("invalid priority enum value is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture) as Record<string, unknown>)["priority"] = "critical";

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, false);
});

void test("invalid riskCategory enum value is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture) as Record<string, unknown>)["riskCategory"] = "nuclear";

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, false);
});

void test("invalid technique enum value is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture) as Record<string, unknown>)["technique"] =
    "tea_leaf_reading";

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, false);
});

void test("invalid reviewState enum value is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture) as Record<string, unknown>)["reviewState"] = "approved";

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, false);
});

void test("invalid polarity enum value is rejected when present", () => {
  const fixture = makeValid();
  (firstCase(fixture) as Record<string, unknown>)["polarity"] = "ambivalent";

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, false);
});

void test("invalid category enum value is rejected when present", () => {
  const fixture = makeValid();
  (firstCase(fixture) as Record<string, unknown>)["category"] = "unknown_cat";

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, false);
});

// ---------------------------------------------------------------------------
// Required field absence
// ---------------------------------------------------------------------------

void test("missing root jobId is rejected", () => {
  const fixture = makeValid() as Record<string, unknown>;
  delete fixture["jobId"];

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, false);
});

void test("missing test case title is rejected", () => {
  const fixture = makeValid();
  delete (firstCase(fixture) as Record<string, unknown>)["title"];

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, false);
});

void test("missing test case steps is rejected", () => {
  const fixture = makeValid();
  delete (firstCase(fixture) as Record<string, unknown>)["steps"];

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, false);
});

void test("empty steps array is rejected (min(1) constraint)", () => {
  const fixture = makeValid();
  (firstCase(fixture) as Record<string, unknown>)["steps"] = [];

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, false);
});

void test("missing audit is rejected", () => {
  const fixture = makeValid();
  delete (firstCase(fixture) as Record<string, unknown>)["audit"];

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, false);
});

// ---------------------------------------------------------------------------
// Extra key — strictObject rejects unknown properties
// ---------------------------------------------------------------------------

void test("extra key on root object is rejected by strictObject", () => {
  const fixture = makeValid() as Record<string, unknown>;
  fixture["unexpectedKey"] = "oops";

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, false);
});

void test("extra key on test case object is rejected by strictObject", () => {
  const fixture = makeValid();
  (firstCase(fixture) as Record<string, unknown>)["extraProp"] = "bad";

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, false);
});

void test("extra key on step object is rejected by strictObject", () => {
  const fixture = makeValid();
  (firstCase(fixture).steps[0] as Record<string, unknown>)["badStep"] =
    "surprise";

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, false);
});

// ---------------------------------------------------------------------------
// audit.truncatedInstructionCount — explicit drift-bug coverage
// ---------------------------------------------------------------------------

void test("audit.truncatedInstructionCount present and non-negative is accepted", () => {
  const fixture = makeValid();
  (firstCase(fixture).audit as Record<string, unknown>)[
    "truncatedInstructionCount"
  ] = 0;

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, true);
});

void test("audit.truncatedInstructionCount absent is accepted", () => {
  const fixture = makeValid();
  delete (firstCase(fixture).audit as Record<string, unknown>)[
    "truncatedInstructionCount"
  ];

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, true);
});

void test("audit.truncatedInstructionCount = -1 is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture).audit as Record<string, unknown>)[
    "truncatedInstructionCount"
  ] = -1;

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, false);
});

void test("audit.truncatedInstructionCount = 1.5 (non-integer) is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture).audit as Record<string, unknown>)[
    "truncatedInstructionCount"
  ] = 1.5;

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, false);
});

// ---------------------------------------------------------------------------
// Hash and timestamp format checks
// ---------------------------------------------------------------------------

void test("inputHash shorter than 64 chars is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture).audit as Record<string, unknown>)["inputHash"] =
    "a".repeat(63);

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, false);
});

void test("inputHash with non-hex characters is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture).audit as Record<string, unknown>)["inputHash"] =
    "g".repeat(64);

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, false);
});

void test("audit.generatedAt not matching ISO-8601 pattern is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture).audit as Record<string, unknown>)["generatedAt"] =
    "2024-01-15";

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, false);
});

// ---------------------------------------------------------------------------
// Optional fields absent — must parse successfully
// ---------------------------------------------------------------------------

void test("absent polarity is accepted", () => {
  const fixture = makeValid();
  delete (firstCase(fixture) as Record<string, unknown>)["polarity"];

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, true);
});

void test("absent category is accepted", () => {
  const fixture = makeValid();
  delete (firstCase(fixture) as Record<string, unknown>)["category"];

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, true);
});

void test("absent confidence is accepted", () => {
  const fixture = makeValid();
  delete (firstCase(fixture) as Record<string, unknown>)["confidence"];

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, true);
});

void test("absent confidenceComponents is accepted", () => {
  const fixture = makeValid();
  delete (firstCase(fixture) as Record<string, unknown>)[
    "confidenceComponents"
  ];

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, true);
});

void test("absent regulatoryRelevance is accepted", () => {
  const fixture = makeValid();
  delete (firstCase(fixture) as Record<string, unknown>)["regulatoryRelevance"];

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, true);
});

// ---------------------------------------------------------------------------
// regulatoryRelevance validation
// ---------------------------------------------------------------------------

void test("regulatoryRelevance.domain with invalid value is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture).regulatoryRelevance as Record<string, unknown>)[
    "domain"
  ] = "space";

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, false);
});

void test("regulatoryRelevance.rationale over 240 chars is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture).regulatoryRelevance as Record<string, unknown>)[
    "rationale"
  ] = "x".repeat(241);

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, false);
});

void test("regulatoryRelevance.rationale exactly 240 chars is accepted (boundary)", () => {
  const fixture = makeValid();
  (firstCase(fixture).regulatoryRelevance as Record<string, unknown>)[
    "rationale"
  ] = "x".repeat(240);

  const result = generatedTestCaseListZodSchema.safeParse(fixture);

  assert.equal(result.success, true);
});

// ---------------------------------------------------------------------------
// buildGeneratedTestCaseListJsonSchemaFromZod
// ---------------------------------------------------------------------------

void test("buildGeneratedTestCaseListJsonSchemaFromZod returns an object with type=object and a $schema key", () => {
  const schema = buildGeneratedTestCaseListJsonSchemaFromZod();

  // Must describe an object (the GeneratedTestCaseList wrapper) and carry
  // the "$schema" declaration that the Zod JSON Schema emitter always emits.
  assert.equal(typeof schema, "object");
  assert.equal(schema["type"], "object");
  assert.equal(typeof schema["$schema"], "string");
});

void test("buildGeneratedTestCaseListJsonSchemaFromZod schema title is GeneratedTestCaseList", () => {
  const schema = buildGeneratedTestCaseListJsonSchemaFromZod();

  // The .meta({ title: "GeneratedTestCaseList" }) must propagate into the output.
  assert.equal(schema["title"], "GeneratedTestCaseList");
});

void test("buildGeneratedTestCaseListJsonSchemaFromZod schema $id is test-intelligence-generated-test-case-list-v1", () => {
  const schema = buildGeneratedTestCaseListJsonSchemaFromZod();

  assert.equal(schema["$id"], "test-intelligence-generated-test-case-list-v1");
});

void test("GENERATED_TEST_CASE_LIST_SCHEMA_NAME is a non-empty string containing the major schema version", () => {
  const majorVersion = GENERATED_TEST_CASE_SCHEMA_VERSION.split(".")[0];

  assert.equal(typeof GENERATED_TEST_CASE_LIST_SCHEMA_NAME, "string");
  assert.ok(GENERATED_TEST_CASE_LIST_SCHEMA_NAME.length > 0);
  assert.ok(
    GENERATED_TEST_CASE_LIST_SCHEMA_NAME.includes(`v${majorVersion}`),
    `expected schema name to include 'v${majorVersion}' but got '${GENERATED_TEST_CASE_LIST_SCHEMA_NAME}'`,
  );
});
