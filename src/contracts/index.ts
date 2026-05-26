/**
 * Bootstrap-period re-export shim. The contract surface has moved to
 * `packages/contracts/` per ADR-0010 + ADR-0011. This shim keeps the
 * existing relative-path imports from `src/test-intelligence/`,
 * `src/server/`, and `src/cli/` resolving until each engine module is
 * extracted (issues #79+) and switches to the workspace package import
 * path `@oscharko-dev/ti-contracts`.
 *
 * The shim re-exports ONLY the reduced surface that the new package
 * publishes; a removed symbol is unreachable through this file, so any
 * engine code that still imports a removed name fails to type-check.
 */

export * from "@oscharko-dev/ti-contracts";
