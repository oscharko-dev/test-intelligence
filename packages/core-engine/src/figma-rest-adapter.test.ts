import assert from "node:assert/strict";
import test from "node:test";

import {
  FigmaRestFetchError,
  fetchFigmaFileForTestIntelligence,
  fetchFigmaImageMetadataForTestIntelligence,
  fetchFigmaNodesForTestIntelligence,
  fetchFigmaScreenCapturesForTestIntelligence,
  parseFigmaUrl,
} from "./figma-rest-adapter.js";

const okJson = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const errJson = (
  status: number,
  body: unknown,
  headers: HeadersInit = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const minimalFile = {
  name: "Test View 03",
  lastModified: "2026-05-01T00:00:00Z",
  version: "1",
  thumbnailUrl: "",
  document: {
    id: "0:0",
    name: "Document",
    type: "DOCUMENT",
    children: [],
  },
};

const PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63606060000000040001f61738550000000049454e44ae426082",
  "hex",
);
const FIGMA_TOKEN_PREFIX = "figd" + "_";

void test("parseFigmaUrl extracts fileKey + nodeId from a design URL", () => {
  const parsed = parseFigmaUrl(
    "https://www.figma.com/design/M7FGS79qLfr3O4OXEYbxy0/Test-View-03?node-id=0-1",
  );
  assert.equal(parsed.fileKey, "M7FGS79qLfr3O4OXEYbxy0");
  assert.equal(parsed.nodeId, "0:1");
});

void test("parseFigmaUrl accepts a /file/ legacy URL", () => {
  const parsed = parseFigmaUrl(
    "https://www.figma.com/file/ABC123xyz/My-File?node-id=12-34",
  );
  assert.equal(parsed.fileKey, "ABC123xyz");
  assert.equal(parsed.nodeId, "12:34");
});

void test("parseFigmaUrl accepts a URL without nodeId", () => {
  const parsed = parseFigmaUrl(
    "https://www.figma.com/design/ABC123xyz/My-File",
  );
  assert.equal(parsed.fileKey, "ABC123xyz");
  assert.equal(parsed.nodeId, undefined);
});

void test("parseFigmaUrl rejects a non-figma host (SSRF guard)", () => {
  assert.throws(
    () => parseFigmaUrl("https://evil.example.com/design/ABC/X"),
    /figma\.com/,
  );
});

void test("parseFigmaUrl rejects a non-https URL", () => {
  assert.throws(
    () => parseFigmaUrl("http://www.figma.com/design/ABC/X"),
    /https/,
  );
});

void test("parseFigmaUrl rejects a URL without a fileKey", () => {
  assert.throws(
    () => parseFigmaUrl("https://www.figma.com/design/"),
    /file key/,
  );
});

void test("parseFigmaUrl rejects unsafe node-id diagnostics", () => {
  assert.throws(
    () =>
      parseFigmaUrl(
        "https://www.figma.com/design/ABC123xyz/File?node-id=mailto:claims@customer.example",
      ),
    (err: unknown): boolean => {
      assert.ok(err instanceof FigmaRestFetchError);
      assert.equal(err.errorClass, "request_invalid");
      assert.doesNotMatch(err.message, /mailto:/u);
      assert.doesNotMatch(err.message, /customer\.example/u);
      return true;
    },
  );
});

void test("fetchFigmaFileForTestIntelligence returns parsed REST file on 200", async () => {
  let seenUrl: string | undefined;
  let seenHeaders: Headers | undefined;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    seenUrl = url;
    seenHeaders = new Headers(init?.headers);
    return okJson(minimalFile);
  }) as unknown as typeof fetch;
  const result = await fetchFigmaFileForTestIntelligence({
    fileKey: "ABC",
    accessToken: "figd_test",
    fetchImpl,
  });
  assert.equal(result.name, "Test View 03");
  assert.ok(seenUrl?.startsWith("https://api.figma.com/v1/files/ABC"));
  assert.equal(seenHeaders?.get("x-figma-token"), "figd_test");
});

void test("fetchFigmaFileForTestIntelligence rejects 401/403 fail-closed (no retry)", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return errJson(401, { err: "Unauthorized" });
  }) as unknown as typeof fetch;
  await assert.rejects(
    () =>
      fetchFigmaFileForTestIntelligence({
        fileKey: "ABC",
        accessToken: "figd_test",
        fetchImpl,
      }),
    (err: unknown): boolean =>
      err instanceof FigmaRestFetchError &&
      err.errorClass === "auth_failed" &&
      !err.retryable,
  );
  assert.equal(calls, 1);
});

void test("fetchFigmaFileForTestIntelligence retries once on 5xx then succeeds", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    if (calls === 1) return errJson(503, { err: "busy" });
    return okJson(minimalFile);
  }) as unknown as typeof fetch;
  const result = await fetchFigmaFileForTestIntelligence({
    fileKey: "ABC",
    accessToken: "figd_test",
    fetchImpl,
  });
  assert.equal(calls, 2);
  assert.equal(result.name, "Test View 03");
});

void test("fetchFigmaFileForTestIntelligence honors Retry-After before retrying 429", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    if (calls === 1) {
      return errJson(
        429,
        { err: "rate limited" },
        {
          "Retry-After": "0",
          "X-Figma-Plan-Tier": "pro",
          "X-Figma-Rate-Limit-Type": "high",
        },
      );
    }
    return okJson(minimalFile);
  }) as unknown as typeof fetch;
  const result = await fetchFigmaFileForTestIntelligence({
    fileKey: "ABC",
    accessToken: "figd_test",
    fetchImpl,
  });
  assert.equal(calls, 2);
  assert.equal(result.name, "Test View 03");
});

void test("fetchFigmaFileForTestIntelligence refuses over-budget Retry-After values", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return errJson(
      429,
      { err: "rate limited" },
      {
        "Retry-After": "61",
        "X-Figma-Plan-Tier": "starter",
        "X-Figma-Rate-Limit-Type": "low",
      },
    );
  }) as unknown as typeof fetch;
  await assert.rejects(
    () =>
      fetchFigmaFileForTestIntelligence({
        fileKey: "ABC",
        accessToken: "figd_test",
        fetchImpl,
      }),
    (err: unknown): boolean =>
      err instanceof FigmaRestFetchError &&
      err.errorClass === "rate_limited" &&
      err.retryAfterSeconds === 61 &&
      err.figmaPlanTier === "starter" &&
      err.figmaRateLimitType === "low",
  );
  assert.equal(calls, 1);
});

void test("fetchFigmaFileForTestIntelligence sanitizes hostile rate-limit metadata", async () => {
  const fetchImpl = (async () =>
    errJson(
      429,
      { err: "rate limited" },
      {
        "Retry-After": "61",
        "X-Figma-Plan-Tier":
          `enterprise https://customer.example/private?token=${FIGMA_TOKEN_PREFIX}plan_secret_value_1234567890`,
        "X-Figma-Rate-Limit-Type":
          `file_content ${FIGMA_TOKEN_PREFIX}limit_secret_value_1234567890`,
        "X-Figma-Upgrade-Link":
          `https://customer.example/upgrade?token=${FIGMA_TOKEN_PREFIX}upgrade_secret_value_1234567890`,
      },
    )) as unknown as typeof fetch;

  await assert.rejects(
    () =>
      fetchFigmaFileForTestIntelligence({
        fileKey: "ABC",
        accessToken: "figd_test",
        fetchImpl,
      }),
    (err: unknown): boolean => {
      assert.ok(err instanceof FigmaRestFetchError);
      assert.equal(err.errorClass, "rate_limited");
      assert.equal(err.retryAfterSeconds, 61);
      assert.match(err.figmaUpgradeLinkDigest ?? "", /^[a-f0-9]{64}$/u);
      assert.doesNotMatch(err.message, /https:\/\/customer\.example/u);
      assert.doesNotMatch(err.message, /figd_/u);
      assert.doesNotMatch(err.figmaPlanTier ?? "", /https:\/\/customer\.example/u);
      assert.doesNotMatch(err.figmaPlanTier ?? "", /figd_/u);
      assert.doesNotMatch(err.figmaRateLimitType ?? "", /figd_/u);
      assert.notEqual(
        err.figmaUpgradeLinkDigest,
        `https://customer.example/upgrade?token=${FIGMA_TOKEN_PREFIX}upgrade_secret_value_1234567890`,
      );
      return true;
    },
  );
});

void test("fetchFigmaFileForTestIntelligence surfaces TLS trust failures with operator action", async () => {
  let calls = 0;
  const cause = Object.assign(
    new Error("unable to get local issuer certificate"),
    {
      code: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    },
  );
  const fetchImpl = (async () => {
    calls += 1;
    throw new TypeError("fetch failed", { cause });
  }) as unknown as typeof fetch;

  await assert.rejects(
    () =>
      fetchFigmaFileForTestIntelligence({
        fileKey: "ABC",
        accessToken: "figd_test",
        fetchImpl,
      }),
    (err: unknown): boolean =>
      err instanceof FigmaRestFetchError &&
      err.errorClass === "transport" &&
      err.message.includes("NODE_EXTRA_CA_CERTS"),
  );
  assert.equal(calls, 2);
});

void test("fetchFigmaFileForTestIntelligence does NOT echo the access token in error messages", async () => {
  const tok = `${FIGMA_TOKEN_PREFIX}supersecret_test_token_value_1234567890_padded_padded`;
  const fetchImpl = (async () => {
    return errJson(403, { err: tok });
  }) as unknown as typeof fetch;
  try {
    await fetchFigmaFileForTestIntelligence({
      fileKey: "ABC",
      accessToken: tok,
      fetchImpl,
    });
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof FigmaRestFetchError);
    assert.ok(
      !err.message.includes(tok),
      `error message must not contain raw token, got: ${err.message}`,
    );
  }
});

void test("fetchFigmaFileForTestIntelligence appends ids when nodeId is supplied", async () => {
  let seenUrl: string | undefined;
  const fetchImpl = (async (url: string) => {
    seenUrl = url;
    return okJson({
      name: "x",
      lastModified: "2026-05-01T00:00:00Z",
      version: "1",
      thumbnailUrl: "",
      nodes: {
        "0:1": {
          document: {
            id: "0:1",
            name: "Frame",
            type: "FRAME",
            children: [],
          },
        },
      },
    });
  }) as unknown as typeof fetch;
  const result = await fetchFigmaFileForTestIntelligence({
    fileKey: "ABC",
    accessToken: "figd_test",
    nodeId: "0:1",
    fetchImpl,
  });
  assert.ok(seenUrl?.includes("/v1/files/ABC/nodes"));
  assert.ok(seenUrl?.includes("ids=0%3A1"));
  // For node-scoped fetches, the adapter wraps the returned subtree as the document root.
  assert.equal(result.document.id, "0:1");
});

void test("fetchFigmaFileForTestIntelligence rejects unsafe nodeId before network calls", async () => {
  const unsafeNodeId =
    `https://customer.example/private?token=${FIGMA_TOKEN_PREFIX}supersecret_single_node_token_1234567890`;
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return okJson({});
  }) as unknown as typeof fetch;

  await assert.rejects(
    () =>
      fetchFigmaFileForTestIntelligence({
        fileKey: "ABC",
        accessToken: "figd_test",
        nodeId: unsafeNodeId,
        fetchImpl,
      }),
    (err: unknown): boolean => {
      assert.ok(err instanceof FigmaRestFetchError);
      assert.equal(err.errorClass, "request_invalid");
      assert.doesNotMatch(err.message, /https:\/\/customer\.example/u);
      assert.doesNotMatch(err.message, /figd_supersecret/u);
      return true;
    },
  );
  assert.equal(calls, 0);
});

void test("fetchFigmaFileForTestIntelligence rejects URI-like nodeId before network calls", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return okJson({});
  }) as unknown as typeof fetch;

  await assert.rejects(
    () =>
      fetchFigmaFileForTestIntelligence({
        fileKey: "ABC",
        accessToken: "figd_test",
        nodeId: "mailto:claims",
        fetchImpl,
      }),
    (err: unknown): boolean => {
      assert.ok(err instanceof FigmaRestFetchError);
      assert.equal(err.errorClass, "request_invalid");
      assert.doesNotMatch(err.message, /mailto:/u);
      return true;
    },
  );
  assert.equal(calls, 0);
});

void test("fetchFigmaNodesForTestIntelligence rejects unsafe node ids before network calls", async () => {
  const unsafeNodeId =
    `https://customer.example/private?token=${FIGMA_TOKEN_PREFIX}supersecret_node_token_1234567890`;
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return okJson({});
  }) as unknown as typeof fetch;
  await assert.rejects(
    () =>
      fetchFigmaNodesForTestIntelligence({
        fileKey: "ABC",
        accessToken: "figd_test",
        nodeIds: [unsafeNodeId],
        fetchImpl,
      }),
    (err: unknown): boolean => {
      assert.ok(err instanceof FigmaRestFetchError);
      assert.equal(err.errorClass, "request_invalid");
      assert.doesNotMatch(err.message, /https:\/\/customer\.example/u);
      assert.doesNotMatch(err.message, /figd_supersecret/u);
      return true;
    },
  );
  assert.equal(calls, 0);
});

void test("fetchFigmaImageMetadataForTestIntelligence rejects unsafe node ids before network calls", async () => {
  const unsafeNodeId = "mailto:claims@customer.example";
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return okJson({});
  }) as unknown as typeof fetch;
  await assert.rejects(
    () =>
      fetchFigmaImageMetadataForTestIntelligence({
        fileKey: "ABC",
        accessToken: "figd_test",
        nodeIds: [unsafeNodeId],
        fetchImpl,
      }),
    (err: unknown): boolean => {
      assert.ok(err instanceof FigmaRestFetchError);
      assert.equal(err.errorClass, "request_invalid");
      assert.doesNotMatch(err.message, /mailto:/u);
      assert.doesNotMatch(err.message, /customer\.example/u);
      return true;
    },
  );
  assert.equal(calls, 0);
});

void test("fetchFigmaNodesForTestIntelligence returns multi-id node documents", async () => {
  let seenUrl: string | undefined;
  const fetchImpl = (async (url: string) => {
    seenUrl = url;
    return okJson({
      name: "x",
      lastModified: "2026-05-01T00:00:00Z",
      version: "1",
      nodes: {
        "0:1": {
          document: { id: "0:1", name: "One", type: "FRAME", children: [] },
        },
        "0:2": {
          document: { id: "0:2", name: "Two", type: "FRAME", children: [] },
        },
      },
    });
  }) as unknown as typeof fetch;

  const result = await fetchFigmaNodesForTestIntelligence({
    fileKey: "ABC",
    accessToken: "figd_test",
    nodeIds: ["0:1", "0:2"],
    fetchImpl,
  });

  assert.ok(seenUrl?.includes("/v1/files/ABC/nodes"));
  assert.ok(seenUrl?.includes("ids=0%3A1%2C0%3A2"));
  assert.equal(result.nodes.get("0:1")?.name, "One");
  assert.equal(result.nodes.get("0:2")?.name, "Two");
});

void test("fetchFigmaNodesForTestIntelligence redacts secret-shaped node ids in diagnostics", async () => {
  const secretLikeNodeId =
    `${FIGMA_TOKEN_PREFIX}supersecret_node_token_value_1234567890`;
  const fetchImpl = (async () => okJson({ nodes: {} })) as unknown as typeof fetch;

  await assert.rejects(
    () =>
      fetchFigmaNodesForTestIntelligence({
        fileKey: "ABC",
        accessToken: "figd_test",
        nodeIds: [secretLikeNodeId],
        fetchImpl,
      }),
    (err: unknown): boolean => {
      assert.ok(err instanceof FigmaRestFetchError);
      assert.equal(err.errorClass, "not_found");
      assert.doesNotMatch(err.message, /figd_supersecret/u);
      return true;
    },
  );
});

void test("fetchFigmaImageMetadataForTestIntelligence persists only URL digests", async () => {
  const fetchImpl = (async () =>
    okJson({
      images: {
        "0:1": "https://figma-alpha-api.s3.us-west-2.amazonaws.com/0_1.png",
        "0:2": null,
      },
    })) as unknown as typeof fetch;

  const result = await fetchFigmaImageMetadataForTestIntelligence({
    fileKey: "ABC",
    accessToken: "figd_test",
    nodeIds: ["0:1", "0:2"],
    fetchImpl,
  });

  assert.equal(result.images[0]?.renderable, true);
  assert.match(result.images[0]?.imageUrlDigest ?? "", /^[a-f0-9]{64}$/u);
  assert.equal(result.images[1]?.renderable, false);
  assert.equal(result.images[1]?.reason, "null");
  assert.doesNotMatch(JSON.stringify(result), /https:\/\//u);
});

void test("fetchFigmaImageMetadataForTestIntelligence redacts secret-shaped node ids in diagnostics", async () => {
  const secretLikeNodeId =
    `${FIGMA_TOKEN_PREFIX}supersecret_image_token_value_1234567890`;
  const fetchImpl = (async () =>
    okJson({
      images: {
        [secretLikeNodeId]: 123,
      },
    })) as unknown as typeof fetch;

  await assert.rejects(
    () =>
      fetchFigmaImageMetadataForTestIntelligence({
        fileKey: "ABC",
        accessToken: "figd_test",
        nodeIds: [secretLikeNodeId],
        fetchImpl,
      }),
    (err: unknown): boolean => {
      assert.ok(err instanceof FigmaRestFetchError);
      assert.equal(err.errorClass, "parse_error");
      assert.doesNotMatch(err.message, /figd_supersecret/u);
      return true;
    },
  );
});

void test("fetchFigmaNodesForTestIntelligence stops reading oversized streaming bodies", async () => {
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new Uint8Array(512));
      if (pulls >= 10) controller.close();
    },
  });
  const fetchImpl = (async () =>
    new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

  await assert.rejects(
    () =>
      fetchFigmaNodesForTestIntelligence({
        fileKey: "ABC",
        accessToken: "figd_test",
        nodeIds: ["0:1", "0:2"],
        fetchImpl,
        maxResponseBytes: 1024,
      }),
    (err: unknown): boolean =>
      err instanceof FigmaRestFetchError &&
      err.errorClass === "transport" &&
      /exceeds 1024 bytes/u.test(err.message),
  );
  assert.ok(pulls < 10, `expected early stream cancellation, got ${pulls} pulls`);
});

void test("fetchFigmaScreenCapturesForTestIntelligence resolves image lookup URLs and returns PNG captures", async () => {
  const requestedUrls: string[] = [];
  const requestHeaders: Headers[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    requestedUrls.push(url);
    requestHeaders.push(new Headers(init?.headers));
    if (url.includes("/v1/images/")) {
      return okJson({
        images: {
          "1:1": "https://figma-alpha-api.s3.us-west-2.amazonaws.com/1_1.png",
        },
      });
    }
    return new Response(PNG_BYTES, {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  }) as unknown as typeof fetch;
  const captures = await fetchFigmaScreenCapturesForTestIntelligence({
    fileKey: "ABC",
    accessToken: "figd_test",
    screens: [{ screenId: "1:1", screenName: "Main Screen" }],
    fetchImpl,
  });
  assert.equal(captures.length, 1);
  assert.equal(captures[0]?.screenId, "1:1");
  assert.equal(captures[0].screenName, "Main Screen");
  assert.equal(captures[0].mimeType, "image/png");
  assert.equal(
    Buffer.from(captures[0].base64Data, "base64").equals(PNG_BYTES),
    true,
  );
  // Issue #1930: PNG IHDR is parsed so the gateway estimator can apply the
  // tile-based formula instead of charging the raw base64 byte length.
  assert.equal(captures[0].widthPx, 1);
  assert.equal(captures[0].heightPx, 1);
  assert.deepEqual(requestedUrls, [
    "https://api.figma.com/v1/images/ABC?ids=1%3A1&format=png&scale=2",
    "https://figma-alpha-api.s3.us-west-2.amazonaws.com/1_1.png",
  ]);
  assert.equal(requestHeaders.length, 2);
  assert.equal(requestHeaders[0]?.get("x-figma-token"), "figd_test");
  assert.equal(requestHeaders[1]?.get("x-figma-token"), null);
});

void test("fetchFigmaScreenCapturesForTestIntelligence batches Figma image lookup ids", async () => {
  const requestedUrls: string[] = [];
  const fetchImpl = (async (url: string) => {
    requestedUrls.push(url);
    if (url.includes("/v1/images/")) {
      return okJson({
        images: {
          "1:1": "https://figma-alpha-api.s3.us-west-2.amazonaws.com/1_1.png",
          "2:2": "https://figma-alpha-api.s3.us-west-2.amazonaws.com/2_2.png",
        },
      });
    }
    return new Response(PNG_BYTES, {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  }) as unknown as typeof fetch;
  const captures = await fetchFigmaScreenCapturesForTestIntelligence({
    fileKey: "ABC",
    accessToken: "figd_test",
    screens: [{ screenId: "1:1" }, { screenId: "2:2" }],
    fetchImpl,
  });
  assert.equal(captures.length, 2);
  assert.deepEqual(
    captures.map((capture) => capture.screenId),
    ["1:1", "2:2"],
  );
  assert.deepEqual(requestedUrls, [
    "https://api.figma.com/v1/images/ABC?ids=1%3A1%2C2%3A2&format=png&scale=2",
    "https://figma-alpha-api.s3.us-west-2.amazonaws.com/1_1.png",
    "https://figma-alpha-api.s3.us-west-2.amazonaws.com/2_2.png",
  ]);
});

void test("fetchFigmaScreenCapturesForTestIntelligence rejects non-Figma CDN screenshot URLs", async () => {
  const fetchImpl = (async (url: string) => {
    if (url.includes("/v1/images/")) {
      return okJson({
        images: {
          "1:1": "https://evil.example.com/1_1.png",
        },
      });
    }
    return new Response(PNG_BYTES, {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  }) as unknown as typeof fetch;
  await assert.rejects(
    () =>
      fetchFigmaScreenCapturesForTestIntelligence({
        fileKey: "ABC",
        accessToken: "figd_test",
        screens: [{ screenId: "1:1" }],
        fetchImpl,
      }),
    (err: unknown): boolean =>
      err instanceof FigmaRestFetchError && err.errorClass === "ssrf_refused",
  );
});
