/**
 * Meta-facade entry point (`@oscharko-dev/ti-meta` during the bootstrap
 * period). When Issue #87 retires the repository root as the published
 * npm entry point, this package takes over the `@oscharko-dev/test-intelligence`
 * name and its `.` export becomes the public root API.
 *
 * For now the meta-facade re-exports the reduced public contract surface
 * from `@oscharko-dev/ti-contracts` so that the `./contracts` sub-export
 * (added to this package's `exports` field post-#87) is already wired
 * against the reduced surface ratified by ADR-0011.
 */

export * from "@oscharko-dev/ti-contracts";
export * from "@oscharko-dev/ti-security";
export * from "@oscharko-dev/ti-core-engine";
export * from "@oscharko-dev/ti-model-gateway";
export * from "@oscharko-dev/ti-evidence";
export * from "@oscharko-dev/ti-quality";
export * from "@oscharko-dev/ti-multi-source";
export * from "@oscharko-dev/ti-review";
export * from "@oscharko-dev/ti-integrations";
export * from "@oscharko-dev/ti-eval";
export * from "@oscharko-dev/ti-agentic-harness";
export * from "@oscharko-dev/ti-production-runner";
export * from "@oscharko-dev/ti-server";

// `AgentSourceLabel` and `LlmCircuitState` are declared in BOTH the contracts
// package and the model-gateway package with structurally equivalent
// definitions (predating the package split). The explicit named re-export
// below disambiguates the `export *` collision by anchoring both names to the
// contracts package, which is the canonical public source.
export type {
  AgentSourceLabel,
  LlmCircuitState,
} from "@oscharko-dev/ti-contracts";

// `FaithfulnessVerdict` and `HallucinationFinding` are declared in BOTH
// ti-contracts and ti-production-runner (faithfulness-eval / hallucination-eval
// carry-in). Anchor to contracts as the canonical surface.
export type {
  FaithfulnessVerdict,
  HallucinationFinding,
} from "@oscharko-dev/ti-contracts";

// `extractAcceptanceCriteriaFromMarkdown` is exported by ti-core-engine and
// ti-production-runner for different package entrypoints. Anchor the public
// meta-facade to the core-engine extractor because it owns the generic parsing
// semantics used before runner-specific rendering.
export { extractAcceptanceCriteriaFromMarkdown } from "@oscharko-dev/ti-core-engine";

// `RecordTransitionInput`, `RecordTransitionResult`, and `ReviewStore` are
// declared in BOTH ti-security and ti-production-runner (review-store carry-in).
// Anchor to ti-security as the canonical source.
export type {
  RecordTransitionInput,
  RecordTransitionResult,
  ReviewStore,
} from "@oscharko-dev/ti-security";
