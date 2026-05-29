# Release Readiness

This note records the public release-readiness map for
`@oscharko-dev/test-intelligence@0.2.0-beta.0`, the Snapshot Vault beta
milestone.

## Release Scope

`0.2.0-beta.0` packages the Figma Snapshot Vault delivery wave:

- tenant-scoped, hash-addressed local Figma snapshot storage;
- resumable import and refresh with sanitized credential, request-budget, and
  rate-limit diagnostics;
- local node-index and preview-cache exploration;
- run-from-snapshot generation through Workbench and CLI paths;
- snapshot provenance in generated cases, evidence, compliance, FinOps,
  genealogy, and customer-facing Markdown outputs;
- large-board hardening for bounded indexing, preview, import, and garbage
  collection behavior;
- public operator, troubleshooting, release-note, and customer-facing
  documentation.

## Package And Contract Alignment

| Surface | `0.2.0-beta.0` value or evidence |
| ------- | -------------------------------- |
| Root npm package | `@oscharko-dev/test-intelligence@0.2.0-beta.0` |
| Workspace package metadata | Workspace package manifests are aligned to `0.2.0-beta.0` for release traceability. |
| CLI/server runtime identity | `PACKAGE_VERSION` reports `0.2.0-beta.0`. |
| Public generated-case artifact schema | `GENERATED_TEST_CASE_SCHEMA_VERSION` is `1.4.0` for Snapshot Vault audit-source alignment. |
| Snapshot manifest schema | `FIGMA_SNAPSHOT_MANIFEST_SCHEMA_VERSION` is `1.1.0`. |
| Snapshot node-index schema | `FIGMA_SNAPSHOT_NODE_INDEX_SCHEMA_VERSION` is `1.1.0`. |
| Snapshot preview-manifest schema | `FIGMA_SNAPSHOT_PREVIEW_MANIFEST_SCHEMA_VERSION` is `1.1.0`. |
| Snapshot import-status schema | `FIGMA_SNAPSHOT_IMPORT_STATUS_SCHEMA_VERSION` is `1.1.0`. |

`CONTRACT_VERSION` and `TEST_INTELLIGENCE_CONTRACT_VERSION` remain compatible
with existing consumers because the Snapshot Vault additions are optional or
specific to new Snapshot Vault artifacts.

## Required Release Evidence

The implementation PR for this release must record these checks before merge:

| Evidence area | Required gate |
| ------------- | ------------- |
| Required GitHub quality gate | GitHub check `ci` passes on the final PR head. |
| Package shape | `pnpm run build:package`, `pnpm run check:package-shape`, and `pnpm run check:installable-package`. |
| Type and contract alignment | `pnpm run typecheck`, `pnpm --dir packages/contracts test`, and `node --import tsx scripts/check-parity.mjs --scenario contracts`. |
| Documentation | Repository Markdown link check in `ci`, or a targeted local equivalent when running offline. |
| Secret/customer-data safety | Secret scan and targeted documentation scan for customer Figma URLs, tokens, private snapshots, private logs, screenshots, and request transcripts. |
| SBOM/package surface | `pnpm run sbom:cyclonedx`, `pnpm run sbom:spdx`, and `pnpm run check:sbom-parity`. |
| Release gate | `pnpm run release:check`, or an explicit PR rationale if the full local aggregate is too heavy and the equivalent required sub-gates plus GitHub `ci` cover the changed surface. |

## Non-Applicable Gates For Documentation-Only Surfaces

This release packaging issue does not intentionally change Studio UI
structure, BFF browser behavior, editor rendering, Monaco, or large-output UI
performance. Studio browser, Studio performance/memory, and visual-regression
gates are therefore required only if the implementation PR changes those
surfaces.

Qodana/static-analysis review is required only if security-sensitive or shared
control-plane code changes. The expected security evidence for this issue is a
targeted trust-boundary and secret/customer-data review because the release
materials describe credential, snapshot, and external-call behavior.

## Public Safety Constraints

Release materials and committed artifacts must not include customer Figma
links, customer screenshots, tokens, private snapshots, private runtime logs,
private request transcripts, or claims that Test Intelligence bypasses Figma
licensing or rate limits. Public language must state that Snapshot Vault
reduces repeated live REST usage by reusing local imported evidence; initial
imports and refreshes still require valid Figma access and still obey Figma
platform limits.
