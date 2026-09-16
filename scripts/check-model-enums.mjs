// Every documented generation model must be one Rails accepts, derived from
// scripts/user-job-enums.json (vendored from gen-backend-v2 by
// gen-mcp-server/scripts/vendor_user_job_enums.py). Fails when a surface lists
// a value Rails rejects or omits one it accepts. Run: npm test
import { readFileSync } from "node:fs";

const jobs = JSON.parse(readFileSync(new URL("./user-job-enums.json", import.meta.url))).user_jobs;
if (!jobs || Object.keys(jobs).length === 0) throw new Error("user-job-enums.json carries no user_jobs");

const CANONICAL = {
  text: ["text_generation"],
  image_from_text: ["gemini_image_generation", "seedream_image_generation", "openai_image_generation_2"],
  video_from_text: ["gemini_video_generation", "gemini_omni_video_generation", "kling", "seedance_video_generation", "seedance_2_0_video_generation", "seedance_2_5_video_generation"],
  video_from_image: ["gemini_video_generation", "gemini_omni_video_generation", "kling_img2video", "seedance_video_generation", "seedance_2_0_video_generation", "seedance_2_5_video_generation"],
};
const enumOf = (job) => (jobs[job]?.model?.enum ?? []).filter((v) => typeof v === "string");
const models = Object.fromEntries(Object.entries(CANONICAL).map(([c, js]) => [c, js.flatMap(enumOf)]));
for (const [c, vals] of Object.entries(models)) if (vals.length === 0) throw new Error(`${c}: no model values derived`);

// Names the old surfaces advertised that Rails rejects; none may return.
const REJECTED = ["gemini_image", "gemini_pro_image", "veo_3", "sora_2", "kling_1_6", "kling_2_1", "kling_2_6", "seedance_pro", "seedance_lite", "gemini_2_0_flash", "gemini_2_5_pro", "gpt_4o", "claude_sonnet_4", "o3_mini", "duration: 5 | 10"];

const SURFACES = {
  "public/llms.txt": Object.keys(models),
  "public/llms-full.txt": Object.keys(models),
  "src/content/docs/reference/generation-types.mdx": Object.keys(models),
  "src/content/docs/reference/cards/text.mdx": ["text"],
  "src/content/docs/reference/cards/image-from-text.mdx": ["image_from_text"],
  "src/content/docs/reference/cards/video-from-text.mdx": ["video_from_text"],
  "src/content/docs/reference/cards/video-from-image.mdx": ["video_from_image"],
  "public/openapi.yaml": [],
  "src/content/docs/guides/typescript-sdk.mdx": [],
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
  for (const c of canonicals) for (const v of models[c]) if (!has(v)) errors.push(`${file}: missing ${c} model ${v}`);
  for (const bad of REJECTED) if (has(bad)) errors.push(`${file}: still advertises ${bad}`);
}
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log(`model enums OK across ${Object.keys(SURFACES).length} surfaces`);
