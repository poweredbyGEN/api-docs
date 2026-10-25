# Fix: api.gen.pro docs site 404 (post-AWS-migration routing gap)

## What broke
`api.gen.pro` serves **two** things off one hostname:
- API paths (`/v1`, `/up`, ...) → Rails (`gen-backend-v2`, now on Hetzner `5.161.246.2`)
- Docs (`/`, `/llms.txt`, `/openapi.yaml`, `/guides/*`, `/reference/*`, `/cards/*`) → Astro Starlight on **GitHub Pages** (`poweredbygen.github.io/api-docs/`)

A **CloudFront** distribution used to split these paths and rewrite the Pages origin
path to `/api-docs`. The AWS migration removed CloudFront and pointed `api.gen.pro`
**entirely at Rails**. Rails has no docs routes → every docs URL 404s.

The API itself was never down. Docs content is healthy at `poweredbygen.github.io/api-docs/`.

## The fix (Cloudflare Worker — no AWS, no redeploy)
`api-gen-pro-router.worker.js` restores the split at the CF edge.

### Steps (Cloudflare dashboard, zone `gen.pro`)
1. **Create an unproxied origin record for Rails** so the Worker can reach the
   backend without looping through `api.gen.pro/*`:
   - DNS → add `origin-api` → `5.161.246.2`, **Proxy status: DNS only (grey cloud)**.
   - (The box presents the `api.gen.pro` cert / a CF Origin cert; `fetch()` to
     `https://origin-api.gen.pro` from the Worker resolves to the same box.)
2. **Workers & Pages → Create Worker** → paste `api-gen-pro-router.worker.js` → Deploy.
3. **Workers Routes** → add route `api.gen.pro/*` → select this Worker.
4. Verify (below). Total time: a few minutes.

### If you prefer NOT to add a Worker
Equivalent with **Origin Rules + a Redirect/Transform Rule** is possible but messier
because the `/api-docs` base-path rewrite + asset paths need a URL Rewrite rule.
The Worker is the clean single-artifact fix.

## Verify after deploy
```bash
# Docs must be 200 again:
for p in / /llms.txt /llms-full.txt /openapi.yaml /reference/agents/; do
  curl -s -o /dev/null -w "$p -> %{http_code}\n" "https://api.gen.pro$p"
done
# API must still work:
curl -s -o /dev/null -w "/up -> %{http_code}\n"  https://api.gen.pro/up                 # 200
curl -s -o /dev/null -w "/v1 -> %{http_code}\n"  https://api.gen.pro/v1/templates/projects # 200
curl -s -o /dev/null -w "/v1/agents -> %{http_code}\n" https://api.gen.pro/v1/agents      # 401
```

## Permanent hardening (separate follow-up)
The underlying fragility is `astro.config` has `site: 'https://api.gen.pro'` with **no
`base:`** and **no `CNAME`** — it only ever worked because something rewrote the origin
path. Long-term, either:
- give the docs their **own subdomain** (`docs.gen.pro`) with a Pages custom-domain
  CNAME (cleanest — removes the dual-purpose host entirely), or
- set Astro `base: '/api-docs'` so published asset paths match the Pages path
  (lets you drop the prepend logic).

Both are larger changes; the Worker unblocks production now.
