# Compliance Narrative

Test Intelligence produces evidence that regulated banking and insurance
operators can review, retain, and verify. The package does not make a
deployment compliant by itself. Classification, risk acceptance, retention,
residency, model-provider selection, and sign-off authority remain operator
responsibilities.

## Evidence Model

The runtime writes schema-versioned artifacts under the operator-selected
artifact root. Typical evidence includes validation reports, policy reports,
coverage reports, review events, provenance, evidence manifests, model-card
artifacts, subprocessor registers, region attestations, and signed audit
dossiers.

## Control Mapping

| Area            | Product responsibility                                                                                           | Operator responsibility                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| DORA resilience | Fail-closed feature gates, deterministic CI checks, package threat model, signed audit evidence.                 | Criticality classification, operational runbooks, incident ownership, supplier oversight.     |
| GDPR            | PII redaction before persistence, no raw screenshot bytes in governance JSON, operator-controlled artifact root. | Lawful basis, retention, data-subject process, residency, upstream system configuration.      |
| EU AI Act       | Record-keeping artifacts, model-card artifacts, human-review evidence, calibration and drift evidence.           | System classification, end-user notices, competent human oversight, deployment risk register. |
| Supply chain    | Lockfile host allowlist, dependency review, SBOM generation, provenance-enabled release path.                    | Package allowlisting, runtime deployment hardening, key custody, artifact retention.          |

## Public Verification

Maintainers should keep these checks green before a release:

```bash
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
pnpm run check:package-shape
pnpm run check:license-policy
pnpm run check:lockfile-hosts
pnpm run check:no-telemetry
```

The compliance posture is intentionally evidence-based: every claim should map
to executable checks, emitted artifacts, or a clear operator responsibility.
