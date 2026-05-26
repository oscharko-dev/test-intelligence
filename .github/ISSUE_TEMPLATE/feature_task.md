---
name: Product task
about: Track a product, engineering, documentation, release, or security task
title: ''
labels: ['type: task', 'status: ready']
assignees: ''
---

## Objective

Describe the concrete Test Intelligence outcome this issue must deliver.

## Product Area

- [ ] UI / user workflow
- [ ] CLI or developer workflow
- [ ] Core generation engine
- [ ] Evidence, audit, or compliance artifact
- [ ] Security or supply chain
- [ ] Packaging, release, or npm publication
- [ ] Documentation or repository hygiene
- [ ] Other:

## Scope

In scope:

-

Out of scope:

-

## Requirements

-

## Acceptance Criteria

- [ ]
- [ ]

## Verification Plan

Required for every implementation PR:

- [ ] GitHub required checks pass before merge.
- [ ] Relevant local tests or checks are listed in the PR.

Select only what applies:

- [ ] UI behavior manually verified or covered by tests.
- [ ] CLI behavior verified with command output or tests.
- [ ] Core logic covered by unit, integration, property, or fixture tests.
- [ ] Security-sensitive change reviewed for trust boundaries, secrets, external calls, and generated artifacts.
- [ ] Supply-chain or package-surface change verified with package, license, lockfile, SBOM, or npm dry-run checks.
- [ ] Documentation or Markdown change verified by the repository link check or a targeted local equivalent.
- [ ] Release-impacting change verified with `pnpm run release:check` or an explicit rationale.
- [ ] Not applicable items are explained in the PR.

## Risk Notes

List compatibility, data, security, auditability, migration, or release risks.

## Closure Evidence

Before closing, record the merged PR, final checks, and any follow-up issue that remains intentionally open.
