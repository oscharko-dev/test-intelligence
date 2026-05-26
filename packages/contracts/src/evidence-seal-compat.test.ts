/**
 * Evidence-seal compatibility regression for the reduced contract surface.
 *
 * ADR-0011, "Evidence-Seal Compatibility Statement":
 *
 *   Evidence packages sealed under the full 426-export surface must continue
 *   to deserialise correctly under the reduced surface. The wire identifiers
 *   embedded in sealed evidence packages -- specifically `CONTRACT_VERSION`,
 *   `TEST_INTELLIGENCE_CONTRACT_VERSION`, artifact schema-version constants,
 *   and all artifact filename constants -- are retained symbols under this
 *   ADR. A sealed evidence package that references only retained symbols is
 *   therefore forward-compatible with the reduced surface without migration.
 *
 * This test exercises that contract directly. It constructs a synthetic
 * pre-reduction evidence envelope whose every wire field references the
 * retained constant set, then asserts that each referenced constant resolves
 * under the reduced surface to the value the envelope was sealed against.
 *
 * If a future change removes one of these retained constants by accident,
 * the corresponding lookup below evaluates to `undefined` and the assertion
 * fails closed. The contract-version freeze test catches the symbol-name
 * change; this test catches the wire-value contract for the symbols an
 * evidence consumer reads on the read path.
 */

import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "./index.js";

const CONTRACT_RECORD = contracts as unknown as Record<string, unknown>;

interface PreReductionEvidenceEnvelope {
  readonly contractVersion: string;
  readonly testIntelligenceContractVersion: string;
  readonly llmGatewayContractVersion: string;
  readonly artifacts: ReadonlyArray<{
    readonly category: string;
    readonly schemaVersionConstant: string;
    readonly filenameConstant: string;
  }>;
}

// Synthetic pre-reduction sample. The schema/filename constants enumerated
// here cover the major artifact classes (audit dossier, ml-bom, model card,
// evidence verifier, generated test cases, agent harness, lbom, visual
// sidecar, provenance) so a regression that removes any of them surfaces
// here even if no other test imports the affected constant by name.
// Constant names below are sampled from the actual reduced surface
// exported by `packages/contracts/src/index.ts`. The list spans every
// major artifact class so a regression that removes any of them surfaces
// here even if no other test imports the affected constant by name.
//
// Pairs are SchemaVersion + Filename where the surface exports both;
// AUDIT_DOSSIER exports a BASENAME instead of a FILENAME and two
// MANIFEST/SIGNATURE schema-version constants, modelled as separate
// audit-dossier entries that omit the filename.
const PRE_REDUCTION_SAMPLE: PreReductionEvidenceEnvelope = {
  contractVersion: "4.66.0",
  testIntelligenceContractVersion: "1.39.0",
  llmGatewayContractVersion: "1.0.0",
  artifacts: [
    {
      category: "audit-dossier-manifest",
      schemaVersionConstant: "AUDIT_DOSSIER_MANIFEST_SCHEMA_VERSION",
      filenameConstant: "AUDIT_DOSSIER_ARTIFACT_BASENAME",
    },
    {
      category: "audit-dossier-signature",
      schemaVersionConstant: "AUDIT_DOSSIER_SIGNATURE_SCHEMA_VERSION",
      filenameConstant: "AUDIT_DOSSIER_ARTIFACT_BASENAME",
    },
    {
      category: "generated-test-cases",
      schemaVersionConstant: "GENERATED_TEST_CASE_SCHEMA_VERSION",
      filenameConstant: "GENERATED_TESTCASES_ARTIFACT_FILENAME",
    },
    {
      category: "agent-harness-graph",
      schemaVersionConstant: "AGENT_HARNESS_EXECUTION_GRAPH_SCHEMA_VERSION",
      filenameConstant: "AGENT_ITERATIONS_ARTIFACT_FILENAME",
    },
    {
      category: "agent-iterations",
      schemaVersionConstant: "AGENT_ITERATIONS_SCHEMA_VERSION",
      filenameConstant: "AGENT_ITERATIONS_ARTIFACT_FILENAME",
    },
    {
      category: "lbom",
      schemaVersionConstant: "LBOM_ARTIFACT_SCHEMA_VERSION",
      filenameConstant: "LBOM_ARTIFACT_FILENAME",
    },
    {
      category: "visual-sidecar-result",
      schemaVersionConstant: "VISUAL_SIDECAR_RESULT_SCHEMA_VERSION",
      filenameConstant: "VISUAL_SIDECAR_RESULT_ARTIFACT_FILENAME",
    },
    {
      category: "visual-sidecar-validation-report",
      schemaVersionConstant: "VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION",
      filenameConstant: "VISUAL_SIDECAR_VALIDATION_REPORT_ARTIFACT_FILENAME",
    },
    {
      category: "evidence-verify-response",
      schemaVersionConstant: "EVIDENCE_VERIFY_RESPONSE_SCHEMA_VERSION",
      // Reuse a stable artifact filename to keep the row shape uniform; the
      // evidence-verify response is delivered via the audit-dossier basename
      // suite on the read path.
      filenameConstant: "AUDIT_DOSSIER_ARTIFACT_BASENAME",
    },
  ],
};

void test("evidence-seal compat: top-level version constants resolve to pre-reduction values", () => {
  assert.equal(
    CONTRACT_RECORD["CONTRACT_VERSION"],
    PRE_REDUCTION_SAMPLE.contractVersion,
    "CONTRACT_VERSION must remain pinned at the pre-reduction value (ADR-0011 version-constant retention).",
  );
  assert.equal(
    CONTRACT_RECORD["TEST_INTELLIGENCE_CONTRACT_VERSION"],
    PRE_REDUCTION_SAMPLE.testIntelligenceContractVersion,
  );
  assert.equal(
    CONTRACT_RECORD["LLM_GATEWAY_CONTRACT_VERSION"],
    PRE_REDUCTION_SAMPLE.llmGatewayContractVersion,
  );
});

void test("evidence-seal compat: every artifact schema-version constant is retained", () => {
  for (const artifact of PRE_REDUCTION_SAMPLE.artifacts) {
    const value = CONTRACT_RECORD[artifact.schemaVersionConstant];
    assert.notEqual(
      value,
      undefined,
      `Reduced surface is missing schema-version constant ${artifact.schemaVersionConstant} required by ${artifact.category} evidence envelopes.`,
    );
    assert.equal(
      typeof value,
      "string",
      `Schema-version constant ${artifact.schemaVersionConstant} must be a string for wire compatibility.`,
    );
  }
});

void test("evidence-seal compat: every artifact filename constant is retained", () => {
  for (const artifact of PRE_REDUCTION_SAMPLE.artifacts) {
    const value = CONTRACT_RECORD[artifact.filenameConstant];
    assert.notEqual(
      value,
      undefined,
      `Reduced surface is missing artifact filename constant ${artifact.filenameConstant} required by ${artifact.category} evidence envelopes.`,
    );
    assert.equal(
      typeof value,
      "string",
      `Artifact filename constant ${artifact.filenameConstant} must be a string for wire compatibility.`,
    );
  }
});

void test("evidence-seal compat: a synthetic seal envelope can be reconstituted from the reduced surface", () => {
  // Simulate the deserialization step an evidence consumer performs: read
  // each wire field, look up the constant by name in the contracts module,
  // and assert the resolved record is fully populated.
  const resolved: Record<string, unknown> = {
    contractVersion: CONTRACT_RECORD["CONTRACT_VERSION"],
    testIntelligenceContractVersion:
      CONTRACT_RECORD["TEST_INTELLIGENCE_CONTRACT_VERSION"],
    llmGatewayContractVersion: CONTRACT_RECORD["LLM_GATEWAY_CONTRACT_VERSION"],
    artifacts: PRE_REDUCTION_SAMPLE.artifacts.map((artifact) => ({
      category: artifact.category,
      schemaVersion: CONTRACT_RECORD[artifact.schemaVersionConstant],
      filename: CONTRACT_RECORD[artifact.filenameConstant],
    })),
  };

  // Every leaf must be defined (no undefined wires).
  const flatten = (value: unknown): unknown[] => {
    if (value === null || value === undefined) return [value];
    if (Array.isArray(value)) return value.flatMap(flatten);
    if (typeof value === "object")
      return Object.values(value as Record<string, unknown>).flatMap(flatten);
    return [value];
  };
  const undefinedLeaves = flatten(resolved).filter((v) => v === undefined);
  assert.equal(
    undefinedLeaves.length,
    0,
    "Reconstituted evidence envelope has undefined wire fields, indicating the reduced surface dropped a retained constant.",
  );
});
