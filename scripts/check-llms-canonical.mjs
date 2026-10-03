#!/usr/bin/env node
// intent: agent discovery has exactly one canonical document, https://gen.pro/llms.txt.
// Invariant: no duplicate is regenerated, no page links a site-local /llms.txt (a link that
// would make the canonical file point back at the redirected host), and the developer OpenAPI
// assets stay published. Run: npm test

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CANONICAL = "https://gen.pro/llms.txt";
const RETIRED_LOCAL_FILES = ["public/llms.txt", "public/llms-full.txt"];
const OPENAPI_FILES = ["public/openapi.yaml", "public/.well-known/openapi.yaml"];
const SCAN_DIRS = ["src", "public"];
const TEXT_EXT = new Set([
  ".md", ".mdx", ".txt", ".ts", ".mjs", ".js", ".astro", ".json", ".yaml", ".yml", ".css", ".html", ".svg",
]);
// A `/llms.txt` reference is only canonical when `https://gen.pro` sits immediately before it; a
// bare or api.gen.pro-hosted path is a linking bug the redirect cannot paper over.
const LOCAL_LLMS = /(?<!https:\/\/gen\.pro)\/llms\.txt/g;
const RETIRED_FULL = /llms-full\.txt/;

const problems = [];

for (const rel of RETIRED_LOCAL_FILES) {
  if (existsSync(path.join(ROOT, rel))) {
    problems.push(`${rel}: duplicate agent-discovery file must not exist (canonical is ${CANONICAL})`);
  }
}

for (const rel of OPENAPI_FILES) {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs) || statSync(abs).size === 0) {
    problems.push(`${rel}: the developer OpenAPI asset must stay published`);
  }
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs));
    else out.push(abs);
  }
  return out;
}

let canonicalLinks = 0;
for (const dirname of SCAN_DIRS) {
  const base = path.join(ROOT, dirname);
  if (!existsSync(base)) {
    problems.push(`${dirname}/: directory not found`);
    continue;
  }
  for (const abs of walk(base)) {
    if (!TEXT_EXT.has(path.extname(abs))) continue;
    // A text extension that cannot be read is a broken input, not a skip.
    const text = readFileSync(abs, "utf8");
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    text.split("\n").forEach((line, index) => {
      if (line.includes(CANONICAL)) canonicalLinks += 1;
      if (RETIRED_FULL.test(line)) {
        problems.push(`${rel}:${index + 1}: llms-full.txt is retired; link ${CANONICAL}`);
      }
      for (const _ of line.matchAll(LOCAL_LLMS)) {
        problems.push(`${rel}:${index + 1}: site-local /llms.txt link; use ${CANONICAL} -> ${line.trim().slice(0, 120)}`);
      }
    });
  }
}

if (canonicalLinks === 0) {
  problems.push(`no page links ${CANONICAL}; agent discovery must stay advertised`);
}

if (problems.length) {
  for (const problem of problems) process.stderr.write(`${problem}\n`);
  process.stderr.write(`check-llms-canonical: ${problems.length} problem(s)\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `check-llms-canonical: OK — ${canonicalLinks} canonical link(s), no duplicate agent-discovery files\n`,
  );
}
