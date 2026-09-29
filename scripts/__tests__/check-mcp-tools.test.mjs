// GEN-6919 / GEN-6879: acceptance tests for scripts/check-mcp-tools.mjs.
// node --test, stdlib only. Each fixture case writes a throwaway snapshot and
// doc under the OS temp dir; case 5 runs the committed snapshot against the
// real developer-facing docs at HEAD.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const CHECKER = path.join(ROOT, "scripts", "check-mcp-tools.mjs");

after(() => {
  rmSync(path.join(ROOT, ".tmp", String(process.pid)), { recursive: true, force: true });
});

const SERVED_SNAPSHOT = {
  source: "test fixture",
  served: ["gen_discover"],
  retired: { gen_get_vidsheet_full: "gen_discover", gen_old_read: "gen_discover" },
};

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

function withFixture(docText, snapshot, run) {
  const parent = tempRoot();
  const dir = mkdtempSync(path.join(parent, "check-mcp-tools-"));
  try {
    const snapshotPath = path.join(dir, "snapshot.json");
    const docPath = path.join(dir, "doc.txt");
    writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
    writeFileSync(docPath, docText);
    return run(docPath, snapshotPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runChecker(docPath, snapshotPath) {
  const result = spawnSync(process.execPath, [CHECKER, "--snapshot", snapshotPath, docPath], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.notEqual(result.status, null, `checker did not run: ${result.error?.message ?? result.stderr}`);
  return result;
}

test("case 1: an unserved, unretired gen_ name fails and is named on stderr", () => {
  const result = withFixture("Call `gen_foo` to do the thing.\n", SERVED_SNAPSHOT, runChecker);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /gen_foo/);
});

test("case 2: a retired name beside its replacement on one line passes", () => {
  const text =
    "Retired: `gen_get_vidsheet_full` — read saved state with the `gen_discover` sheet view.\n";
  const result = withFixture(text, SERVED_SNAPSHOT, runChecker);
  assert.equal(result.status, 0, result.stderr);
});

test("case 3: a retired name without its replacement on the line fails", () => {
  const result = withFixture("Retired: `gen_get_vidsheet_full`.\n", SERVED_SNAPSHOT, runChecker);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /gen_get_vidsheet_full/);
  assert.match(result.stderr, /gen_discover/);
});

test("case 4: a stale tool count fails, the current count passes", () => {
  const snapshot = {
    source: "test fixture",
    served: Array.from({ length: 16 }, (_, i) => `gen_tool_${i}`),
    retired: {},
  };
  const stale = withFixture("We serve 174 tools.\n", snapshot, runChecker);
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /174 tools/);
  const current = withFixture("We serve 16 tools.\n", snapshot, runChecker);
  assert.equal(current.status, 0, current.stderr);
});

test("case 5: the real llms.txt, llms-full.txt and guides/mcp.mdx match the snapshot", () => {
  const result = spawnSync(process.execPath, [CHECKER], { cwd: ROOT, encoding: "utf8" });
  assert.notEqual(result.status, null, `checker did not run: ${result.error?.message ?? result.stderr}`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OK/);
});

test("case 6: .woodpecker/ci.yml runs the checker", () => {
  const ci = readFileSync(path.join(ROOT, ".woodpecker", "ci.yml"), "utf8");
  assert.match(ci, /node scripts\/check-mcp-tools\.mjs/);
});
