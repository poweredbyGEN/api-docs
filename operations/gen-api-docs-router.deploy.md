# gen-api-docs-router — reviewed bytes, compare-before-write, deploy order

`operations/gen-api-docs-router.mjs` is the tracked home of the Cloudflare Worker that fronts
`api.gen.pro/*` (Workers Route `ecb0d1d1ddbd4dd48435f68231063f05`). It routes `/v1*` and the other
API prefixes to Rails, `/v1/schedule*` and `/v1/social*` to gen-backend-python, 301s retired human
doc paths, and proxies everything else to the GitHub Pages docs site. The uploader is
`gen-support/operations/docs-cutover/apply-api-worker.py`; nothing in this repo deploys itself.

## Reviewed bytes

- `operations/gen-api-docs-router.mjs` — the candidate: the live worker plus two 301s
  (`/llms.txt`, `/llms-full.txt` → `https://gen.pro/llms.txt`) and the removal of those two paths
  from `MACHINE_EXACT`, which is the set that skips the human-doc redirect. No other redirect
  changes, no route or DNS change, no settings change.
  sha256 `9af08a79e14f464a52f7fb675a23a06a0dcaa600b3b845b5d3fb97002d094a8e`.
- `operations/gen-api-docs-router.live.mjs` — the live worker source the candidate was diffed
  against, byte-frozen. sha256
  `c2c408c6d27f5fdd4c3dc9df69dbc8301a17973ee19d333365a037fbfecd65a3`.
- `operations/gen-api-docs-router.settings.json` — the worker's settings at that readback, exactly
  the `result` object `apply-api-worker.py` asserts the live settings equal. sha256
  `13769da6f8699e79cec062f642bfbf6740099d5503218c1d405c0f90e99a551f`.

`operations/gen-api-docs-router.test.mjs` (`node --test 'operations/*.test.mjs'`) runs the
candidate and the frozen live copy over the same requests with a mocked global fetch: the two
retired paths answer 301 with no origin call, and every other request — the OpenAPI assets behind
the `/api-docs` proxy path, retired human-doc redirects, Rails and gen-backend-python traffic, the
unknown-path fallthrough — answers what the live worker answers, field for field.

## Compare before writing

1. Read the live script and its settings with the Cloudflare credential
   (`infisical-get /prod/cloudflare PROD__CLOUDFLARE__API_TOKEN` → `email`, `global_api_key`).
2. The live source must equal `operations/gen-api-docs-router.live.mjs` byte for byte. If it does
   not, the worker moved since review: re-diff it, re-review, and refresh the fixture and the
   `LIVE_SHA256` constant in the test in the same change.
3. The live settings must equal `operations/gen-api-docs-router.settings.json`.
4. Upload only the bytes above. `apply-api-worker.py` re-GETs after the PUT and asserts the
   readback is byte-identical, so a partial upload is not a silent one.

## Deploy order

1. **Canonical landing surface first.** `gen.pro/llms.txt` and `gen.pro/skill.md` stop linking
   `api.gen.pro/llms.txt` before or with the redirect. While they point at the retired path, the
   301 hands the agent back the file it came from.
2. **Then the worker.** Upload the reviewed bytes.
3. **Then the api-docs build that removes `public/llms.txt` and `public/llms-full.txt`.** GitHub
   Pages cannot serve an HTTP redirect, so if the files are removed first the old paths 404
   through the worker's docs fallthrough until the redirect exists.

After both, `https://api.gen.pro/llms.txt` and `/llms-full.txt` answer 301 to
`https://gen.pro/llms.txt` with any query string preserved, `/openapi.yaml` and
`/.well-known/openapi.yaml` still answer 200 YAML, and `api.gen.pro/v1/*` still reaches Rails.
