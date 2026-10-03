const REDIRECTS = [
  {
    "from": "https://api.gen.pro/",
    "to": "https://gen.pro/docs/#mcp-api",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/changelog/2026-09-22-mcp-catalog-collapse/",
    "to": "https://gen.pro/docs/#mcp-api",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/changelog/2026-09-29-mcp-session-refresh-and-verified-writes/",
    "to": "https://gen.pro/docs/#mcp-api",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/guides/authentication/",
    "to": "https://gen.pro/docs/#mcp-api",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/guides/claude-code/",
    "to": "https://gen.pro/docs/#claude-code",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/guides/content-ideas/",
    "to": "https://gen.pro/docs/#research-and-ideas",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/guides/errors/",
    "to": "https://gen.pro/docs/#mcp-api",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/guides/example/",
    "to": "https://gen.pro/docs/#mcp-api",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/guides/mcp/",
    "to": "https://gen.pro/docs/#claude-chatgpt",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/guides/monitoring-quickstart/",
    "to": "https://gen.pro/docs/#research-and-ideas",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/guides/n8n/",
    "to": "https://gen.pro/docs/#mcp-api",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/guides/quickstart/",
    "to": "https://gen.pro/docs/#mcp-api",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/guides/vidsheet-actions/",
    "to": "https://gen.pro/docs/#vidsheet",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/journey/",
    "to": "https://gen.pro/docs/#getting-started",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/agent-chat/",
    "to": "https://gen.pro/docs/#research-and-ideas",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/agent-core/",
    "to": "https://gen.pro/docs/#agent-core",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/agent-voice/",
    "to": "https://gen.pro/docs/#avatars-and-voices",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/agents/",
    "to": "https://gen.pro/docs/#setting-up-your-agent",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/api-keys/",
    "to": "https://gen.pro/docs/#mcp-api",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/automation/",
    "to": "https://gen.pro/docs/#advanced-features",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/cards/captions/",
    "to": "https://gen.pro/docs/#creation-cards",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/cards/image-from-text/",
    "to": "https://gen.pro/docs/#creation-cards",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/cards/lipsync/",
    "to": "https://gen.pro/docs/#creation-cards",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/cards/media/",
    "to": "https://gen.pro/docs/#creation-cards",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/cards/song/",
    "to": "https://gen.pro/docs/#creation-cards",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/cards/speech-from-text/",
    "to": "https://gen.pro/docs/#creation-cards",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/cards/text/",
    "to": "https://gen.pro/docs/#creation-cards",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/cards/transcription/",
    "to": "https://gen.pro/docs/#creation-cards",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/cards/video-from-image/",
    "to": "https://gen.pro/docs/#creation-cards",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/cards/video-from-ingredients/",
    "to": "https://gen.pro/docs/#creation-cards",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/cards/video-from-text/",
    "to": "https://gen.pro/docs/#creation-cards",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/cells/",
    "to": "https://gen.pro/docs/#vidsheet",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/columns/",
    "to": "https://gen.pro/docs/#vidsheet",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/content-monitoring/",
    "to": "https://gen.pro/docs/#research-and-ideas",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/content-resources/",
    "to": "https://gen.pro/docs/#vidsheet",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/creation-cards/",
    "to": "https://gen.pro/docs/#creation-cards",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/discovery/",
    "to": "https://gen.pro/docs/#mcp-api",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/endpoints-index/",
    "to": "https://gen.pro/docs/#mcp-api",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/generation-types/",
    "to": "https://gen.pro/docs/#creation-cards",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/generations/",
    "to": "https://gen.pro/docs/#vidsheet",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/layers/",
    "to": "https://gen.pro/docs/#vidsheet",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/organizations/",
    "to": "https://gen.pro/docs/#inviting-your-team",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/overview/",
    "to": "https://gen.pro/docs/#mcp-api",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/pipelines/",
    "to": "https://gen.pro/docs/#advanced-features",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/proof-of-genesis/",
    "to": "https://gen.pro/docs/#vidsheet",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/publishing/",
    "to": "https://gen.pro/docs/#publishing-and-scheduling",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/recurring-jobs/",
    "to": "https://gen.pro/docs/#advanced-features",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/rendering/",
    "to": "https://gen.pro/docs/#publishing-and-scheduling",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/rows/",
    "to": "https://gen.pro/docs/#vidsheet",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/sheets/",
    "to": "https://gen.pro/docs/#vidsheet",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/song-mixes/",
    "to": "https://gen.pro/docs/#creation-cards",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/templates/",
    "to": "https://gen.pro/docs/#templates",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/variables/",
    "to": "https://gen.pro/docs/#advanced-features",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/watchlists/",
    "to": "https://gen.pro/docs/#research-and-ideas",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/step-1-setup/overview/",
    "to": "https://gen.pro/docs/#setting-up-your-agent",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/step-2-ideas/conversations/",
    "to": "https://gen.pro/docs/#research-and-ideas",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/step-2-ideas/overview/",
    "to": "https://gen.pro/docs/#research-and-ideas",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/step-2-ideas/preferences/",
    "to": "https://gen.pro/docs/#research-and-ideas",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/step-2-ideas/refine/",
    "to": "https://gen.pro/docs/#research-and-ideas",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/step-2-ideas/research/",
    "to": "https://gen.pro/docs/#research-and-ideas",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/step-3-convert/clone-template/",
    "to": "https://gen.pro/docs/#templates",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/step-3-convert/overview/",
    "to": "https://gen.pro/docs/#templates",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/step-3-convert/start-from-template/",
    "to": "https://gen.pro/docs/#templates",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/step-4-edit/anatomy/",
    "to": "https://gen.pro/docs/#vidsheet",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/step-4-edit/overview/",
    "to": "https://gen.pro/docs/#vidsheet",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/step-4-edit/regenerate/",
    "to": "https://gen.pro/docs/#vidsheet",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/step-5-export/credits/",
    "to": "https://gen.pro/docs/#credits-and-billing",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/step-5-export/download/",
    "to": "https://gen.pro/docs/#publishing-and-scheduling",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/step-5-export/overview/",
    "to": "https://gen.pro/docs/#publishing-and-scheduling",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/changelog/2026-09-22-mcp-catalog-collapse",
    "to": "https://gen.pro/docs/#mcp-api",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/changelog/2026-09-29-mcp-session-refresh-and-verified-writes",
    "to": "https://gen.pro/docs/#mcp-api",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/guides/authentication",
    "to": "https://gen.pro/docs/#mcp-api",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/guides/claude-code",
    "to": "https://gen.pro/docs/#claude-code",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/guides/content-ideas",
    "to": "https://gen.pro/docs/#research-and-ideas",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/guides/errors",
    "to": "https://gen.pro/docs/#mcp-api",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/guides/example",
    "to": "https://gen.pro/docs/#mcp-api",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/guides/mcp",
    "to": "https://gen.pro/docs/#claude-chatgpt",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/guides/monitoring-quickstart",
    "to": "https://gen.pro/docs/#research-and-ideas",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/guides/n8n",
    "to": "https://gen.pro/docs/#mcp-api",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/guides/quickstart",
    "to": "https://gen.pro/docs/#mcp-api",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/guides/vidsheet-actions",
    "to": "https://gen.pro/docs/#vidsheet",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/journey",
    "to": "https://gen.pro/docs/#getting-started",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/agent-chat",
    "to": "https://gen.pro/docs/#research-and-ideas",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/agent-core",
    "to": "https://gen.pro/docs/#agent-core",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/agent-voice",
    "to": "https://gen.pro/docs/#avatars-and-voices",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/agents",
    "to": "https://gen.pro/docs/#setting-up-your-agent",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/api-keys",
    "to": "https://gen.pro/docs/#mcp-api",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/automation",
    "to": "https://gen.pro/docs/#advanced-features",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/cards/captions",
    "to": "https://gen.pro/docs/#creation-cards",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/cards/image-from-text",
    "to": "https://gen.pro/docs/#creation-cards",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/cards/lipsync",
    "to": "https://gen.pro/docs/#creation-cards",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/cards/media",
    "to": "https://gen.pro/docs/#creation-cards",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/cards/song",
    "to": "https://gen.pro/docs/#creation-cards",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/cards/speech-from-text",
    "to": "https://gen.pro/docs/#creation-cards",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/cards/text",
    "to": "https://gen.pro/docs/#creation-cards",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/cards/transcription",
    "to": "https://gen.pro/docs/#creation-cards",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/cards/video-from-image",
    "to": "https://gen.pro/docs/#creation-cards",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/cards/video-from-ingredients",
    "to": "https://gen.pro/docs/#creation-cards",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/cards/video-from-text",
    "to": "https://gen.pro/docs/#creation-cards",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/cells",
    "to": "https://gen.pro/docs/#vidsheet",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/columns",
    "to": "https://gen.pro/docs/#vidsheet",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/content-monitoring",
    "to": "https://gen.pro/docs/#research-and-ideas",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/content-resources",
    "to": "https://gen.pro/docs/#vidsheet",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/creation-cards",
    "to": "https://gen.pro/docs/#creation-cards",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/discovery",
    "to": "https://gen.pro/docs/#mcp-api",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/endpoints-index",
    "to": "https://gen.pro/docs/#mcp-api",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/generation-types",
    "to": "https://gen.pro/docs/#creation-cards",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/generations",
    "to": "https://gen.pro/docs/#vidsheet",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/layers",
    "to": "https://gen.pro/docs/#vidsheet",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/organizations",
    "to": "https://gen.pro/docs/#inviting-your-team",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/overview",
    "to": "https://gen.pro/docs/#mcp-api",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/pipelines",
    "to": "https://gen.pro/docs/#advanced-features",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/proof-of-genesis",
    "to": "https://gen.pro/docs/#vidsheet",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/publishing",
    "to": "https://gen.pro/docs/#publishing-and-scheduling",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/recurring-jobs",
    "to": "https://gen.pro/docs/#advanced-features",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/rendering",
    "to": "https://gen.pro/docs/#publishing-and-scheduling",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/rows",
    "to": "https://gen.pro/docs/#vidsheet",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/sheets",
    "to": "https://gen.pro/docs/#vidsheet",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/song-mixes",
    "to": "https://gen.pro/docs/#creation-cards",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/templates",
    "to": "https://gen.pro/docs/#templates",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/variables",
    "to": "https://gen.pro/docs/#advanced-features",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/reference/watchlists",
    "to": "https://gen.pro/docs/#research-and-ideas",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/step-1-setup/overview",
    "to": "https://gen.pro/docs/#setting-up-your-agent",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/step-2-ideas/conversations",
    "to": "https://gen.pro/docs/#research-and-ideas",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/step-2-ideas/overview",
    "to": "https://gen.pro/docs/#research-and-ideas",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/step-2-ideas/preferences",
    "to": "https://gen.pro/docs/#research-and-ideas",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/step-2-ideas/refine",
    "to": "https://gen.pro/docs/#research-and-ideas",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/step-2-ideas/research",
    "to": "https://gen.pro/docs/#research-and-ideas",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/step-3-convert/clone-template",
    "to": "https://gen.pro/docs/#templates",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/step-3-convert/overview",
    "to": "https://gen.pro/docs/#templates",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/step-3-convert/start-from-template",
    "to": "https://gen.pro/docs/#templates",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/step-4-edit/anatomy",
    "to": "https://gen.pro/docs/#vidsheet",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/step-4-edit/overview",
    "to": "https://gen.pro/docs/#vidsheet",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/step-4-edit/regenerate",
    "to": "https://gen.pro/docs/#vidsheet",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/step-5-export/credits",
    "to": "https://gen.pro/docs/#credits-and-billing",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/step-5-export/download",
    "to": "https://gen.pro/docs/#publishing-and-scheduling",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/step-5-export/overview",
    "to": "https://gen.pro/docs/#publishing-and-scheduling",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/llms.txt",
    "to": "https://gen.pro/llms.txt",
    "status": 301
  },
  {
    "from": "https://api.gen.pro/llms-full.txt",
    "to": "https://gen.pro/llms.txt",
    "status": 301
  }
];
const MAP = new Map(REDIRECTS.map(r => [new URL(r.from).pathname, r.to]));

const MACHINE_EXACT = new Set([
  "/openapi.yaml", "/.well-known/openapi.yaml",
  "/robots.txt", "/sitemap-index.xml", "/sitemap-0.xml",
  "/favicon.png", "/favicon.svg", "/logo.svg",
  "/mcp-clients/claude.svg", "/mcp-clients/codex.svg", "/mcp-clients/manus.svg",
  "/guides/claude-code.md",
]);
const MACHINE_REGEX = [/\.md$/, /^\/v1(\/|$)/, /^\/\.well-known(\/|$)/, /^\/_astro\//];

function isMachine(pathname) {
  if (MACHINE_EXACT.has(pathname)) return true;
  return MACHINE_REGEX.some(re => re.test(pathname));
}

// ---- RETURN THE RESPONSE, DO NOT ANSWER IT ---------------------------------
// Returning a fresh Response here would bypass the docs branch's existing
// Location rewrite and its redirect: 'manual' handling. Instead this returns a
// 301 Response only for a human page, and `null` tells the caller to fall
// through to the unchanged GitHub Pages fetch.
function legacyDocsRedirect(url) {
  if (isMachine(url.pathname)) return null;
  const target = MAP.get(url.pathname);
  if (!target) return null;
  const out = new URL(target);
  if (url.search) out.search = url.search;   // query preserved, before the fragment
  return Response.redirect(out.toString(), 301);
}


/**
 * api.gen.pro edge router (Cloudflare Worker)
 *
 * WHY THIS EXISTS
 * ---------------
 * `api.gen.pro` is a dual-purpose hostname:
 *   - API paths (/v1, /up, ...)  -> Rails backend (gen-backend-v2, Phusion Passenger)
 *   - everything else (docs)     -> Astro Starlight docs site on GitHub Pages
 *                                   (poweredbygen.github.io/api-docs/*)
 *
 * Before the AWS migration, a CloudFront distribution split these paths and
 * rewrote the GitHub Pages origin path to `/api-docs`. When CloudFront was torn
 * down, api.gen.pro was pointed entirely at Rails, so every docs URL started
 * 404ing (Rails has no route for /llms.txt, /, /guides/*, etc.).
 *
 * This Worker restores that split at the Cloudflare edge — no AWS, no redeploy
 * of the docs, no change to Rails.
 *
 * BIND THIS WORKER TO:  api.gen.pro/*   (Workers Routes)
 *
 * IMPORTANT NOTES
 * ---------------
 * 1. Rails origin is reached by IP with Host: api.gen.pro because the public
 *    cert is terminated at the CF edge and the origin uses a self-signed/CF
 *    Origin cert. Fetching the proxied hostname directly from the Worker would
 *    loop back through this same route. We therefore target the origin via a
 *    Cloudflare "Origin Rule" / a dedicated unproxied hostname instead. See
 *    RAILS_ORIGIN below.
 * 2. The published docs HTML uses ROOT-RELATIVE asset paths (/_astro/...), but
 *    GitHub Pages only serves them under /api-docs/_astro/... . So we prepend
 *    /api-docs to ALL non-API paths (including /_astro and /assets), which is
 *    exactly what CloudFront used to do.
 */

// API path prefixes that must go to Rails. Everything else -> docs.
const API_PREFIXES = [
  '/v1',
  '/up',
  '/users',
  '/rails',
  '/cable',
  '/admin',
  '/sidekiq',
  '/auth',
];

// Rails origin. Uses the existing UNPROXIED (grey-cloud) backend hostname
// `origin-app1.gen.pro` (-> 5.161.246.2) so the Worker reaches Rails directly
// without re-entering the api.gen.pro/* route. (`api.gen.pro` itself is a proxied
// CNAME to this same host.)
const RAILS_ORIGIN = 'https://origin-app1.gen.pro';

// gen-backend-python origin (app-2). `python.gen.pro` (-> 87.99.137.182) is an
// UNPROXIED (grey-cloud) hostname, so the Worker reaches it directly. These
// paths are exposed publicly under the /v1 convention (api.gen.pro/v1/schedule,
// api.gen.pro/v1/social) but gen-backend-python mounts them WITHOUT the /v1
// prefix, so we strip it before forwarding.
const PYTHON_ORIGIN = 'https://python.gen.pro';
const PYTHON_V1_PREFIXES = ['/v1/schedule', '/v1/social'];

function pythonPathFor(pathname) {
  for (const p of PYTHON_V1_PREFIXES) {
    if (pathname === p || pathname.startsWith(p + '/') || pathname.startsWith(p + '?')) {
      // Strip the leading /v1 so /v1/schedule/... -> /schedule/... on app-2.
      return pathname.slice('/v1'.length);
    }
  }
  return null;
}

// GitHub Pages docs origin + project base path.
const DOCS_ORIGIN = 'https://poweredbygen.github.io';
const DOCS_BASE = '/api-docs';

function isApiPath(pathname) {
  return API_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + '/') || pathname.startsWith(p + '?'),
  );
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // --- gen-backend-python surface (/v1/schedule, /v1/social) -> app-2 ---
    // Checked BEFORE the Rails /v1 rule (these prefixes are a subset of /v1).
    const pythonPath = pythonPathFor(url.pathname);
    if (pythonPath !== null) {
      const originUrl = new URL(PYTHON_ORIGIN);
      originUrl.pathname = pythonPath; // /v1-stripped
      originUrl.search = url.search;

      const pyReq = new Request(originUrl.toString(), request);
      pyReq.headers.set('Host', 'python.gen.pro');
      pyReq.headers.set('X-Forwarded-Host', 'api.gen.pro');
      pyReq.headers.set('X-Forwarded-Proto', 'https');
      return fetch(pyReq);
    }

    // --- API traffic -> Rails (unchanged behavior) ---
    if (isApiPath(url.pathname)) {
      const originUrl = new URL(RAILS_ORIGIN);
      originUrl.pathname = url.pathname;
      originUrl.search = url.search;

      const apiReq = new Request(originUrl.toString(), request);
      // Preserve the public Host so Rails routing/cookies/CORS behave identically.
      apiReq.headers.set('Host', 'api.gen.pro');
      apiReq.headers.set('X-Forwarded-Host', 'api.gen.pro');
      apiReq.headers.set('X-Forwarded-Proto', 'https');
      return fetch(apiReq);
    }

    // GEN-7829: redirect human documentation after API routing; retain machine resources.
    if (request.method === "GET" || request.method === "HEAD") {
      const redirect = legacyDocsRedirect(url);
      if (redirect) return redirect;
    }

    // --- Everything else -> GitHub Pages docs, with /api-docs prepended ---
    const docsUrl = new URL(DOCS_ORIGIN);
    docsUrl.pathname = DOCS_BASE + url.pathname; // /_astro/x -> /api-docs/_astro/x
    docsUrl.search = url.search;

    const docsReq = new Request(docsUrl.toString(), {
      method: request.method,
      headers: request.headers,
      redirect: 'manual',
    });

    const resp = await fetch(docsReq);

    // Rewrite GitHub Pages redirects (e.g. trailing-slash 301s point at
    // poweredbygen.github.io/api-docs/...) back to api.gen.pro/... so the user
    // never sees the Pages hostname or the /api-docs prefix.
    if (resp.status >= 300 && resp.status < 400 && resp.headers.has('location')) {
      const loc = resp.headers.get('location');
      const rewritten = loc
        .replace(DOCS_ORIGIN + DOCS_BASE, 'https://api.gen.pro')
        .replace(DOCS_BASE + '/', '/');
      const headers = new Headers(resp.headers);
      headers.set('location', rewritten);
      return new Response(resp.body, { status: resp.status, headers });
    }

    return resp;
  },
};
