import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const restrictBetterSqlite3 = {
  name: "better-sqlite3-boundary",
  // WHY: the native better-sqlite3 module may only be imported by the storage
  // adapter implementation (Issue #52, AC#4). A scoped override below re-enables
  // it under lib/server/storage/**. Keeps the native module out of client and
  // route code so it can never reach a client bundle.
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "better-sqlite3",
            message:
              "Import better-sqlite3 only inside lib/server/storage/. Use the storage adapter elsewhere.",
          },
        ],
      },
    ],
  },
};

const config = defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  { ...restrictBetterSqlite3, files: ["**/*.{ts,tsx,mjs,js}"] },
  {
    // The storage adapter implementation owns the native module; the storage
    // contract tests legitimately open raw connections to assert schema state.
    // Both live under the boundary, so the restriction is lifted for them only.
    name: "better-sqlite3-boundary-allow-storage",
    files: ["lib/server/storage/**", "tests/storage/**"],
    rules: { "no-restricted-imports": "off" },
  },
  globalIgnores([
    ".next/**",
    "node_modules/**",
    "coverage/**",
    "next-env.d.ts",
  ]),
]);

export default config;
