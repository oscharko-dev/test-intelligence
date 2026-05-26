/**
 * Behavioral tests for `validateGeneratedTestCaseList` and
 * `buildGeneratedTestCaseListJsonSchema` exported from
 * `generated-test-case-schema.ts`.
 *
 * Strategy: one valid fixture (all required + a representative set of optional
 * fields), plus one independent negative test per structural rule. Each
 * negative test mutates a structural clone of the valid fixture so the rest of
 * the object remains valid — ensuring the assertion catches only the one
 * intended error path.
 *
 * Mutation robustness: every negative test asserts on the specific error
 * `path` that the validator emits for that rule. If the corresponding
 * validation line were removed or its condition inverted, the path would be
 * absent and the test would fail.
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
  buildGeneratedTestCaseListJsonSchema,
  GENERATED_TEST_CASE_LIST_SCHEMA_NAME,
  validateGeneratedTestCaseList,
} from "./generated-test-case-schema.js";

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

/** Plucks paths from a result's errors. */
const errorPaths = (result: ReturnType<typeof validateGeneratedTestCaseList>) =>
  result.errors.map((e) => e.path);

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

void test("valid fixture returns { valid: true, errors: [] }", () => {
  const result = validateGeneratedTestCaseList(makeValid());

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

// ---------------------------------------------------------------------------
// Root-level structural checks
// ---------------------------------------------------------------------------

void test("non-object root is rejected with path='$'", () => {
  const result = validateGeneratedTestCaseList("not-an-object");

  assert.equal(result.valid, false);
  assert.ok(errorPaths(result).includes("$"));
});

void test("null root is rejected with path='$'", () => {
  const result = validateGeneratedTestCaseList(null);

  assert.equal(result.valid, false);
  assert.ok(errorPaths(result).includes("$"));
});

void test("array root is rejected with path='$'", () => {
  const result = validateGeneratedTestCaseList([]);

  assert.equal(result.valid, false);
  assert.ok(errorPaths(result).includes("$"));
});

void test("unexpected root key is rejected with path='$'", () => {
  const fixture = makeValid() as Record<string, unknown>;
  fixture["unexpectedKey"] = "oops";

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(errorPaths(result).includes("$"));
});

void test("missing schemaVersion is rejected with path='$.schemaVersion'", () => {
  const fixture = makeValid() as Record<string, unknown>;
  delete fixture["schemaVersion"];

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(errorPaths(result).includes("$.schemaVersion"));
});

void test("wrong root schemaVersion literal is rejected", () => {
  const fixture = makeValid() as Record<string, unknown>;
  fixture["schemaVersion"] = "0.0.0";

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(errorPaths(result).includes("$.schemaVersion"));
});

void test("missing jobId is rejected with path='$.jobId'", () => {
  const fixture = makeValid() as Record<string, unknown>;
  delete fixture["jobId"];

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(errorPaths(result).includes("$.jobId"));
});

void test("empty-string jobId is rejected", () => {
  const fixture = makeValid() as Record<string, unknown>;
  fixture["jobId"] = "";

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(errorPaths(result).includes("$.jobId"));
});

void test("non-array testCases is rejected with path='$.testCases'", () => {
  const fixture = makeValid() as Record<string, unknown>;
  fixture["testCases"] = "not-an-array";

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(errorPaths(result).includes("$.testCases"));
});

// ---------------------------------------------------------------------------
// Test-case identity fields
// ---------------------------------------------------------------------------

void test("wrong contractVersion literal on test case is rejected", () => {
  const fixture = makeValid();
  firstCase(fixture).contractVersion =
    "0.0" as typeof TEST_INTELLIGENCE_CONTRACT_VERSION;

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(errorPaths(result).includes("$.testCases[0].contractVersion"));
});

void test("wrong schemaVersion literal on test case is rejected", () => {
  const fixture = makeValid();
  firstCase(fixture).schemaVersion =
    "0.0.0" as typeof GENERATED_TEST_CASE_SCHEMA_VERSION;

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(errorPaths(result).includes("$.testCases[0].schemaVersion"));
});

void test("wrong promptTemplateVersion literal on test case is rejected", () => {
  const fixture = makeValid();
  firstCase(fixture).promptTemplateVersion =
    "0.0.0" as typeof TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION;

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(
    errorPaths(result).includes("$.testCases[0].promptTemplateVersion"),
  );
});

void test("unexpected key on test case is rejected with path='$.testCases[0]'", () => {
  const fixture = makeValid() as {
    testCases: (ReturnType<typeof makeValid>["testCases"][0] & {
      extraProp?: string;
    })[];
  } & Record<string, unknown>;
  (fixture.testCases[0] as Record<string, unknown>)["extraProp"] = "bad";

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(errorPaths(result).includes("$.testCases[0]"));
});

// ---------------------------------------------------------------------------
// Classification enum fields
// ---------------------------------------------------------------------------

void test("invalid level value is rejected with path='$.testCases[0].level'", () => {
  const fixture = makeValid();
  (firstCase(fixture) as Record<string, unknown>)["level"] = "galactic";

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(errorPaths(result).includes("$.testCases[0].level"));
});

void test("invalid type value is rejected with path='$.testCases[0].type'", () => {
  const fixture = makeValid();
  (firstCase(fixture) as Record<string, unknown>)["type"] = "chaos";

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(errorPaths(result).includes("$.testCases[0].type"));
});

void test("invalid priority value is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture) as Record<string, unknown>)["priority"] = "critical";

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(errorPaths(result).includes("$.testCases[0].priority"));
});

void test("invalid riskCategory value is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture) as Record<string, unknown>)["riskCategory"] = "nuclear";

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(errorPaths(result).includes("$.testCases[0].riskCategory"));
});

void test("invalid technique value is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture) as Record<string, unknown>)["technique"] =
    "tea_leaf_reading";

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(errorPaths(result).includes("$.testCases[0].technique"));
});

void test("invalid reviewState value is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture) as Record<string, unknown>)["reviewState"] = "approved";

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(errorPaths(result).includes("$.testCases[0].reviewState"));
});

void test("invalid polarity value is rejected when present", () => {
  const fixture = makeValid();
  (firstCase(fixture) as Record<string, unknown>)["polarity"] = "ambivalent";

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(errorPaths(result).includes("$.testCases[0].polarity"));
});

void test("invalid category value is rejected when present", () => {
  const fixture = makeValid();
  (firstCase(fixture) as Record<string, unknown>)["category"] = "unknown";

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(errorPaths(result).includes("$.testCases[0].category"));
});

// ---------------------------------------------------------------------------
// Optional fields absent — must still validate
// ---------------------------------------------------------------------------

void test("absent polarity is accepted (optional field)", () => {
  const fixture = makeValid();
  delete (firstCase(fixture) as Record<string, unknown>)["polarity"];

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

void test("absent category is accepted (optional field)", () => {
  const fixture = makeValid();
  delete (firstCase(fixture) as Record<string, unknown>)["category"];

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

void test("absent confidence is accepted (optional field)", () => {
  const fixture = makeValid();
  delete (firstCase(fixture) as Record<string, unknown>)["confidence"];

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

void test("absent confidenceComponents is accepted (optional field)", () => {
  const fixture = makeValid();
  delete (firstCase(fixture) as Record<string, unknown>)[
    "confidenceComponents"
  ];

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

void test("absent regulatoryRelevance is accepted (optional field)", () => {
  const fixture = makeValid();
  delete (firstCase(fixture) as Record<string, unknown>)["regulatoryRelevance"];

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

void test("absent audit.truncatedInstructionCount is accepted (optional field)", () => {
  const fixture = makeValid();
  delete (firstCase(fixture).audit as Record<string, unknown>)[
    "truncatedInstructionCount"
  ];

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

void test("absent step.data and step.expected are accepted (optional fields)", () => {
  const fixture = makeValid();
  const step = firstCase(fixture).steps[0] as Record<string, unknown>;
  delete step["data"];
  delete step["expected"];
  delete step["fieldLifecycleTransitionId"];

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

// ---------------------------------------------------------------------------
// Steps array
// ---------------------------------------------------------------------------

void test("empty steps array is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture) as Record<string, unknown>)["steps"] = [];

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(errorPaths(result).includes("$.testCases[0].steps"));
});

void test("step with index=0 is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture).steps[0] as Record<string, unknown>)["index"] = 0;

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(errorPaths(result).includes("$.testCases[0].steps[0].index"));
});

void test("step with non-integer index is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture).steps[0] as Record<string, unknown>)["index"] = 1.5;

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(errorPaths(result).includes("$.testCases[0].steps[0].index"));
});

void test("step with negative index is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture).steps[0] as Record<string, unknown>)["index"] = -1;

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(errorPaths(result).includes("$.testCases[0].steps[0].index"));
});

// ---------------------------------------------------------------------------
// Unit-interval numbers
// ---------------------------------------------------------------------------

void test("qualitySignals.confidence > 1 is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture).qualitySignals as Record<string, unknown>)["confidence"] =
    1.1;

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(
    errorPaths(result).includes("$.testCases[0].qualitySignals.confidence"),
  );
});

void test("qualitySignals.confidence < 0 is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture).qualitySignals as Record<string, unknown>)["confidence"] =
    -0.1;

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(
    errorPaths(result).includes("$.testCases[0].qualitySignals.confidence"),
  );
});

void test("top-level confidence > 1 is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture) as Record<string, unknown>)["confidence"] = 2;

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(errorPaths(result).includes("$.testCases[0].confidence"));
});

void test("confidenceComponents.judgePanelAgreement > 1 is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture).confidenceComponents as Record<string, unknown>)[
    "judgePanelAgreement"
  ] = 1.01;

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(
    errorPaths(result).includes(
      "$.testCases[0].confidenceComponents.judgePanelAgreement",
    ),
  );
});

void test("confidenceComponents.rawScore < 0 is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture).confidenceComponents as Record<string, unknown>)[
    "rawScore"
  ] = -0.5;

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(
    errorPaths(result).includes("$.testCases[0].confidenceComponents.rawScore"),
  );
});

// ---------------------------------------------------------------------------
// Audit hash and timestamp validation
// ---------------------------------------------------------------------------

void test("inputHash shorter than 64 chars is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture).audit as Record<string, unknown>)["inputHash"] =
    "a".repeat(63);

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(errorPaths(result).includes("$.testCases[0].audit.inputHash"));
});

void test("inputHash with non-hex characters is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture).audit as Record<string, unknown>)["inputHash"] =
    "g".repeat(64);

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(errorPaths(result).includes("$.testCases[0].audit.inputHash"));
});

void test("promptHash longer than 64 chars is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture).audit as Record<string, unknown>)["promptHash"] =
    "b".repeat(65);

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(errorPaths(result).includes("$.testCases[0].audit.promptHash"));
});

void test("schemaHash with uppercase hex is rejected (must be lowercase)", () => {
  const fixture = makeValid();
  (firstCase(fixture).audit as Record<string, unknown>)["schemaHash"] =
    "A".repeat(64);

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(errorPaths(result).includes("$.testCases[0].audit.schemaHash"));
});

void test("audit.generatedAt not matching ISO-8601 is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture).audit as Record<string, unknown>)["generatedAt"] =
    "2024-01-15";

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(errorPaths(result).includes("$.testCases[0].audit.generatedAt"));
});

void test("audit.generatedAt with plain text is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture).audit as Record<string, unknown>)["generatedAt"] =
    "not-a-date";

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(errorPaths(result).includes("$.testCases[0].audit.generatedAt"));
});

void test("audit.truncatedInstructionCount negative is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture).audit as Record<string, unknown>)[
    "truncatedInstructionCount"
  ] = -1;

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(
    errorPaths(result).includes(
      "$.testCases[0].audit.truncatedInstructionCount",
    ),
  );
});

void test("audit.truncatedInstructionCount = 0 is accepted (boundary)", () => {
  const fixture = makeValid();
  (firstCase(fixture).audit as Record<string, unknown>)[
    "truncatedInstructionCount"
  ] = 0;

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

// ---------------------------------------------------------------------------
// Regulatory relevance
// ---------------------------------------------------------------------------

void test("regulatoryRelevance.domain with invalid value is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture).regulatoryRelevance as Record<string, unknown>)[
    "domain"
  ] = "space";

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(
    errorPaths(result).includes("$.testCases[0].regulatoryRelevance.domain"),
  );
});

void test("regulatoryRelevance.rationale over 240 chars is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture).regulatoryRelevance as Record<string, unknown>)[
    "rationale"
  ] = "x".repeat(241);

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(
    errorPaths(result).includes("$.testCases[0].regulatoryRelevance.rationale"),
  );
});

void test("regulatoryRelevance.rationale exactly 240 chars is accepted (boundary)", () => {
  const fixture = makeValid();
  (firstCase(fixture).regulatoryRelevance as Record<string, unknown>)[
    "rationale"
  ] = "x".repeat(240);

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

void test("regulatoryRelevance.rationale empty string is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture).regulatoryRelevance as Record<string, unknown>)[
    "rationale"
  ] = "";

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(
    errorPaths(result).includes("$.testCases[0].regulatoryRelevance.rationale"),
  );
});

// ---------------------------------------------------------------------------
// Nested object violations
// ---------------------------------------------------------------------------

void test("figmaTraceRef without required screenId is rejected", () => {
  const fixture = makeValid();
  delete (firstCase(fixture).figmaTraceRefs[0] as Record<string, unknown>)[
    "screenId"
  ];

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(
    errorPaths(result).includes("$.testCases[0].figmaTraceRefs[0].screenId"),
  );
});

void test("figmaTraceRef with unexpected key is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture).figmaTraceRefs[0] as Record<string, unknown>)["badKey"] =
    "oops";

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(errorPaths(result).includes("$.testCases[0].figmaTraceRefs[0]"));
});

void test("qcMappingPreview with missing exportable is rejected", () => {
  const fixture = makeValid();
  delete (firstCase(fixture).qcMappingPreview as Record<string, unknown>)[
    "exportable"
  ];

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(
    errorPaths(result).includes("$.testCases[0].qcMappingPreview.exportable"),
  );
});

void test("qcMappingPreview.decisionBasis with wrong literal is rejected", () => {
  const fixture = makeValid();
  (firstCase(fixture).qcMappingPreview as Record<string, unknown>)[
    "decisionBasis"
  ] = "final_decision";

  const result = validateGeneratedTestCaseList(fixture);

  assert.equal(result.valid, false);
  assert.ok(
    errorPaths(result).includes(
      "$.testCases[0].qcMappingPreview.decisionBasis",
    ),
  );
});

// ---------------------------------------------------------------------------
// buildGeneratedTestCaseListJsonSchema
// ---------------------------------------------------------------------------

void test("buildGeneratedTestCaseListJsonSchema returns an object with a $schema key", () => {
  const schema = buildGeneratedTestCaseListJsonSchema();

  // The builder delegates to the Zod JSON Schema emitter, which always
  // includes a "$schema" declaration identifying the JSON Schema draft.
  assert.equal(typeof schema, "object");
  assert.equal(typeof schema["$schema"], "string");
});

void test("buildGeneratedTestCaseListJsonSchema returns a schema with type=object", () => {
  const schema = buildGeneratedTestCaseListJsonSchema();

  // The root must describe an object (the GeneratedTestCaseList wrapper).
  assert.equal(schema["type"], "object");
});

void test("buildGeneratedTestCaseListJsonSchema $id is test-intelligence-generated-test-case-list-v1", () => {
  const schema = buildGeneratedTestCaseListJsonSchema();

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
