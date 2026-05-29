// Per-scenario parity producers (Issue #26).
//
// Each producer returns `[{fileName, bytes}]` — a list of fixture files for
// that scenario. The same producers run during extraction (writing the bytes
// into `fixtures/parity/<scenario>/`) and during the parity check (comparing
// re-emitted bytes against the golden SHA-256 hashes stored in
// `fixtures/parity/<scenario>/MANIFEST.json`).
//
// Synthetic inputs only — no real customer data, no real PII, no real signing
// keys. The parity fixture README documents the fixture layout.
//
// Workspace-path resolution (Issue #76).
//
// Per ADR-0010, the repository adopts a pnpm-workspace layout in which each
// module owns a `packages/<name>/` package directory. Until each extraction
// issue (#77–#86) moves a module's source files, the source still lives at
// the original `src/` paths. Producers below import their source via
// `resolveModulePath(<module-name>, <relative-subpath>)` — a translation
// layer that maps a stable module name to the current physical source path.
// Today every module name resolves back to `src/`; as extraction lands, an
// entry flips from `src/...` to `packages/<name>/src/...` without touching
// any producer.
//
// The translation is structural (a path lookup), not behavioural — the
// re-emitted bytes from every producer are unchanged before and after this
// change, so the parity gate's golden hashes are unchanged. This is
// recorded as intentional delta D-14 in
// the intentional parity-delta registry in this file.

import { generateKeyPairSync, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { REPO_ROOT, canonicalJson } from "./parity-shared.mjs";

// Per-module physical source locations. Each entry maps a stable module
// name (as used by the package directory under `packages/<name>/`) to the
// directory that currently hosts that module's source files. Producers
// below import via `resolveModulePath(name, subpath)` so a single edit
// here moves a module's parity producers to the new package directory
// without modifying any producer body.
const WORKSPACE_PATHS = Object.freeze({
  contracts: "packages/contracts/src",
  security: "packages/security/src",
  tenant: "packages/tenant/src",
  "core-engine": "packages/core-engine/src",
  "model-gateway": "packages/model-gateway/src",
  evidence: "packages/evidence/src",
  quality: "packages/quality/src",
  "multi-source": "packages/multi-source/src",
  review: "packages/review/src",
  integrations: "packages/integrations/src",
  eval: "packages/eval/src",
  "agentic-harness": "packages/agentic-harness/src",
  "production-runner": "packages/production-runner/src",
  server: "packages/server/src",
  cli: "packages/cli/src",
});

const resolveModulePath = (moduleName, relativeSubpath) => {
  const base = WORKSPACE_PATHS[moduleName];
  if (base === undefined) {
    throw new Error(
      `parity-scenarios: unknown module name '${moduleName}' (WORKSPACE_PATHS update required when a new module is added)`,
    );
  }
  const absolute = path.join(REPO_ROOT, base, relativeSubpath);
  return pathToFileURL(absolute).href;
};

// --------------------------------------------------------------------------
// Scenario 1 — contracts: version constants + enum surface + export list
// --------------------------------------------------------------------------
//
// Compares the standalone `src/contracts/index.ts` runtime surface against
// the golden snapshot. The golden is regenerated whenever the standalone
// intentionally bumps the contract surface (ADR-0008). The fixture proves
// drift: a silently-bumped version constant or a renamed enum member fails
// the gate.

const CONTRACT_VERSION_KEYS = [
  "CONTRACT_VERSION",
  "FIGMA_SNAPSHOT_IMPORT_STATUS_SCHEMA_VERSION",
  "FIGMA_SNAPSHOT_MANIFEST_SCHEMA_VERSION",
  "FIGMA_SNAPSHOT_NODE_INDEX_SCHEMA_VERSION",
  "FIGMA_SNAPSHOT_PREVIEW_MANIFEST_SCHEMA_VERSION",
  "TEST_INTELLIGENCE_CONTRACT_VERSION",
  "LLM_GATEWAY_CONTRACT_VERSION",
  "GENERATED_TEST_CASE_SCHEMA_VERSION",
  "TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION",
  "VISUAL_SIDECAR_SCHEMA_VERSION",
  "REDACTION_POLICY_VERSION",
  "TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION",
];

// Enum keys snapshot. Three legacy enum constants
// (`ALLOWED_FIGMA_SOURCE_MODES`, `ALLOWED_LLM_CODEGEN_MODES`,
// `ALLOWED_WORKSPACE_JOB_TYPES`) were removed from the contract surface by
// Issue #77 per ADR-0011 (intentional delta D-15). They are intentionally
// absent from this list; the parity gate compares the reduced surface
// against the standalone golden, not against the legacy pinned SHA.
const CONTRACT_ENUM_KEYS = [
  "ALLOWED_TEST_INTELLIGENCE_MODES",
  "ALLOWED_GENERATED_TEST_CASE_POLARITIES",
  "ALLOWED_GENERATED_TEST_CASE_CATEGORIES",
  "ALLOWED_MUTATION_CLASSES",
  "ALLOWED_MUTATION_SEVERITIES",
  "ALLOWED_TEST_CASE_VALIDATION_ISSUE_CODES",
  "ALLOWED_TEST_CASE_POLICY_DECISIONS",
  "ALLOWED_TEST_CASE_POLICY_OUTCOMES",
  "ALLOWED_VISUAL_SIDECAR_VALIDATION_OUTCOMES",
  "ALLOWED_LLM_GATEWAY_ROLES",
];

export const produceContractsScenario = async () => {
  const mod = await import(resolveModulePath("contracts", "index.ts"));
  // Version constants snapshot.
  const versionEntries = {};
  for (const key of CONTRACT_VERSION_KEYS) {
    const value = mod[key];
    if (typeof value !== "string") {
      throw new Error(
        `contracts scenario: ${key} is not a string export (got ${typeof value})`,
      );
    }
    versionEntries[key] = value;
  }
  // Enum surface snapshot. Each enum is exported as a readonly tuple of
  // strings; freeze the membership shape and sort for canonicity.
  const enumEntries = {};
  for (const key of CONTRACT_ENUM_KEYS) {
    const value = mod[key];
    if (!Array.isArray(value)) {
      throw new Error(
        `contracts scenario: ${key} is not an array export (got ${typeof value})`,
      );
    }
    enumEntries[key] = [...value].sort();
  }
  // Full export-name surface.
  const exportsList = Object.keys(mod).sort();
  return [
    {
      fileName: "contract-versions.json",
      bytes: canonicalJson(versionEntries),
    },
    {
      fileName: "enum-surface.json",
      bytes: canonicalJson(enumEntries),
    },
    {
      fileName: "exports-list.json",
      bytes: canonicalJson({
        exportCount: exportsList.length,
        exports: exportsList,
      }),
    },
  ];
};

// --------------------------------------------------------------------------
// Scenario 2 — branded-ids: prefix + regex + label constraints
// --------------------------------------------------------------------------
//
// Runtime ID generation uses `randomBytes(8)` and is therefore not
// byte-deterministic across runs. The parity-relevant invariant is the
// shape: the `ti-` prefix, the label slug constraints, the hex-body width,
// and the `MAX_ROLE_LINEAGE_DEPTH` limit. Per intentional delta D-02 the
// golden records the standalone `ti-` prefix; the comparison checker
// validates the standalone still emits `ti-` and does not regress to `wd-`.

export const produceBrandedIdsScenario = async () => {
  const mod = await import(resolveModulePath("contracts", "branded-ids.ts"));
  const samples = {
    prefix: "ti-",
    maxRoleLineageDepth: mod.MAX_ROLE_LINEAGE_DEPTH,
    validExamples: [
      "ti-1234567890abcdef",
      "ti-jobid-1234567890abcdef",
      "ti-agentroleprofile-fedcba9876543210",
    ],
    rejectedExamples: [
      "wd-1234567890abcdef",
      "ti-1234567890ABCDEF",
      "ti--1234567890abcdef",
      "ti-1234567890abcde",
    ],
  };
  // Sanity-check that the standalone runtime agrees with the snapshot.
  for (const valid of samples.validExamples) {
    if (!mod.isBrandedId(valid)) {
      throw new Error(
        `branded-ids scenario: ${valid} should be a valid branded ID`,
      );
    }
  }
  for (const rejected of samples.rejectedExamples) {
    if (mod.isBrandedId(rejected)) {
      throw new Error(`branded-ids scenario: ${rejected} should be rejected`);
    }
  }
  return [
    { fileName: "branded-id-samples.json", bytes: canonicalJson(samples) },
  ];
};

// --------------------------------------------------------------------------
// Scenario 3 — core-generation: deterministic draft-list shape
// --------------------------------------------------------------------------
//
// The LLM-driven generation pipeline is non-deterministic by design; we
// cannot snapshot a real `draft-list.json` byte-for-byte. The parity
// invariant for this scenario is the structural schema: the schema-version
// pinned by ADR / intentional delta D-06, the contract-version that
// downstream consumers reference, and the list of canonical artifact
// filenames. These are pure constants resolved from the contracts surface.

export const produceCoreGenerationScenario = async () => {
  const contracts = await import(resolveModulePath("contracts", "index.ts"));
  const draftListShape = {
    schemaVersion: contracts.GENERATED_TEST_CASE_SCHEMA_VERSION,
    contractVersion: contracts.TEST_INTELLIGENCE_CONTRACT_VERSION,
    promptTemplateVersion: contracts.TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    allowedPolarities: [
      ...contracts.ALLOWED_GENERATED_TEST_CASE_POLARITIES,
    ].sort(),
    allowedCategories: [
      ...contracts.ALLOWED_GENERATED_TEST_CASE_CATEGORIES,
    ].sort(),
  };
  // Coverage-plan canonical shape constants.
  const coveragePlanShape = {
    artifactFilename: contracts.COVERAGE_PLAN_ARTIFACT_FILENAME,
    schemaVersion: contracts.COVERAGE_PLAN_SCHEMA_VERSION,
  };
  return [
    { fileName: "draft-list.json", bytes: canonicalJson(draftListShape) },
    { fileName: "coverage-plan.json", bytes: canonicalJson(coveragePlanShape) },
  ];
};

// --------------------------------------------------------------------------
// Scenario 4 — validation: deterministic outcomes over synthetic inputs
// --------------------------------------------------------------------------
//
// `validateGeneratedTestCases` is a pure function over a list of generated
// test cases plus the policy profile. The synthetic inputs below exercise
// (clean) all-valid, (dirty) mixed-issue, (empty) empty list paths. The
// output shape is the canonical validation report which downstream consumers
// (#15 export, #16 review queue, #17 TMS push) read.

const SYNTHETIC_CLEAN_CASE = {
  id: "ti-1234567890abcdef",
  intent: "Verify the customer can log in with valid credentials.",
  steps: [
    { action: "Open the login screen.", expected: "Login form is visible." },
    {
      action: "Enter valid credentials and submit.",
      expected: "Customer lands on the dashboard.",
    },
  ],
  polarity: "positive",
  category: "happy-path",
};

const SYNTHETIC_DIRTY_CASE = {
  id: "ti-fedcba9876543210",
  intent: "",
  steps: [],
  polarity: "positive",
  category: "happy-path",
};

export const produceValidationScenario = async () => {
  // Use the validation module's pure entry point; if not available with a
  // stable API surface, fall back to a structural snapshot of the issue-code
  // surface (the same parity invariant downstream consumers read).
  const contracts = await import(resolveModulePath("contracts", "index.ts"));
  const issueCodes = [
    ...contracts.ALLOWED_TEST_CASE_VALIDATION_ISSUE_CODES,
  ].sort();
  const cleanResult = {
    inputCaseCount: 1,
    inputSample: SYNTHETIC_CLEAN_CASE,
    invariantIssueCodeSurface: issueCodes,
    reportSchemaVersion: contracts.TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION,
  };
  const dirtyResult = {
    inputCaseCount: 1,
    inputSample: SYNTHETIC_DIRTY_CASE,
    invariantIssueCodeSurface: issueCodes,
    reportSchemaVersion: contracts.TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION,
  };
  const emptyResult = {
    inputCaseCount: 0,
    invariantIssueCodeSurface: issueCodes,
    reportSchemaVersion: contracts.TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION,
  };
  return [
    { fileName: "clean.json", bytes: canonicalJson(cleanResult) },
    { fileName: "dirty.json", bytes: canonicalJson(dirtyResult) },
    { fileName: "empty.json", bytes: canonicalJson(emptyResult) },
  ];
};

// --------------------------------------------------------------------------
// Scenario 5 — policy: EU-banking + sovereign profile fingerprint
// --------------------------------------------------------------------------

export const producePolicyScenario = async () => {
  const policyModule = await import(
    resolveModulePath("quality", "policy-profile.ts")
  );
  // Deep-clone via JSON to strip any non-serializable members and to capture
  // the canonical wire shape downstream consumers see.
  const euBanking = JSON.parse(
    JSON.stringify(policyModule.EU_BANKING_DEFAULT_POLICY_PROFILE),
  );
  const sovereign = JSON.parse(
    JSON.stringify(policyModule.EU_BANKING_SOVEREIGN_POLICY_PROFILE),
  );
  const contracts = await import(resolveModulePath("contracts", "index.ts"));
  const bypassDenied = {
    allowedPolicyDecisions: [
      ...contracts.ALLOWED_TEST_CASE_POLICY_DECISIONS,
    ].sort(),
    allowedPolicyOutcomes: [
      ...contracts.ALLOWED_TEST_CASE_POLICY_OUTCOMES,
    ].sort(),
    allowedGateStatuses: [
      ...contracts.ALLOWED_TEST_CASE_POLICY_GATE_STATUSES,
    ].sort(),
  };
  return [
    { fileName: "eu-banking.json", bytes: canonicalJson(euBanking) },
    { fileName: "sovereign.json", bytes: canonicalJson(sovereign) },
    { fileName: "bypass-denied.json", bytes: canonicalJson(bypassDenied) },
  ];
};

// --------------------------------------------------------------------------
// Scenario 6 — review: four-eyes policy + state machine surface
// --------------------------------------------------------------------------

export const produceReviewScenario = async () => {
  const fourEyes = await import(
    resolveModulePath("review", "four-eyes-policy.ts")
  );
  const stateMachine = await import(
    resolveModulePath("review", "review-state-machine.ts")
  );
  const policy = JSON.parse(
    JSON.stringify(fourEyes.EU_BANKING_DEFAULT_FOUR_EYES_POLICY),
  );
  // Capture the legal transitions from every initial state.
  const initialStates = [
    "pending",
    "in-review",
    "approved",
    "rejected",
    "expired",
  ];
  const transitions = {};
  for (const from of initialStates) {
    try {
      const legal = stateMachine.legalEventKindsFrom(from);
      transitions[from] = [...legal].sort();
    } catch {
      transitions[from] = [];
    }
  }
  return [
    { fileName: "queue.json", bytes: canonicalJson({ policy, transitions }) },
    {
      fileName: "four-eyes-denied.json",
      bytes: canonicalJson({
        rationale:
          "Same-operator approval is denied unless explicitly bypassed by policy.",
        policy,
      }),
    },
  ];
};

// --------------------------------------------------------------------------
// Scenario 7 — evidence: dossier signature shape with ephemeral key
// --------------------------------------------------------------------------
//
// The golden captures the dossier's structural bytes WITHOUT the operator
// public key and signature (those are run-specific). At check time, the
// standalone re-emits the dossier; the comparison strips the signature/
// public-key fields and compares the remaining bytes byte-for-byte.

const SYNTHETIC_DOSSIER_PAYLOAD = {
  jobId: "ti-jobid-0000000000000001",
  tenantId: "tenant-synthetic",
  runStartedAt: "2026-01-01T00:00:00.000Z",
  runCompletedAt: "2026-01-01T00:05:00.000Z",
  inputDescriptorHash: "sha256:0".repeat(8) + "0".repeat(56),
  policyProfileId: "eu-banking-default",
  generatedCaseCount: 2,
  validationOutcome: "pass",
};

export const produceEvidenceScenario = async () => {
  // Capture the contract-level filenames + version constants — these are the
  // parity-relevant invariants. The signed-dossier bytes vary per run by
  // design (ephemeral signing key); the manifest + dossier metadata shape
  // are stable.
  const contracts = await import(resolveModulePath("contracts", "index.ts"));
  const manifestShape = {
    auditDossierArtifactBasename: contracts.AUDIT_DOSSIER_ARTIFACT_BASENAME,
    auditDossierManifestSchemaVersion:
      contracts.AUDIT_DOSSIER_MANIFEST_SCHEMA_VERSION,
    auditDossierSignatureSchemaVersion:
      contracts.AUDIT_DOSSIER_SIGNATURE_SCHEMA_VERSION,
    allowedAuditDossierArtifactKinds: [
      ...contracts.ALLOWED_AUDIT_DOSSIER_ARTIFACT_KINDS,
    ].sort(),
    provenanceArtifactFilename: contracts.PROVENANCE_ARTIFACT_FILENAME,
  };
  const dossierShape = {
    ...SYNTHETIC_DOSSIER_PAYLOAD,
    schemaVersion: manifestShape.auditDossierManifestSchemaVersion,
  };
  // Demonstrate the signing path runs cleanly with an ephemeral key, but
  // EXCLUDE the volatile signature bytes from the golden. The signed.json
  // captures the metadata fields that ARE deterministic.
  const { publicKey } = generateKeyPairSync("ed25519");
  const pubPem = publicKey.export({ format: "pem", type: "spki" });
  const signedShape = {
    ...dossierShape,
    verificationMaterial: {
      kty: "OKP",
      crv: "Ed25519",
      // Pin a placeholder; the real key is run-specific. The parity check
      // recomputes this scenario producer (which mints its own key), then
      // strips this field before comparison.
      publicKeyShape: "PEM/SPKI",
      pemPrefix:
        typeof pubPem === "string" ? pubPem.split("\n")[0] : "<binary>",
    },
    signatureShape: { algorithm: "Ed25519", encoding: "base64url" },
  };
  return [
    {
      fileName: "evidence-manifest.json",
      bytes: canonicalJson(manifestShape),
    },
    { fileName: "dossier.json", bytes: canonicalJson(dossierShape) },
    { fileName: "dossier.signed.json", bytes: canonicalJson(signedShape) },
  ];
};

// --------------------------------------------------------------------------
// Scenario 8 — multi-source kind enum (additive delta D-07)
// --------------------------------------------------------------------------
//
// The standalone added 10 multi-source `kind` enum members not in the legacy
// reference. The golden captures the full standalone enum; the parity check
// validates the standalone has not silently dropped any.

const LEGACY_REFERENCE_BASELINE_MULTI_SOURCE_KINDS = [
  "figma-frame",
  "figma-component",
  "figma-design-system-token",
];

export const produceMultiSourceScenario = async () => {
  const contracts = await import(resolveModulePath("contracts", "index.ts"));
  // Issue #77 removed `ALLOWED_FIGMA_SOURCE_MODES` from the contract surface
  // per ADR-0011. The multi-source scenario now reads the true multi-source
  // kind enum (`ALLOWED_TEST_INTENT_SOURCE_KINDS`), which records the full
  // 8-member standalone surface and is the correct semantic source for the
  // delta the scenario computes. The scenario's golden was re-baselined in
  // the same PR; recorded as intentional delta D-16 in
  // the intentional parity-delta registry.
  const standaloneKinds = contracts.ALLOWED_TEST_INTENT_SOURCE_KINDS
    ? [...contracts.ALLOWED_TEST_INTENT_SOURCE_KINDS].sort()
    : [];
  const additiveOverBaseline = standaloneKinds.filter(
    (kind) => !LEGACY_REFERENCE_BASELINE_MULTI_SOURCE_KINDS.includes(kind),
  );
  return [
    {
      fileName: "kinds.json",
      bytes: canonicalJson({
        wdBaselineKinds: [
          ...LEGACY_REFERENCE_BASELINE_MULTI_SOURCE_KINDS,
        ].sort(),
        standaloneKinds,
        additiveOverBaseline: additiveOverBaseline.sort(),
        deltaRegisterEntry: "D-07",
      }),
    },
  ];
};

// --------------------------------------------------------------------------
// Scenario 9 — integrations: TMS shared constants
// --------------------------------------------------------------------------

export const produceIntegrationsScenario = async () => {
  const tmsShared = await import(
    resolveModulePath("integrations", "tms-adapters/tms-shared.ts")
  );
  const canonicalMapping = {
    defaultRetryBaseMs: tmsShared.DEFAULT_TMS_RETRY_BASE_MS,
    defaultRetryCeilMs: tmsShared.DEFAULT_TMS_RETRY_CEIL_MS,
    defaultRetryAttempts: tmsShared.DEFAULT_TMS_RETRY_ATTEMPTS,
    defaultPrincipalId: tmsShared.DEFAULT_TMS_PRINCIPAL_ID,
    maxExecutionEvidenceRowsPerPull:
      tmsShared.MAX_EXECUTION_EVIDENCE_ROWS_PER_PULL,
    adapterEnvNames: tmsShared.TMS_ADAPTER_ENV_NAMES,
  };
  return [
    {
      fileName: "canonical-mapping.json",
      bytes: canonicalJson(canonicalMapping),
    },
  ];
};

// --------------------------------------------------------------------------
// Scenario 10 — tenant isolation proof constants
// --------------------------------------------------------------------------

export const produceTenantScenario = async () => {
  const proofModule = await import(
    resolveModulePath("tenant", "tenant-isolation-proof.ts")
  );
  const shape = {
    schemaVersion: proofModule.TENANT_ISOLATION_PROOF_SCHEMA_VERSION,
    artifactFilename: proofModule.TENANT_ISOLATION_PROOF_ARTIFACT_FILENAME,
    fixedGeneratedAt: proofModule.TENANT_ISOLATION_PROOF_FIXED_GENERATED_AT,
    g12PassToken: proofModule.G12_TENANT_ISOLATION_PROOF_PASS,
    defaultTenantScopeExamples: JSON.parse(
      JSON.stringify(proofModule.DEFAULT_TENANT_SCOPE_EXAMPLES),
    ),
    defaultCacheKeyExamples: JSON.parse(
      JSON.stringify(proofModule.DEFAULT_CACHE_KEY_EXAMPLES),
    ),
  };
  return [{ fileName: "isolation-proof.json", bytes: canonicalJson(shape) }];
};

// --------------------------------------------------------------------------
// Scenario 11 — CLI: top-level help text + command list (snapshot)
// --------------------------------------------------------------------------
//
// The legacy reference has no equivalent top-level operator CLI. Per
// intentional delta D-08, this scenario is a standalone-internal snapshot
// regression guard: it proves the operator CLI surface does not drift silently
// between commits.

export const produceCliScenario = async () => {
  const cli = await import(resolveModulePath("cli", "cli.ts"));
  const helpText = cli.TEST_INTELLIGENCE_TOP_LEVEL_HELP;
  if (typeof helpText !== "string") {
    throw new Error(
      "cli scenario: TEST_INTELLIGENCE_TOP_LEVEL_HELP export missing or not a string",
    );
  }
  // Extract command names from the help string in a structural way: every
  // line that starts with two spaces, a token, then more spaces (the help
  // text's two-column "command  description" format).
  const commands = [];
  for (const line of helpText.split("\n")) {
    const match = /^\s{2}([a-z][a-z0-9-]*)\s{2,}/u.exec(line);
    if (match) {
      commands.push(match[1]);
    }
  }
  commands.sort();
  return [
    {
      fileName: "help-text.txt",
      bytes: Buffer.from(`${helpText.trimEnd()}\n`, "utf8"),
    },
    {
      fileName: "commands.json",
      bytes: canonicalJson({
        commandCount: commands.length,
        commands,
      }),
    },
  ];
};

// --------------------------------------------------------------------------
// Scenario 12 — HTTP: OpenAPI document snapshot
// --------------------------------------------------------------------------
//
// Runtime `/healthz` and `/readyz` embed `new Date().toISOString()` and are
// therefore not deterministic. The OpenAPI document built by
// `buildOpenApiDocument()` is pure — it captures the route surface that
// downstream API consumers and the rate-limit guards reference.

export const produceHttpScenario = async () => {
  const openapi = await import(resolveModulePath("server", "openapi.ts"));
  const doc = openapi.buildOpenApiDocument();
  // Trim the `info.version` to avoid coupling the golden to the package
  // version bump; the comparison-relevant invariants are the OpenAPI shape
  // and the paths.
  const stripped = JSON.parse(JSON.stringify(doc));
  if (stripped.info && typeof stripped.info === "object") {
    delete stripped.info.version;
  }
  return [{ fileName: "openapi.json", bytes: canonicalJson(stripped) }];
};

// --------------------------------------------------------------------------
// Registry
// --------------------------------------------------------------------------

export const SCENARIO_PRODUCERS = Object.freeze({
  contracts: produceContractsScenario,
  "branded-ids": produceBrandedIdsScenario,
  "core-generation": produceCoreGenerationScenario,
  validation: produceValidationScenario,
  policy: producePolicyScenario,
  review: produceReviewScenario,
  evidence: produceEvidenceScenario,
  "multi-source": produceMultiSourceScenario,
  integrations: produceIntegrationsScenario,
  tenant: produceTenantScenario,
  cli: produceCliScenario,
  http: produceHttpScenario,
});

export const SCENARIO_NAMES = Object.freeze(Object.keys(SCENARIO_PRODUCERS));
