# Security Policy

Test Intelligence is published as a standalone enterprise package for
regulated banking and insurance modernization workflows. This policy documents
how vulnerabilities are reported and which security controls are maintained for
the public package.

## Supported Versions

| Version line | Supported |
| --- | --- |
| `0.0.x` | Supported during the current pre-1.0 line |
| Older unpublished snapshots | Not supported |

## Reporting a Vulnerability

Do not open public issues for security vulnerabilities.

Report privately via GitHub private vulnerability reporting on this repository.
If that is unavailable, contact
[security@oscharko.dev](mailto:security@oscharko.dev).

Include the impact summary, reproduction steps, affected versions, suggested
remediation, and any relevant operator configuration.

## Response Targets

| Severity | Acknowledge | Fix target |
| --- | --- | --- |
| Critical | 4 hours | 24 hours |
| High | 8 hours | 72 hours |
| Medium | 24 hours | 7 calendar days |
| Low | 48 hours | Next scheduled release |

## Security-Sensitive Surfaces

- The HTTP runtime binds to loopback by default and requires explicit operator
  configuration for broader exposure.
- Write routes require bearer-token authentication and fail closed when
  authentication is unavailable.
- Feature gates fail closed when disabled or unset.
- The model gateway reads operator-provided endpoints, deployment names, and
  keys from environment variables; secrets are not committed to the repository.
- Evidence, audit-dossier, region-attestation, and reviewer signing keys are
  operator-owned.
- Runtime artifacts are written only under operator-selected output roots.

## Supply-Chain Controls

- Dependencies are installed from the committed lockfile.
- Lockfile hosts are checked against an allowlist.
- Dependency review runs on package metadata changes.
- GitHub Actions use pinned actions and `persist-credentials: false` on
  checkout.
- SBOM and package-shape checks are part of the release posture.
- Private runtime state, generated caches, secrets, and internal documentation
  are excluded from the public package.

## Remediation Policy

Released versions are not unpublished. Affected releases are deprecated when
needed and fixed by publishing a patched forward release. Public release notes
must not disclose unpublished vulnerability details before coordinated
disclosure is complete.
