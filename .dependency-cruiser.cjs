/**
 * dependency-cruiser configuration for the test-intelligence monorepo.
 *
 * Enforces the dependency direction documented in
 * `docs/architecture/module-map.md` and ADR-0010. The packages under
 * `packages/` form a layered DAG; an import that travels against the
 * documented direction is a backward edge and fails the gate with
 * severity `error`.
 *
 * Strategy. Each rule lives on the **source** package side
 * (`from.path` rooted at `^packages/<name>/`) and forbids imports of any
 * sibling workspace package that is not in the package's allowed-dependency
 * list per ADR-0010. The `to.path` regex matches BOTH forms an internal
 * package can appear in:
 *
 *   1. The npm-name form: `^@oscharko-dev/(ti-|test-intelligence)…` — the
 *      unresolved import-string emitted by depcruise when the workspace
 *      package is not declared as a dependency or when resolution defers to
 *      the npm name.
 *
 *   2. The resolved-symlink form: `^packages/<name>/` — pnpm symlinks
 *      hoisted workspace packages into the root `node_modules/@oscharko-dev/`
 *      tree, and depcruise records the resolved filesystem path
 *      (`packages/<name>/dist/index.js`) on the import edge. The npm-name
 *      regex alone misses resolved edges, so every rule includes the
 *      `packages/<name>/` alternative in its `to.path` regex.
 *
 * Hardening done under issue #87 (epic #73 closure):
 *   - The `to.path` regex on every per-package rule now matches BOTH the
 *     npm-name form AND the resolved `packages/<name>/` form. Before the
 *     hardening, the resolved form silently slipped past every rule under
 *     pnpm's hoisting model.
 *   - `evidence-no-modify-after-seal` graduated from `warn` to `error` per
 *     its own graduation schedule.
 *
 * The rules together form a closed set for packages/apps: any edge that is not
 * listed in the per-package `Depends on` column of ADR-0010's package
 * responsibility table is forbidden by exactly one rule below. The root `src/`
 * tree is also cruised so residual compatibility carry-outs remain covered by
 * cross-cutting trust-boundary rules such as `no-direct-llm-provider-imports`.
 */

/**
 * Build a `to.path` regex that matches imports of any internal workspace
 * package EXCEPT the source package itself and the listed allowed
 * dependencies. The match covers both the npm-name form
 * `@oscharko-dev/ti-<name>` and the resolved-symlink filesystem form
 * `packages/<name>/`.
 *
 * `selfPackage` is the source package's short-name (e.g. `"agentic-harness"`).
 * It is added to the allow-list so a package's intra-package imports do not
 * trip the rule.
 *
 * `allowed` is the list of allowed external internal package short-names
 * (without the `ti-` prefix). An empty list means "this package may only
 * import from itself" (used for the contracts leaf rule).
 */
const importsForbiddenOutsideAllowList = ({ selfPackage, allowed }) => {
  const fullAllow = [selfPackage, ...allowed];
  const allowedAlternation = fullAllow.join("|");
  return {
    path: [
      "^@oscharko-dev/(ti-|test-intelligence)",
      "^packages/(?!(?:" + allowedAlternation + ")/)[^/]+/",
    ].join("|"),
    pathNot: [
      "^@oscharko-dev/ti-(" + allowedAlternation + ")(/|$)",
      "^packages/(" + allowedAlternation + ")/",
    ].join("|"),
  };
};

/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "contracts-is-leaf",
      severity: "error",
      comment:
        "Contracts (#6) is the sole leaf node per ADR-0002 / module-map.md invariant 1. It must not import from any other internal package.",
      from: { path: "^packages/contracts/" },
      to: importsForbiddenOutsideAllowList({
        selfPackage: "contracts",
        allowed: [],
      }),
    },
    {
      name: "security-imports-only-contracts",
      severity: "error",
      comment:
        "Security (#7) source files depend only on Contracts per module-map.md. Test files are exempt — they may import from higher-layer packages for integration coverage.",
      from: {
        path: "^packages/security/",
        pathNot: "\\.test\\.ts$",
      },
      to: importsForbiddenOutsideAllowList({
        selfPackage: "security",
        allowed: ["contracts"],
      }),
    },
    {
      name: "tenant-imports-only-contracts",
      severity: "error",
      comment:
        "Tenant (#18) depends only on Contracts per module-map.md. Test files are exempt — integration tests may import from higher-layer packages.",
      from: { path: "^packages/tenant/", pathNot: "\\.test\\.ts$" },
      to: importsForbiddenOutsideAllowList({
        selfPackage: "tenant",
        allowed: ["contracts"],
      }),
    },
    {
      name: "core-engine-allowed-deps",
      severity: "error",
      comment:
        "Core Engine (#8) per module-map.md invariant 2 depends on Contracts only and must not import from Harness, Runner, API, or CLI. During bootstrap extraction the package additionally depends on Security (canonical-hash, redaction, error sanitization helpers consumed by the engine) and Tenant (isolation guards on persistent-store reads); these bootstrap dependencies are scoped to the carry-in cohort and reconcile in the follow-up issue tracked from ADR-0009.",
      from: { path: "^packages/core-engine/", pathNot: "\\.test\\.ts$" },
      to: importsForbiddenOutsideAllowList({
        selfPackage: "core-engine",
        allowed: ["contracts", "security", "tenant"],
      }),
    },
    {
      name: "model-gateway-allowed-deps",
      severity: "error",
      comment:
        "Model Gateway (#9) is infrastructure. Its long-term allowed dependency per module-map.md invariant 3 is Contracts only; during bootstrap extraction (#80) the gateway additionally depends on Security (canonical-hash, redaction, error sanitization), Core Engine (generated-test-case schema and validators it consumes when shaping prompts), and Tenant (isolation guards for replay-cache scoping). Direct LLM provider SDK imports remain forbidden everywhere outside this package — see `no-direct-llm-provider-imports`.",
      from: { path: "^packages/model-gateway/", pathNot: "\\.test\\.ts$" },
      to: importsForbiddenOutsideAllowList({
        selfPackage: "model-gateway",
        allowed: ["contracts", "security", "core-engine", "tenant"],
      }),
    },
    {
      name: "no-direct-llm-provider-imports",
      severity: "error",
      comment:
        "TB-1 — Productive LLM calls must flow through the Model Gateway. Any package outside packages/model-gateway/ that imports an LLM provider SDK violates the trust boundary.",
      from: { pathNot: "^packages/model-gateway/" },
      to: {
        path: "^(@anthropic-ai/sdk|openai|@google-ai/generativelanguage|cohere-ai|@mistralai/mistralai)(/|$)",
      },
    },
    {
      name: "evidence-allowed-deps",
      severity: "error",
      comment:
        "Evidence (#13) is the cross-cutting tamper-evident artefact subsystem (TB-2). Its long-term allowed dependency per module-map.md invariant 3 is Contracts and Core Engine; during bootstrap extraction (#81) the package additionally depends on Security (canonical-hash and redaction utilities consumed when computing seal inputs) and Model Gateway (computePerSourceCostBreakdownHashFromReport for FinOps seal hashing).",
      from: {
        path: "^packages/evidence/",
        pathNot: "\\.test\\.ts$|^packages/evidence/scripts/",
      },
      to: importsForbiddenOutsideAllowList({
        selfPackage: "evidence",
        allowed: ["contracts", "core-engine", "security", "model-gateway"],
      }),
    },
    {
      name: "evidence-no-modify-after-seal",
      severity: "error",
      comment:
        "TB-2 invariant — Evidence is the cross-cutting tamper-evident artefact subsystem. No module other than `packages/evidence/` may reach into the canonical seal-producing modules (evidence-attestation, evidence-manifest, audit-dossier-renderer, audit-dossier-verify, lbom-emitter). External consumers must call the package's `index.ts` surface. Graduated from `warn` to `error` in #87 per the rule's own graduation schedule once the carry-out modules landed in `packages/evidence/src/` and no cross-package import edges into the seal-producing module set remained.",
      from: { pathNot: "^packages/evidence/" },
      to: {
        path: "^packages/evidence/src/(evidence-attestation|evidence-manifest|audit-dossier-renderer|audit-dossier-verify|lbom-emitter)\\.ts$",
      },
    },
    {
      name: "quality-allowed-deps",
      severity: "error",
      comment:
        "Quality (#12) depends on Contracts and Core Engine for its long-term allowed surface per module-map.md invariant 3; during bootstrap extraction (#82) the package additionally depends on Security (canonical-hash, redaction, error sanitization), Model Gateway (judge LLM invocation, repair prompts), and Tenant (isolation guards) — infrastructure deps shared with the Model Gateway and Evidence bootstrap exceptions.",
      from: { path: "^packages/quality/", pathNot: "\\.test\\.ts$" },
      to: importsForbiddenOutsideAllowList({
        selfPackage: "quality",
        allowed: [
          "contracts",
          "core-engine",
          "security",
          "model-gateway",
          "tenant",
        ],
      }),
    },
    {
      name: "multi-source-allowed-deps",
      severity: "error",
      comment:
        "Multi-Source (#14) depends on Contracts and Core Engine for its long-term allowed surface per module-map.md invariant 3; during bootstrap extraction (#82) the package additionally depends on Security (canonical-hash, secret redaction, error sanitization for Jira HTTP responses) and Model Gateway (gateway-mediated LLM calls for source-mix planning) — infrastructure deps shared with the Model Gateway and Evidence bootstrap exceptions.",
      from: { path: "^packages/multi-source/", pathNot: "\\.test\\.ts$" },
      to: importsForbiddenOutsideAllowList({
        selfPackage: "multi-source",
        allowed: ["contracts", "core-engine", "security", "model-gateway"],
      }),
    },
    {
      name: "review-allowed-deps",
      severity: "error",
      comment:
        "Review (#16) depends on Contracts and Core Engine for its long-term allowed surface per module-map.md invariant 3; during bootstrap extraction (#82) the package additionally depends on Security (canonical-hash for review-decision hashing).",
      from: { path: "^packages/review/", pathNot: "\\.test\\.ts$" },
      to: importsForbiddenOutsideAllowList({
        selfPackage: "review",
        allowed: ["contracts", "core-engine", "security"],
      }),
    },
    {
      name: "integrations-allowed-deps",
      severity: "error",
      comment:
        "Integrations (#17) depends on Contracts and Core Engine for its long-term allowed surface per module-map.md invariant 3; during bootstrap extraction (#82) the package additionally depends on Security (canonical-hash, secret redaction, error sanitization for QC/Jira HTTP responses) and Tenant (isolation guards on persistent-store reads performed by execution-evidence ingest).",
      from: { path: "^packages/integrations/", pathNot: "\\.test\\.ts$" },
      to: importsForbiddenOutsideAllowList({
        selfPackage: "integrations",
        allowed: ["contracts", "core-engine", "security", "tenant"],
      }),
    },
    {
      name: "eval-allowed-deps",
      severity: "error",
      comment:
        "Eval (#19) depends on Contracts, Core Engine, Quality, and Model Gateway per module-map.md; during bootstrap extraction the package additionally depends on Security (canonical-hash, secret redaction) and Tenant (isolation guards on calibration-data reads).",
      from: { path: "^packages/eval/", pathNot: "\\.test\\.ts$" },
      to: importsForbiddenOutsideAllowList({
        selfPackage: "eval",
        allowed: [
          "contracts",
          "core-engine",
          "quality",
          "model-gateway",
          "security",
          "tenant",
        ],
      }),
    },
    {
      name: "agentic-harness-allowed-deps",
      severity: "error",
      comment:
        "Agentic Harness (#29) depends on Core Engine and Model Gateway only per module-map.md invariant 4. It must not import from Runner, API, or CLI. During bootstrap extraction the package additionally depends on Contracts (re-exported types), Security (canonical-hash, redaction), and Tenant (isolation guards on agent-lessons memdir reads); these reconcile in the follow-up issue.",
      from: { path: "^packages/agentic-harness/", pathNot: "\\.test\\.ts$" },
      to: importsForbiddenOutsideAllowList({
        selfPackage: "agentic-harness",
        allowed: [
          "core-engine",
          "model-gateway",
          "contracts",
          "security",
          "tenant",
        ],
      }),
    },
    {
      name: "production-runner-allowed-deps",
      severity: "error",
      comment:
        "Production Runner (#10) is the orchestration root per module-map.md invariant 5. Allowed deps: Harness, Core Engine, Model Gateway, Quality, Multi-Source, Review, Integrations, Evidence, Contracts, Security, Eval, Tenant (carry-in cohort — reconcile in follow-up issue). Forbidden: Server, CLI, Meta-facade.",
      from: { path: "^packages/production-runner/" },
      to: importsForbiddenOutsideAllowList({
        selfPackage: "production-runner",
        allowed: [
          "agentic-harness",
          "core-engine",
          "model-gateway",
          "quality",
          "multi-source",
          "review",
          "integrations",
          "evidence",
          "contracts",
          "security",
          "eval",
          "tenant",
        ],
      }),
    },
    {
      name: "no-direct-adapter-imports-in-runner-core",
      severity: "error",
      comment:
        "ADR-0003 / module-map.md invariant 7: the orchestrator + event/evidence boundary modules MUST NOT import concrete adapter packages directly — only the factory may. (The #84 carry-in cohort of helper modules legitimately depends on adapter packages and is scoped out of this rule; manifest reconciliation in follow-up issue will progressively narrow this exemption as helpers re-extract.)",
      from: {
        path: "^packages/production-runner/src/(production-runner|production-runner-events|production-runner-evidence)\\.ts$",
      },
      to: {
        path: "^(packages/(quality|multi-source|review|integrations|evidence)/|@oscharko-dev/ti-(quality|multi-source|review|integrations|evidence)(/|$))",
      },
    },
    {
      name: "server-allowed-deps",
      severity: "error",
      comment:
        "Server (#21) is the HTTP-API package per module-map.md invariant 5. Its long-term allowed surface is Production Runner, Tenant, Review, Evidence, and Contracts; during bootstrap extraction (#86) the package additionally depends on Security (the `WorkspaceRuntimeLogger` type, `createWorkspaceLogger` factory, and shared sanitization helpers consumed by every request handler).",
      from: { path: "^packages/server/" },
      to: importsForbiddenOutsideAllowList({
        selfPackage: "server",
        allowed: [
          "production-runner",
          "tenant",
          "review",
          "evidence",
          "contracts",
          "security",
        ],
      }),
    },
    {
      name: "cli-allowed-deps",
      severity: "error",
      comment:
        "CLI (#20) is the operator entry-point package per module-map.md invariant 5. Its long-term allowed surface is Production Runner, Tenant, and Contracts; during bootstrap extraction (#85) the package additionally depends on Core Engine (re-exported types and helpers consumed by run/calibration-refit/onboard commands), Model Gateway (gateway-mediated LLM calls invoked by figma-export and run dry-run helpers), Evidence (sealed-artefact verification helpers used by audit-dossier and verify-seal commands), Security (canonical-hash, secret redaction, error sanitization), Eval (calibration-refit operator surface), Agentic Harness (run-command harness-wiring helpers), plus the integration adapters Integrations and Review (carry-in cohort — reconcile in follow-up issue).",
      from: { path: "^packages/cli/" },
      to: importsForbiddenOutsideAllowList({
        selfPackage: "cli",
        allowed: [
          "production-runner",
          "tenant",
          "contracts",
          "core-engine",
          "model-gateway",
          "evidence",
          "security",
          "eval",
          "agentic-harness",
          "integrations",
          "review",
          "quality",
          "multi-source",
        ],
      }),
    },
    {
      name: "no-circular",
      severity: "error",
      comment:
        "Cycles between packages are forbidden; the dependency graph is a DAG. Test files are exempt — integration tests may cross package boundaries to exercise cross-layer behaviour.",
      from: { path: "^(packages|apps)/", pathNot: "\\.test\\.ts$" },
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: {
      path: ["node_modules", "dist", "\\.tsbuildinfo$"],
    },
    tsConfig: {
      fileName: "tsconfig.json",
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
