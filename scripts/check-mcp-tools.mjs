#!/usr/bin/env node
// GEN-6919 / GEN-6879: a doc build fails when the described MCP tool surface
// differs from tools/list. The served surface and the retired-name map live in
// scripts/mcp-tools-snapshot.json (regenerate with
// scripts/update-mcp-tools-snapshot.mjs); this checker reads only that snapshot,
// so CI needs no MCP credential.
//
// Rules per scanned line:
//   1. a served name is fine;
//   2. a retired name must name its replacement on the same line, or be absent;
//   3. any other gen_* identifier is a stale tool name and fails;
//   4. a claim of "N tools" must match the served count;
//   5. a banned product term (GEN-6897) fails.
//
// Usage: node scripts/check-mcp-tools.mjs [--snapshot <file>] [<doc> ...]
// Default docs: public/llms.txt, public/llms-full.txt and the MCP-facing pages
// under src/content/docs (guides/mcp.mdx, guides/vidsheet-actions.mdx,
// guides/content-ideas.mdx, reference/publishing.mdx, reference/watchlists.mdx).
// Pass paths to check others; the retired-name migration table
// (src/content/docs/changelog/2026-09-22-mcp-catalog-collapse.mdx) is
// deliberately not a default because it exists to list retired names.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DEFAULT_DOCS = [
  "public/llms.txt",
  "public/llms-full.txt",
  "src/content/docs/guides/mcp.mdx",
  "src/content/docs/guides/vidsheet-actions.mdx",
  "src/content/docs/guides/content-ideas.mdx",
  "src/content/docs/reference/publishing.mdx",
  "src/content/docs/reference/watchlists.mdx",
];
// A PAT is a credential, not a tool: gen_pat_* identifiers are allowed.
const TOOL_NAME = /(?<![\w])gen_[a-z0-9_]+/g;
const CREDENTIAL_PREFIX = /^gen_pat/;
const BANNED = [[/\bPlays?\b/, "the Plays concept is retired (GEN-6897)"]];
const TOOL_COUNT = /\b(\d{1,4})\s+tools\b/gi;

function parseArgs(argv) {
  const options = { snapshot: process.env.MCP_TOOLS_SNAPSHOT ?? path.join(HERE, "mcp-tools-snapshot.json"), docs: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--snapshot") {
      options.snapshot = argv[i + 1];
      i += 1;
    } else if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg.startsWith("-")) {
      options.error = `unknown option ${arg}`;
    } else {
      options.docs.push(arg);
    }
  }
  if (!options.docs.length) options.docs = DEFAULT_DOCS;
  return options;
}

function loadSnapshot(file) {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const served = new Set(raw.served ?? []);
  const retired = raw.retired ?? {};
  if (!served.size) throw new Error(`${file}: snapshot lists no served tools`);
  for (const name of Object.keys(retired)) {
    if (served.has(name)) throw new Error(`${file}: ${name} is both served and retired`);
  }
  return { served, retired, raw };
}

function lineViolations(file, line, text, { served, retired }) {
  const found = [];
  for (const [pattern, reason] of BANNED) {
    if (pattern.test(text)) found.push(`${file}:${line}: banned term ${pattern} — ${reason}`);
  }
  for (const match of text.matchAll(TOOL_COUNT)) {
    const claimed = Number(match[1]);
    if (claimed !== served.size) {
      found.push(
        `${file}:${line}: stale tool count "${match[0]}" — the snapshot serves ${served.size} tools`,
      );
    }
  }
  const seen = new Set();
  for (const match of text.matchAll(TOOL_NAME)) {
    const name = match[0];
    if (seen.has(name) || CREDENTIAL_PREFIX.test(name) || served.has(name)) continue;
    seen.add(name);
    const replacement = retired[name];
    if (!replacement) {
      found.push(
        `${file}:${line}: ${name} is neither served nor a documented retired name (GEN-6919)`,
      );
    } else if (!new RegExp(`(?<![\\w])${replacement}(?![\\w])`).test(text)) {
      found.push(
        `${file}:${line}: retired tool ${name} must name its replacement ${replacement} on the same line, or be removed (GEN-6919)`,
      );
    }
  }
  return found;
}

function checkDoc(file, snapshot) {
  const text = readFileSync(file, "utf8");
  const violations = [];
  text.split("\n").forEach((line, index) => {
    violations.push(...lineViolations(file, index + 1, line, snapshot));
  });
  return violations;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write("usage: node scripts/check-mcp-tools.mjs [--snapshot <file>] [<doc> ...]\n");
    return 0;
  }
  if (options.error) {
    process.stderr.write(`check-mcp-tools: ${options.error}\n`);
    return 2;
  }
  const snapshot = loadSnapshot(path.resolve(ROOT, options.snapshot));
  const violations = options.docs.flatMap((doc) => checkDoc(path.resolve(ROOT, doc), snapshot));
  if (violations.length) {
    for (const violation of violations) process.stderr.write(`${violation}\n`);
    process.stderr.write(
      `check-mcp-tools: ${violations.length} violation(s) against ${snapshot.served.size} served tools ` +
        `(snapshot ${snapshot.raw.source ?? "unknown"})\n`,
    );
    return 1;
  }
  process.stdout.write(
    `check-mcp-tools: OK — ${options.docs.length} doc(s) match ${snapshot.served.size} served tools ` +
      `(snapshot ${snapshot.raw.source ?? "unknown"})\n`,
  );
  return 0;
}

process.exitCode = main();
