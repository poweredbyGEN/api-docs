#!/usr/bin/env node
// GEN-6697: scripts/user-job-enums.json feeds check-model-enums.mjs, so the
// documented model enums are only as true as this copy. Fails unless it is
// byte-identical to the Rails-generated docs/generated/user-job-enums.json at
// gen-backend-v2 <ref> (argv[2], default main), fetched through the GitHub API
// with GEN_BACKEND_V2_TOKEN. A missing token, any non-200, a body with fewer
// than 40 job types, or a diff is a non-zero exit; there is no skip path.
// Re-vendor from a fresh gen-backend-v2 checkout:
//   git -C ~/projects/gen-backend-v2 show origin/main:docs/generated/user-job-enums.json > scripts/user-job-enums.json
// The org secret is a GitHub PAT, so this reads the GitHub push mirror of the
// Gitea source of truth.
// ponytail: a run inside the mirror's sync lag compares against the previous
// main; switch to the Gitea API if a Gitea read token is ever added.
import { readFileSync } from "node:fs";

const ref = process.argv[2] ?? "main";
const token = process.env.GEN_BACKEND_V2_TOKEN;
if (!token) fail("GEN_BACKEND_V2_TOKEN is unset; refusing to skip the freshness check");

const url = `https://api.github.com/repos/poweredbyGEN/gen-backend-v2/contents/docs/generated/user-job-enums.json?ref=${ref}`;
const res = await fetch(url, {
  headers: {
    Accept: "application/vnd.github.raw+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "api-docs-enums-freshness",
    "X-GitHub-Api-Version": "2022-11-28",
  },
});
if (!res.ok) fail(`cannot fetch gen-backend-v2@${ref} docs/generated/user-job-enums.json: HTTP ${res.status}`);
const remote = Buffer.from(await res.arrayBuffer());

let jobs;
try {
  jobs = JSON.parse(remote).user_jobs;
} catch (err) {
  fail(`gen-backend-v2@${ref}: not the user-job enum artifact (${err.message})`);
}
if (!jobs || Object.keys(jobs).length < 40) fail(`gen-backend-v2@${ref}: only ${Object.keys(jobs ?? {}).length} job types (< 40); refusing to trust it`);

const local = readFileSync(new URL("./user-job-enums.json", import.meta.url));
if (!local.equals(remote)) fail(`scripts/user-job-enums.json differs from gen-backend-v2@${ref} (local ${local.length} bytes, remote ${remote.length} bytes); re-vendor from a fresh checkout and commit`);
console.log(`PASS: scripts/user-job-enums.json is byte-identical to gen-backend-v2@${ref} docs/generated/user-job-enums.json`);

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}
