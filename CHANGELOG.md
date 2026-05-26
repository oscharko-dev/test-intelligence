# Changelog

All notable public changes are tracked here.

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
