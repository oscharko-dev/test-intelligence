import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { describe, test } from "node:test";
import fc from "fast-check";
import {
  readBearerToken,
  validateBearerToken,
  validateWriteRequest,
} from "./request-security.js";

const makeRequest = (
  headers: Record<string, string | string[]>,
): IncomingMessage => {
  return { headers } as unknown as IncomingMessage;
};

void describe("request-security fuzz invariants", () => {
  void test("readBearerToken never throws on arbitrary authorization input", () => {
    fc.assert(
      fc.property(fc.string(), (header) => {
        const result = readBearerToken(makeRequest({ authorization: header }));
        return result === undefined || typeof result === "string";
      }),
      { numRuns: 200 },
    );
  });

  void test("validateBearerToken always rejects when no header is sent", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 64 }),
        (configuredToken) => {
          const result = validateBearerToken({
            request: makeRequest({}),
            bearerToken: configuredToken,
            routeLabel: "test",
          });
          return !result.ok;
        },
      ),
      { numRuns: 100 },
    );
  });

  void test("validateBearerToken accepts a matching token regardless of length", () => {
    fc.assert(
      fc.property(fc.integer({ min: 8, max: 128 }), (length) => {
        const token = randomBytes(length).toString("hex");
        const result = validateBearerToken({
          request: makeRequest({ authorization: `Bearer ${token}` }),
          bearerToken: token,
          routeLabel: "test",
        });
        return result.ok;
      }),
      { numRuns: 50 },
    );
  });

  void test("validateBearerToken rejects digest collisions on differing input", () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.string({ minLength: 8, maxLength: 64 }),
          fc.string({ minLength: 8, maxLength: 64 }),
        ),
        ([a, b]) => {
          fc.pre(a !== b);
          const digestA = createHash("sha256").update(a, "utf8").digest("hex");
          const digestB = createHash("sha256").update(b, "utf8").digest("hex");
          fc.pre(digestA !== digestB);
          const result = validateBearerToken({
            request: makeRequest({ authorization: `Bearer ${b}` }),
            bearerToken: a,
            routeLabel: "t",
          });
          return !result.ok;
        },
      ),
      { numRuns: 100 },
    );
  });

  void test("validateWriteRequest rejects unsupported Content-Type for arbitrary types", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          "text/plain",
          "application/xml",
          "multipart/form-data",
          "image/png",
        ),
        (contentType) => {
          const result = validateWriteRequest({
            request: makeRequest({ "content-type": contentType }),
            host: "127.0.0.1",
            port: 1983,
          });
          assert.equal(result.ok, false);
          return result.statusCode === 415;
        },
      ),
      { numRuns: 20 },
    );
  });
});
