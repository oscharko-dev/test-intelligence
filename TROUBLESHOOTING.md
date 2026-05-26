# Troubleshooting

Current operator-facing issues only.

## Workbench Does Not Start

Run:

```bash
pnpm run local:start
```

Open `http://localhost:1983`.

If port `1983` is busy, free the conflicting local process and rerun. The start
script does not switch ports automatically.

```bash
lsof -nP -iTCP:1983 -sTCP:LISTEN
```

## Dependency Install Fails

Use the committed package manager:

```bash
corepack enable
pnpm install --frozen-lockfile
```

Do not switch package managers. The lockfile is part of the supply-chain
control surface.

## Stop Does Not Free The Port

`pnpm run local:stop` only stops the managed Workbench process recorded under
`.test-intelligence/local-runtime/`. It reports unmanaged listeners but does not
kill unrelated local processes.

## Workbench Validation Rejects A Run

Check required fields, local paths, feature gate, Figma token, and model
endpoint/API-key environment values.

## Final E2E Fails

Start the Workbench first:

```bash
pnpm run local:start
pnpm run test:final-e2e
```

The command expects operator-provided local fixtures in the untracked
`test-case/` directory and clears `.test-intelligence/final-e2e/` before every
run. If launch fails, inspect `.test-intelligence/local-runtime/workbench.log`
and confirm the run uses the expected base URL.

## Repository Checks Fail

For Workbench-only changes:

```bash
pnpm --dir apps/workbench lint
pnpm --dir apps/workbench test
pnpm --dir apps/workbench typecheck
pnpm --dir apps/workbench build
```

For runtime or package changes:

```bash
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

Security-sensitive package changes should also run:

```bash
pnpm run check:package-shape
pnpm run check:license-policy
pnpm run check:lockfile-hosts
pnpm run check:no-telemetry
```

## Security Issue

Do not open a public issue. Follow `SECURITY.md`.
