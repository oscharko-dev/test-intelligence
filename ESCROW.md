# Source and Release Escrow

This document records the escrow posture for `Test Intelligence` release
continuity and recoverability. It is part of the DORA Art. 28
arrangement that regulated operators establish with the product
maintainer.

## Escrow Triggers

- Primary maintainers are unavailable for more than 5 business days
  during an active security incident.
- A critical supply-chain event requires third-party reproducibility
  verification.
- A regulatory or contractual audit requires evidence preservation
  beyond what the public release tree carries.

## Escrow Artifact Set

- Source code at the release tag.
- `pnpm-lock.yaml` and release workflow definitions.
- Release evidence artifacts: CycloneDX and SPDX SBOM, SLSA provenance,
  reproducible-build verification report, and any other release
  evidence artifacts required by the current release checklist.
- Governance and security manifests: `COMPLIANCE.md`, `SECURITY.md`,
  `THREAT_MODEL.md`, `ZERO_TELEMETRY.md`, `VERSIONING.md`.
- The audit-dossier and provenance artifacts produced by the release
  job, when a release-time run is recorded.

## Restore Procedure

1. Check out the escrowed release tag and verify the commit signature
   policy.
2. Rebuild the package with `pnpm install --frozen-lockfile` and
   deterministic hash checks.
3. Re-run release gates: `pnpm run typecheck`, `pnpm run lint`,
   `pnpm run test`, `pnpm run build`.
4. Verify SBOM and provenance against the escrowed evidence set.
5. Publish a forward-fix version if remediation is required.

## Responsibilities

- Release engineering: maintain the escrow package and workflow
  artifacts, and refresh on every release.
- Security engineering: validate integrity and incident alignment.
- Platform engineering: execute restoration and reproducibility
  verification when the operator invokes the escrow trigger.
