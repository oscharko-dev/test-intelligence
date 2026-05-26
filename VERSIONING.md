# Versioning

Test Intelligence follows semantic versioning after the first public release.
Before `1.0.0`, minor and patch releases may still change behavior when needed
for security, correctness, or product readiness.

## Public Surface

The public compatibility surface is limited to:

- npm package name, exports, and CLI binary name;
- TypeScript declarations emitted under `dist/`;
- schema-versioned artifacts emitted by the runtime;
- documented Workbench behavior in `README.md`;
- security and support policies in root Markdown files.

Internal package layout, tests, fixtures, scripts, generated artifacts, and
internal documentation are not public compatibility guarantees.

## Change Rules

- Patch releases fix defects, security issues, documentation errors, and
  compatibility-preserving behavior.
- Minor releases may add Workbench functionality, new artifact fields marked as
  optional, new routes, or new CLI expert tooling.
- Major releases may remove or rename public exports, routes, artifact fields,
  or runtime defaults.

## Artifact Versions

Schema-versioned artifacts carry their own version fields. Artifact consumers
should validate those fields instead of relying only on the npm package
version.
