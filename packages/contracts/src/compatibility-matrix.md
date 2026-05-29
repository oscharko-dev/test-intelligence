# Contract Compatibility Matrix

This document records the version contracts of the public surface exported by
`@oscharko-dev/test-intelligence` through the `./contracts` entry point. It is
the human-readable companion to `index.ts`.

## Contract version

`CONTRACT_VERSION` is the schema-version constant for the public contract
surface. It changes only when the exported contract surface changes.

| Aspect     | Value                                                                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format     | Dotted version string (`MAJOR.MINOR.PATCH`)                                                                                                         |
| Current    | `4.66.0`                                                                                                                                            |
| Minor bump | Additive only — new optional fields, new branded-ID variants, new schema entries. Consumers need no code change.                                    |
| Major bump | Breaking — field removed, type narrowed, required field added, semantics changed. Consumers must update before upgrading the package major version. |

`TEST_INTELLIGENCE_CONTRACT_VERSION` (`1.39.0`) versions the Test Intelligence
sub-contract that engine modules and golden fixtures reference by name.

Issues #29 through #37 add Snapshot Vault contracts, storage, local snapshot
generation, provenance, large-board hardening, and public release packaging.
The wire additions are optional or Snapshot Vault-specific, so
`CONTRACT_VERSION` and `TEST_INTELLIGENCE_CONTRACT_VERSION` remain
read-compatible with legacy live-Figma and non-Figma evidence paths. Snapshot
Vault artifact schema constants and generated-test-case schema metadata identify
the `0.2.0-beta.0` artifact family explicitly.

When a major schema bump is published, the previous major's `CONTRACT_VERSION`
remains documented in this file and in the package changelog. The package ships
no runtime migration shim between major schema versions; consumers migrate
their stored `GeneratedTestCase` objects themselves. Evidence packages seal
`CONTRACT_VERSION` at generation time, so downstream consumers must check the
sealed version before deserialising older evidence.

## Artifact schema-version constants

These constants version individual artifact shapes. They are independent of
`CONTRACT_VERSION` and of each other.

| Constant                                         | Value   | Versions                                                            |
| ------------------------------------------------ | ------- | ------------------------------------------------------------------- |
| `GENERATED_TEST_CASE_SCHEMA_VERSION`             | `1.4.0` | Structural shape of a `GeneratedTestCaseList` artifact.             |
| `FIGMA_SNAPSHOT_MANIFEST_SCHEMA_VERSION`         | `1.1.0` | Persisted Snapshot Vault manifest artifact.                         |
| `FIGMA_SNAPSHOT_NODE_INDEX_SCHEMA_VERSION`       | `1.1.0` | Persisted Snapshot Vault local node-index artifact.                 |
| `FIGMA_SNAPSHOT_PREVIEW_MANIFEST_SCHEMA_VERSION` | `1.1.0` | Persisted Snapshot Vault preview manifest artifact.                 |
| `FIGMA_SNAPSHOT_IMPORT_STATUS_SCHEMA_VERSION`    | `1.1.0` | Persisted Snapshot Vault resumable import-status artifact.          |
| `TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION`      | `1.7.3` | Compiled prompt-template family that produced a case.               |
| `VISUAL_SIDECAR_SCHEMA_VERSION`                  | `1.1.0` | Visual sidecar schema consumed by the prompt compiler.              |
| `REDACTION_POLICY_VERSION`                       | `1.0.0` | Redaction policy bundle applied before prompt compilation.          |

## Branded-ID prefix

All branded identifiers use the `ti-` prefix to assert standalone product
identity.

The branded-ID shape is `^ti-(?:<label>-)?<16 hex digits>$`, where `<label>`
is optional lowercase kebab-case.

## Runtime matrix

| Aspect         | Supported                                                                     |
| -------------- | ----------------------------------------------------------------------------- |
| Node.js        | `>= 22.13.0`                                                                  |
| Module formats | ESM (`./dist/contracts/index.js`) and CommonJS (`./dist/contracts/index.cjs`) |

## Enforcement

The following gates keep this matrix and the contract surface in lockstep.

| Check                                                        | Guards                                                                                                          |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/contract-version.test.ts`            | `CONTRACT_VERSION` value and format, artifact constant values, and the frozen runtime-export set (drift guard). |
| `pnpm typecheck`                                             | `isolatedDeclarations` and strict type checking of every exported declaration.                                  |
| `packages/contracts/src/branded-ids.compile-failure.test.ts` | Compile-time misuse: a `RoleStepId` is not assignable where a `JobId` is expected.                              |
| `packages/contracts/src/submit-mode-parity.test.ts`          | Each `ALLOWED_*` runtime array stays in exact lockstep with its derived union type.                             |
