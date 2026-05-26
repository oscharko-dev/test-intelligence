# Zero-Telemetry Posture

`Test Intelligence` follows a zero-telemetry policy for runtime usage
data. The runtime does not emit analytics, usage metrics, or behavioral
telemetry to any external service. This document records the policy, the
explicitly allowed exceptions, and the verification procedure operators
use to confirm the posture in their own deployment.

## Policy Statement

- The package does not emit runtime analytics, usage metrics, or
  behavioral telemetry to external services.
- No user-identifying or tenant-identifying runtime payload is
  transmitted by default.
- No network call is performed for telemetry collection.
- Logging is operator-supplied: the standalone HTTP server factory
  (`createTestIntelligenceServer` in `packages/server/src/server.ts`)
  takes a required `logger` option and does not create a default file
  sink. Leaving logging to the operator is part of the zero-telemetry
  posture.
- The audit-log line writer (`auditWrite`) is operator-supplied. The
  runtime never opens a network socket to a remote audit collector.

## Allowed Exceptions

The runtime makes outbound network calls only on operator-initiated
paths, never on the telemetry path:

- **Operator-configured LLM gateway.** The `run` and `figma-export`
  routes call the upstream deployment configured by
  `TEST_INTELLIGENCE_LLM_GATEWAY_*`. The destination is
  operator-controlled.
- **Operator-configured Figma REST API.** The Figma REST source kind
  calls `https://api.figma.com` with an operator-supplied token. The
  destination is fixed and well-known; the token is operator-controlled
  and never persisted to artifacts.
- **Operator-configured Jira REST API.** The Jira REST source kind calls
  the operator-supplied Jira base URL with an operator-supplied token.
- **Operator-configured TMS adapters.** The `tms-push` and
  `execution-pull` commands call the operator-supplied TMS endpoints
  (ALM, qTest, Polarion, Xray) with operator-supplied credentials.
- **CI release evidence uploads.** GitHub Actions workflows in
  `.github/workflows/` upload SBOM and provenance artifacts to the
  release attestation surface. These are CI-side actions, not runtime
  paths, and never run as part of the published package's runtime
  behavior.

The destinations above are operator-controlled inference and integration
endpoints. They carry prompt and ingest data scoped to the active job
and never carry analytics, usage metrics, or behavioral telemetry.
Endpoints, deployment names, and API keys are read at request time via
injected providers; they are never embedded in package source and never
persisted to artifacts.

## Verification Procedure

1. **Source-level audit.** No runtime source under `src/`, `packages/*/src`,
   or `scripts/` imports a telemetry SDK, instrumentation
   library, or analytics endpoint. The optional peer dependency
   `@opentelemetry/api` lets operators wire their own observability stack;
   the runtime never instantiates an exporter itself.

2. **Network audit.** With the master feature gate disabled, run the
   HTTP server and confirm no outbound connection is made:

    ```bash
    TEST_INTELLIGENCE_ENABLED=0 \
    node ./dist/cli.js doctor --json
    ```

3. **Run-time audit.** With the gate enabled but the LLM gateway
   unconfigured, submit a job and confirm the run route fails closed
   with `503 LLM_GATEWAY_UNCONFIGURED` without performing any outbound
   call.

4. **Release-artifact audit.** Inspect the published tarball with
   `npm pack --dry-run` and confirm no telemetry script is included.

5. **Workflow audit.** Workflow files in `.github/workflows/` upload
   only release evidence artifacts (SBOM, provenance, build reports)
   and do not post runtime usage data.

## Operator Responsibility

Operators who choose to wire the runtime to their own observability
stack via the `@opentelemetry/api` peer dependency are responsible for
the privacy and retention posture of that destination. The
zero-telemetry posture of `Test Intelligence` covers the published
package; it does not cover an operator-built observability layer placed
on top of it.
