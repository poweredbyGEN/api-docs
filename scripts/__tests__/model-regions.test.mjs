import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REFERENCE = "src/content/docs/reference/";
const CARDS = {
  text: ["text_generation"],
  "image-from-text": ["gemini_image_generation", "seedream_image_generation", "openai_image_generation_2"],
  "video-from-text": ["gemini_video_generation", "gemini_omni_video_generation", "kling", "seedance_video_generation", "seedance_2_0_video_generation", "seedance_2_5_video_generation"],
  "video-from-image": ["gemini_video_generation", "gemini_omni_video_generation", "kling_img2video", "seedance_video_generation", "seedance_2_0_video_generation", "seedance_2_5_video_generation"],
  lipsync: ["infinite_voice_lip_sync"],
};
const PAGES = [`${REFERENCE}generation-types.mdx`, ...Object.keys(CARDS).map((card) => `${REFERENCE}cards/${card}.mdx`)];
const OUTPUTS = [...PAGES, "public/openapi.yaml", "public/.well-known/openapi.yaml"];
const REGION = /^.*gen:backend-model-enums:start.*\n([\s\S]*?)^.*gen:backend-model-enums:end.*$/gm;
const read = (dir, file) => readFileSync(path.join(dir, file), "utf8");
const json = (dir, file) => JSON.parse(read(dir, file));
const writeJson = (dir, file, value) => writeFileSync(path.join(dir, file), `${JSON.stringify(value, null, 2)}\n`);

function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "model-regions-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const file of ["scripts/sync-from-backend.mjs", "scripts/lib", "scripts/backend", "scripts/mcp-tools-snapshot.json", ...OUTPUTS]) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    cpSync(path.join(ROOT, file), path.join(dir, file), { recursive: true });
  }
  return dir;
}

function sync(dir, ...args) {
  const result = spawnSync(process.execPath, ["scripts/sync-from-backend.mjs", ...args], {
    cwd: dir, encoding: "utf8", timeout: 20_000,
  });
  assert.notEqual(result.status, null, result.error?.message);
  return result;
}

function regenerate(dir) {
  const result = sync(dir);
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

function regions(text) {
  const matches = [...text.matchAll(REGION)];
  assert.ok(matches.length, "page lacks a generated backend-model-enums region");
  return matches.map((match) => match[1]).join("\n");
}

const prose = (text) => text.replace(REGION, "<generated model region>");
const hasModel = (text, model) => new RegExp(`(^|[^\\w.-])${model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[^\\w.-]|$)`, "m").test(text);
function models(jobs, card) {
  const field = card === "lipsync" ? "lip_sync_model" : "model";
  // A free-form model string has no finite enum to list in the docs.
  return [...new Set(CARDS[card].flatMap((job) => {
    if (!Object.hasOwn(jobs[job], field)) return [];
    const selector = jobs[job][field];
    return Object.hasOwn(selector, "enum") ? selector.enum.filter((value) => typeof value === "string") : [];
  }))];
}

// intent: every checked card list is regenerated from the vendored job enums;
// labels on model rows come from the FE-visible matrix rather than catalog copies.
test("model regions cover text, image, both video cards and lipsync", (t) => {
  const dir = fixture(t);
  for (const file of PAGES) {
    const current = read(dir, file);
    regions(current);
    writeFileSync(path.join(dir, file), current.replace(REGION, (match, body) => match.replace(body, "\n\n")));
  }
  regenerate(dir);
  const jobs = json(dir, "scripts/backend/user-job-enums.json").user_jobs;
  const matrix = json(dir, "scripts/backend/public-contract.json").catalog.matrix.models;
  for (const [card] of Object.entries(CARDS)) {
    const generated = regions(read(dir, `${REFERENCE}cards/${card}.mdx`));
    const formType = card === "lipsync" ? "lip-sync" : card;
    for (const model of models(jobs, card)) assert.ok(hasModel(generated, model), `${card}: missing ${model}`);
    for (const entry of matrix.filter((entry) => entry.form_type === formType && models(jobs, card).includes(entry.model))) {
      assert.ok(generated.includes(entry.label), `${card}: missing FE label for ${entry.model}`);
    }
  }
  const index = regions(read(dir, `${REFERENCE}generation-types.mdx`));
  for (const card of Object.keys(CARDS)) {
    for (const model of models(jobs, card)) assert.ok(hasModel(index, model), `generation-types: missing ${model}`);
  }
  const result = sync(dir, "--check");
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

// intent: one authoritative enum edit invalidates all affected regions, and
// regeneration preserves every other model and every byte of surrounding prose.
test("removing a shared video model invalidates and updates every generated list", (t) => {
  const dir = fixture(t);
  regenerate(dir);
  const before = Object.fromEntries(OUTPUTS.map((file) => [file, read(dir, file)]));
  const artifact = json(dir, "scripts/backend/user-job-enums.json");
  const removed = "seedance-2.5";
  const original = artifact.user_jobs.seedance_2_5_video_generation.model.enum;
  assert.ok(original.includes(removed));
  artifact.user_jobs.seedance_2_5_video_generation.model.enum = original.filter((model) => model !== removed);
  writeJson(dir, "scripts/backend/user-job-enums.json", artifact);
  const stale = sync(dir, "--check");
  assert.notEqual(stale.status, 0, "--check accepts a stale enum region");
  for (const file of [`${REFERENCE}generation-types.mdx`, `${REFERENCE}cards/video-from-text.mdx`, `${REFERENCE}cards/video-from-image.mdx`]) {
    assert.ok((stale.stdout + stale.stderr).includes(file), `stale check does not name ${file}`);
  }
  for (const file of OUTPUTS) assert.equal(read(dir, file), before[file], `--check writes ${file}`);
  regenerate(dir);
  const allModels = [...new Set(Object.keys(CARDS).flatMap((card) => models(artifact.user_jobs, card)))];
  for (const file of PAGES) {
    const after = read(dir, file);
    assert.equal(prose(after), prose(before[file]), `${file}: prose outside model regions changed`);
    const oldRegion = regions(before[file]);
    const newRegion = regions(after);
    assert.ok(!hasModel(newRegion, removed), `${file}: removed model survives`);
    for (const model of allModels) assert.equal(hasModel(newRegion, model), hasModel(oldRegion, model), `${file}: other model ${model} changed`);
  }
  const fresh = sync(dir, "--check");
  assert.equal(fresh.status, 0, fresh.stdout + fresh.stderr);
});

// intent: a missing FE label is an error even when another catalog copy carries
// that label, so regeneration cannot silently publish an invented model name.
test("missing matrix label fails with its card and model", (t) => {
  const dir = fixture(t);
  const file = "scripts/backend/public-contract.json";
  const contract = json(dir, file);
  const card = "image-from-text";
  const model = "gemini_2";
  const entry = contract.catalog.matrix.models.find((entry) => entry.form_type === card && entry.model === model);
  assert.ok(entry.label);
  assert.ok(contract.catalog.models.find((entry) => entry.card === card && entry.model === model).label);
  delete entry.label;
  writeJson(dir, file, contract);
  const result = sync(dir);
  assert.notEqual(result.status, 0, "generator accepts a missing FE-visible label");
  assert.ok((result.stdout + result.stderr).includes(card), result.stdout + result.stderr);
  assert.ok((result.stdout + result.stderr).includes(model), result.stdout + result.stderr);
});

// intent: an incomplete matrix is a broken input, never permission to silently
// erase every FE model table during an otherwise successful regeneration.
for (const missing of ["matrix", "models", "rules"]) {
  test(`missing catalog.matrix ${missing} fails explicitly`, (t) => {
    const dir = fixture(t);
    const file = "scripts/backend/public-contract.json";
    const contract = json(dir, file);
    if (missing === "matrix") delete contract.catalog.matrix;
    else delete contract.catalog.matrix[missing];
    writeJson(dir, file, contract);
    const result = sync(dir);
    assert.notEqual(result.status, 0, `generator accepts missing catalog.matrix ${missing}`);
    assert.ok((result.stdout + result.stderr).includes("catalog.matrix"), result.stdout + result.stderr);
  });
}

// intent: video durations retain the matrix's exact allowed values, and an
// incomplete duration rule fails with its card/model instead of a blank cell.
test("video duration cell matches matrix values and rejects missing allowed", (t) => {
  const dir = fixture(t);
  regenerate(dir);
  const model = "seedance-2.5";
  const card = "video-from-text";
  const generated = regions(read(dir, `${REFERENCE}cards/${card}.mdx`));
  const row = generated.split("\n").find((line) => line.startsWith("|") && hasModel(line, model));
  assert.ok(row, `${card}: no model row for ${model}`);
  assert.equal(row.split("|").at(-2).trim(), "4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30");
  const file = "scripts/backend/public-contract.json";
  const contract = json(dir, file);
  const rule = contract.catalog.matrix.rules.find((entry) => entry.card === card && entry.model === model && entry.field === "duration");
  assert.ok(Array.isArray(rule.allowed));
  delete rule.allowed;
  writeJson(dir, file, contract);
  const result = sync(dir);
  assert.notEqual(result.status, 0, "generator accepts a duration rule without allowed values");
  assert.ok((result.stdout + result.stderr).includes(card), result.stdout + result.stderr);
  assert.ok((result.stdout + result.stderr).includes(model), result.stdout + result.stderr);
});
