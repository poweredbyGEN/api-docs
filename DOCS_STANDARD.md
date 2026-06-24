# GEN API Docs & Dev-Page Standard

**One rule above all: minimal prose, code-first.** Every dev-facing page (api.gen.pro,
gen.pro/mcpapi, quickstarts, the MCP setup page) follows this. Modeled on Sakana
(console.sakana.ai/get-started) and z.ai (docs.z.ai) — the cleanest dev docs we found.

## The 10 rules

1. **Code is the content.** ~60% of vertical space is code blocks. Prose exists only to say *what the next code block does*.
2. **1–2 sentences per concept, max.** 5–15 words each. Imperative voice: "Create an API key." "Copy the key." Never a paragraph where a sentence works.
3. **No marketing prose on docs pages.** No "powerful", "seamless", "the whole loop". State the thing; show the code.
4. **Lead with working code, explain after (if at all).** The first thing under a heading should be runnable, not a description.
5. **Every code block is copy-paste runnable** and has a **Copy button**. Use a real placeholder token (`gen_pat_…` / `YOUR_API_KEY`), never a live key.
6. **Numbered steps** as `### 1. …`, `### 2. …` for any setup flow. Anchor every heading for deep links (`#create-an-api-key`).
7. **Single column**, ~700–800px max width. No sidebar clutter on a quickstart; left-nav only on the full reference.
8. **One language per block, sequential** (curl → Python → TS) rather than tab-overload. Inline-code (`backticks`) for names: `fugu`, `gen_create_image`.
9. **Prerequisites first, edge cases last.** Warnings as a short `Note:` / callout, not a paragraph.
10. **Show, don't tell, the choice.** Hosted vs download = two labeled code blocks side by side, not a prose explanation of the difference.

## Page skeleton (quickstart / get-started)

```
# <Page title — plain, e.g. "Get started">
<one-line intro, ≤15 words>

## Create an API key
<one line>  →  [Create key] button / link
<code: example request using the key>

## <Step 2 …>
<one line>
<code block + Copy>
```

## What "good" looks like (verbatim-feel examples)

- Heading: `### 1. Install` → then the install code. No "In this step you will…".
- Intro: "Connect GEN to your agent over MCP." (6 words) → code block.
- Choice: a **Hosted** code block and a **Download (local)** code block, each labeled, no comparison paragraph.

## Anti-patterns (do NOT do)

- Multi-sentence descriptions before code.
- Adjective-heavy marketing copy on a docs/setup surface.
- Explaining what an API/MCP *is* (assume familiarity; link out once if needed).
- Code without a copy affordance or with a real key.
- Walls of bullet points where two code blocks would be clearer.

## Where this applies

- **api.gen.pro** (the docs site + every guide/reference page) — the daily `gen-api-sync`
  agent must author/maintain pages to this standard.
- **gen.pro/mcpapi** and any dev landing page — hero may keep one marketing line, but
  the body is code-first per the rules above.
- The forthcoming **MCP setup page** (hosted vs download) — two labeled code blocks.

## api.gen.pro layout removals (2026-06-24 — mav)

- **Remove the right-hand "On this page" / table-of-contents column** on all api.gen.pro docs pages. Reclaim the width for content.
- **Remove the vertical line/rail on the left edge of each section** (the left border/guide line down the section list). Keep nav items, drop the decorative left line.
