/**
 * Bootstrap-period re-export shim. The security module has moved to
 * `packages/security/` per ADR-0010. See `packages/security/src/index.ts`
 * for the canonical home. Engine relative imports continue resolving
 * until each consumer is extracted (issues #79+).
 */

export * from "@oscharko-dev/ti-security";
