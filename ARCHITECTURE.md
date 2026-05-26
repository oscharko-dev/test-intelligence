# Architecture

Test Intelligence is a pnpm workspace with a narrow published package surface
and internal packages for the runtime implementation. The current user-facing
product surface is the Workbench under `apps/workbench`.

## Product Shape

- `apps/workbench` provides the local operator UI.
- `packages/contracts` owns versioned public artifact and API contracts.
- `packages/server` owns the local HTTP runtime.
- `packages/production-runner` orchestrates evidence generation and artifact
  writing.
- `packages/evidence`, `packages/security`, `packages/eval`,
  `packages/model-gateway`, and related packages isolate specialized runtime
  concerns.
- Root `src/` contains the public package entrypoint, CLI wiring, and root
  integration tests.

## Boundaries

- Contracts flow outward from `packages/contracts`; runtime packages must not
  redefine public artifact shapes.
- Security-sensitive helpers live in `packages/security` and are consumed by
  other packages rather than duplicated.
- The Workbench is not part of the npm runtime package.
- Generated artifacts are written under operator-configured output roots or
  ignored `artifacts/` paths.
- Internal planning and historical notes are not part of the published package
  surface.

## Release Posture

The public package ships compiled `dist/` output and root public Markdown only.
Source, fixtures, scripts, internal documentation, generated caches, and local
operator state are excluded from the npm tarball.
