# Parity golden fixtures

This directory stores deterministic golden artifacts for the parity scripts.
The scripts regenerate equivalent artifacts from the product and assert
byte-identity against these fixtures, tolerating only intentional deltas encoded
in the parity tooling.

## Layout

```
fixtures/parity/
├── README.md                   ← this file
├── MANIFEST.json               ← top-level: lists every scenario + its scenario-MANIFEST.json hash
├── contracts/
│   ├── MANIFEST.json           ← per-scenario file hashes
│   ├── contract-versions.json
│   ├── enum-surface.json
│   └── exports-list.json
├── branded-ids/
│   ├── MANIFEST.json
│   └── branded-id-samples.json
├── core-generation/
│   ├── MANIFEST.json
│   ├── draft-list.json
│   └── coverage-plan.json
├── validation/
│   ├── MANIFEST.json
│   ├── clean.json
│   ├── dirty.json
│   └── empty.json
├── policy/
│   ├── MANIFEST.json
│   ├── eu-banking.json
│   ├── sovereign.json
│   └── bypass-denied.json
├── review/
│   ├── MANIFEST.json
│   ├── queue.json
│   └── four-eyes-denied.json
├── evidence/
│   ├── MANIFEST.json
│   ├── evidence-manifest.json
│   ├── dossier.json
│   └── dossier.signed.json     ← golden snapshots structural shape; the run-specific public
│                                 key and signature bytes are captured as placeholder fields
│                                 so the comparison stays byte-exact and no private key ever
│                                 lands in git
├── multi-source/
│   ├── MANIFEST.json
│   └── kinds.json
├── integrations/
│   ├── MANIFEST.json
│   └── canonical-mapping.json
├── tenant/
│   ├── MANIFEST.json
│   └── isolation-proof.json
├── cli/
│   ├── MANIFEST.json
│   ├── help-text.txt
│   └── commands.json
└── http/
    ├── MANIFEST.json
    └── openapi.json            ← OpenAPI document is the deterministic HTTP surface;
                                   runtime /healthz and /readyz embed a wall-clock timestamp
                                   and are excluded from the gate
```

## MANIFEST.json shape

```json
{
    "scenario": "contracts",
    "extractedAt": "2026-05-23T00:00:00.000Z",
    "wdSourceSha": "006dabdf0abe30b9cac2b742a7238c6625d8e8c1",
    "fileCount": 3,
    "files": {
        "contract-versions.json": "sha256:<64hex>",
        "enum-surface.json": "sha256:<64hex>",
        "exports-list.json": "sha256:<64hex>"
    }
}
```

The top-level `MANIFEST.json` lists every scenario's `MANIFEST.json` hash so a single hash
seals the entire parity baseline.

## Re-extracting fixtures

```sh
node scripts/extract-parity-fixtures.mjs --wd-checkout /path/to/reference-checkout
```

The helper refuses to run if:

- the reference checkout path equals the standalone repo root (no self-extraction);
- the reference checkout HEAD is not the pinned SHA above (no drift);
- a scenario's artifact is not deterministic across two consecutive runs of the same
  command (catches hidden non-determinism in the reference).

## Synthetic discipline

Every fixture is produced from synthetic literals — no real customer data, no real PII, no
real signing keys. Audit-dossier scenarios mint an ephemeral Ed25519 keypair per
extraction run; the public key is captured into the golden bundle. The corresponding
parity script mints a second ephemeral keypair per check run and injects the golden
signature, ensuring no private key ever lands in git.
