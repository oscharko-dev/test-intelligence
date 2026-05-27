# Test Intelligence

Test Intelligence turns design and requirement evidence into traceable test
intelligence for regulated banking and insurance delivery.

The current user-facing surface is the **Workbench** in `apps/workbench`. It is
a local Next.js operator UI for configuring runs, launching the runtime, and
inspecting generated artifacts.

## npm Installation

Install the published package:

```bash
npm install @oscharko-dev/test-intelligence
```

or `yarn add @oscharko-dev/test-intelligence` / `pnpm add @oscharko-dev/test-intelligence`.

Initialize start/stop scripts in your host `package.json`:

```bash
npx test-intelligence init
```

Start and stop locally:

```bash
npm run test-intelligence:start
npm run test-intelligence:stop
```

You can also run the binary directly from CLI:

```bash
npx test-intelligence start
npx test-intelligence stop
```

Then open:

`http://localhost:1983`.

For production-style package installs, the Workbench does not read credentials
from a checked-in `.env` by default. Configure credentials through the
Workbench **Model Settings** screen, either manually or by importing an `.env`
file by local path/upload. Use the included `import.env` template for the
required keys. If your network intercepts TLS, include `NODE_EXTRA_CA_CERTS`
with an operator-approved PEM bundle path so Figma REST and image export calls
trust the local enterprise CA. Region-attestation evidence also requires
`TEST_INTELLIGENCE_REGION_ATTESTATION_SIGNING_KEY`; use an operator-managed,
tenant-local HMAC key. Saved values are written only to the local workspace
runtime state under `.test-intelligence/local-runtime/` and are ignored by Git.

Use `npx test-intelligence start --mock` for UI-only local runs without live
Figma or LLM calls. The packaged Workbench uses the current directory as the
operator workspace by default; override it with `--workspace=<path>` when
needed.

## Source Checkout Workbench

Start from a fresh checkout:

```bash
pnpm run local:start
```

Open `http://localhost:1983`.

`local:start` checks for missing `node_modules`, runs `pnpm install` when
needed, builds `apps/workbench` when the build output is missing, and starts the
Workbench on port `1983`. If that port is already occupied, the script exits and
asks the operator to free the port locally; it does not switch ports.

Stop the managed Workbench process:

```bash
pnpm run local:stop
```

Useful variants are:

```bash
pnpm run local:start:mock       # UI-only mock runner, no live Figma/LLM calls
pnpm run local:start:prod       # production Next.js mode
pnpm run local:start -- --env-file=.env.local
```

`local:start` does not load `.env` automatically. On first launch, configure
credentials in the Workbench Model Settings screen by importing an `.env` file
or entering the values manually.

Runtime state, PID files, and logs are written under
`.test-intelligence/local-runtime/` and are intentionally ignored by Git.

The Workbench currently provides Runs and Model Settings for local operator
workflows. Run History is read-only sample data until persisted history loading
is implemented.

## Final Local E2E

Run the local final end-to-end suite after the Workbench is running and local
case fixtures have been provided:

```bash
pnpm run test:final-e2e
```

The command runs the Workbench Playwright flow against operator-provided local
fixtures in the untracked `test-case/` directory and writes fresh results to
`.test-intelligence/final-e2e/`. The test clears that result directory at the
start of each run so stale artifacts are not reused as successful evidence.

## Maintainer Checks

For Workbench changes:

```bash
pnpm --dir apps/workbench lint
pnpm --dir apps/workbench test
pnpm --dir apps/workbench typecheck
pnpm --dir apps/workbench build
```

For visual or final local E2E coverage:

```bash
pnpm --dir apps/workbench exec playwright install chromium
pnpm --dir apps/workbench test:visual
pnpm run test:final-e2e
```

Update visual snapshots with `pnpm --dir apps/workbench test:visual:update`
only after reviewing the UI diff. For repository-wide runtime changes, use the
CI scripts in `package.json`.
