import { defineConfig, type Options } from "tsup";

// The standalone `@oscharko-dev/test-intelligence` package emits a single npm
// artifact per ADR-0006.
//
// Key invariants this config enforces:
//
//   - Every public entry (`index`, `cli`, `contracts/index`) emits BOTH
//     `.js` (ESM) and `.cjs` (CJS) so consumers can `import` or `require()`.
//   - Each entry gets a matching `.d.ts` (for ESM) AND `.d.cts` (for CJS),
//     so `are-the-types-wrong` (#25) does not flag a dual-package hazard.
//   - ESM output gets a `createRequire(import.meta.url)` banner so dynamic
//     `require()` inside the bundle works under Node ESM resolution.
//   - CJS output defines `import.meta.url` via a `pathToFileURL(__filename)`
//     shim so modules that read `import.meta.url` still work under CJS.
//   - `@opentelemetry/api` is an OPTIONAL peer (per `peerDependenciesMeta`)
//     and must NOT be bundled — listed in `external` so consumers control
//     the resolved version.
//
// All three entry points are emitted by a SINGLE tsup config (not an
// array of configs). Earlier attempts to split into an array (one config
// for {index, cli}, a second config for {contracts/index} with
// `clean: false`) produced a CI-only race in which the second config's
// DTS bundler dropped `dist/contracts/index.d.{ts,cts}` even though both
// `pnpm run build` invocations succeeded. The single-config form serialises
// the DTS pass and emits all three entries deterministically.

const CJS_IMPORT_META_URL_SHIM = "__testIntelligenceImportMetaUrl";
const ESM_CREATE_REQUIRE_SHIM = "__testIntelligenceCreateRequire";

const config: Options = {
  entry: {
    index: "packages/server/src/index.ts",
    cli: "packages/cli/src/cli.ts",
    "server-entrypoint": "packages/server/src/server-entrypoint.ts",
    // The contracts surface physically lives in `packages/contracts/src/`
    // per ADR-0010 / ADR-0011. We point tsup at the `src/contracts/`
    // re-export shim (rather than the workspace package directly) so the
    // root tsconfig's `rootDir: src` is honoured by tsup's DTS bundler.
    // The shim re-exports the reduced surface unchanged, so the emitted
    // `dist/contracts/index.{js,cjs}` artifact is functionally identical
    // to pointing at the package source. When the root publishes the
    // meta-facade (#87), this entry retires.
    "contracts/index": "src/contracts/index.ts",
  },
  format: ["esm", "cjs"],
  platform: "node",
  target: "node22",
  external: ["@opentelemetry/api"],
  // Bundle workspace packages (@oscharko-dev/ti-*) into the dist artifact so
  // the published meta-package is self-contained. Without this, tsup
  // externalises them (because they appear in `dependencies`), and the
  // runtime container fails with ERR_MODULE_NOT_FOUND when `pnpm prune
  // --prod` strips the private workspace links from node_modules.
  noExternal: [/^@oscharko-dev\/ti-/],
  sourcemap: true,
  treeshake: true,
  clean: true,
  splitting: false,
  // Use a dedicated tsconfig whose `rootDir: .` accommodates the
  // `src/contracts/` re-export shim that re-exports from
  // `packages/contracts/src/`. The root `tsconfig.json` keeps
  // `rootDir: src` for `tsc --noEmit`; tsup's DTS bundler needs the wider
  // root because esbuild follows the shim's relative import out of `src/`.
  tsconfig: "tsconfig.tsup.json",
  dts: true,
  outDir: "dist",
  outExtension({ format }) {
    return {
      js: format === "cjs" ? ".cjs" : ".js",
      dts: format === "cjs" ? ".d.cts" : ".d.ts",
    };
  },
  esbuildOptions(options, context) {
    if (context.format === "cjs") {
      options.define = {
        ...(options.define ?? {}),
        "import.meta.url": CJS_IMPORT_META_URL_SHIM,
      };
      const existingBanner = options.banner?.js;
      options.banner = {
        ...(options.banner ?? {}),
        js: `${existingBanner ? `${existingBanner}\n` : ""}const ${CJS_IMPORT_META_URL_SHIM} = require("node:url").pathToFileURL(__filename).href;`,
      };
      options.logOverride = {
        ...(options.logOverride ?? {}),
        "empty-import-meta": "silent",
      };
      return;
    }

    if (context.format === "esm") {
      const existingBanner = options.banner?.js;
      options.banner = {
        ...(options.banner ?? {}),
        js: `${existingBanner ? `${existingBanner}\n` : ""}import { createRequire as ${ESM_CREATE_REQUIRE_SHIM} } from "node:module";\nconst require = ${ESM_CREATE_REQUIRE_SHIM}(import.meta.url);`,
      };
    }
  },
};

export default defineConfig(config);
