#!/usr/bin/env node
// GEN-6697: scripts/user-job-enums.json feeds check-model-enums.mjs, so the
// documented model enums are only as true as this copy. Fails unless it is
// byte-identical to the Rails-generated docs/generated/user-job-enums.json at
// gen-backend-v2 <ref> (argv[2], default main) on git.gen.pro, the forge that
// controls merges (GEN-6691). GitHub is a one-way mirror that lags or freezes,
// so a comparison against it can pass on a contract main has already moved.
// The ref is resolved to its commit SHA first: Gitea's raw endpoint answers an
// unknown ref with the default branch (HTTP 200), which would turn a typo into
// a silent pass. A missing token, any non-200, a body that is not the artifact
// or carries fewer than 40 job types, or a diff is a non-zero exit; there is no
// skip path. The token is a Gitea read token (Woodpecker org secret
// gen_gitea_read_token), not a GitHub PAT.
// Re-vendor from a fresh gen-backend-v2 checkout:
//   git -C ~/projects/gen-backend-v2 show origin/main:docs/generated/user-job-enums.json > scripts/user-job-enums.json
import { readFileSync } from "node:fs";

const ref = process.argv[2] ?? "main";
const token = process.env.GEN_BACKEND_V2_TOKEN;
if (!token) fail("GEN_BACKEND_V2_TOKEN is unset; refusing to skip the freshness check");

const REPO = "https://git.gen.pro/api/v1/repos/GEN/gen-backend-v2";
async function get(path) {
  const res = await fetch(`${REPO}/${path}`, {
    // Gitea's own scheme; a personal access token is not accepted as `Bearer`.
    // Cloudflare answers an absent User-Agent with a 1010 block.
    headers: { Authorization: `token ${token}`, "User-Agent": "api-docs-enums-freshness" },
  });
  if (res.status !== 200) fail(`GET ${path}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
const parse = (buf, what) => {
  try {
    return JSON.parse(buf);
  } catch (err) {
    fail(`${what}: not JSON (${err.message})`);
  }
};

const sha = parse(await get(`branches/${ref}`), `gen-backend-v2 branch ${ref}`).commit?.id;
if (!/^[0-9a-f]{40}$/.test(sha ?? "")) fail(`gen-backend-v2 branch ${ref}: no commit SHA in the response`);
const remote = await get(`raw/docs/generated/user-job-enums.json?ref=${sha}`);
const jobs = parse(remote, `gen-backend-v2@${sha}: user-job-enums.json`).user_jobs;
if (!jobs || Object.keys(jobs).length < 40) fail(`gen-backend-v2@${sha}: only ${Object.keys(jobs ?? {}).length} job types (< 40); refusing to trust it`);

const local = readFileSync(new URL("./user-job-enums.json", import.meta.url));
if (!local.equals(remote)) fail(`scripts/user-job-enums.json differs from gen-backend-v2@${sha} (${ref}) (local ${local.length} bytes, remote ${remote.length} bytes); re-vendor from a fresh checkout and commit`);
console.log(`PASS: scripts/user-job-enums.json is byte-identical to gen-backend-v2@${sha} (${ref}) docs/generated/user-job-enums.json`);

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}
