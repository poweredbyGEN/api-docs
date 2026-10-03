// Acceptance tests for operations/gen-api-docs-router.mjs (GEN-8400).
//
// The worker is the edge in front of api.gen.pro. This change makes exactly two
// requests answer differently — the retired agent-discovery paths now 301 to the
// canonical file — so every other request must answer exactly what the live
// worker answers. Both modules are run over the same requests with a mocked
// global fetch and compared field by field: response, and the origin call the
// worker made to produce it.
//
// node --test, stdlib only. Run: node --test 'operations/*.test.mjs'

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CANDIDATE_PATH = path.join(HERE, "gen-api-docs-router.mjs");
const LIVE_PATH = path.join(HERE, "gen-api-docs-router.live.mjs");

// The live worker bytes this candidate was reviewed against. Replacing the
// fixture moves the reviewed baseline, so it takes a deliberate edit here too.
const LIVE_SHA256 = "c2c408c6d27f5fdd4c3dc9df69dbc8301a17973ee19d333365a037fbfecd65a3";

const CANONICAL = "https://gen.pro/llms.txt";
const DOCS_PROXY = "https://poweredbygen.github.io/api-docs";
const RAILS_ORIGIN = "https://origin-app1.gen.pro";
const PYTHON_ORIGIN = "https://python.gen.pro";
const DOCS_BODY = "DOCS-PROXY-BODY-SENTINEL";
const ORIGIN_BODY = "BACKEND-BODY-SENTINEL";

const candidate = (await import(pathToFileURL(CANDIDATE_PATH).href)).default;
const live = (await import(pathToFileURL(LIVE_PATH).href)).default;

// One entry per response shape the worker produces: a machine asset and an
// unknown page proxied to GitHub Pages, a retired human-doc path, and API
// traffic to Rails and to gen-backend-python.
const UNAFFECTED = [
  { url: "https://api.gen.pro/openapi.yaml" },
  { url: "https://api.gen.pro/.well-known/openapi.yaml" },
  { url: "https://api.gen.pro/robots.txt" },
  { url: "https://api.gen.pro/sitemap-index.xml" },
  { url: "https://api.gen.pro/sitemap-0.xml" },
  { url: "https://api.gen.pro/favicon.svg" },
  { url: "https://api.gen.pro/mcp-clients/claude.svg" },
  { url: "https://api.gen.pro/guides/claude-code.md" },
  { url: "https://api.gen.pro/some-unknown-page/" },
  { url: "https://api.gen.pro/guides/mcp/" },
  { url: "https://api.gen.pro/guides/quickstart/" },
  { url: "https://api.gen.pro/" },
  { url: "https://api.gen.pro/journey/" },
  { url: "https://api.gen.pro/reference/agents/" },
  { url: "https://api.gen.pro/reference/cards/text" },
  { url: "https://api.gen.pro/step-5-export/overview" },
  { url: "https://api.gen.pro/v1/me" },
  { url: "https://api.gen.pro/v1/schedule/platforms" },
  { url: "https://api.gen.pro/v1/social/posts" },
  { url: "https://api.gen.pro/v1/vidsheet/actions", method: "POST", body: '{"actions":[]}' },
];

// Run one request through a worker with `fetch` mocked, and report both the
// response and the origin call the worker made. The body is read from a clone so
// the original request stays untouched.
async function respond(worker, { url, method = "GET", body } = {}) {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    calls.push({
      url: request.url,
      method: request.method,
      host: request.headers.get("host"),
      forwardedHost: request.headers.get("x-forwarded-host"),
      forwardedProto: request.headers.get("x-forwarded-proto"),
      body: await request.clone().text(),
    });
    if (new URL(request.url).origin === "https://poweredbygen.github.io") {
      return new Response(DOCS_BODY, { status: 200, headers: { "content-type": "text/yaml" } });
    }
    return new Response(ORIGIN_BODY, { status: 200, headers: { "content-type": "text/plain" } });
  };
  try {
    const response = await worker.fetch(new Request(url, { method, body, redirect: "manual" }));
    return {
      status: response.status,
      location: response.headers.get("location"),
      body: await response.text(),
      calls,
    };
  } finally {
    globalThis.fetch = previousFetch;
  }
}

test("the frozen live source is the reviewed baseline", () => {
  const digest = createHash("sha256").update(readFileSync(LIVE_PATH)).digest("hex");
  assert.equal(
    digest,
    LIVE_SHA256,
    "operations/gen-api-docs-router.live.mjs changed: re-review the candidate against the new live bytes and update LIVE_SHA256",
  );
});

test("5. every unaffected request answers exactly what the live worker answers", async () => {
  for (const request of UNAFFECTED) {
    assert.deepEqual(await respond(candidate, request), await respond(live, request), request.url);
  }
});

test("5. retired human-doc paths keep the live worker's status and Location", async () => {
  const mcp = await respond(candidate, { url: "https://api.gen.pro/guides/mcp/" });
  assert.deepEqual(mcp, await respond(live, { url: "https://api.gen.pro/guides/mcp/" }));
  assert.equal(mcp.status, 301);
  assert.equal(mcp.location, "https://gen.pro/docs/#claude-chatgpt");
  assert.deepEqual(mcp.calls, [], "a human-doc redirect must not reach an origin");
});

test("1. GET /llms.txt 301s to the canonical file, with no origin fetch", async () => {
  const before = await respond(live, { url: "https://api.gen.pro/llms.txt" });
  assert.equal(before.status, 200, "the live worker serves the deprecated file from the docs origin");

  const response = await respond(candidate, { url: "https://api.gen.pro/llms.txt" });
  assert.equal(response.status, 301);
  assert.equal(response.location, CANONICAL);
  assert.deepEqual(response.calls, []);
});

test("2. HEAD /llms-full.txt keeps the query string on the canonical 301", async () => {
  const response = await respond(candidate, {
    url: "https://api.gen.pro/llms-full.txt?source=test",
    method: "HEAD",
  });
  assert.equal(response.status, 301);
  assert.equal(response.location, `${CANONICAL}?source=test`);
  assert.deepEqual(response.calls, []);
});

test("3. the developer OpenAPI assets keep the GitHub Pages proxy path and never redirect", async () => {
  for (const asset of ["/openapi.yaml", "/.well-known/openapi.yaml"]) {
    const response = await respond(candidate, { url: `https://api.gen.pro${asset}` });
    assert.equal(response.status, 200);
    assert.equal(response.location, null);
    assert.equal(response.body, DOCS_BODY);
    assert.deepEqual(
      response.calls.map((call) => `${call.method} ${call.url}`),
      [`GET ${DOCS_PROXY}${asset}`],
    );
  }
});

test("4. API traffic keeps its Rails and python origin, method and body", async () => {
  const rails = await respond(candidate, {
    url: "https://api.gen.pro/v1/vidsheet/actions",
    method: "POST",
    body: '{"actions":[]}',
  });
  assert.deepEqual(rails, await respond(live, {
    url: "https://api.gen.pro/v1/vidsheet/actions",
    method: "POST",
    body: '{"actions":[]}',
  }));
  assert.equal(rails.status, 200);
  assert.equal(rails.location, null);
  assert.equal(rails.body, ORIGIN_BODY);
  assert.deepEqual(rails.calls, [
    {
      url: `${RAILS_ORIGIN}/v1/vidsheet/actions`,
      method: "POST",
      host: "api.gen.pro",
      forwardedHost: "api.gen.pro",
      forwardedProto: "https",
      body: '{"actions":[]}',
    },
  ]);

  const python = await respond(candidate, { url: "https://api.gen.pro/v1/schedule/platforms" });
  assert.deepEqual(python, await respond(live, { url: "https://api.gen.pro/v1/schedule/platforms" }));
  assert.deepEqual(python.calls, [
    {
      url: `${PYTHON_ORIGIN}/schedule/platforms`,
      method: "GET",
      host: "python.gen.pro",
      forwardedHost: "api.gen.pro",
      forwardedProto: "https",
      body: "",
    },
  ]);
});
