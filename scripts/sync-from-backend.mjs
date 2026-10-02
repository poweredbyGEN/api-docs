#!/usr/bin/env node
// Regenerates the backend-derived parts of the public docs (public/openapi.yaml,
// public/.well-known/openapi.yaml, public/llms.txt, public/llms-full.txt and the
// card reference pages) from the gen-backend-v2 artifacts that define the model,
// creation-card and Vidsheet contracts. Every generated region is delimited by a
// `gen:<name>:start` / `gen:<name>:end` marker pair, so hand-written prose outside
// the markers survives a regeneration untouched.
//
// The `paths:` body of both OpenAPI copies is owned by scripts/sync_mcp_surface.py:
// it documents exactly the routes an MCP tool calls. This script renders the
// `gen:backend-creation-card-schemas` region in components and the markdown
// regions in llms.txt / llms-full.txt.
//
// Vendor (default): copy the upstream artifacts into scripts/backend/, then
// regenerate. Sources, all relative to the --backend directory:
//   config/creation_cards.yml                        card, model, label, options
//   config/model_capabilities.yml                    model id cross-check
//   config/routes.rb                                 the creation_card_matrix route
//   docs/generated/creation-card-matrix.json         the capability matrix the API serves
//   docs/generated/user-job-enums.json               the model enum each job type accepts
//   docs/generated/vidsheet-action-schema.json       the Vidsheet action envelope
//   docs/generated/vidsheet-operations-schema.json   the Vidsheet operation endpoints
//   docs/generated/avatars-api-schema.json           the /avatars response schemas
// The MCP tool surface is gen-mcp-server's served registry, vendored to
// scripts/backend/mcp-tools.json from
// src/gen_mcp_server/contracts/catalog-record/schema-paths.tsv on origin/main.
//
// Usage:
//   node scripts/sync-from-backend.mjs --backend ../gen-backend-v2
//   node scripts/sync-from-backend.mjs --check                 # CI: vendored copy
//   node scripts/sync-from-backend.mjs --check --backend <dir> # CI: an upstream checkout
//
// --check reads the artifacts and re-renders in memory; it writes nothing and
// exits 1 when a rendering differs from the committed file. Without --backend it
// reads the vendored scripts/backend/ copy, so CI needs no gen-backend-v2
// checkout and the result is deterministic.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const VENDOR_DIR = path.join(HERE, "backend");
const MCP_TOOLS_FILE = path.join(VENDOR_DIR, "mcp-tools.json");
const MCP_SNAPSHOT_FILE = path.join(HERE, "mcp-tools-snapshot.json");
const DEFAULT_MCP_REPO = process.env.GEN_MCP_SERVER_REPO ?? "/root/projects/gen-mcp-server";
const MCP_REGISTRY = "src/gen_mcp_server/contracts/catalog-record/schema-paths.tsv";

// Upstream paths, in the order they are vendored.
const UPSTREAM = {
  creationCards: "config/creation_cards.yml",
  modelCapabilities: "config/model_capabilities.yml",
  routes: "config/routes.rb",
  matrix: "docs/generated/creation-card-matrix.json",
  userJobs: "docs/generated/user-job-enums.json",
  actionSchema: "docs/generated/vidsheet-action-schema.json",
  operationsSchema: "docs/generated/vidsheet-operations-schema.json",
  avatars: "docs/generated/avatars-api-schema.json",
};

// The documented generation types and the Rails job types each one routes to.
// Mirrors the CANONICAL map in check-model-enums.mjs, which gates the surfaces
// against the same job enums.
const MODEL_TYPES = {
  text: ["text_generation"],
  image_from_text: ["gemini_image_generation", "seedream_image_generation", "openai_image_generation_2"],
  video_from_text: [
    "gemini_video_generation",
    "gemini_omni_video_generation",
    "kling",
    "seedance_video_generation",
    "seedance_2_0_video_generation",
    "seedance_2_5_video_generation",
  ],
  video_from_image: [
    "gemini_video_generation",
    "gemini_omni_video_generation",
    "kling_img2video",
    "seedance_video_generation",
    "seedance_2_0_video_generation",
    "seedance_2_5_video_generation",
  ],
};

const MIGRATION_GUIDE = "https://api.gen.pro/changelog/2026-09-22-mcp-catalog-collapse/";
// The worked example in the generated retired-name note. Pinned to the mapping
// the compatibility shim serves; asserted against the vendored snapshots so a
// rename upstream fails this script instead of publishing a stale example.
const RETIRED_EXAMPLE = { from: "gen_media_action", to: "gen_generate" };

function parseArgs(argv) {
  const options = { check: false, backend: null, mcpRepo: DEFAULT_MCP_REPO };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (argv[i] === undefined) throw new Error(`${arg} needs a value`);
      return argv[i];
    };
    if (arg === "--check") options.check = true;
    else if (arg === "--backend") options.backend = next();
    else if (arg === "--mcp-repo") options.mcpRepo = next();
    else if (arg === "-h" || arg === "--help") options.help = true;
    else throw new Error(`unknown option ${arg}`);
  }
  return options;
}

// A minimal reader for the YAML shape config/creation_cards.yml uses: block
// mappings, flow sequences and scalars. It is not a general YAML parser; a
// construct outside that shape (a block sequence whose items are mappings)
// raises rather than being guessed at, so an upstream reformat is loud.
function parseYamlSubset(text) {
  const tokens = [];
  for (const raw of text.split("\n")) {
    const line = stripComment(raw);
    if (!line.trim()) continue;
    tokens.push({ indent: line.match(/^ */)[0].length, content: line.trim() });
  }
  let i = 0;
  const parseBlock = (indent) => (tokens[i].content.startsWith("- ") ? parseSeq(indent) : parseMap(indent));
  const parseMap = (indent) => {
    const out = {};
    while (i < tokens.length && tokens[i].indent === indent && !tokens[i].content.startsWith("- ")) {
      const token = tokens[i];
      const colon = splitKey(token.content);
      if (colon === null) throw new Error(`creation_cards.yml: not a mapping entry: ${token.content}`);
      const { key, rest } = colon;
      i += 1;
      if (rest !== "") out[key] = parseScalar(rest);
      else if (i < tokens.length && tokens[i].indent > indent) out[key] = parseBlock(tokens[i].indent);
      else out[key] = null;
    }
    return out;
  };
  const parseSeq = (indent) => {
    const out = [];
    while (i < tokens.length && tokens[i].indent === indent && tokens[i].content.startsWith("- ")) {
      const item = tokens[i].content.slice(2).trim();
      if (splitKey(item) !== null) throw new Error(`creation_cards.yml: unsupported block-sequence mapping: ${item}`);
      out.push(parseScalar(item));
      i += 1;
    }
    return out;
  };
  const value = parseBlock(tokens[0].indent);
  if (i !== tokens.length) throw new Error(`creation_cards.yml: unread line: ${tokens[i].content}`);
  return value;
}

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "#" && (i === 0 || line[i - 1] === " ")) return line.slice(0, i);
  }
  return line;
}

function splitKey(content) {
  let quote = null;
  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ":" && (i + 1 === content.length || content[i + 1] === " ")) {
      return { key: content.slice(0, i).trim(), rest: content.slice(i + 1).trim() };
    }
  }
  return null;
}

function parseScalar(value) {
  if (value === "" || value === "~" || value === "null") return null;
  if (value === "{}") return {};
  if (value === "[]") return [];
  if (value.startsWith("[")) return splitFlow(value.slice(1, -1)).map(parseScalar);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (/^-?\d*\.\d+$/.test(value)) return Number(value);
  return value;
}

function splitFlow(body) {
  const out = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "[" || ch === "{") depth += 1;
    else if (ch === "]" || ch === "}") depth -= 1;
    else if (ch === "," && depth === 0) {
      out.push(body.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (body.slice(start).trim()) out.push(body.slice(start).trim());
  return out;
}

// The upstream checkout keeps the artifacts at their repository paths; the
// vendored copy flattens them to one file per artifact under scripts/backend/.
// Resolve either layout so a --check against the vendored copy reads the same
// bytes as a regeneration from upstream.
function sourcePath(dir, rel) {
  const nested = path.join(dir, rel);
  if (existsSync(nested)) return nested;
  const flat = path.join(dir, path.basename(rel));
  if (existsSync(flat)) return flat;
  throw new Error(`${dir}: missing ${rel}`);
}

const readSource = (dir, rel) => readFileSync(sourcePath(dir, rel), "utf8");
const readSourceJson = (dir, rel) => JSON.parse(readSource(dir, rel));

function escapeCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function scrub(text) {
  // Public wording: no ticket ids leave this generator.
  return String(text).replace(/\bGEN-\d+\b/g, "").replace(/\s{2,}/g, " ").trim();
}

function formatNumbers(values) {
  const nums = values.filter((v) => typeof v === "number").sort((a, b) => a - b);
  if (!nums.length) return "—";
  const out = [];
  let i = 0;
  while (i < nums.length) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j += 1;
    if (j - i + 1 >= 4) out.push(`${nums[i]}–${nums[j]}`);
    else for (let k = i; k <= j; k += 1) out.push(String(nums[k]));
    i = j + 1;
  }
  return out.join(", ");
}

function jobEnum(userJobs, job, field = "model") {
  const values = userJobs?.[job]?.[field]?.enum ?? [];
  return values.filter((v) => typeof v === "string");
}

// ---- the creation-card capability matrix -------------------------------------

function buildCatalog(backendDir) {
  const creationCards = parseYamlSubset(readSource(backendDir, UPSTREAM.creationCards));
  const matrix = readSourceJson(backendDir, UPSTREAM.matrix);
  const capabilities = readSource(backendDir, UPSTREAM.modelCapabilities);
  const routes = readSource(backendDir, UPSTREAM.routes);

  if (!/^\s*get "creation_card_matrix"/m.test(routes)) {
    throw new Error(`${UPSTREAM.routes}: no get "creation_card_matrix" route`);
  }
  const capabilityKeys = new Set([...capabilities.matchAll(/^- key:\s*(\S+)\s*$/gm)].map((m) => m[1]));

  const rulesByPair = new Map();
  for (const rule of matrix.rules ?? []) {
    const key = `${rule.card}\u0000${rule.model}`;
    if (!rulesByPair.has(key)) rulesByPair.set(key, new Map());
    rulesByPair.get(key).set(rule.field, { allowed: rule.allowed ?? [], default: rule.default ?? null });
  }

  const models = [];
  for (const entry of matrix.models ?? []) {
    const card = entry.form_type;
    const model = entry.model;
    if (!capabilityKeys.has(model)) throw new Error(`${UPSTREAM.modelCapabilities}: no model key ${model}`);
    const cardModels = creationCards?.cards?.[card]?.models ?? {};
    if (!cardModels[model]) {
      throw new Error(`${UPSTREAM.creationCards}: card ${card} has no model ${model}; it and the capability matrix disagree`);
    }
    const status = cardModels[model].status ?? "active";
    const label = cardModels[model].label ?? model;
    const rules = rulesByPair.get(`${card}\u0000${model}`);
    models.push({
      card,
      model,
      label,
      status,
      ratio: rules?.get("ratio")?.allowed ?? [],
      duration: rules?.get("duration")?.allowed ?? [],
      outputResolution: rules?.get("outputResolution")?.allowed ?? [],
    });
  }

  const ruleFields = [...new Set((matrix.rules ?? []).map((r) => r.field))];
  return { creationCards, matrix, models, ruleFields };
}

// ---- generated regions -------------------------------------------------------

// The paths section is generated by scripts/sync_mcp_surface.py from the MCP
// surface; the creation-card capability matrix it used to carry is no longer
// served as an API route, so only its schemas stay here.
function inferType(values) {
  const types = new Set();
  let nullable = false;
  for (const value of values) {
    if (value === null || value === undefined) {
      nullable = true;
      continue;
    }
    if (Array.isArray(value)) types.add("array");
    else if (typeof value === "number") types.add(Number.isInteger(value) ? "integer" : "number");
    else if (typeof value === "boolean") types.add("boolean");
    else if (typeof value === "object") types.add("object");
    else types.add("string");
  }
  const list = types.size ? [...types] : ["string"];
  if (nullable && !list.some((t) => t === "object" || t === "array")) list.push("null");
  return list;
}

function yamlType(types, indent) {
  const pad = " ".repeat(indent);
  if (types.length === 1 && types[0] !== "null") return `${pad}type: ${types[0]}`;
  return `${pad}type: [${types.map((t) => (t === "null" ? '"null"' : t)).join(", ")}]`;
}

// One `properties:<name>:` block for a generated object schema. `$ref` is used
// for the two keys the public spec publishes as their own named schema.
function yamlPropertyBlock(name, values, indent) {
  const pad = " ".repeat(indent);
  const lines = [`${pad}${name}:`];
  if (name === "model") {
    lines.push(`${pad}  $ref: '#/components/schemas/CreationCardModel'`);
    return lines;
  }
  const types = inferType(values);
  const sample = values.find((v) => v !== null && v !== undefined);
  const isArray = types.includes("array");
  lines.push(...yamlType(isArray ? ["array"] : types, indent + 2).split("\n"));
  if (isArray) {
    const itemTypes = inferType((sample ?? []).flat());
    if (itemTypes.length === 1 && itemTypes[0] === "object") {
      lines.push(`${pad}  items:`);
      lines.push(`${pad}    type: object`);
    } else {
      lines.push(`${pad}  items:`);
      if (itemTypes.length === 1 && itemTypes[0] !== "null") lines.push(`${pad}    type: ${itemTypes[0]}`);
      else lines.push(`${pad}    type: [${itemTypes.map((t) => (t === "null" ? '"null"' : t)).join(", ")}]`);
    }
  }
  return lines;
}

function openapiSchemaRegion(catalog) {
  const { matrix } = catalog;
  const limits = matrix.limits ?? [];
  const limitKeys = [...new Set(limits.flatMap((entry) => Object.keys(entry)))];
  const enumValues = [...new Set(catalog.models.map((m) => m.model))];
  const lines = [
    "    CreationCardModel:",
    "      type: string",
    "      description: |",
    "        A model id a creation card accepts. The card catalog pairs each id with",
    "        its card and the ratio, duration and outputResolution values the API runs.",
    "      enum:",
    ...enumValues.map((value) => `        - ${value}`),
    "    CreationCardMatrix:",
    "      type: object",
    "      description: |",
    "        The creation-card capability matrix: the creation-card ids, the model id each",
    "        card accepts, and the option values, required fields and bounds the API",
    "        enforces. A generation outside `allowed` is refused.",
    "      properties:",
    "        description:",
    "          type: string",
    "        cards:",
    "          type: array",
    "          description: The creation-card ids the API accepts.",
    "          items:",
    "            type: string",
    "        models:",
    "          type: array",
    "          description: One entry per card and model id the API accepts.",
    "          items:",
    "            type: object",
    "            required: [form_type, model]",
    "            properties:",
    "              form_type:",
    "                type: string",
    "                description: The creation-card id.",
    "              model:",
    "                $ref: '#/components/schemas/CreationCardModel'",
    "        song_max_duration_seconds:",
    "          type: object",
    "          description: Longest song in seconds for each song model.",
    "          additionalProperties:",
    "            type: integer",
    "        limits:",
    "          type: array",
    "          description: The required fields and bounds the API enforces per card and model.",
    "          items:",
    "            type: object",
    "            properties:",
  ];
  for (const key of limitKeys) {
    lines.push(...yamlPropertyBlock(key, limits.map((entry) => entry[key]), 14));
  }
  lines.push(
    "        rules:",
    "          type: array",
    "          description: The values the API runs for each option field of a card and model.",
    "          items:",
    "            type: object",
    "            required: [card, model, field, allowed]",
    "            properties:",
    "              card:",
    "                type: string",
    "              model:",
    "                $ref: '#/components/schemas/CreationCardModel'",
    "              field:",
    "                type: string",
    "                enum:",
    ...catalog.ruleFields.map((field) => `                  - ${field}`),
    "              default:",
    "                oneOf:",
    '                  - type: string',
    "                  - type: integer",
    '                  - type: "null"',
    "              allowed:",
    "                type: array",
    "                items:",
    "                  oneOf:",
    "                    - type: string",
    "                    - type: integer",
  );
  return lines;
}

function markdownMatrix(catalog, { heading }) {
  const lines = [];
  if (heading) lines.push(heading, "");
  lines.push(
    "The creation-card capability matrix: the model ids each creation card accepts, and the ratio, duration and outputResolution values the API runs. A generation outside those values is refused.",
    "",
    "| Card | Model | Label | Ratio | Duration (s) | Output resolution |",
    "|---|---|---|---|---|---|",
  );
  for (const item of catalog.models) {
    lines.push(
      `| \`${escapeCell(item.card)}\` | \`${escapeCell(item.model)}\` | ${escapeCell(item.label)} | ` +
        `${item.ratio.map((v) => `\`${escapeCell(v)}\``).join(", ") || "—"} | ` +
        `${formatNumbers(item.duration)} | ` +
        `${item.outputResolution.map((v) => `\`${escapeCell(v)}\``).join(", ") || "—"} |`,
    );
  }
  const songs = Object.entries(catalog.matrix.song_max_duration_seconds ?? {});
  if (songs.length) {
    lines.push(
      "",
      "Song length caps (seconds): " + songs.map(([model, seconds]) => `\`${model}\` ${seconds}`).join("; ") + ".",
    );
  }
  return lines;
}

function markdownModelEnums(userJobs, types) {
  const lines = ["Model ids the API accepts, read from the Rails job enums:", ""];
  for (const type of types) {
    const values = [...new Set((MODEL_TYPES[type] ?? []).flatMap((job) => jobEnum(userJobs, job)))];
    lines.push(`- \`${type}\`: ${values.map((v) => `\`${v}\``).join(", ")}`);
  }
  return lines;
}

function markdownMcpTools(mcpTools) {
  const tools = mcpTools.tools ?? [];
  const lines = [
    `The hosted server serves ${tools.length} tools (\`gen_discover\` plus one \`gen_<noun>_action\` per domain, and the \`gen_ask\`, \`gen_analyze\`, \`gen_avatars\` and \`gen_generate\` tools):`,
    "",
    "| Tool | Purpose |",
    "|---|---|",
  ];
  for (const tool of tools) {
    lines.push(`| \`${escapeCell(tool.name)}\` | ${escapeCell(tool.summary)} |`);
  }
  lines.push(
    "",
    `Retired \`gen_*\` names stay callable as hidden compatibility aliases (for example \`${RETIRED_EXAMPLE.from}\` → \`${RETIRED_EXAMPLE.to}\`); the full map is ${MIGRATION_GUIDE}`,
  );
  return lines;
}

function markdownVidsheetActions(summary, { operations }) {
  const lines = [
    `\`POST ${summary.path}\` takes one envelope: \`actions[]\` of ${summary.min_items}–${summary.max_items ?? "N"} typed actions.`,
    "",
    "| `action` | `target.kind` | Required besides `action` and `target` |",
    "|---|---|---|",
  ];
  for (const row of summary.rows) {
    const extras = row.extras.map((field) => `\`${escapeCell(field)}\``).join(", ") || "—";
    lines.push(`| \`${escapeCell(row.action)}\` | \`${escapeCell(row.kind)}\` | ${extras} |`);
  }
  lines.push(
    "",
    `Read the current envelope with \`GET ${summary.discovery_path}\` (MCP: \`gen_discover\` domain=\`vidsheet\` view=\`actions\`).`,
  );
  if (summary.idempotency_description) lines.push(`\`Idempotency-Key\`: ${scrub(summary.idempotency_description)}`);
  if (summary.generation_lifecycle_path) {
    lines.push(
      `Existing-job lifecycle: \`POST ${summary.generation_lifecycle_path}\` (MCP: \`gen_vidsheet_action\` ops \`stop_generation\` and \`continue_generation\`).`,
    );
  }
  if (operations && summary.operations.length) {
    lines.push("", "Vidsheet operation history (undo and redo):", "", "| Method | Path | `operationId` |", "|---|---|---|");
    for (const row of summary.operations) {
      lines.push(`| ${row.method} | \`${escapeCell(row.route)}\` | \`${escapeCell(row.operationId)}\` |`);
    }
  }
  return lines;
}

// ---- region plumbing ---------------------------------------------------------

// Replaces the lines between a `gen:<tag>:start` / `gen:<tag>:end` marker pair.
// The block is padded with one blank line inside the pair at each end, so the
// rendered text is separated from its neighbours once the invisible markers are
// read; the original blank line (or its absence) stays outside the pair, so
// deleting a whole region — markers included — restores the file byte for byte.
function applyRegion(text, tag, body) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.includes(`gen:${tag}:start`));
  if (start < 0) throw new Error(`marker gen:${tag}:start not found`);
  const end = lines.findIndex((line, index) => index > start && line.includes(`gen:${tag}:end`));
  if (end < 0) throw new Error(`marker gen:${tag}:end not found`);
  return [...lines.slice(0, start + 1), "", ...body, "", ...lines.slice(end)].join("\n");
}

function render(text, regions) {
  return regions.reduce((current, [tag, body]) => applyRegion(current, tag, body), text);
}

// ---- vendoring ---------------------------------------------------------------

// api-docs is mirrored publicly, so only the public projection of the backend
// is committed: the capability catalog, the model enums per job type, the
// Vidsheet action envelope, and the Vidsheet wire parameters and request bodies
// for the routes an MCP tool can call. The dashboard tables, the Rails routes
// and the internal controller annotations stay in the backend; they are read
// only while generating.
const PUBLIC_CONTRACT = path.join(VENDOR_DIR, "public-contract.json");

function actionSummary(actionSchema, operationsSchema) {
  const request = actionSchema.request_schema ?? {};
  const actions = request.properties?.actions ?? {};
  const rows = [];
  for (const arm of actions.items?.oneOf ?? []) {
    const action = arm.properties?.action?.const;
    const kind = arm.properties?.target?.properties?.kind?.const;
    if (!action || !kind) continue;
    rows.push({ action, kind, extras: (arm.required ?? []).filter((f) => f !== "action" && f !== "target") });
  }
  const operations = [];
  for (const [route, methods] of Object.entries(operationsSchema.paths ?? {})) {
    for (const [method, operation] of Object.entries(methods ?? {})) {
      if (!String(operation.operationId ?? "").startsWith("vidsheet_operation.")) continue;
      // The /spreadsheets/ entries are wire aliases of the /vidsheet/ routes;
      // the public docs name one canonical path per operation.
      if (!route.startsWith("/v1/vidsheet/")) continue;
      operations.push({ method: method.toUpperCase(), route, operationId: operation.operationId });
    }
  }
  // The envelope request is served as its top level only: the full `actions`
  // branch is hundreds of kilobytes, so the public spec states the fields a
  // caller must send and the batch bounds, and the per-action shape stays in
  // the MCP tool schema. The response envelope is small enough to publish whole.
  const projection = { type: request.type ?? "object", required: request.required ?? [], properties: {} };
  for (const [name, schema] of Object.entries(request.properties ?? {})) {
    if (name === "actions") {
      projection.properties[name] = {
        type: "array",
        description: schema.description ?? null,
        minItems: schema.minItems ?? 1,
        maxItems: schema.maxItems ?? null,
        items: { type: "object" },
      };
    } else {
      projection.properties[name] = schema;
    }
  }
  return {
    path: actionSchema.path,
    discovery_path: actionSchema.discovery_path,
    generation_lifecycle_path: actionSchema.generation_lifecycle_path ?? null,
    idempotency_description: actionSchema.headers?.["Idempotency-Key"]?.description ?? null,
    min_items: actions.minItems ?? 1,
    max_items: actions.maxItems ?? null,
    request_projection: projection,
    response_schema: actionSchema.response_schema ?? null,
    rows,
    operations,
  };
}

// The public projection of the Vidsheet wire contract: one entry per canonical
// /v1/vidsheet route with its path/query/header parameters and request body.
// The /v1/spreadsheets aliases and the internal `x-controller` annotations are
// dropped; the operations-schema file stays in the backend.
function vidsheetOperations(operationsSchema) {
  const out = {};
  for (const [route, methods] of Object.entries(operationsSchema.paths ?? {})) {
    if (!route.startsWith("/v1/vidsheet/")) continue;
    for (const [method, operation] of Object.entries(methods ?? {})) {
      const entry = {};
      if (operation.operationId) entry.operationId = operation.operationId;
      if (operation.parameters) entry.parameters = operation.parameters;
      if (operation.requestBody) entry.requestBody = operation.requestBody;
      out[`${method.toUpperCase()} ${route}`] = entry;
    }
  }
  return out;
}

function vendor(backendDir) {
  mkdirSync(VENDOR_DIR, { recursive: true });
  // The /avatars response schemas are the newest vendored artifact. Validate it
  // first so a missing or malformed upstream file fails the sync immediately,
  // instead of silently keeping stale hand-written response schemas in the
  // public spec.
  readSourceJson(backendDir, UPSTREAM.avatars);
  const contract = {
    catalog: buildCatalog(backendDir),
    user_jobs: readSourceJson(backendDir, UPSTREAM.userJobs).user_jobs ?? {},
    actions: actionSummary(
      readSourceJson(backendDir, UPSTREAM.actionSchema),
      readSourceJson(backendDir, UPSTREAM.operationsSchema),
    ),
    vidsheet_operations: vidsheetOperations(readSourceJson(backendDir, UPSTREAM.operationsSchema)),
  };
  writeFileSync(PUBLIC_CONTRACT, `${JSON.stringify(contract, null, 2)}\n`);
  // check-enums-freshness.mjs compares this byte copy with the backend.
  copyFileSync(path.join(backendDir, UPSTREAM.userJobs), path.join(VENDOR_DIR, "user-job-enums.json"));
  copyFileSync(path.join(backendDir, UPSTREAM.avatars), path.join(VENDOR_DIR, "avatars-api-schema.json"));
  const sha = path.join(backendDir, "SHA");
  if (existsSync(sha)) {
    copyFileSync(sha, path.join(VENDOR_DIR, "SHA"));
  } else if (existsSync(path.join(backendDir, ".git"))) {
    const head = execFileSync("git", ["-C", backendDir, "rev-parse", "HEAD"], { encoding: "utf8" });
    writeFileSync(path.join(VENDOR_DIR, "SHA"), head);
  }
  process.stdout.write("vendored the public backend contract into scripts/backend/public-contract.json\n");
}

// A lane clone may fetch the repo as `upstream` rather than `origin`; accept
// either name (and a local branch) so the vendored revision still resolves.
function resolveRef(repo, requested) {
  for (const ref of [requested, "upstream/main", "origin/main", "main"]) {
    try {
      execFileSync("git", ["-C", repo, "rev-parse", "--verify", ref], { stdio: ["ignore", "pipe", "ignore"] });
      return ref;
    } catch {
      // try the next ref name
    }
  }
  return requested;
}

function readRevision(repo, ref) {
  try {
    return execFileSync("git", ["-C", repo, "rev-parse", "--short", ref], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

function refreshMcpTools(mcpRepo) {
  const ref = resolveRef(mcpRepo, "origin/main");
  let registry;
  try {
    registry = execFileSync("git", ["-C", mcpRepo, "show", `${ref}:${MCP_REGISTRY}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    if (existsSync(MCP_TOOLS_FILE)) {
      process.stdout.write(
        `warning: cannot read ${MCP_REGISTRY} from ${mcpRepo} (${error.message.split("\n")[0]}); keeping the vendored mcp-tools.json\n`,
      );
      return;
    }
    throw new Error(`cannot read ${MCP_REGISTRY} from ${mcpRepo}: ${error.message}`);
  }
  writeFileSync(MCP_TOOLS_FILE, `${JSON.stringify(buildMcpTools(registry, readRevision(mcpRepo, ref)), null, 2)}\n`);
  process.stdout.write("vendored the served MCP registry into scripts/backend/mcp-tools.json\n");
}

function parseTsv(registry) {
  const lines = registry.split("\n");
  const headerAt = lines.findIndex((line) => line.startsWith("record_kind\t"));
  if (headerAt < 0) throw new Error("mcp registry: no header row");
  const header = lines[headerAt].split("\t");
  const column = (name) => header.indexOf(name);
  const record = column("record");
  const rowType = column("row_type");
  const pointer = column("pointer");
  const description = column("description");
  const title = column("title");
  const rows = [];
  for (const line of lines.slice(headerAt + 1)) {
    if (!line.trim()) continue;
    const cells = line.split("\t");
    rows.push({ cells, record, rowType, pointer, description, title });
  }
  return rows;
}

function unquoteRepr(value) {
  let text = String(value ?? "").trim();
  if (text.startsWith('"""') && text.endsWith('"""')) text = text.slice(3, -3);
  return text
    .replace(/\\(.)/g, (_, ch) => (ch === "n" || ch === "r" || ch === "t" ? " " : ch))
    .replace(/\s+/g, " ")
    .trim();
}

function firstSentence(description, title) {
  const text = unquoteRepr(description);
  if (!text) return scrub(title ?? "");
  const match = text.match(/^(.*?[.!?])(\s|$)/s);
  let sentence = (match ? match[1] : text).trim();
  if (sentence.split(/\s+/).filter(Boolean).length < 4) sentence = unquoteRepr(title) || sentence;
  sentence = scrub(sentence);
  if (sentence.length > 200) {
    const cut = sentence.slice(0, 200);
    sentence = `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:]$/, "")}…`;
  }
  return sentence;
}

function buildMcpTools(registry, revision) {
  const rows = parseTsv(registry);
  const tools = rows
    .filter((row) => row.cells[row.rowType] === "tool_field" && (row.cells[row.pointer] ?? "") === "")
    .map((row) => ({
      name: row.cells[row.record],
      title: unquoteRepr(row.cells[row.title]),
      summary: firstSentence(row.cells[row.description], row.cells[row.title]),
    }))
    .filter((tool) => tool.name.startsWith("gen_"))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (tools.length < 10) throw new Error(`mcp registry: only ${tools.length} served tools`);
  return { source: `gen-mcp-server origin/main ${MCP_REGISTRY}`, revision, tools };
}

function assertMcpAgreement(mcpTools) {
  if (!existsSync(MCP_SNAPSHOT_FILE)) return;
  const snapshot = JSON.parse(readFileSync(MCP_SNAPSHOT_FILE, "utf8"));
  const served = [...(snapshot.served ?? [])].sort();
  const listed = mcpTools.tools.map((tool) => tool.name);
  if (served.join("\n") !== listed.join("\n")) {
    throw new Error(
      `scripts/backend/mcp-tools.json (${listed.length}) and scripts/mcp-tools-snapshot.json (${served.length}) ` +
        "disagree on the served MCP tools; refresh scripts/mcp-tools-snapshot.json and re-vendor before regenerating",
    );
  }
}

// ---- entry point -------------------------------------------------------------

function main() {
  try {
    return run();
  } catch (error) {
    process.stderr.write(`sync-from-backend: ${error.message}\n`);
    return 1;
  }
}

function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(
      "usage: node scripts/sync-from-backend.mjs [--backend DIR] [--check] [--mcp-repo DIR]\n",
    );
    return 0;
  }

  // Without --backend, a regeneration vendors from the sibling gen-backend-v2
  // checkout when one exists, while --check always reads the vendored copy: CI
  // has no such checkout, and the committed output must be reproducible from
  // the committed artifacts.
  // A regeneration reads the backend (--backend, else the sibling checkout) and
  // rewrites the public contract; --check only re-renders from the committed
  // contract, because CI has no backend checkout.
  const fallback = path.resolve(ROOT, "..", "gen-backend-v2");
  const backendDir = options.backend ? path.resolve(options.backend) : fallback;
  if (!options.check) {
    if (!existsSync(backendDir)) throw new Error(`--backend ${backendDir}: no such directory`);
    vendor(backendDir);
    refreshMcpTools(options.mcpRepo);
  }
  if (!existsSync(PUBLIC_CONTRACT)) throw new Error("scripts/backend/public-contract.json is missing; run without --check first");
  if (!existsSync(MCP_TOOLS_FILE)) throw new Error("scripts/backend/mcp-tools.json is missing; run without --check first");

  const contract = JSON.parse(readFileSync(PUBLIC_CONTRACT, "utf8"));
  const catalog = contract.catalog;
  const userJobs = contract.user_jobs;
  const mcpTools = JSON.parse(readFileSync(MCP_TOOLS_FILE, "utf8"));
  assertMcpAgreement(mcpTools);
  if ((mcpTools.tools ?? []).length < 10) throw new Error("scripts/backend/mcp-tools.json lists too few served tools");

  const openapiSchemas = openapiSchemaRegion(catalog);
  const mcpRegion = ["backend-mcp-tools", markdownMcpTools(mcpTools)];
  const actionsRegion = ["backend-vidsheet-actions", markdownVidsheetActions(contract.actions, { operations: false })];
  const openapiRegions = [["backend-creation-card-schemas", openapiSchemas]];

  const targets = [
    { file: "public/openapi.yaml", regions: openapiRegions },
    { file: "public/.well-known/openapi.yaml", regions: openapiRegions },
    {
      file: "public/llms.txt",
      regions: [
        [
          "backend-creation-card-matrix",
          markdownMatrix(catalog, { heading: "**Creation-card capability matrix (generated from the API).**" }),
        ],
        mcpRegion,
        actionsRegion,
      ],
    },
    {
      file: "public/llms-full.txt",
      regions: [
        [
          "backend-creation-card-matrix",
          markdownMatrix(catalog, { heading: "## Creation-card capability matrix (generated from the API)" }),
        ],
        mcpRegion,
        ["backend-vidsheet-actions", markdownVidsheetActions(contract.actions, { operations: true })],
      ],
    },
    {
      file: "src/content/docs/reference/generation-types.mdx",
      regions: [["backend-model-enums", markdownModelEnums(userJobs, Object.keys(MODEL_TYPES))]],
    },
    {
      file: "src/content/docs/reference/cards/video-from-text.mdx",
      regions: [["backend-model-enums", markdownModelEnums(userJobs, ["video_from_text"])]],
    },
    {
      file: "src/content/docs/reference/cards/video-from-image.mdx",
      regions: [["backend-model-enums", markdownModelEnums(userJobs, ["video_from_image"])]],
    },
  ];

  const changed = [];
  for (const target of targets) {
    const file = path.join(ROOT, target.file);
    const current = readFileSync(file, "utf8");
    const next = render(current, target.regions);
    if (next === current) continue;
    changed.push(target.file);
    if (!options.check) writeFileSync(file, next);
  }

  if (options.check) {
    if (changed.length) {
      process.stderr.write(`FAIL: ${changed.length} file(s) would change from scripts/backend/public-contract.json:\n`);
      for (const file of changed) process.stderr.write(`  ${file}\n`);
      process.stderr.write("run: node scripts/sync-from-backend.mjs --backend <gen-backend-v2>  and commit the result\n");
      return 1;
    }
    process.stdout.write(`PASS: generated doc regions match scripts/backend/public-contract.json\n`);
    return 0;
  }
  process.stdout.write(changed.length ? `regenerated ${changed.join(", ")}\n` : "regenerated: no change\n");
  return 0;
}

process.exitCode = main();
