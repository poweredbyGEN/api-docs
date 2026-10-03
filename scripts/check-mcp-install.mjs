// GEN-7747 (d)+(e), GEN-7128: the MCP install surface is OAuth-first.
// Connectors add https://mcp.gen.pro by URL and sign in; the personal access
// token is the headless/CI path, not the default config. This check fails when
// guides/mcp.mdx drifts back to PAT-first. Run: npm test
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const MCP_FILE = "src/content/docs/guides/mcp.mdx";
const INSTALL_END = "## How the MCP fits with the GEN agent";
const HOSTED_URL = "https://mcp.gen.pro";
const CLAUDE_ADD = "claude mcp add --transport http gen https://mcp.gen.pro";

const errors = [];
const fail = (c, msg) => errors.push(`case ${c}: ${msg}`);
const around = (lines, i, distance) =>
  lines.slice(Math.max(0, i - distance), i + distance + 1).join("\n");

const mcpLines = read(MCP_FILE).split("\n");
const boundary = mcpLines.findIndex((line) => line.startsWith(INSTALL_END));
if (boundary === -1) fail(4, `${MCP_FILE}: install section boundary "${INSTALL_END}" is missing`);
const installLines = mcpLines.slice(0, boundary === -1 ? mcpLines.length : boundary);

// 1. Connector users add the URL by URL and sign in, before any gen_pat text.
const connectorAt = installLines.findIndex((line, i) => {
  const block = around(installLines, i, 6);
  return (
    /claude/i.test(line) &&
    /chatgpt/i.test(block) &&
    /sign in/i.test(block) &&
    /url/i.test(block) &&
    block.includes(HOSTED_URL)
  );
});
const firstPatAt = installLines.findIndex((line) => line.includes("gen_pat"));
if (connectorAt === -1) {
  fail(1, `${MCP_FILE}: no install text tells Claude and ChatGPT connector users to add ${HOSTED_URL} by URL and sign in`);
} else if (firstPatAt !== -1 && firstPatAt < connectorAt) {
  fail(1, `${MCP_FILE}:${firstPatAt + 1}: gen_pat text precedes the connector OAuth sign-in text at line ${connectorAt + 1}`);
}

// 2. The Claude Code command carries no --header, and /mcp follows it.
const addAt = mcpLines.findIndex((line) => line.includes(CLAUDE_ADD));
if (addAt === -1) {
  fail(2, `${MCP_FILE}: no "${CLAUDE_ADD}" command`);
} else {
  if (mcpLines[addAt].includes("--header")) {
    fail(2, `${MCP_FILE}:${addAt + 1}: the Claude Code command carries --header; Claude Code signs in with OAuth`);
  }
  if (!mcpLines.slice(addAt + 1, addAt + 6).some((line) => line.includes("/mcp"))) {
    fail(2, `${MCP_FILE}:${addAt + 1}: no "/mcp" sign-in step within 5 lines after the Claude Code command`);
  }
}

// 3. The PAT path stays, named as the headless/CI or no-OAuth path, and is not
//    the primary call to action.
const patHeaderAt = installLines.findIndex((line) => /authorization/i.test(line) && line.includes("Bearer gen_pat_"));
if (patHeaderAt === -1) {
  fail(3, `${MCP_FILE}: the PAT config ("Authorization: Bearer gen_pat_") is gone`);
} else if (!/headless|\bci\b|without oauth|no oauth/i.test(around(installLines, patHeaderAt, 12))) {
  fail(3, `${MCP_FILE}:${patHeaderAt + 1}: the PAT config is not labelled headless/CI or clients without OAuth`);
}
const primary = mcpLines
  .map((line, i) => ({ line, i }))
  .filter(({ line }) => /<a\b/.test(line) && /class="[^"]*\bprimary\b[^"]*"/.test(line));
if (primary.length === 0) {
  fail(3, `${MCP_FILE}: no primary button`);
} else {
  const label = primary[0].line.replace(/<[^>]*>/g, "").trim();
  if (/personal access token/i.test(label)) {
    fail(3, `${MCP_FILE}:${primary[0].i + 1}: the primary button is "${label}"; OAuth connect is primary and the PAT link is secondary`);
  }
}

// 4. The install section points users of the old tool names at the changelog.
const changelogAt = installLines.findIndex((line) => line.includes("/changelog/2026-09-22-mcp-catalog-collapse/"));
if (changelogAt === -1) {
  fail(4, `${MCP_FILE}: the install section has no /changelog/2026-09-22-mcp-catalog-collapse/ link for users of the retired tool names`);
} else if (!/retired|older|old|legacy|renamed/i.test(around(installLines, changelogAt, 2)) || !/tool/i.test(around(installLines, changelogAt, 2))) {
  fail(4, `${MCP_FILE}:${changelogAt + 1}: the catalog-collapse link is not tied to the retired tool names`);
}

// 5. npm test runs this check.
let testScript = null;
try {
  testScript = JSON.parse(read("package.json")).scripts?.test ?? "";
} catch (error) {
  fail(6, `package.json: unreadable (${error.message})`);
}
if (testScript !== null && !testScript.includes("check-mcp-install.mjs")) {
  fail(5, `package.json: "test" does not run scripts/check-mcp-install.mjs -> ${testScript}`);
}

if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("mcp install OK");
