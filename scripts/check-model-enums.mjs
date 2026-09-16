// Every documented generation type and model must be one Rails accepts, derived
// from scripts/user-job-enums.json (vendored from gen-backend-v2 by
// gen-mcp-server/scripts/vendor_user_job_enums.py; its keys are the job types the
// Rails validator accepts). Fails when a surface documents a generation_type
// Rails rejects, lists a model value Rails rejects, omits one it accepts, or
// omits a field Rails requires for a routed type. Run: npm test
import { readFileSync } from "node:fs";

const jobs = JSON.parse(readFileSync(new URL("./user-job-enums.json", import.meta.url))).user_jobs;
if (!jobs || Object.keys(jobs).length === 0) throw new Error("user-job-enums.json carries no user_jobs");

const CANONICAL = {
  text: ["text_generation"],
  image_from_text: ["gemini_image_generation", "seedream_image_generation", "openai_image_generation_2"],
  video_from_text: ["gemini_video_generation", "gemini_omni_video_generation", "kling", "seedance_video_generation", "seedance_2_0_video_generation", "seedance_2_5_video_generation"],
  video_from_image: ["gemini_video_generation", "gemini_omni_video_generation", "kling_img2video", "seedance_video_generation", "seedance_2_0_video_generation", "seedance_2_5_video_generation"],
};
const enumOf = (job, field = "model") => (jobs[job]?.[field]?.enum ?? []).filter((v) => typeof v === "string");
const models = Object.fromEntries(Object.entries(CANONICAL).map(([c, js]) => [c, js.flatMap((j) => enumOf(j))]));
for (const [c, vals] of Object.entries(models)) if (vals.length === 0) throw new Error(`${c}: no model values derived`);

// Canonical types that route to a single Rails job. `data` is forwarded verbatim,
// so a surface must document every field that job requires (one of each
// alternative group) and the vendored enum of its selector field, if any.
const ROUTES = {
  speech_from_text: "voice_generation",
  lipsync: "infinite_voice_lip_sync",
  captions: "assemblyai_audio_caption_generation",
  video_from_ingredients: "generate_pika_video",
};
for (const [c, job] of Object.entries(ROUTES)) if (!jobs[job]) throw new Error(`${c}: Rails does not accept job type ${job}`);
const requiredGroups = (job) => [
  ...(jobs[job].required ?? []).map((f) => [f]),
  ...(jobs[job].one_of_required?.length ? [[...new Set(jobs[job].one_of_required.flat())]] : []),
];
// generation_type values a surface may document: canonical names or raw Rails job types.
const ACCEPTED = new Set([...Object.keys(CANONICAL), ...Object.keys(ROUTES), ...Object.keys(jobs)]);

// Names the old surfaces advertised that Rails rejects; none may return.
const REJECTED = ["gemini_image", "gemini_pro_image", "veo_3", "sora_2", "kling_1_6", "kling_2_1", "kling_2_6", "seedance_pro", "seedance_lite", "gemini_2_0_flash", "gemini_2_5_pro", "gpt_4o", "claude_sonnet_4", "o3_mini", "duration: 5 | 10",
  // data fields the phantom routes documented; Rails has no such fields.
  "voice_method", "source_resource_id", "asset_resource_ids", "video_resource_id", "audio_resource_id", "sync_so", '"script"'];

const ALL = [...Object.keys(models), ...Object.keys(ROUTES)];
const SURFACES = {
  "public/llms.txt": ALL,
  "public/llms-full.txt": ALL,
  "src/content/docs/reference/generation-types.mdx": ALL,
  "src/content/docs/reference/cards/speech-from-text.mdx": ["speech_from_text"],
  "src/content/docs/reference/cards/lipsync.mdx": ["lipsync"],
  "src/content/docs/reference/cards/captions.mdx": ["captions"],
  "src/content/docs/reference/cards/video-from-ingredients.mdx": ["video_from_ingredients"],
  "src/content/docs/reference/cards/text.mdx": ["text"],
  "src/content/docs/reference/cards/image-from-text.mdx": ["image_from_text"],
  "src/content/docs/reference/cards/video-from-text.mdx": ["video_from_text"],
  "src/content/docs/reference/cards/video-from-image.mdx": ["video_from_image"],
  "public/openapi.yaml": [],
  "public/.well-known/openapi.yaml": [],
  "src/content/docs/step-4-edit/overview.mdx": [],
  "src/content/docs/step-4-edit/anatomy.mdx": [],
  "src/content/docs/step-4-edit/regenerate.mdx": [],
  "src/content/docs/step-5-export/credits.mdx": [],
};
const errors = [];
for (const [file, canonicals] of Object.entries(SURFACES)) {
  const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  // Whole-token match: `gemini_2` must not be satisfied by `gemini_2_lite`, nor `veo-3` by `veo-3.1`.
  const has = (v) => new RegExp(`(^|[^\\w.-])${v.replace(/[.|]/g, "\\$&")}(?=[^\\w.-]|$)`, "m").test(text);
  for (const c of canonicals) {
    if (models[c]) for (const v of models[c]) if (!has(v)) errors.push(`${file}: missing ${c} model ${v}`);
    if (ROUTES[c]) {
      // A required field counts only as a data key ("text", `data.text`, `text:`, `text,`), never as prose.
      const hasKey = (f) => new RegExp(`"${f}"|data\\.${f}\\b|\\b${f}\\??\\s*[:,]`).test(text);
      for (const group of requiredGroups(ROUTES[c])) if (!group.some(hasKey)) errors.push(`${file}: ${c} does not document required field ${group.join("|")}`);
      for (const v of enumOf(ROUTES[c], "lip_sync_model")) if (!has(v)) errors.push(`${file}: missing ${c} lip_sync_model ${v}`);
    }
  }
  for (const bad of REJECTED) if (has(bad)) errors.push(`${file}: still advertises ${bad}`);
  // Every generation_type a surface names (JSON, curl, YAML example/enum, table row) must be one Rails accepts.
  const named = [
    ...text.matchAll(/generation_type["']?\s*[:=]\s*["'](\w+)["']/g),
    ...(text.match(/generation_type:\n(?:.*\n)*?\s+enum:\n((?:\s+- \w+\n)+)/)?.[1].matchAll(/- (\w+)/g) ?? []),
    ...(file.endsWith("generation-types.mdx") ? text.matchAll(/^\|[^|]*\| `(\w+)` \|/gm) : []),
  ];
  for (const [, t] of named) if (!ACCEPTED.has(t)) errors.push(`${file}: documents generation_type ${t}, which Rails rejects`);
}
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log(`generation types and model enums OK across ${Object.keys(SURFACES).length} surfaces`);
