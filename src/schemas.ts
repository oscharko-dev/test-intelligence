/**
 * Bootstrap-period re-export shim. The Zod request schemas have moved to
 * `packages/contracts/src/schemas.ts` per ADR-0010. This shim keeps the
 * existing relative-path imports from engine and server code resolving
 * until each engine module is extracted (issues #79+).
 */

export * from "../packages/contracts/src/schemas.js";
