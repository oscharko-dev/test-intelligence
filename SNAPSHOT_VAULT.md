# Snapshot Vault

Snapshot Vault is the local Figma evidence workflow introduced for
`0.2.0-beta.0`. It imports a Figma board into tenant-scoped, hash-addressed
snapshot artifacts, then lets operators inspect, select, and run generation
from that immutable local evidence.

Snapshot Vault reduces repeated live Figma REST usage after an import or
refresh has completed. The initial import and every refresh still require valid
Figma access and still obey the Figma platform's licensing, access-control, and
rate-limit rules.

## Operator Workflow

1. Configure the Workbench credentials in **Model Settings**. Use the included
   `import.env` template or enter values manually. Persisted values stay in the
   local workspace runtime state under `.test-intelligence/local-runtime/`,
   which is ignored by Git.
2. Start the Workbench:

   ```bash
   pnpm run local:start
   ```

   npm package installations can use:

   ```bash
   npx test-intelligence start
   ```

3. Open `http://localhost:1983` and select **Snapshot Vault**.
4. Import or refresh a Figma board from an operator-provided Figma URL. The
   Workbench resolves the file identity, applies credential and request-budget
   governance, and writes local snapshot artifacts under
   `.test-intelligence/figma-snapshots/`.
5. Search and inspect local pages, frames, and nodes. Preview metadata is
   bounded and cache-backed; it is not a Figma editor replacement.
6. Add pages, frames, or nodes to the scope basket.
7. Launch run-from-snapshot from the Workbench, or run the CLI against the
   local snapshot:

   ```bash
   npx test-intelligence run \
     --figma-snapshot-id <snapshot-id> \
     --figma-snapshot-root . \
     --figma-snapshot-page-id <page-id> \
     --tenant-id <tenant-id> \
     --environment-id <environment-id> \
     --project-id <project-id>
   ```

   Generation from a local snapshot does not perform live Figma REST calls.

## Supported Figma Auth Modes

Snapshot import and refresh support the credential modes below. Snapshot-backed
generation itself uses only validated local artifacts and does not require a
Figma token.

| Mode | Status | Operational use |
| ---- | ------ | --------------- |
| `personal_access_token` | Supported | Local or self-hosted operator import when the operator has explicit file access. |
| `enterprise_service_token` | Supported | Enterprise-controlled import where the service principal has approved Figma access. |
| `oauth_access_token` | Schema-ready, fails closed | Reserved for a future OAuth resolver. Do not rely on it for `0.2.0-beta.0`. |

Tokens, authorization headers, raw customer URLs, private request logs, and
private runtime logs are not written to snapshot artifacts.

## Snapshot Artifacts

Each imported snapshot is scoped by tenant, environment, project, hashed source
identity, and snapshot id. The vault persists four primary artifact families:

| Artifact | Schema constant | Purpose |
| -------- | --------------- | ------- |
| Manifest | `FIGMA_SNAPSHOT_MANIFEST_SCHEMA_VERSION` | Snapshot identity, tenant scope, safe source identity, import strategy, timestamps, and sibling artifact digests. |
| Node index | `FIGMA_SNAPSHOT_NODE_INDEX_SCHEMA_VERSION` | Local searchable page, frame, and node evidence with digest-backed source references. |
| Preview manifest | `FIGMA_SNAPSHOT_PREVIEW_MANIFEST_SCHEMA_VERSION` | Bounded cached preview metadata and asset references. |
| Import status | `FIGMA_SNAPSHOT_IMPORT_STATUS_SCHEMA_VERSION` | Resumable import state, sanitized retry/rate-limit data, request-budget counters, and failure class. |

Generated test cases can include optional `audit.snapshotSource` metadata that
pins the selected snapshot id, manifest digest, node-index digest, and selected
scope digest. Run-level evidence, compliance, FinOps, genealogy, and
customer-facing Markdown can carry sanitized Snapshot Vault provenance through
`figmaSourceAudit`.

## REST Savings And Reproducibility

Snapshot Vault is designed for regulated delivery teams that need repeatable
test intelligence from large Figma boards:

- A completed local import can support many scoped generation runs without
  repeated live Figma REST reads.
- Selected page, frame, and node scope is digest-stamped so audit reviewers can
  reproduce which local evidence was used.
- Tenant-scoped storage prevents accidental cross-tenant snapshot reuse.
- Evidence artifacts report live Figma calls performed by the generation run
  and live calls avoided by local snapshot reuse.

## Recommended Enterprise Setup

- Use a self-hosted workspace per tenant or per regulated delivery boundary.
- Keep `.test-intelligence/figma-snapshots/` and
  `.test-intelligence/local-runtime/` out of source control and CI artifacts
  unless an explicit internal evidence-retention process governs them.
- Prefer an enterprise-managed Figma service token where customer policy allows
  it. Use personal access tokens only for explicit operator-driven import.
- Configure `NODE_EXTRA_CA_CERTS` with an operator-approved PEM bundle when
  enterprise TLS interception is required.
- Treat Figma import/refresh as a governed online operation and schedule it
  with respect to Figma plan limits. Treat run-from-snapshot as the repeatable
  local generation path.
- Record release evidence with `ci`, package-shape, installable-package, SBOM,
  secret/customer-data, and documentation-link checks before promotion.

## Limitations

- Snapshot Vault does not bypass Figma rate limits, access controls, licensing,
  or plan restrictions.
- Import and refresh still require valid Figma credentials and network access
  to Figma.
- OAuth access-token import is schema-ready but not enabled in
  `0.2.0-beta.0`.
- The local explorer provides cached previews and structural overlays for
  evidence-backed test generation; it is not a pixel-perfect Figma editor or a
  design-authoring surface.
- Snapshot artifacts must not contain customer board URLs, customer
  screenshots, tokens, private snapshots, private runtime logs, or private
  request transcripts.

## Related Documentation

- [README.md](README.md) for installation, Workbench startup, and the primary
  operator entry points.
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for Snapshot Vault failure handling.
- [RELEASE_READINESS.md](RELEASE_READINESS.md) for the `0.2.0-beta.0` release
  evidence map.
- [VERSIONING.md](VERSIONING.md) for package and artifact compatibility rules.
