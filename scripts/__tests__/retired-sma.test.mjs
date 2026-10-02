// GEN-8156 (part A): the SMA (social media automation) routes are retired under
// GEN-7397 and a gen-agentic test asserts no served route contains "/smas".
// These tests pin the api-docs side of that retirement: no documented path, no
// MCP-surface operation, the x-schema-status: missing count stays ratcheted at
// its new value, and both generator scripts render the committed docs cleanly.
// node --test, stdlib only; the OpenAPI copies are parsed with PyYAML because no
// YAML parser ships in the Node stdlib.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const OPENAPI = path.join(ROOT, "public", "openapi.yaml");
const MCP_SURFACE = path.join(ROOT, "scripts", "mcp-surface.json");
const BASELINE = path.join(ROOT, "scripts", "openapi-missing-baseline.json");
const SYNC_MCP = path.join(ROOT, "scripts", "sync_mcp_surface.py");
const SYNC_BACKEND = path.join(ROOT, "scripts", "sync-from-backend.mjs");

// The new ratchet value after removing the nine retired SMA operations:
// 25 missing before - 9 SMA operations = 16.
const EXPECTED_MISSING = 16;

function parseOpenApi() {
  const script = 'import json,sys,yaml\nprint(json.dumps(yaml.safe_load(open(sys.argv[1])), separators=(",",":")))';
  const result = spawnSync("python3", ["-c", script, OPENAPI], { cwd: ROOT, encoding: "utf8" });
  assert.notEqual(result.status, null, `python3 could not run: ${result.error?.message ?? result.stderr}`);
  if (result.status !== 0) {
    throw new Error(`python3 could not parse ${OPENAPI}:\n${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

test("S1: public/openapi.yaml has no path containing /smas", () => {
  const doc = parseOpenApi();
  const offenders = Object.keys(doc.paths).filter((p) => p.includes("/smas"));
  assert.deepEqual(offenders, [], `retired SMA paths still documented: ${offenders.join(", ")}`);
});

test("S2: scripts/mcp-surface.json has no operation whose path contains /smas", () => {
  const surface = JSON.parse(readFileSync(MCP_SURFACE, "utf8"));
  const offenders = surface.operations
    .filter((op) => op.path.includes("/smas"))
    .map((op) => `${op.method} ${op.path}`);
  assert.deepEqual(offenders, [], `retired SMA operations still in the surface: ${offenders.join(", ")}`);
});

test("S3: x-schema-status: missing count equals the baseline and is the retired-SMA value", () => {
  const doc = parseOpenApi();
  let missing = 0;
  for (const methods of Object.values(doc.paths)) {
    for (const op of Object.values(methods)) {
      if (op && op["x-schema-status"] === "missing") missing += 1;
    }
  }
  const baseline = JSON.parse(readFileSync(BASELINE, "utf8")).missing;
  assert.equal(missing, baseline, "missing count drifted from scripts/openapi-missing-baseline.json");
  assert.equal(baseline, EXPECTED_MISSING, `baseline should be ${EXPECTED_MISSING} after the SMA retirement`);
});

test("S4: both generator scripts render the committed docs cleanly", () => {
  const mcp = spawnSync("python3", [SYNC_MCP, "--check"], { cwd: ROOT, encoding: "utf8" });
  assert.notEqual(mcp.status, null, `sync_mcp_surface.py could not run: ${mcp.error?.message ?? mcp.stderr}`);
  assert.equal(mcp.status, 0, `sync_mcp_surface.py --check failed:\n${mcp.stdout}\n${mcp.stderr}`);

  const backend = spawnSync(process.execPath, [SYNC_BACKEND, "--check"], { cwd: ROOT, encoding: "utf8" });
  assert.notEqual(backend.status, null, `sync-from-backend.mjs could not run: ${backend.error?.message ?? backend.stderr}`);
  assert.equal(backend.status, 0, `sync-from-backend.mjs --check failed:\n${backend.stdout}\n${backend.stderr}`);
});
