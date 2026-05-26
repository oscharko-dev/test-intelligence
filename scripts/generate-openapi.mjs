#!/usr/bin/env node
/**
 * Export the OpenAPI JSON document from the in-code source of truth at
 * `packages/server/src/openapi.ts`. The output is a generated build artifact,
 * not public repository documentation. Operators regenerate after
 * intentionally extending the route surface by running:
 *
 *     node --import tsx scripts/generate-openapi.mjs
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildOpenApiDocument } from "../packages/server/src/openapi.ts";

const document = buildOpenApiDocument();
const target = resolve("artifacts/openapi/openapi.json");
const payload = `${JSON.stringify(document, null, 2)}\n`;
await mkdir(dirname(target), { recursive: true });
await writeFile(target, payload, "utf8");
process.stdout.write(`Wrote ${target} (${String(payload.length)} bytes)\n`);
