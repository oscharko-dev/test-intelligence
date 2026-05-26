# Threat Model

Test Intelligence processes operator-provided design and requirement evidence
and emits reviewable test-intelligence artifacts. The primary security goal is
to prevent untrusted input, misconfiguration, or supply-chain compromise from
leaking secrets, corrupting evidence, or expanding runtime trust boundaries.

## Assets

- Operator secrets, API keys, bearer tokens, and signing keys.
- Source evidence supplied through the Workbench, API, CLI, or local files.
- Generated test cases, validation reports, policy reports, provenance, model
  cards, and audit dossiers.
- Package source, lockfile, release workflows, and npm package contents.

## Trust Boundaries

| Boundary                         | Main risk                                                         | Control                                                                            |
| -------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Workbench to local operator host | Local file path misuse or misleading run configuration.           | Input validation and explicit operator-selected paths.                             |
| HTTP runtime                     | Unauthorized writes, oversized requests, unsafe CORS, rate abuse. | Bearer auth, fail-closed feature gates, body limits, rate limits, CORS checks.     |
| Model gateway                    | Secret leakage, prompt injection, provider retention mismatch.    | Operator-owned gateway configuration, role separation, redaction, evidence stamps. |
| Filesystem output                | Path traversal or artifact overwrite outside the run root.        | Normalized operator roots and job-scoped artifact directories.                     |
| Supply chain                     | Dependency confusion, malicious tarballs, compromised actions.    | Frozen lockfile, host allowlist, pinned actions, dependency review, SBOM checks.   |

## STRIDE Summary

| Category               | Example                                      | Mitigation                                                          |
| ---------------------- | -------------------------------------------- | ------------------------------------------------------------------- |
| Spoofing               | Unauthenticated write request.               | Bearer token required for protected routes.                         |
| Tampering              | Modified artifact after generation.          | Canonical JSON, hashes, signatures, and audit-dossier verification. |
| Repudiation            | Untraceable review or export decision.       | Review events, provenance, and signed audit dossiers.               |
| Information disclosure | Secrets in logs or generated artifacts.      | Secret scanning, redaction helpers, no committed runtime state.     |
| Denial of service      | Large payload or request burst.              | Body-size limits and per-client rate limits.                        |
| Elevation of privilege | Unsafe output path or host allowlist bypass. | Path normalization, host allowlists, and fail-closed validation.    |

## Assumptions

- Operators protect their own deployment environment, signing keys, artifact
  storage, model gateways, Jira/TMS systems, and access controls.
- Public package consumers install from npm or from a reviewed source checkout.
- Generated artifacts may contain regulated business context and must be
  handled as operator-controlled evidence.
