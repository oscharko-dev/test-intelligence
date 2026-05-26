/**
 * Package-identity constants and helpers describing the published
 * `@oscharko-dev/test-intelligence` build at runtime.
 *
 * Lives in its own file (not `index.ts`) so other modules in this package
 * can import the version constant without forming an `index.ts` import
 * cycle through the server factory barrel.
 */

/** Release maturity of a published build, derived from its semantic version. */
export type ReleaseStage = "pre-beta" | "beta" | "stable";

/**
 * Immutable identity and release metadata describing the running package.
 */
export interface PackageIdentity {
  readonly name: string;
  readonly version: string;
  readonly stage: ReleaseStage;
}

export const PACKAGE_NAME: string = "@oscharko-dev/test-intelligence";

export const PACKAGE_VERSION: string = "0.1.0-beta.3";

export function resolveReleaseStage(version: string): ReleaseStage {
  const separatorIndex = version.indexOf("-");
  if (separatorIndex === -1) {
    return "stable";
  }
  const preRelease = version.slice(separatorIndex + 1);
  return preRelease.startsWith("beta") ? "beta" : "pre-beta";
}

export function getPackageIdentity(): PackageIdentity {
  return {
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    stage: resolveReleaseStage(PACKAGE_VERSION),
  };
}
