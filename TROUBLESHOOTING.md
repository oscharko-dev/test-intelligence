# Troubleshooting

Current operator-facing issues only.

## Workbench Does Not Start

Run:

```bash
pnpm run local:start
```

Open `http://localhost:1983`.

If port `1983` is busy, free the conflicting local process and rerun. The start
script does not switch ports automatically.

```bash
lsof -nP -iTCP:1983 -sTCP:LISTEN
```

## Recover Local Persistence

### Where local state lives

The Workbench stores all metadata, artifacts, and backups under `.test-intelligence/` in the monorepo root (or the directory specified by `WORKBENCH_REPO_ROOT` if set). This directory is gitignored.

Files:

- **Metadata database:** `.test-intelligence/workbench.db` — SQLite file containing snapshots, runs, artifacts, scope baskets, generated seeds, and exports. WAL mode, so you may also see `workbench.db-wal` and `workbench.db-shm` sidecar files.
- **Artifact store:** `.test-intelligence/storage-artifacts/` — content-addressed artifacts stored as `.bin` files in a two-level sharded layout (`<aa>/<bb>/<sha256>.bin`).
- **Automatic backups:** `.test-intelligence/backups/` — transactionally-consistent database snapshots taken before schema migrations.

### Recover from a migration failure

**Symptom:** On startup, the server logs:

```
[workbench] Local storage bootstrap failed; persistence features are unavailable: Failed to initialize the local Workbench database. Existing data was left unchanged.
```

Persistence features are unavailable until the issue is resolved, but the database and all artifacts remain intact.

**Diagnosis and recovery:**

1. Identify the root cause — typically disk space or permission issues.
    - Disk full: `df -h` to check free space in `.test-intelligence/` parent.
    - Permissions: `ls -ld .test-intelligence/ .test-intelligence/backups/` to verify the Workbench process can write.
    - Check the full server logs in `.test-intelligence/local-runtime/workbench.log` for additional detail.

2. Fix the root cause.

3. Restart the Workbench so bootstrap retries:

    ```bash
    pnpm run local:stop
    pnpm run local:start
    ```

**Restore from a backup (if needed):**

If a migration logic error corrupted the schema before you fixed the disk issue, restore the database to its pre-migration state:

1. Stop the Workbench: `pnpm run local:stop`.

2. Choose a backup from `.test-intelligence/backups/` — backups are named `workbench-v<from>-to-v<to>-<timestamp>.db`, where `<from>` is the schema version you want to return to.

3. Replace the current database:

    ```bash
    cd .test-intelligence
    cp backups/workbench-v1-to-v2-2026-05-30T16-54-17-000Z.db workbench.db
    rm -f workbench.db-wal workbench.db-shm
    ```

    (Adjust the backup filename to match your backup's timestamp and versions.)

4. Restart the Workbench: `pnpm run local:start`.

### Recover from an indexing failure

**Symptom:** On startup, the server logs:

```
[workbench] Legacy artifact index skipped at startup: <error name>
```

This is non-fatal. The Workbench boots normally and all newly created runs persist correctly. Only the one-time backfill of pre-existing local artifacts was skipped.

**Recovery:**

Resolve the underlying cause (e.g., unreadable legacy artifact directory, permission issue) and restart the Workbench. The index runs again at startup.

## Dependency Install Fails

Use the committed package manager:

```bash
corepack enable
pnpm install --frozen-lockfile
```

Do not switch package managers. The lockfile is part of the supply-chain
control surface.

## Stop Does Not Free The Port

`pnpm run local:stop` only stops the managed Workbench process recorded under
`.test-intelligence/local-runtime/`. It reports unmanaged listeners but does not
kill unrelated local processes.

## Workbench Validation Rejects A Run

Check required fields, local paths, feature gate, Figma token, and model
endpoint/API-key environment values.

## Snapshot Vault Import Is Rate-Limited

A 429 or rate-limited import means Figma or the configured local request budget
has asked the operator to slow down. Snapshot Vault records sanitized retry
timing and budget counters in the active import status, but it does not bypass
Figma rate limits or plan restrictions.

Wait until the reported retry/reset time, reduce import scope where possible,
or refresh during a lower-traffic window. Use run-from-snapshot for repeatable
generation after a valid import completes.

## Snapshot Vault Reports Missing Credentials

Configure the Figma token in Workbench **Model Settings** or through the
operator environment before importing or refreshing. Supported
`0.2.0-beta.0` import modes are `personal_access_token` and
`enterprise_service_token`; `oauth_access_token` is schema-ready but fails
closed until an OAuth resolver is available.

Snapshot-backed generation does not require a Figma token because it reads
validated local artifacts.

## Snapshot Vault Cannot Access A File

Confirm the operator-provided URL identifies a Figma file the configured
credential can read. Do not paste signed image URLs, private request URLs, or
tokens into documentation, issues, logs, or release evidence.

If enterprise TLS interception is required, configure `NODE_EXTRA_CA_CERTS`
with an operator-approved workspace-local PEM bundle.

## Snapshot Vault Rejects An Oversized Board

Large-board imports are governed by configured byte, node, chunk, preview, and
memory ceilings. If a board exceeds those limits, reduce the import scope,
raise the operator-approved budget for the deployment, or import at a project
granularity that matches the regulated delivery workflow.

## Snapshot Vault Import Was Interrupted

Restart the import or refresh for the same tenant/project/source. The staged
import path uses resumability checkpoints and chunk inventory to continue from
the last safe phase when the checkpoint is valid. If the checkpoint is marked
non-resumable, start a fresh import.

## Snapshot Vault Reports A Corrupted Checkpoint

Treat a corrupted checkpoint as untrusted local state. Stop active imports,
remove only the affected snapshot directory under
`.test-intelligence/figma-snapshots/` for the tenant/project/source, and import
again. Do not commit the checkpoint or attach it to public issues.

## Clean Up Snapshot Vault Cache

Use tenant/project-scoped cleanup only. Remove stale snapshot directories under
the relevant `.test-intelligence/figma-snapshots/<tenant>/<environment>/<project>/`
path after confirming no active run references them. Keep
`.test-intelligence/figma-snapshots/` out of source control and public release
artifacts.

## Final E2E Fails

Start the Workbench first:

```bash
pnpm run local:start
pnpm run test:final-e2e
```

The command expects operator-provided local fixtures in the untracked
`test-case/` directory and clears `.test-intelligence/final-e2e/` before every
run. If launch fails, inspect `.test-intelligence/local-runtime/workbench.log`
and confirm the run uses the expected base URL.

## Repository Checks Fail

For Workbench-only changes:

```bash
pnpm --dir apps/workbench lint
pnpm --dir apps/workbench test
pnpm --dir apps/workbench typecheck
pnpm --dir apps/workbench build
```

For runtime or package changes:

```bash
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

Security-sensitive package changes should also run:

```bash
pnpm run check:package-shape
pnpm run check:license-policy
pnpm run check:lockfile-hosts
pnpm run check:no-telemetry
```

## Security Issue

Do not open a public issue. Follow `SECURITY.md`.
