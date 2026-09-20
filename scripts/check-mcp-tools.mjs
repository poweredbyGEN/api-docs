#!/usr/bin/env node
// Fails when a published doc names a `gen_*` MCP tool the live server does not
// expose, or states a tool count that no longer matches `tools/list`.
//
// Why this exists: these files are hand-maintained and they are what AI agents
// are pointed at. On 2026-09-19 llms.txt named `gen_render_video`, which is
// absent from tools/list — an agent following the docs calls it and fails. The
// count had drifted too: 155 documented, 174 live, and the same 155 had been
// copied into all three files below. None of that is visible by reading them;
// only a comparison against the running server finds it.
//
// A name that does not exist is the dangerous direction and is always fatal.
// A stale count is mechanical to fix: the error prints the number to write.
//
// There is NO skip path. A missing token, a bad status, an empty tool list, an
// unreadable doc or a body that is not a tools/list result all exit non-zero —
// a checker that cannot see must fail, never pass. Mirrors
// check-enums-freshness.mjs.
//
// Needs a GEN Personal Access Token with MCP access:
//   GEN_MCP_PAT=<pat> node scripts/check-mcp-tools.mjs
import { readFileSync } from "node:fs";

const MCP_URL = process.env.GEN_MCP_URL ?? "https://mcp.gen.pro/mcp";

// Every published surface that names tools or states a count. llms.txt alone is
// not enough: the same "155" lived in llms-full.txt and the guide page too, so
// a check scoped to one file passes while the docs site stays wrong.
const DOCS = [
  "public/llms.txt",
  "public/llms-full.txt",
  "src/content/docs/guides/mcp.mdx",
];

// Matches all three published wordings:
//   exposes 174 `gen_*` tools | Exposes 174 gen_* tools | exposes **174 tools**
const COUNT = /exposes\s+\*{0,2}(\d+)\s*(?:`?gen_\*`?)?\s*tools/i;
const TOOL_NAME = /\bgen_[a-z0-9_]+\b/g;

// Text between these markers documents tools that were REMOVED. A migration
// note that names the dead call is more useful than silence, so those names are
// history rather than instructions and are not checked. The exemption is
// deliberately a sentinel and not a fuzzy "the word removed appears nearby"
// rule: it is narrow, greppable, and visible in review.
const REMOVED_BLOCK =
  /<!--\s*gen-removed-tools:start\s*-->[\s\S]*?<!--\s*gen-removed-tools:end\s*-->/g;

function fail(msg) {
  console.error(`check-mcp-tools: ${msg}`);
  process.exit(1);
}

const pat = process.env.GEN_MCP_PAT;
if (!pat) fail("GEN_MCP_PAT is unset; refusing to skip the MCP tool check");

// The server speaks Streamable HTTP and answers with SSE frames even for a
// single JSON-RPC call, so the payload is the last `data:` line, not the body.
function lastDataFrame(text, what) {
  const frames = text
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => l.slice(6));
  const raw = frames.length ? frames[frames.length - 1] : text;
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail(`${what}: response was not JSON (${err.message})`);
  }
}

// A notification carries no response body and is acknowledged with 202, not
// 200. Accepting only 200 failed against a healthy server — a false RED is as
// useless as a false green.
async function rpc(body, sessionId, okStatuses = [200]) {
  const headers = {
    Authorization: `Bearer ${pat}`,
    "Content-Type": "application/json",
    // Both are mandatory: without the SSE accept the server answers 406.
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!okStatuses.includes(res.status)) {
    fail(`${body.method}: HTTP ${res.status}`);
  }
  return { res, text: await res.text() };
}

const init = await rpc({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "api-docs-mcp-tool-check", version: "1.0" },
  },
});
const sessionId = init.res.headers.get("mcp-session-id");
if (!sessionId) fail("initialize returned no mcp-session-id");
const serverVersion =
  lastDataFrame(init.text, "initialize").result?.serverInfo?.version ?? "unknown";

await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }, sessionId, [
  200, 202, 204,
]);

const listed = lastDataFrame(
  (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, sessionId)).text,
  "tools/list",
);
const tools = listed.result?.tools;
if (!Array.isArray(tools) || tools.length === 0) {
  fail("tools/list returned no tools; refusing to validate against an empty set");
}
const live = new Set(tools.map((t) => t.name));

console.log(`check-mcp-tools: server ${serverVersion}, ${live.size} tools live`);

let bad = false;
let sawAnyName = false;

for (const doc of DOCS) {
  let text;
  try {
    text = readFileSync(doc, "utf8");
  } catch (err) {
    fail(`${doc}: cannot read (${err.message}); a doc that vanished is not a pass`);
  }

  const scanned = text.replace(REMOVED_BLOCK, "");

  // `gen_pat_...` is the PAT prefix used in examples, not a tool name.
  // Without this, every doc showing a sample key reports a fake ghost.
  const named = new Set(
    (scanned.match(TOOL_NAME) ?? []).filter((n) => !n.startsWith("gen_pat_")),
  );
  if (named.size) sawAnyName = true;
  const ghosts = [...named].filter((n) => !live.has(n)).sort();
  const stated = text.match(COUNT);

  console.log(
    `  ${doc}: ${named.size} names, stated count ${stated ? stated[1] : "none"}`,
  );

  if (ghosts.length) {
    bad = true;
    console.error(
      `\n${doc} names ${ghosts.length} tool(s) that DO NOT EXIST on the live server:`,
    );
    for (const g of ghosts) console.error(`  - ${g}`);
    console.error(
      "An agent reading the docs will call these and fail. Remove or correct them.",
    );
  }
  if (stated && Number(stated[1]) !== live.size) {
    bad = true;
    console.error(
      `\n${doc} says the MCP exposes ${stated[1]} tools; tools/list returns ${live.size}.`,
    );
    console.error(`Update that number to ${live.size}.`);
  }
}

// Every doc silently losing its gen_* names would otherwise read as a clean pass.
if (!sawAnyName) {
  fail("no gen_* tool names found in ANY doc; the docs or this regex are wrong");
}

if (bad) process.exit(1);
console.log("check-mcp-tools: OK");
