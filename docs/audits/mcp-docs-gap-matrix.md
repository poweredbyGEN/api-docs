# MCP docs gap matrix — GEN-6830 acceptance re-run for GEN-6919

**Audit date:** 2026-09-29 (all URLs accessed 2026-09-29). **Method:** read-only. The
described surface was diffed against `scripts/mcp-tools-snapshot.json`
(16 served tools, 192 retired names, generated 2026-09-29 from gen-mcp-server
`upstream/main@bc99691`; see "Surface provenance" below). Peer behaviour was read
from each vendor's official documentation. No paid or live provider call was made;
where a claim needs a live `tools/list`, it is marked **UNVERIFIED** rather than
asserted.

## Surface provenance (honesty note)

The snapshot was derived **offline** from the gen-mcp-server source of truth
(`@mcp.tool` registry plus `contracts/vidsheet-alias-replacements.json`), because
no GEN MCP credential exists on the audit box. The live `mcp.gen.pro` `tools/list`
count was **not measured**; it is stated nowhere in the docs. CI checks the docs
against the committed snapshot, not the live server. Refreshing it needs a PAT and
is documented in `scripts/update-mcp-tools-snapshot.mjs`.

## Priority matrix

| # | Class | Finding (evidence) | Smallest update | Exact target |
|---|---|---|---|---|
| P0 | Stale fact | `public/llms.txt` named 55 retired `gen_*` tools as if served (e.g. `gen_create_video`, `gen_query_watchlist`) against 16 served; `public/llms-full.txt` named 6; `guides/mcp.mdx` named 12 | Regenerated the tool sections from served family tools and their action branches | `public/llms.txt`, `public/llms-full.txt`, `src/content/docs/guides/mcp.mdx` (done in this lane) |
| P0 | Stale fact | The MCP reference pages still taught retired names: content-ideas table (6), Vidsheet media/lifecycle lines (6), publishing note (2), watchlists note (2) | Rewrote each line to the served dispatcher/op and marked the retired name with its replacement | `src/content/docs/guides/content-ideas.mdx`, `guides/vidsheet-actions.mdx`, `reference/publishing.mdx`, `reference/watchlists.mdx` (done) |
| P0 | Stale fact | The four-host topology and composer boundary were absent from the public docs | One section, linked from the other pages | `src/content/docs/guides/mcp.mdx#hosts-and-the-composer-boundary` (done); links in `llms.txt`, `llms-full.txt`, `guides/vidsheet-actions.mdx` |
| P0 | Regression gate | No build failed when docs drifted from `tools/list` | `scripts/check-mcp-tools.mjs` + a Woodpecker step; the checker fails on an unserved name, a retired name without its replacement on the line, a stale "N tools" count, or a banned Plays claim | `scripts/check-mcp-tools.mjs`, `scripts/__tests__/check-mcp-tools.test.mjs`, `.woodpecker/ci.yml` (done) |
| P1 | UX opportunity | Higgsfield and ElevenLabs both tell the reader how to **verify** the connection before use; GEN's guide had no such step | Added "Verify the connection" (`gen_discover` domain=platform view=me) | `src/content/docs/guides/mcp.mdx` (done) |
| P1 | UX opportunity | Cloudflare documents the token cost of its tool catalog and a code-mode alternative; ElevenLabs documents per-tool approval and admin/user tool controls. GEN documents the composer/catalog collapse but not the client-side tool-approval controls | Add one paragraph on host tool-approval controls and the catalog-size rationale next to the install steps | `src/content/docs/guides/mcp.mdx` (open; needs a product statement on approval policy) |
| P1 | UX opportunity | Higgsfield documents per-client capability differences (a feature table per agent) and where results land | Add a per-client capability row for GEN connectors (for example which hosts support app-only `gen_card_page` cards) | `src/content/docs/guides/mcp.mdx` (open; the app-only surface is real — `gen_card_page` is `ui.visibility: app`) |
| P2 | Documented claim, untested | The docs say retired names are hidden compatibility aliases until 2026-10-22 and answer with a `deprecation` pointer | No doc change; a gen-mcp-server test already pins the alias window and pointer | gen-mcp-server (out of this repo) |
| P2 | Documented claim, untested here | "The live llms.txt lists no retired tool names against the current served surface" | The checker proves it against the snapshot; the live equality stays **UNVERIFIED** until a credentialed run refreshes the snapshot | `scripts/mcp-tools-snapshot.json` refresh |

## Peer comparison (official docs)

| Dimension | GEN (this repo) | [Higgsfield](https://higgsfield.ai/creator-hub/help-center/integrations/how-do-i-connect-higgsfield-to-ai-agent) | [ElevenLabs](https://elevenlabs.io/docs/eleven-agents/operate/hosted-mcp) | [Cloudflare](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/) |
|---|---|---|---|---|
| Onboarding | Hosted URL `https://mcp.gen.pro`, OAuth first, PAT fallback | Hosted URL, no API key; per-client instructions | Hosted URL, OAuth with scoped consent; no API key copied into the client | Hosted URL per server, OAuth with scope selection |
| Client-specific steps | Claude, ChatGPT, Claude Code, other OAuth clients | Claude, ChatGPT, Cursor, CLI agents | Claude Desktop directory plus custom connector | Claude, Windsurf, playground, SDKs |
| Token/CI fallback | PAT header documented | Not documented | Not documented on this page | Bearer API token documented for CI/CD |
| Verify the connection | `gen_discover` platform.me | "ask for your credit balance" | Sign-in plus permission review | OAuth redirect plus permission selection |
| Tool reference / freshness | Snapshot-gated: the build fails on drift | Skill/capability tables per agent | Capability list plus client tool controls | Catalog table per server; code-mode token table |
| Errors / retries / confirmation | `payment_required`, `CONFIRMATION_REQUIRED`, typed errors | Reconnect steps for auth/transient errors | Destructive-action warning and per-tool approval | Stateless retry, transport migration note |
| Docs for agents | `llms.txt`, `llms-full.txt`, OpenAPI | Skills catalogue | `llms.txt`, `llms-full.txt` | Markdown twins and `llms.txt` index |

## Boundaries honoured

This matrix names no private infrastructure, pricing, credentials or vendor
mappings, and it does not propose restoring the retired downloadable SDK: the
hosted remote server stays the only supported install path.

## Residuals

- Live `tools/list` equality is unproven on this box (no credential). Refresh with
  `GEN_MCP_PAT=... node scripts/update-mcp-tools-snapshot.mjs` before release.
- `src/content/docs/changelog/2026-09-22-mcp-catalog-collapse.mdx` deliberately
  keeps the full retired-name migration table; it is excluded from the checker's
  default paths because its subject *is* the retired names.
- The two P1 UX items above need a product statement before they can be written.
