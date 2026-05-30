# ADR 0001: Workbench storage adapter and migration contract

- Status: Accepted
- Date: 2026-05-30
- Epic: #48
- Issue: #51

## Context

The Workbench operator UI (`apps/workbench`) currently persists run, snapshot,
and settings state through purpose-built file stores under
`<repoRoot>/.test-intelligence/` (for example `workbench-run-registry.ts` and
`workbench-snapshot-vault.ts`). As Epic #48 adds structured, queryable
Workbench features — run history, scope baskets, generated-seed and export
catalogs — ad hoc per-feature files become hard to query, keep consistent, and
evolve. Several of these entities also reference large binaries (Figma node
graphs, generated-test-case JSON, export bundles) that do not belong inside a
relational row.

Epic #48 sets the direction: SQLite (better-sqlite3) for structured metadata, a
content-addressed file artifact store for large binaries, both behind a single
adapter interface, with forward-only versioned migrations applied at startup.

Issue #51 is deliberately **contract only**. It defines the persistence
boundary and its invariants — the types, repository interfaces, adapter shape,
migration rule, path layout, and a working in-memory test double — without
introducing `better-sqlite3`, any concrete SQLite code, or any new npm
dependency. Concrete bootstrap (the first schema migration and the SQLite-backed
adapter) is the follow-up child issue #52; wiring existing stores onto the
adapter is #52/#53. Fixing the boundary first lets dependent features and tests
target a stable surface while the implementation is built and reviewed in
isolation.

## Decision

### Boundary and dependency direction

A single interface, `WorkbenchStorageAdapter`, aggregates one repository per
entity plus lifecycle operations (migrations, transactions, teardown). Server
code depends only on the barrel `@/lib/server/storage`; it never imports a
concrete implementation. The storage module imports **only Node built-ins**
(`node:crypto`, `node:path`) and no `@/lib/*` or workspace packages, so the
persistence schema is decoupled from UI and domain types and is independently
testable. Where a persistence record mirrors an existing domain type, the
alignment is captured in a `// WHY` comment (and below) rather than by importing
the type, so persistence and presentation can evolve independently.

Dependency direction is one-way: UI/server depend on the storage boundary; the
storage boundary depends on nothing in the app.

### Entities and the metadata-versus-artifact-store split

Six entities are defined. Small, queryable fields live in SQLite; large or
binary payloads live in the content-addressed artifact store and are referenced
by a `ContentRef` (`{ sha256, byteSize, storageRef }`). Customer run outputs
that already exist as files on disk are referenced by directory rather than
copied.

| Entity                        | SQLite (metadata)                                                                            | Artifact store / filesystem                            |
| ----------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `SnapshotMetadataRecord`      | id, tenantScope, createdAt, label?, source, nodeCount, pageCount, frameCount, lifecycleState | node graph payload via `payload: ContentRef`           |
| `RunMetadataRecord`           | id (jobId), tenantScope, createdAt, updatedAt, status, snapshotId?, label?                   | customer outputs on disk via `artifactDir`             |
| `ArtifactMetadataRecord`      | id, runId, tenantScope, createdAt, name, kind, customerFacing (append-only)                  | artifact bytes via `content: ContentRef`               |
| `ScopeBasketRecord`           | id, tenantScope, createdAt, updatedAt, label, snapshotId?, selection, itemCount              | none (small; fully in SQLite)                          |
| `GeneratedSeedMetadataRecord` | id, runId, tenantScope, createdAt, status, count                                             | `GeneratedTestCaseList` JSON via `content: ContentRef` |
| `ExportMetadataRecord`        | id, runId, tenantScope, createdAt, format, status                                            | export bundle via `content: ContentRef`                |

Source-of-truth alignments (documented, not imported): `WorkbenchRunStatus`
mirrors `RunStatus` in [`apps/workbench/lib/types.ts`](../../apps/workbench/lib/types.ts);
snapshot fields mirror `WorkbenchSnapshotCatalogRow` in
[`apps/workbench/lib/snapshot-vault.ts`](../../apps/workbench/lib/snapshot-vault.ts);
`ContentRef.sha256` and `ExportMetadataRecord.format` mirror
`ExportArtifactRecord` in the contracts package.

### Adapter interface

```ts
interface WorkbenchStorageAdapter {
    readonly snapshots: SnapshotRepository;
    readonly runs: RunRepository;
    readonly artifacts: ArtifactRepository;
    readonly scopeBaskets: ScopeBasketRepository;
    readonly generatedSeeds: GeneratedSeedRepository;
    readonly exports: ExportRepository;
    migrateToLatest(): number;
    getSchemaVersion(): number;
    transaction<T>(work: (tx: WorkbenchStorageAdapter) => T): T;
    close(): void;
}
```

Repository methods are **synchronous**, matching better-sqlite3 (and the
in-memory double). `get` and `update*` return `undefined` for an absent id
(never throw); `list` returns `[]` when empty. Every returned record is a deep,
immutable snapshot — mutating a returned value cannot alter stored state.
Create-input types omit server-assigned `id`, `createdAt`, and `updatedAt`.

### Forward-only migration rule

Migrations are forward-only and versioned. `WorkbenchMigration` carries a
`version`, a `description`, and an `up(tx)` step; this contract holds no SQL (the
concrete store supplies statements). `validateMigrationSequence` enforces that
versions are integers, each at least 1, strictly increasing, and **contiguous
from 1** (`[1, 2, 3, ...]`). `migrateToLatest` validates the sequence, applies
each migration whose version exceeds the stored schema version in ascending
order, advances the stored version, and returns it; re-running applies nothing
(idempotent). Each migration runs inside transaction semantics, so a failing
migration leaves the schema unchanged (atomic). The concrete store persists the
applied version in SQLite `PRAGMA user_version`; the in-memory double keeps it in
a field. There are intentionally no reversible (down) migrations.

### Transaction semantics

`transaction(work)` runs `work` against a handle exposing the same repositories.
Writes are atomic (all-or-nothing); a thrown error rolls back every change,
including updates to pre-existing records, and rethrows. Reads observe prior
writes within the same transaction (read-your-writes). Nesting is forbidden: a
nested call throws `WorkbenchStorageError` with code `NESTED_TRANSACTION`. The
in-memory double passes itself as the handle (its repositories already mutate the
guarded live state); the concrete store will bind a distinct handle whose
repositories execute against the active better-sqlite3 transaction.

### Content addressing and paths

Artifacts are content-addressed by SHA-256. `artifactStorageRef(hash)` returns a
two-level sharded relative path `<aa>/<bb>/<hash>.bin`, keeping directory sizes
bounded. The artifact root is `<repoRoot>/.test-intelligence/storage-artifacts`
and the database is `<repoRoot>/.test-intelligence/workbench.db`. Repo-root
resolution mirrors `resolveRepoRoot` in
[`apps/workbench/lib/server/workbench-run-validation.ts`](../../apps/workbench/lib/server/workbench-run-validation.ts):
`WORKBENCH_REPO_ROOT` is resolved when set, otherwise the current working
directory is used with a trailing `apps/workbench` segment stripped. Paths are
built with `node:path` joins from fixed filenames and a validated hash, so there
is no path-traversal surface.

## Consequences

### Positive

- A single, stable, dependency-free import surface for all Workbench
  persistence; the SQLite implementation can be added or replaced without
  touching call sites.
- Decoupled schema: persistence types do not import UI or domain modules, so
  the boundary is independently testable and resistant to incidental churn.
- Reviewable, low-risk landing: #51 is purely additive (no existing file is
  modified), and the in-memory double lets dependent features and tests proceed
  before the concrete store exists.
- Deterministic, auditable storage: forward-only contiguous migrations and
  content-addressed artifacts give reproducible, traceable persistence suited to
  regulated delivery.

### Negative

- Synchronous repository methods constrain the concrete implementation to a
  synchronous engine (better-sqlite3), which is the intended choice but rules
  out an async driver without revisiting the contract.
- Forward-only migrations mean schema mistakes are corrected by a new forward
  migration, never a rollback.
- The same-handle in-memory transaction model is a simplification; the SQLite
  implementation must bind repositories to the active transaction to preserve
  identical semantics, and the shared contract suite is what guarantees parity.
- Two stores (SQLite plus the artifact directory) must be kept consistent;
  orphaned artifacts are possible if a row write is rolled back after bytes are
  staged, which the concrete implementation must handle on write ordering.

## Alternatives considered

1. **All payloads as BLOBs inside SQLite (no separate artifact store).**
   Rejected: large Figma node graphs, generated-test-case JSON, and export
   bundles would bloat the database, inflate backups, and harm query/VACUUM
   performance; content addressing on disk also enables natural deduplication
   and direct file streaming for downloads.
2. **Reversible (down) migrations.** Rejected: down migrations roughly double
   migration authoring and test cost, are routinely unsafe for destructive
   schema changes on real data, and contradict the forward-only, append-history
   posture appropriate for an audit-oriented product. Corrections ship as new
   forward migrations.
3. **An ORM or query-builder (e.g. Prisma, Drizzle, Knex).** Rejected for #51:
   it adds heavyweight dependencies and a competing schema-definition and
   migration mechanism, conflicting with the dependency-free,
   Node-built-ins-only constraint and the existing lightweight file-store
   conventions. A thin hand-written repository layer over better-sqlite3 keeps
   the surface minimal and fully under our control.

## Implementation notes

The contract lives under
[`apps/workbench/lib/server/storage/`](../../apps/workbench/lib/server/storage/):

- `types.ts` — persistence DTOs, create-input types, and repository interfaces.
- `storage-adapter.ts` — the `WorkbenchStorageAdapter` interface and
  `WorkbenchStorageError`.
- `migrations.ts` — `WorkbenchMigration`, the empty `WORKBENCH_MIGRATIONS`
  registry (the first migration arrives with #52), and
  `validateMigrationSequence`.
- `db-path.ts` — `resolveWorkbenchStoragePaths`, `artifactStorageRef`,
  `artifactAbsolutePath`, and `sha256Hex`.
- `memory-adapter.ts` — `createMemoryWorkbenchStorageAdapter`, the in-memory
  test double implementing the full contract.
- `index.ts` — the public barrel imported as `@/lib/server/storage`.

The behavioural contract is exercised by a shared suite,
`apps/workbench/tests/storage/adapter-contract.ts`, which every implementation
binds to a factory; the in-memory double does so in
`apps/workbench/tests/storage/memory-adapter.test.ts`, and path/hash helpers are
covered by `apps/workbench/tests/storage/db-path.test.ts`. The future SQLite
adapter reuses the same shared suite to prove parity.
