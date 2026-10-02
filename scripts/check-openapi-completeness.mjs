#!/usr/bin/env node
// GEN-8157: completeness gate for public/openapi.yaml.
//
// public/openapi.yaml is the API reference; the docs pages are being retired,
// so the spec must give an integrator everything. This checker scores every
// operation on seven dimensions and fails the build when any count drops below
// scripts/openapi-completeness-baseline.json ({dimension: max_missing_operations}).
// A dimension's allowance can only ever shrink (--update), never grow, so a lane that
// documents an operation without also filling its gaps cannot merge.
//
// The seven dimensions, one boolean per operation:
//   description       the operation has a non-empty `description`
//   request_schema    a requestBody schema (GET and DELETE are bodyless: satisfied)
//   request_example   a requestBody example/examples (GET and DELETE satisfied)
//   response_schema   any 2xx response with a schema or $ref
//   response_example  any 2xx response with example/examples (media type or schema)
//   error_responses   at least one 4xx or 5xx response
//   error_codes       a 4xx response whose schema (after $ref resolution) defines
//                     a `code`/`error_code` property with an enum, or whose inline
//                     example carries a `code`/`error_code`
//
// Stdlib-only Node: public/openapi.yaml is YAML and the Node stdlib ships no
// YAML parser, so this file carries a minimal YAML reader for the subset the
// spec uses (block mappings, block sequences, single-line flow sequences,
// `|`/`>` block scalars, quoted and plain scalars, comments). It throws on any
// construct outside that subset rather than guessing at it.
//
// Usage:
//   node scripts/check-openapi-completeness.mjs            # gate: fail on regression
//   node scripts/check-openapi-completeness.mjs --report   # per-dimension missing operations
//   node scripts/check-openapi-completeness.mjs --update   # shrink the allowance only
//   node scripts/check-openapi-completeness.mjs --file <spec> --baseline <json>

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DEFAULT_SPEC = path.join(ROOT, "public", "openapi.yaml");
const DEFAULT_BASELINE = path.join(ROOT, "scripts", "openapi-completeness-baseline.json");

export const DIMENSIONS = [
  "description",
  "request_schema",
  "request_example",
  "response_schema",
  "response_example",
  "error_responses",
  "error_codes",
];

const METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);
const READ_METHODS = new Set(["get", "delete"]);

// ---- minimal YAML reader ----------------------------------------------------

// Split a line into its leading indentation and the rest, with a trailing
// comment removed (a `#` only starts a comment when it follows whitespace or
// the start of the line; a `#` inside quotes is data, e.g. `$ref: '#/...'`).
function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === quote && line[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === "#" && (i === 0 || line[i - 1] === " " || line[i - 1] === "\t")) {
      return line.slice(0, i);
    }
  }
  return line;
}

function unquoteSingle(s) {
  return s.slice(1, -1).replace(/''/g, "'");
}

function unquoteDouble(s) {
  // The generated spec quotes with JSON escapes (json.dumps); a hand-written
  // double-quoted scalar uses plain YAML escapes. JSON.parse covers both
  // closely enough for the strings in this file.
  try {
    return JSON.parse(s);
  } catch {
    return s.slice(1, -1).replace(/\\(["\\/bfnrt])/g, (_, c) => {
      const table = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
      return table[c] ?? c;
    });
  }
}

function unquote(s) {
  s = s.trim();
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return unquoteSingle(s);
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return unquoteDouble(s);
  return s;
}

// First `:` outside quotes — the key/value separator of a mapping line.
function findColon(s) {
  let quote = null;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quote) {
      if (ch === quote && s[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === ":") return i;
  }
  return -1;
}

// Split a flow expression on a separator at bracket depth 0, outside quotes.
function splitTopLevel(s, sep) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let cur = "";
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quote) {
      cur += ch;
      if (ch === quote && s[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === "[" || ch === "{") depth += 1;
    else if (ch === "]" || ch === "}") depth -= 1;
    if (ch === sep && depth === 0) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur !== "") parts.push(cur);
  return parts;
}

function parseScalar(s) {
  s = s.trim();
  if (s === "" || s === "null" || s === "~") return null;
  if (s === "true" || s === "True" || s === "TRUE") return true;
  if (s === "false" || s === "False" || s === "FALSE") return false;
  if (s.startsWith("'") && s.endsWith("'")) return unquoteSingle(s);
  if (s.startsWith('"') && s.endsWith('"')) return unquoteDouble(s);
  if (s.startsWith("[") && s.endsWith("]")) return parseFlowSeq(s);
  if (s.startsWith("{") && s.endsWith("}")) return parseFlowMap(s);
  if (/^-?\d+$/.test(s)) return Number.parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return Number.parseFloat(s);
  return s;
}

function parseFlowSeq(s) {
  const inner = s.slice(1, -1).trim();
  if (inner === "") return [];
  return splitTopLevel(inner, ",").map((item) => parseScalar(item.trim()));
}

function parseFlowMap(s) {
  const inner = s.slice(1, -1).trim();
  const obj = {};
  if (inner === "") return obj;
  for (const entry of splitTopLevel(inner, ",")) {
    const colon = findColon(entry);
    if (colon < 0) throw new Error(`flow mapping entry without colon: ${entry}`);
    const key = unquote(entry.slice(0, colon).trim());
    obj[key] = parseScalar(entry.slice(colon + 1).trim());
  }
  return obj;
}

export function parseYaml(text) {
  const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));
  let i = 0;

  function nextContent() {
    while (i < lines.length) {
      const t = stripComment(lines[i]).trim();
      if (t !== "" && !t.startsWith("#")) return i;
      i += 1;
    }
    return -1;
  }

  function parseBlockScalar(indicator, keyIndent) {
    const fold = indicator[0] === ">";
    const parts = [];
    let base = null;
    while (i < lines.length) {
      const raw = lines[i];
      if (raw.trim() === "") {
        parts.push("");
        i += 1;
        continue;
      }
      const indent = raw.length - raw.trimStart().length;
      if (indent <= keyIndent) break;
      if (base === null) base = indent;
      const slice = raw.slice(Math.min(indent, base));
      parts.push(slice.trimEnd());
      i += 1;
    }
    const text = fold ? parts.map((p) => p.trim()).join(" ") : parts.join("\n");
    const strip = indicator.includes("-");
    const keep = indicator.includes("+");
    if (fold) return text;
    if (strip) return text.replace(/\n+$/, "");
    if (keep) return text;
    return text.replace(/\n+$/, "") + "\n";
  }

  function parseValue(indent) {
    const idx = nextContent();
    if (idx < 0) return null;
    const raw = lines[idx];
    const cur = raw.length - raw.trimStart().length;
    if (cur !== indent) return null;
    const content = stripComment(raw.slice(cur)).trimEnd();
    if (content === "-" || content.startsWith("- ")) return parseSequence(indent);
    return parseMapping(indent);
  }

  function parseValueAfterKey(rest, keyIndent) {
    rest = stripComment(rest).trim();
    if (rest === "") {
      const idx = nextContent();
      if (idx < 0) return null;
      const cur = lines[idx].length - lines[idx].trimStart().length;
      if (cur < keyIndent) return null;
      if (cur === keyIndent) {
        // A block sequence may sit at the same indent as its key (the
        // generated `parameters:` renders `- name: ...` without indenting).
        const content = stripComment(lines[idx].slice(cur)).trimEnd();
        return content === "-" || content.startsWith("- ") ? parseSequence(cur) : null;
      }
      return parseValue(cur);
    }
    if (/^[|>][+-]?\d*$/.test(rest) || /^[|>]$/.test(rest)) return parseBlockScalar(rest, keyIndent);
    return parseScalar(rest);
  }

  function parseMapping(indent) {
    const obj = {};
    for (;;) {
      const idx = nextContent();
      if (idx < 0) break;
      const raw = lines[idx];
      const cur = raw.length - raw.trimStart().length;
      if (cur !== indent) break;
      const content = stripComment(raw.slice(cur)).trimEnd();
      if (content === "" || content === "-" || content.startsWith("- ")) break;
      const colon = findColon(content);
      if (colon < 0) break;
      const key = unquote(content.slice(0, colon).trim());
      const rest = content.slice(colon + 1);
      i = idx + 1;
      obj[key] = parseValueAfterKey(rest, cur);
    }
    return obj;
  }

  function parseSequence(indent) {
    const arr = [];
    for (;;) {
      const idx = nextContent();
      if (idx < 0) break;
      const raw = lines[idx];
      const cur = raw.length - raw.trimStart().length;
      if (cur !== indent) break;
      const content = stripComment(raw.slice(cur)).trimEnd();
      if (content !== "-" && !content.startsWith("- ")) break;
      const rest = content === "-" ? "" : content.slice(2);
      i = idx + 1;
      if (rest === "") {
        arr.push(parseValue(indent + 2));
      } else if (rest.startsWith("{") || rest.startsWith("[")) {
        // `- { ... }` / `- [ ... ]`: a flow value, not a block mapping item.
        arr.push(parseScalar(rest));
      } else if (findColon(rest) >= 0) {
        // `- key: value` starts a mapping whose continuation keys sit at
        // indent + 2 (the first key rides the dash, so it sits in the same
        // column as the continuations). A first key with no inline value is
        // therefore null; a sibling key deeper in the item does not nest under it.
        const keyIndent = indent + 2;
        const item = {};
        const colon = findColon(rest);
        const key = unquote(rest.slice(0, colon).trim());
        item[key] = parseValueAfterKey(rest.slice(colon + 1), keyIndent);
        Object.assign(item, parseMapping(keyIndent));
        arr.push(item);
      } else {
        arr.push(parseScalar(rest));
      }
    }
    return arr;
  }

  const idx = nextContent();
  if (idx < 0) return {};
  const rootIndent = lines[idx].length - lines[idx].trimStart().length;
  return parseValue(rootIndent) ?? {};
}

// ---- scoring ----------------------------------------------------------------

function isRead(method) {
  return READ_METHODS.has(String(method).toLowerCase());
}

function mediaHasSchema(media) {
  return !!media && typeof media === "object" && "schema" in media;
}

function mediaHasExample(media) {
  if (!media || typeof media !== "object") return false;
  if ("example" in media || "examples" in media) return true;
  const schema = media.schema;
  return !!schema && typeof schema === "object" && ("example" in schema || "examples" in schema);
}

function responseHasSchema(resp) {
  if (!resp || typeof resp !== "object") return false;
  if ("$ref" in resp) return true;
  for (const media of Object.values(resp.content || {})) {
    if (mediaHasSchema(media)) return true;
  }
  return false;
}

function responseHasExample(resp) {
  if (!resp || typeof resp !== "object") return false;
  for (const media of Object.values(resp.content || {})) {
    if (mediaHasExample(media)) return true;
  }
  return false;
}

function resolveRef(spec, ref) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return undefined;
  let node = spec;
  for (const part of ref.slice(2).split("/")) {
    if (node == null || typeof node !== "object") return undefined;
    node = node[part.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  return node;
}

function resolveSchema(spec, schema, seen = new Set()) {
  if (!schema || typeof schema !== "object") return undefined;
  if (typeof schema.$ref === "string") {
    if (seen.has(schema.$ref)) return undefined;
    seen.add(schema.$ref);
    return resolveSchema(spec, resolveRef(spec, schema.$ref), seen);
  }
  return schema;
}

// The schema behind a 4xx/5xx response: inline content schema, or the target of
// a response $ref (which may itself point at a response object or straight at a
// component schema).
function resolveResponseSchema(spec, resp) {
  if (!resp || typeof resp !== "object") return undefined;
  if (typeof resp.$ref === "string") {
    const target = resolveRef(spec, resp.$ref);
    if (target && typeof target === "object") {
      if ("content" in target || "$ref" in target) return resolveResponseSchema(spec, target);
      return resolveSchema(spec, target);
    }
    return undefined;
  }
  for (const media of Object.values(resp.content || {})) {
    if (media && typeof media === "object" && "schema" in media) {
      return resolveSchema(spec, media.schema);
    }
  }
  return undefined;
}

function schemaHasErrorCodeEnum(schema) {
  if (!schema || typeof schema !== "object") return false;
  const props = schema.properties;
  if (!props || typeof props !== "object") return false;
  for (const name of ["code", "error_code"]) {
    const prop = props[name];
    if (prop && typeof prop === "object" && Array.isArray(prop.enum) && prop.enum.length > 0) return true;
  }
  return false;
}

function exampleCarriesCode(example) {
  if (Array.isArray(example)) return example.some(exampleCarriesCode);
  if (example && typeof example === "object") {
    for (const [k, v] of Object.entries(example)) {
      if (k === "code" || k === "error_code") return true;
      if (exampleCarriesCode(v)) return true;
    }
  }
  return false;
}

// Inline example objects only — a response-level $ref is not chased, so the
// generic Unauthorized/NotFound component examples do not count as named codes.
function inlineExamples(resp) {
  const out = [];
  if (!resp || typeof resp !== "object") return out;
  for (const media of Object.values(resp.content || {})) {
    if (!media || typeof media !== "object") continue;
    if ("example" in media) out.push(media.example);
    if ("examples" in media) {
      for (const v of Object.values(media.examples ?? {})) {
        if (v && typeof v === "object" && "value" in v) out.push(v.value);
        else out.push(v);
      }
    }
    const schema = media.schema;
    if (schema && typeof schema === "object") {
      if ("example" in schema) out.push(schema.example);
      if ("examples" in schema) out.push(schema.examples);
    }
  }
  return out;
}

function operationHasErrorCodes(spec, op) {
  for (const [code, resp] of Object.entries(op.responses || {})) {
    if (!/^4/.test(String(code))) continue;
    if (schemaHasErrorCodeEnum(resolveResponseSchema(spec, resp))) return true;
    if (inlineExamples(resp).some(exampleCarriesCode)) return true;
  }
  return false;
}

export function scoreOperation(spec, method, op) {
  const read = isRead(method);
  const score = {
    description: !!op.description && String(op.description).trim().length > 0,
    request_schema: false,
    request_example: false,
    response_schema: false,
    response_example: false,
    error_responses: false,
    error_codes: false,
  };
  const requestBody = op.requestBody;
  if (read) {
    score.request_schema = true;
    score.request_example = true;
  } else if (requestBody && typeof requestBody === "object") {
    if ("$ref" in requestBody) score.request_schema = true;
    for (const media of Object.values(requestBody.content || {})) {
      if (mediaHasSchema(media)) score.request_schema = true;
      if (mediaHasExample(media)) score.request_example = true;
    }
  }
  for (const [code, resp] of Object.entries(op.responses || {})) {
    const c = String(code);
    if (/^2/.test(c)) {
      if (responseHasSchema(resp)) score.response_schema = true;
      if (responseHasExample(resp)) score.response_example = true;
    }
    if (/^[45]/.test(c)) score.error_responses = true;
  }
  score.error_codes = operationHasErrorCodes(spec, op);
  return score;
}

export function scoreSpec(spec) {
  const counts = Object.fromEntries(DIMENSIONS.map((d) => [d, 0]));
  const missing = Object.fromEntries(DIMENSIONS.map((d) => [d, []]));
  for (const [route, methods] of Object.entries(spec.paths || {})) {
    if (!methods || typeof methods !== "object") continue;
    for (const [method, op] of Object.entries(methods)) {
      if (!METHODS.has(String(method).toLowerCase())) continue;
      if (!op || typeof op !== "object") continue;
      const key = `${String(method).toUpperCase()} ${route}`;
      const score = scoreOperation(spec, method, op);
      for (const dim of DIMENSIONS) {
        if (score[dim]) counts[dim] += 1;
        else missing[dim].push(key);
      }
    }
  }
  return { counts, missing };
}

// ---- baseline comparison ----------------------------------------------------

function readBaseline(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// The baseline is the MOST operations allowed to miss each dimension. Counting
// misses rather than hits lets an operation be retired without tripping the
// gate, while any new gap still fails it.
export function compareBaseline(misses, baseline) {
  const failures = [];
  for (const dim of DIMENSIONS) {
    const allowed = Number(baseline?.[dim] ?? 0);
    if (misses[dim] > allowed) {
      failures.push({ dimension: dim, measured: misses[dim], baseline: allowed });
    }
  }
  return failures;
}

export function updateBaseline(misses, baseline) {
  const next = {};
  for (const dim of DIMENSIONS) {
    const measured = Number(misses[dim] ?? 0);
    next[dim] = dim in (baseline || {}) ? Math.min(Number(baseline[dim]), measured) : measured;
  }
  return next;
}

export function missCounts(missing) {
  return Object.fromEntries(DIMENSIONS.map((d) => [d, missing[d].length]));
}

// ---- CLI --------------------------------------------------------------------

function printUsage() {
  console.log(
    [
      "usage: node scripts/check-openapi-completeness.mjs [--report] [--update]",
      "                                   [--file <spec.yaml>] [--baseline <json>]",
      "",
      "  (default)   exit 1 if more operations miss a dimension than allowed",
      "  --report    print, per dimension, the operations that miss it",
      "  --update    rewrite the baseline, shrinking it only (never growing)",
    ].join("\n"),
  );
}

function printReport(counts, missing) {
  for (const dim of DIMENSIONS) {
    const absent = missing[dim];
    console.log(`${dim}: ${counts[dim]}`);
    if (absent.length > 0) {
      console.log(`  missing (${absent.length}):`);
      for (const key of absent) console.log(`    - ${key}`);
    }
  }
}

function main(argv) {
  const options = { report: false, update: false, file: DEFAULT_SPEC, baseline: DEFAULT_BASELINE };
  for (let a = 0; a < argv.length; a += 1) {
    const arg = argv[a];
    if (arg === "--report") options.report = true;
    else if (arg === "--update") options.update = true;
    else if (arg === "--file") options.file = argv[++a];
    else if (arg === "--baseline") options.baseline = argv[++a];
    else if (arg === "-h" || arg === "--help") {
      printUsage();
      return 0;
    } else {
      console.error(`unknown option: ${arg}`);
      return 2;
    }
  }

  const spec = parseYaml(readFileSync(options.file, "utf8"));
  const { counts, missing } = scoreSpec(spec);
  const misses = missCounts(missing);
  const baseline = readBaseline(options.baseline);

  if (options.update) {
    writeFileSync(options.baseline, `${JSON.stringify(updateBaseline(misses, baseline), null, 2)}\n`);
    console.log(`wrote ${options.baseline}`);
    return 0;
  }

  if (options.report) {
    printReport(counts, missing);
    return 0;
  }

  const failures = compareBaseline(misses, baseline);
  for (const dim of DIMENSIONS) {
    console.log(`${dim}: ${counts[dim]} present, ${misses[dim]} missing (allowed ${Number(baseline?.[dim] ?? 0)})`);
  }
  if (failures.length > 0) {
    console.error("FAIL: more operations miss a dimension than the baseline allows:");
    for (const f of failures) {
      console.error(`  ${f.dimension}: ${f.measured} missing > ${f.baseline} allowed`);
    }
    return 1;
  }
  console.log("PASS: openapi completeness within baseline");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
