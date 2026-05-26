import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildOpenApiDocument } from "./openapi.js";

void describe("openapi document builder", () => {
  void test("emits a stable OpenAPI 3.1 route inventory", () => {
    const document = buildOpenApiDocument();

    assert.equal(document.openapi, "3.1.0");
    assert.equal(document.info.title, "Test Intelligence API");
    assert.ok(document.paths["/healthz"]);
    assert.ok(document.paths["/readyz"]);
    assert.ok(document.paths["/openapi.json"]);
    assert.ok(document.paths["/api/v1/jobs"]);
  });
});
