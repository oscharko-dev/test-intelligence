# Agent Operating Rules

## Test Intelligence Product Context

Test Intelligence is a standalone enterprise product for regulated banking and insurance modernization workflows. It is
not a demo, proof of concept, or internal prototype. The product transforms product evidence such as Figma masks, visual
UI evidence, Jira requirements, customer-provided context, tenant profiles, and compliance metadata into reviewable,
traceable, audit-ready test intelligence artifacts.

The system is designed to generate high-quality test cases, coverage plans, validation reports, policy reports, evidence
manifests, customer-facing Markdown/PDF/ZIP artifacts, and integration-ready outputs for enterprise test management
systems. All generated output must remain explainable, evidence-backed, and suitable for regulated delivery
environments.

## Templates

- Use the current GitHub issue templates in `.github/ISSUE_TEMPLATE/` when creating or updating issues.
- Use the current pull request template in `.github/pull_request_template.md` when opening or updating pull requests.
- Do not create free-form issues or pull requests by copying older examples unless the result is checked against the
  current template.
- Keep acceptance criteria, expected verification, review settlement, and closure evidence formally updated in GitHub.

## Delivery standard

- Build production-ready, state-of-the-art solutions.
- Keep implementations simple, maintainable, and focused on the issue scope.
- Be creative and innovative where it improves product quality, but avoid unnecessary special cases, speculative
  abstractions, and process overhead.
- Preserve existing architecture boundaries, quality gates, security posture, evidence semantics, and deterministic
  verification.

## Language and artifacts

- Write code comments, configuration, documentation, issues, pull requests, and GitHub comments in professional English.
- Do not commit local runtime state, secrets, customer data, private logs, generated caches, or tool-specific memory.
