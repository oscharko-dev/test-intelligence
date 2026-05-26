/**
 * Public surface for `@oscharko-dev/ti-cli`.
 *
 * The CLI package is an entry-point package — its primary deliverable is the
 * `test-intelligence` binary built from `cli.ts`, not a library API. The
 * barrel only exposes the package-identity helpers consumed by the binary's
 * `--version` handler, kept here (rather than imported back from the root
 * facade) so the CLI package compiles standalone without a back-reference
 * to the engine root.
 *
 * The constants `PACKAGE_NAME` and `PACKAGE_VERSION` are intentionally kept
 * in sync with the root `package.json` (`@oscharko-dev/test-intelligence`)
 * because the operator binary identifies itself as the published product,
 * not as the workspace-internal `ti-cli` package.
 */

/** Release maturity of a published build, derived from its semantic version. */
export type ReleaseStage = "pre-beta" | "beta" | "stable";

/**
 * Immutable identity and release metadata describing the running package.
 */
export interface PackageIdentity {
  /** Fully qualified npm package name, including the publish scope. */
  readonly name: string;
  /** Semantic version string of the published build. */
  readonly version: string;
  /** Release maturity derived from the semantic version. */
  readonly stage: ReleaseStage;
}

/** Fully qualified npm package name of this build. */
export const PACKAGE_NAME: string = "@oscharko-dev/test-intelligence";

/** Semantic version of this build, kept in sync with root `package.json`. */
export const PACKAGE_VERSION: string = "0.1.0-beta.2";

/**
 * Classifies a semantic version string into a {@link ReleaseStage}.
 *
 * A version without a pre-release identifier is `stable`. A pre-release
 * identifier beginning with `beta` is `beta`; any other pre-release
 * identifier is treated as `pre-beta`.
 */
export function resolveReleaseStage(version: string): ReleaseStage {
  const separatorIndex = version.indexOf("-");
  if (separatorIndex === -1) {
    return "stable";
  }
  const preRelease = version.slice(separatorIndex + 1);
  return preRelease.startsWith("beta") ? "beta" : "pre-beta";
}

/**
 * Returns the immutable identity and release metadata of this package build.
 */
export function getPackageIdentity(): PackageIdentity {
  return {
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    stage: resolveReleaseStage(PACKAGE_VERSION),
  };
}

// Audit-dossier helpers — carry-in from src/test-intelligence/ during the #85
// CLI extraction. The CLI run command is the sole production consumer of
// `generateAuditDossier`; co-located test files in src/test-intelligence/ that
// exercise the helper import it via this package surface. Reconciliation of
// the audit-dossier ownership boundary (Evidence vs. Production-Runner vs.
// CLI) is tracked in the manifest-reconciliation follow-up issue.
export {
  generateAuditDossier,
  resolveAuditDossierDefaults,
  type GenerateAuditDossierResult,
} from "./audit-dossier.js";
