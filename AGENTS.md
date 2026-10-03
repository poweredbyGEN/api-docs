# api-docs — agent notes

Public docs for the GEN API and hosted MCP. Page style lives in `DOCS_STANDARD.md`.

## Generated files: edit the generator, not the output

gen-backend-v2 owns the API contracts. These files are generated from it, never hand-edited:

- `public/openapi.yaml` and `public/.well-known/openapi.yaml`
- the vendored copies in `scripts/backend/*`

Agent discovery is canonical at `https://gen.pro/llms.txt`. api.gen.pro does not publish its own
`llms.txt`; the retired `/llms.txt` and `/llms-full.txt` paths 301 to the canonical file at the
`gen-api-docs-router` Cloudflare Worker, and api.gen.pro keeps `openapi.yaml` for developers.

`scripts/sync-from-backend.mjs` writes them (the OpenAPI `paths:` body comes from
`scripts/sync_mcp_surface.py`). Text outside the `gen:<name>:start` / `gen:<name>:end` markers
is hand-written and survives a regeneration. The contract-sync bot (agent-infra
`ops/contract-sync/`, every 10 minutes) runs `sync-from-backend.mjs` on every backend contract
change and opens an `auto/contract-sync-<sha>` PR that merges itself on green. To change generated
content, change gen-backend-v2 or the generator script. If a bot PR is red, fix the cause there.

## Public docs rules

- No prices or credit amounts. Say "uses credits".
- No internal hosts, ticket numbers or vendor internals.
