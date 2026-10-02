// GEN-8157: acceptance tests for scripts/check-openapi-completeness.mjs.
// node --test, stdlib only. Each case can fail: a regression in the checker
// (or in the generator that fills the spec) flips an assertion instead of
// silently passing.
//
//   G1: a spec with one complete operation and one missing a response example
//       counts response_example=1 and gates (non-zero) against a baseline of 2.
//   G2: --update never lowers a baseline value (5 stays 5 when measured 3,
//       becomes 7 when measured 7).
//   G3: a 4xx response $ref'ing a schema with code.enum counts for error_codes;
//       one whose code has no enum and no example does not.
//   G4: the real public/openapi.yaml passes the committed baseline, and the
//       baseline's error_responses value is 192 (every operation has an error).
//   G5: python3 scripts/sync_mcp_surface.py --check and
//       node scripts/sync-from-backend.mjs --check still exit 0.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  compareBaseline,
  missCounts,
  parseYaml,
  DIMENSIONS,
  scoreSpec,
  updateBaseline,
} from "../check-openapi-completeness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const CHECKER = path.join(ROOT, "scripts", "check-openapi-completeness.mjs");
const OPENAPI = path.join(ROOT, "public", "openapi.yaml");
const BASELINE = path.join(ROOT, "scripts", "openapi-completeness-baseline.json");
const SYNC_MCP = path.join(ROOT, "scripts", "sync_mcp_surface.py");
const SYNC_BACKEND = path.join(ROOT, "scripts", "sync-from-backend.mjs");

// TMPDIR can point at a read-only mount (a locked-down lane box); fall back to
// a per-process directory under the repo before giving up.
function tempRoot() {
  for (const candidate of [tmpdir(), path.join(ROOT, ".tmp", String(process.pid))]) {
    try {
      mkdirSync(candidate, { recursive: true });
      accessSync(candidate, constants.W_OK);
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  throw new Error("no writable temp directory");
}

function zeroBaseline() {
  return Object.fromEntries(DIMENSIONS.map((d) => [d, 0]));
}

function runNode(args, cwd = ROOT) {
  return spawnSync(process.execPath, args, { cwd, encoding: "utf8" });
}

function completeOperation() {
  return {
    description: "A complete operation.",
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { type: "object", properties: { id: { type: "string" } } },
          example: { id: "abc123" },
        },
      },
    },
    responses: {
      "200": {
        description: "OK",
        content: {
          "application/json": {
            schema: { type: "object", properties: { ok: { type: "boolean" } } },
            example: { ok: true },
          },
        },
      },
      "422": {
        description: "Validation error",
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/Error" } },
        },
      },
    },
  };
}

test("G1: response_example is counted per operation and gates against the baseline", () => {
  const missingExample = completeOperation();
  // Strip the 2xx example/examples: a schema with no example is not complete.
  delete missingExample.responses["200"].content["application/json"].example;

  const spec = {
    components: { schemas: { Error: { type: "object", properties: { code: { type: "string" } } } } },
    paths: {
      "/complete": { get: completeOperation() },
      "/missing": { get: missingExample },
    },
  };

  const { counts, missing } = scoreSpec(spec);
  assert.equal(counts.response_example, 1, "exactly one operation has a 2xx example");
  assert.deepEqual(missing.response_example, ["GET /missing"]);

  const baseline = { ...zeroBaseline(), response_example: 0 };
  const failures = compareBaseline(missCounts(missing), baseline);
  assert.ok(
    failures.some((f) => f.dimension === "response_example" && f.measured === 1 && f.baseline === 0),
    "one operation missing an example must fail an allowance of 0",
  );
});

test("G2: updateBaseline only shrinks an allowance, never grows it", () => {
  const baseline = { ...zeroBaseline(), error_codes: 5 };
  assert.equal(updateBaseline({ ...zeroBaseline(), error_codes: 3 }, baseline).error_codes, 3);
  assert.equal(updateBaseline({ ...zeroBaseline(), error_codes: 7 }, baseline).error_codes, 5);
});

test("G6: retiring an operation never fails the gate", () => {
  const spec = { paths: { "/a": { get: completeOperation() }, "/b": { get: completeOperation() } } };
  const before = missCounts(scoreSpec(spec).missing);
  delete spec.paths["/b"];
  const after = missCounts(scoreSpec(spec).missing);
  assert.deepEqual(compareBaseline(after, before), []);
});

test("G2: --update rewrites a baseline file only downward", () => {
  const dir = mkdtempSync(path.join(tempRoot(), "openapi-completeness-g2-"));
  try {
    const baselinePath = path.join(dir, "baseline.json");
    const realMisses = missCounts(scoreSpec(parseYaml(readFileSync(OPENAPI, "utf8"))).missing).error_codes;
    // An allowance above the real misses shrinks to the measured value.
    writeFileSync(baselinePath, JSON.stringify({ ...zeroBaseline(), error_codes: realMisses + 50 }, null, 2));
    let result = runNode([CHECKER, "--update", "--file", OPENAPI, "--baseline", baselinePath]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(baselinePath, "utf8")).error_codes, realMisses);

    // An allowance below the real misses is never grown by a re-measure.
    writeFileSync(baselinePath, JSON.stringify({ ...zeroBaseline(), error_codes: 1 }, null, 2));
    result = runNode([CHECKER, "--update", "--file", OPENAPI, "--baseline", baselinePath]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(baselinePath, "utf8")).error_codes, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("G3: a 4xx response $ref'ing a code.enum schema counts for error_codes; a plain code does not", () => {
  const components = {
    schemas: {
      ErrorWithEnum: {
        type: "object",
        properties: { code: { type: "string", enum: ["a", "b"] } },
      },
      ErrorNoEnum: {
        type: "object",
        properties: { code: { type: "string" } },
      },
    },
  };

  const base = completeOperation();
  const withEnum = structuredClone(base);
  withEnum.responses["422"] = {
    description: "Validation error",
    content: {
      "application/json": { schema: { $ref: "#/components/schemas/ErrorWithEnum" } },
    },
  };
  const noEnum = structuredClone(base);
  noEnum.responses["422"] = {
    description: "Validation error",
    content: {
      "application/json": { schema: { $ref: "#/components/schemas/ErrorNoEnum" } },
    },
  };

  const spec = {
    components,
    paths: {
      "/enumerated": { post: withEnum },
      "/plain": { post: noEnum },
    },
  };

  const { counts } = scoreSpec(spec);
  assert.equal(counts.error_codes, 1, "only the enum-carrying operation has a named error code");
});

test("G4: the real spec passes the committed baseline, and no operation lacks an error response", () => {
  const result = runNode([CHECKER]);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  assert.equal(baseline.error_responses, 0, "every operation carries at least one 4xx/5xx response");

  // The real spec must also meet every other dimension at exactly the baseline:
  // a count below it would have failed the gate above.
  const report = runNode([CHECKER, "--report"]);
  assert.equal(report.status, 0, report.stderr);
});

test("G5: the OpenAPI generators still re-render the committed docs", () => {
  const mcp = spawnSync("python3", [SYNC_MCP, "--check"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(mcp.status, 0, mcp.stderr || mcp.stdout);

  const backend = runNode([SYNC_BACKEND, "--check"]);
  assert.equal(backend.status, 0, backend.stderr || backend.stdout);
});
