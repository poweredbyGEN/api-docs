# Alternative fix (NO Worker): Cloudflare Origin Rules + URL Rewrite

Use this if you prefer not to run a Worker. It reproduces the CloudFront path-split
with native Cloudflare rules. Slightly more moving parts than the Worker, but no code.

> Goal is identical: `api.gen.pro/v1`,`/up`,… → Rails; everything else → GitHub Pages
> `poweredbygen.github.io/api-docs/*` (with the `/api-docs` base-path prepend).

## Prereq DNS
Add an **unproxied** record so Rails is reachable as a distinct origin:
- `origin-api.gen.pro` → `5.161.246.2`, **DNS only (grey cloud)**.

## Step 1 — Send API paths to the Rails origin (Origin Rule)
Rules → **Origin Rules** → Create rule:
- **When incoming requests match:**
  `(http.host eq "api.gen.pro" and (starts_with(http.request.uri.path, "/v1") or http.request.uri.path eq "/up" or starts_with(http.request.uri.path, "/users") or starts_with(http.request.uri.path, "/rails") or starts_with(http.request.uri.path, "/cable") or starts_with(http.request.uri.path, "/auth")))`
- **Then — Override:** DNS record / Host header → `origin-api.gen.pro`
  (keep the visitor Host `api.gen.pro` so Rails routing/cookies/CORS are unchanged).

## Step 2 — Send everything else to GitHub Pages (Origin Rule)
Origin Rules → Create rule (place AFTER step 1 so API wins):
- **When:** `(http.host eq "api.gen.pro")`  *(catch-all; step 1's rule, ordered first, has already peeled off API paths)*
- **Then — Override:**
  - **Host header** → `poweredbygen.github.io`
  - **(SNI)** → `poweredbygen.github.io`

## Step 3 — Prepend `/api-docs` to the docs path (URL Rewrite / Transform Rule)
Rules → **Transform Rules → Rewrite URL** → Create rule:
- **When:** same catch-all as step 2 (api.gen.pro, non-API). To be safe, exclude API:
  `(http.host eq "api.gen.pro" and not starts_with(http.request.uri.path, "/v1") and http.request.uri.path ne "/up" and not starts_with(http.request.uri.path, "/users") and not starts_with(http.request.uri.path, "/rails") and not starts_with(http.request.uri.path, "/cable") and not starts_with(http.request.uri.path, "/auth"))`
- **Then — Rewrite to… Path → Dynamic:**
  `concat("/api-docs", http.request.uri.path)`
  This turns `/_astro/x.css` → `/api-docs/_astro/x.css` and `/llms.txt` → `/api-docs/llms.txt`, matching how Pages serves the project.

## Step 4 — SSL mode
Ensure the zone (or a Configuration Rule for api.gen.pro) uses **Full** SSL so CF
talks HTTPS to both origins. GitHub Pages presents a valid cert; the Rails origin
presents a self-signed/CF-Origin cert (Full, not Full-Strict, for that origin —
or install a CF Origin Certificate on the box and use Full-Strict).

## Caveat vs the Worker
GitHub Pages issues **trailing-slash 301 redirects** whose `Location` points at
`poweredbygen.github.io/api-docs/...`. The Worker rewrites those back to
`api.gen.pro/...`; native rules do **not**. If you see the Pages hostname leak in a
redirect, add a **Response Header Transform** rewriting `Location`, or just use the
Worker (`api-gen-pro-router.worker.js`) which handles it in one artifact.

## Verify (same as Worker path)
```bash
for p in / /llms.txt /llms-full.txt /openapi.yaml /reference/agents/; do
  curl -s -o /dev/null -w "$p -> %{http_code}\n" "https://api.gen.pro$p"; done   # all 200
curl -s -o /dev/null -w "/up -> %{http_code}\n"  https://api.gen.pro/up                  # 200
curl -s -o /dev/null -w "/v1 -> %{http_code}\n"  https://api.gen.pro/v1/templates/projects # 200
curl -s -o /dev/null -w "/agents -> %{http_code}\n" https://api.gen.pro/v1/agents         # 401
```
