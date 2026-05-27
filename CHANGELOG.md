# Changelog

All notable public changes are tracked here.

## 0.1.0-beta.5 - 2026-05-27

- Fixed npm-installed CLI startup on Node 22.14 by removing a premature
  `node:tls` named import that is only available in newer Node 22 releases.
- Kept enterprise CA bundle support for Figma REST and model-gateway calls
  while using the Node runtime's system CA store when available and falling
  back to the native fetch trust path on older Node runtimes.
- Added Azure Foundry `/openai` to `/openai/v1` chat-completions fallback and
  clarified Workbench endpoint templates to prefer v1 base URLs.
- Hardened Workbench settings APIs so credential-bearing responses are never
  cacheable and `.env` content imports enforce the same size limit as file
  imports.
- Removed a workflow shell interpolation pattern flagged by GitHub code
  scanning.

## 0.1.0-beta.4 - 2026-05-27

- Added local Workbench credential onboarding with `.env` path import, `.env`
  upload, template download, and persisted UI settings for npm installations.
- Hardened Figma REST and model-gateway HTTPS calls to use the platform trust
  store plus optional operator-provided `NODE_EXTRA_CA_CERTS`.
- Propagated persisted model, Figma, enterprise TLS, and region-attestation
  settings into Workbench runs without requiring repository-local `.env` files.

## 0.1.0-beta.3 - 2026-05-26

- Added an installable packaged Workbench runtime to the npm artifact.
- Added `test-intelligence start` and `test-intelligence stop` so npm
  installations can run the local UI on port `1983` without a repository
  checkout.
- Removed publish-time `workspace:*` runtime dependencies from the public npm
  dependency surface.
- Added an installable-package release gate that checks packed Workbench
  runtime artifacts before publish.

## 0.1.0-beta.2 - 2026-05-26

- Clarified that the final local E2E flow requires operator-provided,
  untracked `test-case/` fixtures and does not ship those fixtures in the npm
  package.
- Hardened the development-to-main promotion path with a dedicated `dev`
  integration branch, required CI/security checks, and a source-branch guard for
  `main`.
- Integrated compatible dependency and supply-chain updates while deferring
  incompatible major upgrades for explicit migration work.
- Kept Workbench visual regression CI scoped to visual tests so local final E2E
  fixtures are not required in GitHub Actions.
- Aligned runtime package identity constants with the published package version.

## 0.1.0-beta.1 - 2026-05-26

- Initial beta release candidate for the Test Intelligence Workbench, runtime,
  evidence pipeline, and local final E2E workflow.
