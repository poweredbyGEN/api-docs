#!/usr/bin/env node
// GEN-6919: regenerate scripts/mcp-tools-snapshot.json — the served MCP tool
// surface plus the retired-name map — that scripts/check-mcp-tools.mjs gates the
// docs against. CI has no MCP credential, so CI reads the committed snapshot.
//
// Live mode (preferred, needs a GEN PAT in the environment):
//   GEN_MCP_PAT=... node scripts/update-mcp-tools-snapshot.mjs --mcp-url https://mcp.gen.pro
// Offline mode (used when no credential exists; still the gen-mcp-server
// source-of-truth registry, not a hand-typed list):
//   node scripts/update-mcp-tools-snapshot.mjs --aliases-repo ../gen-mcp-server --offline
//
// The PAT is read from the environment only and is never written to the
// snapshot or to stdout. Every request sets a User-Agent: the mcp.gen.pro edge
// 403s Python-urllib (GEN-6898).
//
// Retired names come from gen-mcp-server: contracts/vidsheet-alias-replacements.json
// (aliases) plus the _COMPAT_EXTRA_VIEWS and _COMPAT_RENAMED_FNS maps in
// src/gen_mcp_server/server.py. A retired name resolves to the replacement tool
// exactly as the server's _compat_pointer does, so the docs must name that tool
// on the same line.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const USER_AGENT = "GEN-api-docs-snapshot/1.0 (+https://api.gen.pro; GEN-6919)";
const ALIASES_CANDIDATES = [
  "src/gen_mcp_server/contracts/vidsheet-alias-replacements.json",
  "contracts/vidsheet-alias-replacements.json",
];
const SERVER_CANDIDATES = ["src/gen_mcp_server/server.py", "gen_mcp_server/server.py"];
// Renames the server resolves without an alias-map entry (the migration guide
// documents them): https://api.gen.pro/changelog/2026-09-22-mcp-catalog-collapse/
const KNOWN_RENAMES = {
  gen_media_action: "gen_generate",
  gen_list_talking_avatars: "gen_avatars",
  gen_vidsheet_discover: "gen_discover",
};

function parseArgs(argv) {
  const options = {
    out: path.join(HERE, "mcp-tools-snapshot.json"),
    ref: "origin/main",
    offline: false,
    mcpUrl: process.env.GEN_MCP_URL ?? "https://mcp.gen.pro",
    patEnv: "GEN_MCP_PAT",
    aliasesRepo: process.env.GEN_MCP_SERVER_REPO ?? "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (argv[i] === undefined) throw new Error(`${arg} needs a value`);
      return argv[i];
    };
    if (arg === "--offline") options.offline = true;
    else if (arg === "--out") options.out = next();
    else if (arg === "--ref") options.ref = next();
    else if (arg === "--mcp-url") options.mcpUrl = next();
    else if (arg === "--pat-env") options.patEnv = next();
    else if (arg === "--aliases-repo") options.aliasesRepo = next();
    else if (arg === "-h" || arg === "--help") options.help = true;
    else throw new Error(`unknown option ${arg}`);
  }
  return options;
}

// Read one file from a git ref when the repo is a checkout, else from disk.
// The ref keeps the snapshot tied to gen-mcp-server main, not a dirty worktree.
function readRepoFile(repo, ref, candidates) {
  let gitError = null;
  for (const candidate of candidates) {
    try {
      return {
        path: candidate,
        text: execFileSync("git", ["-C", repo, "show", `${ref}:${candidate}`], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }),
      };
    } catch (error) {
      gitError = error;
    }
  }
  for (const candidate of candidates) {
    try {
      return { path: candidate, text: readFileSync(path.join(repo, candidate), "utf8") };
    } catch {
      // try the next candidate
    }
  }
  throw new Error(`cannot read ${candidates[0]} from ${repo}@${ref}: ${gitError?.message}`);
}

function repoRevision(repo, ref) {
  try {
    return execFileSync("git", ["-C", repo, "rev-parse", "--short", ref], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

// Lane clones fetch the repo as `upstream`, not `origin`; accept either name
// (and a local branch) so the snapshot can still be pinned to the remote tip.
function resolveRef(repo, requested) {
  for (const ref of [requested, "upstream/main", "origin/main", "main"]) {
    if (repoRevision(repo, ref) !== "unknown") return ref;
  }
  return requested;
}

function dictKeys(serverSource, name) {
  const match = serverSource.match(new RegExp(`${name} = \\{(.*?)\\n\\}`, "s"));
  if (!match) return [];
  return [...match[1].matchAll(/"?(gen_[a-z0-9_]+)"?\s*:/g)].map((m) => m[1]);
}

function extraViews(serverSource) {
  const match = serverSource.match(/_COMPAT_EXTRA_VIEWS = \{(.*?)\n\}/s);
  if (!match) return {};
  return Object.fromEntries(
    [...match[1].matchAll(/"(gen_[a-z0-9_]+)":\s*"([a-z_]+)"/g)].map((m) => [m[1], m[2]]),
  );
}

// Same replacement precedence as server._compat_pointer.
function replacementFor(name, aliases, views) {
  if (KNOWN_RENAMES[name]) return KNOWN_RENAMES[name];
  const entry = aliases[name];
  if (!entry) return views[name] ? "gen_discover" : null;
  if (entry.views?.length) return entry.read_tools?.[0] ?? "gen_discover";
  if (entry.scope === "host") return entry.read_tools?.[0] ?? "gen_discover";
  if (entry.scope === "family" || (entry.ops?.length && !entry.actions?.length)) {
    return entry.read_tools?.[0] ?? "gen_discover";
  }
  return "gen_vidsheet_action";
}

function servedFromServerSource(serverSource) {
  const names = new Set();
  for (const match of serverSource.matchAll(/@mcp\.tool\(([\s\S]*?)\)\s*\n(?:async )?def ([a-z0-9_]+)/g)) {
    const explicit = match[1].match(/name="(gen_[a-z0-9_]+)"/);
    names.add(explicit ? explicit[1] : match[2]);
  }
  return [...names].sort();
}

async function servedFromLive(mcpUrl, pat) {
  const response = await fetch(mcpUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${pat}`,
      "user-agent": USER_AGENT,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "gen-api-docs-snapshot", version: "1.0" },
      },
    }),
  });
  // A remote MCP endpoint may answer initialize with SSE; the session it sets
  // is not needed for a stateless tools/list on the hosted server.
  await response.text();
  const list = await fetch(mcpUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${pat}`,
      "user-agent": USER_AGENT,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  });
  if (!list.ok) throw new Error(`tools/list answered HTTP ${list.status}`);
  const body = await list.text();
  const payloadLine = body.startsWith("event:") || body.startsWith("data:")
    ? body.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5)).join("")
    : body;
  const payload = JSON.parse(payloadLine);
  const tools = payload.result?.tools;
  if (!Array.isArray(tools) || !tools.length) throw new Error("tools/list returned no tools array");
  return tools.map((tool) => tool.name).sort();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(
      "usage: node scripts/update-mcp-tools-snapshot.mjs [--offline] [--mcp-url URL] " +
        "[--pat-env VAR] [--aliases-repo PATH] [--ref REF] [--out FILE]\n",
    );
    return 0;
  }
  const repo = options.aliasesRepo || path.resolve(ROOT, "..", "gen-mcp-server");
  const ref = resolveRef(repo, options.ref);
  const pat = process.env[options.patEnv];
  const aliasesFile = readRepoFile(repo, ref, ALIASES_CANDIDATES);
  const serverFile = readRepoFile(repo, ref, SERVER_CANDIDATES);
  const aliases = JSON.parse(aliasesFile.text).aliases ?? {};
  const views = extraViews(serverFile.text);
  const renamed = dictKeys(serverFile.text, "_COMPAT_RENAMED_FNS");

  let served;
  let source;
  if (!options.offline && pat) {
    served = await servedFromLive(options.mcpUrl, pat);
    source = `live: ${options.mcpUrl} tools/list`;
  } else {
    served = servedFromServerSource(serverFile.text);
    source =
      `offline: gen-mcp-server ${ref}@${repoRevision(repo, ref)} ` +
      `${serverFile.path} @mcp.tool registry + ${aliasesFile.path}`;
  }

  const retired = {};
  const candidates = [
    ...Object.keys(aliases),
    ...renamed,
    ...Object.keys(views),
    ...Object.keys(KNOWN_RENAMES),
  ];
  for (const name of candidates) {
    if (served.includes(name)) continue;
    const replacement = replacementFor(name, aliases, views);
    if (replacement) retired[name] = replacement;
  }

  const snapshot = {
    source,
    generated_at: new Date().toISOString(),
    served: [...served].sort(),
    retired: Object.fromEntries(Object.entries(retired).sort(([a], [b]) => a.localeCompare(b))),
  };
  const out = path.resolve(ROOT, options.out);
  writeFileSync(out, `${JSON.stringify(snapshot, null, 2)}\n`);
  process.stdout.write(
    `wrote ${path.relative(ROOT, out)}: ${snapshot.served.length} served, ` +
      `${Object.keys(snapshot.retired).length} retired (${source})\n`,
  );
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    process.stderr.write(`update-mcp-tools-snapshot: ${error.message}\n`);
    process.exitCode = 1;
  },
);
