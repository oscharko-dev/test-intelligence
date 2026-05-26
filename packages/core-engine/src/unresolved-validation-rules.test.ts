import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  REDACTION_POLICY_VERSION,
  TEST_DESIGN_MODEL_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  type GeneratedTestCase,
  type TestDesignModel,
} from "@oscharko-dev/ti-contracts";
import {
  buildSourceScopedValidationOpenQuestions,
  classifyUnresolvedValidationDetail,
  deriveUnresolvedValidationConstraints,
  deriveUnresolvedValidationConstraintsWithScreenFallback,
  detectOpenQuestionClarificationClaim,
  detectUnsupportedExactValidationClaim,
  extractUnresolvedValidationStatements,
  isUnresolvedValidationText,
} from "./unresolved-validation-rules.js";

const FIXTURE_DIR = new URL(
  "../../../fixtures/test-intelligence/unresolved-validation-rules-fixtures",
  import.meta.url,
).pathname;

const buildModel = (
  overrides: Partial<TestDesignModel> = {},
): TestDesignModel => ({
  schemaVersion: TEST_DESIGN_MODEL_SCHEMA_VERSION,
  jobId: "job-2013",
  sourceHash: "f".repeat(64),
  screens: [
    {
      screenId: "screen-financing",
      name: "Finanzierungsbedarf",
      elements: [
        {
          elementId: "screen-financing::field::kaufpreis",
          label: "Höhe des Kaufpreises (Netto)",
          kind: "text",
        },
        {
          elementId: "screen-financing::field::nebenkosten",
          label: "Höhe der Nebenkosten (Brutto) (optional)",
          kind: "text",
        },
        {
          elementId: "screen-financing::field::mwst",
          label: "Anfallender MwSt.-Satz bei Kauf",
          kind: "select",
        },
      ],
      actions: [],
      validations: [],
      calculations: [],
      visualRefs: [],
      sourceRefs: ["custom-context-markdown"],
    },
  ],
  businessRules: [],
  calculationConstraints: [],
  assumptions: [],
  openQuestions: [],
  riskSignals: [],
  ...overrides,
});

const buildGeneratedCase = (
  overrides: Partial<GeneratedTestCase> = {},
): GeneratedTestCase => ({
  id: "tc-unresolved",
  sourceJobId: "job-2013",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: "Validate unresolved amount field",
  objective: "Keep unresolved validation generic",
  level: "system",
  type: "functional",
  priority: "p2",
  riskCategory: "low",
  technique: "equivalence_partitioning",
  preconditions: [],
  testData: [],
  steps: [
    {
      index: 1,
      action: "Check that the amount label is visible.",
      expected: "The amount label is shown.",
    },
  ],
  expectedResults: ["The amount label is shown."],
  figmaTraceRefs: [{ screenId: "screen-financing", nodeId: "node-1" }],
  assumptions: [],
  openQuestions: [],
  qcMappingPreview: { exportable: true },
  qualitySignals: {
    coveredFieldIds: ["screen-financing::field::kaufpreis"],
    coveredActionIds: [],
    coveredValidationIds: [],
    coveredNavigationIds: [],
    confidence: 0.9,
  },
  reviewState: "draft",
  audit: {
    jobId: "job-2013",
    generatedAt: "2026-05-08T00:00:00.000Z",
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    redactionPolicyVersion: REDACTION_POLICY_VERSION,
    visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
    cacheHit: false,
    cacheKey: "k".repeat(64),
    inputHash: "i".repeat(64),
    promptHash: "p".repeat(64),
    schemaHash: "s".repeat(64),
  },
  ...overrides,
});

void test("isUnresolvedValidationText recognises German Jira phrasing for Issue #2013", () => {
  assert.equal(
    isUnresolvedValidationText(
      "Validierungsregeln für Betragsfelder und MwSt.-Auswahl sind noch zu spezifizieren.",
    ),
    true,
  );
  assert.equal(
    isUnresolvedValidationText(
      "Es ist fachlich zu klären, wie sich die Auswahl Netto / Brutto auf die Berechnung auswirkt.",
    ),
    true,
  );
  assert.equal(
    isUnresolvedValidationText(
      "Die Auswirkungen der Optionen Netto und Brutto auf Feldbezeichnungen, Berechnung und Vorbelegung sind nicht vollständig spezifiziert.",
    ),
    true,
  );
  // Sentences without an unresolved marker must not be flagged.
  assert.equal(
    isUnresolvedValidationText(
      "Die Maske wird entsprechend der Figma-Vorlage dargestellt.",
    ),
    false,
  );
  // Sentences without a topic marker must not be flagged either.
  assert.equal(
    isUnresolvedValidationText("Der Termin ist noch zu klären."),
    false,
  );
});

void test("isUnresolvedValidationText still recognises English phrasing", () => {
  assert.equal(
    isUnresolvedValidationText(
      "Validation rules for amount fields are still to be specified.",
    ),
    true,
  );
  assert.equal(isUnresolvedValidationText("Buttons must be visible."), false);
});

void test("extractUnresolvedValidationStatements splits a German Jira block into individual statements", () => {
  const text = `## Annahmen / Klärungsbedarf
- Es ist fachlich zu klären, wie sich die Auswahl Netto / Brutto konkret auf Feldbezeichnungen, Berechnung und Vorbelegung auswirkt.
- Es ist fachlich zu klären, ob der Finanzierungsbedarf rein aus Kaufpreis + Nebenkosten besteht oder ob weitere Positionen berücksichtigt werden.
- Validierungsregeln für Betragsfelder und MwSt.-Auswahl sind noch zu spezifizieren.`;

  const statements = extractUnresolvedValidationStatements(text);
  assert.equal(statements.length, 3);
  assert.ok(
    statements.some((statement) =>
      statement.includes("Validierungsregeln für Betragsfelder"),
    ),
  );
  assert.ok(
    statements.some((statement) => statement.includes("Netto / Brutto")),
  );
  assert.ok(statements.every((statement) => statement.length > 0));
});

void test("buildSourceScopedValidationOpenQuestions prefixes German statements with the source label", () => {
  const text =
    "Validierungsregeln für Betragsfelder und MwSt.-Auswahl sind noch zu spezifizieren.";
  const questions = buildSourceScopedValidationOpenQuestions({
    sourceLabel: "custom_context_markdown",
    text,
  });
  assert.equal(questions.length, 1);
  assert.ok(
    questions[0]?.startsWith("custom_context_markdown: "),
    "openQuestion is prefixed with source label",
  );
});

void test("deriveUnresolvedValidationConstraints derives a constraint scoped to the screen via stem matching", () => {
  const model = buildModel({
    openQuestions: [
      {
        openQuestionId: "open-question-aaaa1111",
        text: "custom_context_markdown: Es ist fachlich zu klären, wie sich die Auswahl Netto / Brutto auf die Berechnung auswirkt.",
      },
    ],
  });

  const constraints = deriveUnresolvedValidationConstraints(model);
  assert.equal(constraints.length, 1);
  const [constraint] = constraints;
  assert.equal(constraint?.screenId, "screen-financing");
  assert.ok(
    constraint.fieldIds.includes("screen-financing::field::kaufpreis"),
    "Netto-bearing field is anchored via stem match",
  );
  assert.ok(
    constraint.fieldIds.includes("screen-financing::field::nebenkosten"),
    "Brutto-bearing field is anchored via stem match",
  );
  assert.ok(constraint.evidenceText.includes("Netto / Brutto"));
});

void test("deriveUnresolvedValidationConstraints does not invent scope for generic notes", () => {
  const model = buildModel({
    screens: [
      {
        screenId: "screen-financing",
        name: "Finanzierungsbedarf",
        elements: [],
        actions: [],
        validations: [],
        calculations: [],
        visualRefs: [],
        sourceRefs: ["custom-context-markdown"],
      },
    ],
    openQuestions: [
      {
        openQuestionId: "open-question-bbbb2222",
        text: "custom_context_markdown: Validierungsregeln sind noch zu spezifizieren.",
      },
    ],
  });

  // Strict variant must not anchor a generic note to unrelated fields,
  // otherwise specified validations elsewhere on the mask get cross-blocked.
  const strict = deriveUnresolvedValidationConstraints(model);
  assert.equal(strict.length, 0);
});

void test("deriveUnresolvedValidationConstraintsWithScreenFallback anchors generic notes to the first screen for probe injection", () => {
  const model = buildModel({
    screens: [
      {
        screenId: "screen-financing",
        name: "Finanzierungsbedarf",
        elements: [],
        actions: [],
        validations: [],
        calculations: [],
        visualRefs: [],
        sourceRefs: ["custom-context-markdown"],
      },
    ],
    openQuestions: [
      {
        openQuestionId: "open-question-bbbb2222",
        text: "custom_context_markdown: Validierungsregeln sind noch zu spezifizieren.",
      },
    ],
  });

  const fallback =
    deriveUnresolvedValidationConstraintsWithScreenFallback(model);
  assert.equal(fallback.length, 1);
  const [constraint] = fallback;
  assert.equal(constraint?.screenId, "screen-financing");
  assert.deepEqual(constraint.fieldIds, []);
  assert.deepEqual(constraint.validationIds, []);
  assert.ok(constraint.evidenceText.includes("Validierungsregeln"));
});

void test("deriveUnresolvedValidationConstraints ignores openQuestions that do not describe validation gaps", () => {
  const model = buildModel({
    openQuestions: [
      {
        openQuestionId: "open-question-cccc3333",
        text: "Welche Beleg-Vorlage soll für den Investitionscheckliste verwendet werden?",
      },
    ],
  });

  const constraints = deriveUnresolvedValidationConstraints(model);
  assert.equal(constraints.length, 0);
});

void test("deriveUnresolvedValidationConstraints emits constraints for unresolved validation rules attached to a screen", () => {
  const model = buildModel({
    screens: [
      {
        screenId: "screen-financing",
        name: "Finanzierungsbedarf",
        elements: [
          {
            elementId: "screen-financing::field::kaufpreis",
            label: "Höhe des Kaufpreises (Netto)",
            kind: "text",
          },
        ],
        actions: [],
        validations: [
          {
            validationId: "screen-financing::validation::amount-tbd",
            rule: "Validierungsregeln für Betragsfelder sind noch zu spezifizieren.",
            targetElementId: "screen-financing::field::kaufpreis",
          },
        ],
        calculations: [],
        visualRefs: [],
        sourceRefs: [],
      },
    ],
  });

  const constraints = deriveUnresolvedValidationConstraints(model);
  assert.equal(constraints.length, 1);
  assert.equal(constraints[0]?.screenId, "screen-financing");
  assert.deepEqual(constraints[0].fieldIds, [
    "screen-financing::field::kaufpreis",
  ]);
  assert.deepEqual(constraints[0].validationIds, [
    "screen-financing::validation::amount-tbd",
  ]);
});

void test("classifier fixture covers at least 12 unsupported and 12 label-only cases", async () => {
  const raw = await readFile(
    join(FIXTURE_DIR, "claim-classifier.json"),
    "utf8",
  );
  const parsed = JSON.parse(raw) as {
    cases: Array<{
      id: string;
      text: string;
      classification:
        | "concrete_numeric_data"
        | "concrete_message_text"
        | "label_only"
        | "none";
      unsupported: boolean;
    }>;
  };

  const unsupported = parsed.cases.filter((entry) => entry.unsupported);
  const labelOnly = parsed.cases.filter(
    (entry) => entry.classification === "label_only",
  );
  assert.ok(unsupported.length >= 12);
  assert.ok(labelOnly.length >= 12);

  for (const entry of parsed.cases) {
    const detail = classifyUnresolvedValidationDetail(entry.text);
    assert.equal(detail.classification, entry.classification, entry.id);
  }
});

void test("detectUnsupportedExactValidationClaim ignores label-only unresolved checks and surfaces a clarification warning instead", () => {
  const model = buildModel({
    openQuestions: [
      {
        openQuestionId: "open-question-issue-2067",
        text: "custom_context_markdown: Es ist fachlich zu klären, wie sich die Auswahl Netto / Brutto auf Feldbezeichnungen und Berechnung auswirkt.",
      },
    ],
  });

  const testCase = buildGeneratedCase({
    title: "Unresolved check review",
    objective: "Keep this check generic.",
    steps: [
      {
        index: 1,
        action:
          'Verifiziert, dass das Label "Höhe des Kaufpreises (Netto)" sichtbar ist.',
        expected: "Das Label ist sichtbar.",
      },
    ],
    expectedResults: ["Das Label ist sichtbar."],
  });

  assert.equal(
    detectUnsupportedExactValidationClaim({ testCase, model }),
    undefined,
  );
  const warning = detectOpenQuestionClarificationClaim({ testCase, model });
  assert.ok(warning);
  assert.equal(warning.path, "steps[0].action");
});

void test("field-scoped unresolved questions do not contaminate unrelated cases on the same screen", () => {
  const model = buildModel({
    screens: [
      {
        screenId: "screen-financing",
        name: "Finanzierungsbedarf",
        elements: [
          {
            elementId: "screen-financing::field::person",
            label: "Person",
            kind: "select",
          },
          {
            elementId: "screen-financing::field::kaufpreis",
            label: "Höhe des Kaufpreises (Netto)",
            kind: "text",
          },
        ],
        actions: [],
        validations: [],
        calculations: [],
        visualRefs: [],
        sourceRefs: ["custom-context-markdown"],
      },
    ],
    openQuestions: [
      {
        openQuestionId: "open-question-person-source",
        text: "custom_context_markdown: Es ist fachlich zu klären, welche Datenquelle das Auswahlfeld Person verwendet und wie Personendaten validiert werden.",
      },
    ],
  });

  const unrelatedCase = buildGeneratedCase({
    objective:
      "Verifizieren, dass das Label Höhe des Kaufpreises (Netto) sichtbar ist.",
    steps: [
      {
        index: 1,
        action: "Prüfe das Label Höhe des Kaufpreises (Netto).",
        expected: "Das Label ist sichtbar.",
      },
    ],
    qualitySignals: {
      coveredFieldIds: ["screen-financing::field::kaufpreis"],
      coveredActionIds: [],
      coveredValidationIds: [],
      coveredNavigationIds: [],
      confidence: 0.9,
    },
  });
  assert.equal(
    detectOpenQuestionClarificationClaim({ testCase: unrelatedCase, model }),
    undefined,
  );

  const relatedCase = buildGeneratedCase({
    objective: "Verifizieren, dass das Label Person sichtbar ist.",
    steps: [
      {
        index: 1,
        action: "Prüfe das Label Person.",
        expected: "Das Label ist sichtbar.",
      },
    ],
    qualitySignals: {
      coveredFieldIds: ["screen-financing::field::person"],
      coveredActionIds: [],
      coveredValidationIds: [],
      coveredNavigationIds: [],
      confidence: 0.9,
    },
  });
  assert.ok(
    detectOpenQuestionClarificationClaim({ testCase: relatedCase, model }),
  );
});

void test("detectUnsupportedExactValidationClaim blocks quoted validation messages even when the message text is custom", () => {
  const model = buildModel({
    openQuestions: [
      {
        openQuestionId: "open-question-issue-2067-custom-message",
        text: "custom_context_markdown: Validierungsregeln für Betragsfelder und MwSt.-Auswahl sind noch zu spezifizieren.",
      },
    ],
  });

  const testCase = buildGeneratedCase({
    objective: "Keep this unresolved validation generic.",
    steps: [
      {
        index: 1,
        action:
          'Expected validation message: "Bitte geben Sie einen Wert ein".',
        expected: "The custom validation message is shown.",
      },
    ],
    expectedResults: ["The custom validation message is shown."],
    qualitySignals: {
      coveredFieldIds: ["screen-financing::field::mwst"],
      coveredActionIds: [],
      coveredValidationIds: [],
      coveredNavigationIds: [],
      confidence: 0.9,
    },
  });

  const error = detectUnsupportedExactValidationClaim({ testCase, model });
  assert.ok(error);
  assert.equal(error.path, "steps[0].action");
  assert.equal(
    detectOpenQuestionClarificationClaim({ testCase, model }),
    undefined,
  );
});
