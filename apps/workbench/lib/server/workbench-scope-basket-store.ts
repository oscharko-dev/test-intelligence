/**
 * Durable persistence bridge for the Snapshot Vault scope basket (Issue #53,
 * Phase 4). The scope basket was a purely client-side, ephemeral selection; this
 * module makes it survive a restart by upserting it into the `scope_baskets`
 * SQLite table, keyed by the active tenant scope plus the snapshot it scopes.
 *
 * WHY a separate module mirroring `workbench-snapshot-persistence.ts`: it keeps
 * the storage side-effect off the hardened snapshot read path, and every read
 * and write is pinned to the server-resolved tenant scope so a basket from one
 * tenant is never visible to another.
 *
 * WHY no engine-id reconciliation hack (unlike snapshots/runs): the basket is
 * found by `(tenantScope, snapshotId)`, both of which the schema stores directly,
 * so the upsert reconciles cleanly with no spare-column trickery.
 */

// WHY a separate import path: `getWorkbenchStorage` is intentionally NOT
// re-exported from the storage barrel because it pulls in the better-sqlite3
// adapter, which must never reach a client bundle. Server-only callers import
// it directly (mirrors `workbench-snapshot-persistence.ts`).
import { getWorkbenchStorage } from "@/lib/server/storage/bootstrap";
import type { ScopeBasketRecord, ScopeSelection } from "@/lib/server/storage";
import {
  formatWorkbenchTenantScope,
  resolveWorkbenchTenantScope,
} from "./workbench-tenant-scope";

/**
 * Typed, operator-safe failure for scope-basket input/validation (mirrors
 * `WorkbenchSnapshotVaultError`). Messages never carry paths or secrets so they
 * are safe to return to the client and log.
 */
export class WorkbenchScopeBasketError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(input: { status: number; code: string; message: string }) {
    super(input.message);
    this.name = "WorkbenchScopeBasketError";
    this.status = input.status;
    this.code = input.code;
  }
}

const readIdList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    : [];

/**
 * Narrows untrusted JSON into a `ScopeSelection`. A non-object body or non-array
 * field yields empty id lists rather than throwing, matching the snapshot
 * selection-preview route's lenient parsing.
 */
export const parseScopeSelection = (value: unknown): ScopeSelection => {
  const raw =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  return {
    nodeIds: readIdList(raw.nodeIds),
    pageIds: readIdList(raw.pageIds),
    frameIds: readIdList(raw.frameIds),
  };
};

const countSelection = (selection: ScopeSelection): number =>
  selection.nodeIds.length +
  selection.pageIds.length +
  selection.frameIds.length;

const requireSnapshotId = (snapshotId: string): string => {
  const trimmed = snapshotId.trim();
  if (trimmed.length === 0) {
    throw new WorkbenchScopeBasketError({
      status: 400,
      code: "SCOPE_BASKET_SNAPSHOT_ID_REQUIRED",
      message: "A snapshot id is required to read or persist a scope basket.",
    });
  }
  return trimmed;
};

const tenantScopeFor = (env: NodeJS.ProcessEnv): string =>
  formatWorkbenchTenantScope(resolveWorkbenchTenantScope(env));

/**
 * Returns the persisted scope basket for the active tenant and the given
 * snapshot, or `undefined` when none exists. WHY the explicit `tenantScope`
 * filter plus a same-tenant guard on the result: `scopeBaskets.list()` is shared
 * storage, so the basket must be both queried and re-checked under the active
 * tenant so a basket from another tenant can never leak. If more than one basket
 * exists for the pair the most recently updated wins.
 */
export const getScopeBasketForSnapshot = (
  snapshotId: string,
  env: NodeJS.ProcessEnv = process.env,
): ScopeBasketRecord | undefined => {
  const id = requireSnapshotId(snapshotId);
  const tenantScope = tenantScopeFor(env);
  const matches = getWorkbenchStorage({ env })
    .scopeBaskets.list({ tenantScope, snapshotId: id })
    .filter((record) => record.tenantScope === tenantScope);
  return matches.reduce<ScopeBasketRecord | undefined>((latest, record) => {
    if (latest === undefined) return record;
    return record.updatedAt >= latest.updatedAt ? record : latest;
  }, undefined);
};

/**
 * Upserts the scope basket for the active tenant and snapshot. WHY find-then-
 * update-or-create keyed by `(tenantScope, snapshotId)`: repeated saves for the
 * same snapshot must reconcile into a single row (no duplicate baskets), and the
 * key the schema stores natively makes that reconciliation exact. The repo
 * recomputes `itemCount`; it is passed for create-input completeness.
 */
export const saveScopeBasketSelection = (
  input: {
    readonly snapshotId: string;
    readonly label: string;
    readonly selection: ScopeSelection;
  },
  env: NodeJS.ProcessEnv = process.env,
): ScopeBasketRecord => {
  const snapshotId = requireSnapshotId(input.snapshotId);
  const tenantScope = tenantScopeFor(env);
  const selection = input.selection;
  const storage = getWorkbenchStorage({ env });
  const existing = storage.scopeBaskets
    .list({ tenantScope, snapshotId })
    .find((record) => record.tenantScope === tenantScope);
  if (existing !== undefined) {
    const updated = storage.scopeBaskets.update(
      existing.id,
      tenantScope,
      {
        label: input.label,
        selection,
      },
    );
    if (updated !== undefined) return updated;
  }
  return storage.scopeBaskets.create({
    tenantScope,
    label: input.label,
    snapshotId,
    selection,
    itemCount: countSelection(selection),
  });
};
