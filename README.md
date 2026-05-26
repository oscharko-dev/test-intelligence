# Test Intelligence

Test Intelligence turns design and requirement evidence into traceable test
intelligence for regulated banking and insurance delivery.

The current user-facing surface is the **Workbench** in `apps/workbench`. It is
a local Next.js operator UI for configuring runs, launching the runtime, and
inspecting generated artifacts.

## Local Workbench

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

Runtime state, PID files, and logs are written under
`.test-intelligence/local-runtime/` and are intentionally ignored by Git.

The Workbench currently provides Runs and Model Settings for local operator
workflows. Run History is read-only sample data until persisted history loading
is implemented.

## Final Local E2E

Run the local final end-to-end suite after the Workbench is running:

```bash
pnpm run test:final-e2e
```

The command runs the Workbench Playwright flow against the local test-case set
and writes fresh results to `.test-intelligence/final-e2e/`. The test clears
that result directory at the start of each run so stale artifacts are not reused
as successful evidence.

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
