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

// Rails origin. Use an UNPROXIED DNS record (grey-cloud) for the backend so the
// Worker can reach it without re-entering the api.gen.pro/* route.
//   Recommended: create  origin-api.gen.pro  -> 5.161.246.2  (DNS only, grey cloud)
//   Cloudflare's fetch() will validate its edge cert normally for that hostname.
// If you instead front the box with a CF Origin Certificate on api.gen.pro,
// you can keep RAILS_ORIGIN = 'https://origin-api.gen.pro'.
const RAILS_ORIGIN = 'https://origin-api.gen.pro';

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
