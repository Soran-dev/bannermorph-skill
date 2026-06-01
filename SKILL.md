---
name: bannermorph
description: This skill should be used when the user wants to batch-generate e-commerce banners by replacing the product image in a template. Trigger phrases include "做一批 banner", "批量生成 banner", "把这些商品图放进 banner 模板", "用这个模板生成多张商品图", "banner 批量替换商品图", "make a batch of banners with this template", or whenever the user uploads a banner template plus product images and asks to automate generation. The skill accepts 4 product sources (single image / folder / Excel URL column / single URL), calls a configurable OpenAI-compatible image-generation API (defaults to ideaLAB + gemini-3.1-flash-image-preview), and outputs banner files plus a markdown quality report. It does not replace text on the banner; templates' text remains fixed.
version: 0.1.0
---

# BannerMorph

## Purpose

Replace the product image inside an existing banner template across many products in one shot. The template's text, layout, decorations stay untouched (no text replacement). Output is one banner file per product plus a markdown report scoring each result.

## When to use

- User uploads a banner template + N product images and wants batch output.
- User has an Excel sheet with product image URLs and a banner template.
- User asks to "do a batch", "do a promo banner for these products", or similar.
- User wants to retry a few unsatisfying results from a previous run.

Do **not** use when:
- User wants the banner text replaced per product (this skill does not do text replacement).
- User wants a single one-off banner (skill works but is overkill; suggest direct prompt instead).

## Required first-time setup

When the user invokes this skill for the first time, check if `IDEALAB_API_KEY` is configured:

```bash
node ~/.claude/skills/bannermorph/scripts/parse_products.js '{"source":{"folder":"/tmp/__check__"}}'
```

If the user has not configured an API key, the `generate_batch` script returns `AK_NOT_CONFIGURED`. Prompt the user:

> 第一次用先告诉我你的 ideaLAB API key (格式 sk-xxxxx),我帮你保存

Then save it:

```bash
node ~/.claude/skills/bannermorph/scripts/config.js '{"api_key":"sk-xxxxx"}'
```

## Quota rules (always inform the user)

The default API target is **ideaLAB**, which limits a single key to **10 calls per hour**. The skill caps a single batch at **10 products** when using the default key. If the user requests more than 10 products with the default key, the script rejects with `QUOTA_EXCEEDED`. When this happens, present the three options exactly:

1. Process the first 10 products now.
2. Ask for the user's own paid image-generation API key (e.g., OpenAI or Gemini) to bypass the limit.
3. Reduce the request to 10 products or fewer.

If the user has been using the default key heavily within the hour, mention proactively that the next batch may hit the quota and suggest switching keys.

## Core workflow (4 steps)

### Step 1 — Analyze template (vision in chat, no script call)

**If the user dragged the template into chat**, the path is usually under `~/.claude/image-cache/<session-uuid>/<n>.png` (or another temp location). These paths can be cleaned up later. **Run `import_template.js` first** to copy the image to a stable location inside the skill, then use the returned `stable_path` for all later steps:

```bash
node ~/.claude/skills/bannermorph/scripts/import_template.js \
  '{"source":"/Users/you/.claude/image-cache/<session>/<n>.png"}'
```

Returns `{ stable_path, original_path, size_bytes, ext }`. Use `stable_path` from this point on.

If the user passed a stable path themselves (e.g., `~/Documents/templates/foo.png`), you can skip the import and use that path directly.

Then use the chat model's vision capability to read the template image and **output a JSON object conforming to `references/template-analysis-schema.md`**. The schema captures: template_type / headline_zones / decoration_zones / safe_zones / product_bbox_hint / color_palette / style / extras_to_drop / original_product_kind.

**🔴 Vision double-check (mandatory)**

After drafting the JSON, look at the template image **again** and verify every declared element is actually present:

```
checklist:
□ Each headline_zones[].text — can you actually read it in the template?
□ Each decoration_zones entry — does it exist in the template? Match against actual pixels, not assumptions / not examples copied from this doc.
□ original_product_kind — what's literally pictured in the template?
□ product_bbox_hint.approx_pct — eyeball the actual area, ±10% tolerance
□ Any claim that contains a count ("3 logos", "5 motifs", ...) — count each one in the actual image before writing the number
```

If anything in the draft cannot be confirmed by looking at the template, **delete it** rather than estimate. A hallucinated element in the schema poisons both the generate-prompt and the score-agent (real incident: a hallucinated count of small motifs was echoed into the prompt, causing Gemini to emit ~25 motifs across 5 outputs, and simultaneously caused score-agents to penalize a later clean batch for "missing" the hallucinated motifs).

**Keep `safe_zones` short and positive** — describe via pixel identity ("everything outside the product bbox must be pixel-identical to template"), never by listing what should not appear. See `references/template-analysis-schema.md` postmortem for the empirical evidence chain.

Keep the JSON in working memory. It is used **only** for rendering the generate-prompt block (see template-analysis-schema.md → "Render → generate-prompt block"). The Step 4 score-agent does **not** receive any pre-declared inventory — it grounds its judgment in direct image comparison.

Do not show the JSON or the rendered block to the user (technical detail). The user only needs to see the high-level summary at the end.

### Step 2 — Parse products

Call the parse script with one of the four source types:

```bash
node ~/.claude/skills/bannermorph/scripts/parse_products.js '{"source":{"folder":"./products/"}}'
node ~/.claude/skills/bannermorph/scripts/parse_products.js '{"source":{"image":"./single.png"}}'
node ~/.claude/skills/bannermorph/scripts/parse_products.js '{"source":{"excel":"./list.xlsx"}}'
node ~/.claude/skills/bannermorph/scripts/parse_products.js '{"source":{"url":"https://..."}}'
node ~/.claude/skills/bannermorph/scripts/parse_products.js '{"source":{"urls":["https://a.jpg","https://b.jpg"]}}'
```

The script returns `{ product_paths: string[], count: number }` or a friendly error with `next_steps`.

### Step 3 — Generate batch

**Compose the `prompt`** using the canonical skeleton in `references/template-analysis-schema.md` → "Recommended generate-prompt skeleton". It includes **4 iron rules**:
1. All template text 100% intact
2. New product matches original bbox
3. Strip all extras from source product image
4. **Pixel-identical outside the product bbox** — model is a pixel-copier, not a designer

Rule 4 went through several wrong versions before landing on "pixel-identical." Earlier versions enumerated specific motifs to avoid — that pattern reliably **caused** the named motifs to appear in outputs (image-edit models cannot process negation; every named visual concept gets activated). The current version names only what to preserve (template pixels), never what to forbid. See `template-analysis-schema.md` postmortem for the full evidence chain.

**Never add prohibitive language with visual-element nouns to the prompt** — not even "don't add X" — it backfires.

Then call generate_batch:

```bash
node ~/.claude/skills/bannermorph/scripts/generate_batch.js '{
  "template_image": "/abs/path/template.png",
  "product_paths": ["/abs/path/a.png", "/abs/path/b.png"],
  "prompt": "<the composed prompt>",
  "output_dir": "/abs/path/output/",
  "auto_subdir": true
}'
```

**`auto_subdir: true` is recommended for operational use** — it creates a `batch-{YYYYMMDD-HHmmss}/` subdirectory inside `output_dir`, so each batch's images + report live in their own folder and never overwrite history. The script returns `effective_output_dir` in the result — pass that to `write_report.js` in Step 4 (not the original `output_dir`).

The script enforces the quota rule, runs concurrently (default 5), and returns:

```json
{
  "results": [{"product_id": "...", "output_image": "...", "success": true, "duration_ms": 21000}],
  "success_count": 8,
  "failed_count": 2,
  "using_default_ak": true
}
```

If `failed_count > 0` and errors are quota-related, present the user with options. See `references/error-codes.md`.

For batches **> 3 images**, the script writes a one-line stderr progress marker per image (`[generate_batch] N/total ✓/✗ <product_id> (Xs)`). If you want to surface progress to the user during the run, invoke `Bash` with `run_in_background: true` and poll the task output with `TaskOutput` — the live stderr lines show which image is currently finishing.

### Step 4 — Score (parallel subagents) + write report

For each successful output, spawn one `general-purpose` subagent via the `Agent` tool.

**🔴 BLOCKING RULE — single message, multiple tool_use blocks**

The N subagent calls MUST appear together in **one** assistant message as N parallel `Agent` tool_use blocks. The Anthropic Agent harness only parallelizes tool_uses **inside the same message**. Splitting them across messages serializes them and defeats the entire purpose of this step.

```
❌ WRONG (serialized — 5 images takes 1+ minute):
  msg 1: <Agent>score #1</Agent>
  (wait for return)
  msg 2: <Agent>score #2</Agent>
  ...

✅ CORRECT (parallel — finishes in time of slowest):
  msg 1: <Agent>score #1</Agent><Agent>score #2</Agent>...<Agent>score #N</Agent>
```

If you have already started scoring serially in this session, do not "fix" it by re-issuing the rest in parallel — finish what you started, then internalize the rule for next time. Better one slow round than half-broken state.

Serial scoring of N images in the main session is slow (3–5 minutes for 5 images); parallel subagents bring it to ~15-30s.

Each subagent receives:
- The template path (absolute)
- Its own output image path (absolute)
- A strict instruction to return JSON only and to ground judgment in direct image comparison

Subagents **do not** see the source product image. They also **do not receive the Step 1 template_analysis JSON** — passing a pre-declared "template should contain X" inventory caused real bugs (a Step 1 hallucination led 4 subagents to deduct points for "missing 5 motifs" against a clean output, because the template never had those motifs). The score-agent reads the template and the output directly and reports what it actually sees.

The full prompt template (with placeholders `{template_path}` / `{output_path}` and the JSON output schema) lives in `references/score-agent-prompt.md`. Use it verbatim, substitute the placeholders, and send.

**🔴 Scoring-output reflux red lines (do not violate)**

The score-agent output is meant for the user (as a report), not as automatic input back into the next generate-prompt. If you propose to "fix" generate-prompt based on score issues, follow these red lines:

1. **Do not echo any specific visual-element noun from `issues` back into the next round's generate-prompt.** Score issues might say "extra small motif appeared in top-right" — you must NOT respond by adding "don't add motifs in top-right" to generate-prompt. Naming it makes it appear (see template-analysis-schema.md postmortem).
2. **Do not echo `issues` into the next round's score-agent prompt either.** The score-agent must restart from direct image comparison every round, no inherited context.
3. **For retry rounds, use abstract addons only.** See `references/retry-prompts.md` for the mapping table — every addon there is intentionally abstract ("提高对模板像素的忠实度", "缩小商品", etc.), never naming specific motifs.
4. **If score keeps flagging the same issue across rounds**, suggest the user try a different source product image or accept the result — do not escalate generate-prompt prohibitions, that path always backfires.

Each subagent returns one JSON object:

```json
{
  "score": 7,
  "verdict": "ok",
  "issues": ["short string", "..."],
  "retry_suggestion": null
}
```

Parse each subagent response, merge the score fields into the corresponding `results` entry (already populated from `generate_batch` with `product_id`, `output_image`, `success`, `duration_ms`), then call:

```bash
node ~/.claude/skills/bannermorph/scripts/write_report.js '{
  "template_image": "...",
  "prompt": "...",
  "output_dir": "<effective_output_dir from Step 3>",
  "format": "both-light",
  "results": [{
    "product_id": "...",
    "output_image": "...",
    "score": 7,
    "verdict": "ok",
    "issues": ["slight color shift"],
    "retry_suggestion": null
  }]
}'
```

The script writes `report.md` and/or `report.html` in `output_dir`.

**`format` options**:
- `md` (default) — markdown only
- `both` — md + html with base64-inline images (self-contained, emailable, ~10MB per 5 images)
- `both-light` — **recommended for >10 images** — md + html with relative image paths (~30KB, but sharing requires zip-ing the whole output_dir)
- `html` / `html-light` — html only, base64 or relative-path variant

Finally, summarize to the user in 3-5 lines:

```
✅ 已完成 N 张  (默认 ideaLAB key)
   📁 图片: <output_dir>
   📄 报告: <output_dir>/report.md
   通过 X / 建议 retry Y / 失败 Z
   要 retry 那些不达标的吗?
```

## Retry workflow

When the user asks to "retry the bad ones" or "retry #3 and #7":

1. Extract the product IDs to retry.
2. Summarize the failure patterns from the previous report into a short **prompt_addons** string. Common patterns and suggested addons live in `references/retry-prompts.md`.
3. Call retry_batch (overwrites original output files):

```bash
node ~/.claude/skills/bannermorph/scripts/retry_batch.js '{
  "template_image": "...",
  "products_to_retry": [{"product_id": "...", "product_image_path": "..."}],
  "base_prompt": "<original prompt>",
  "prompt_addons": "<summarized fix>",
  "output_dir": "<same as before>"
}'
```

4. Score the new results with vision, compare to previous scores, and report the deltas:

```
#03: 4 → 9 ✅
#07: 5 → 8 ✅
#31: 3 → 6 ⚠️ still low
```

5. Cap retry rounds at **2**. After 2 failed rounds on the same image, suggest swapping the source product image or accepting the result.

## Customer-facing language rules

Translate technical terms to plain language for the user:

- "OpenRouter / DashScope / base_url" → "你自己的付费生图 API key (例如 OpenAI / Gemini 的)"
- "429 / rate limit" → "配额用完了"
- Never show the composed prompt unless the user explicitly asks.
- Never show prompt_addons.

## Error handling

Every script returns either success JSON or `{ error, message, next_steps[] }`. Always relay the `next_steps` to the user verbatim (they are pre-translated to plain language). For the full error code list and recovery flow, see `references/error-codes.md`.

## File layout

```
~/.claude/skills/bannermorph/          (also works at ~/.qoder/skills/ and ~/.trae/skills/)
├── SKILL.md                           # this file
├── package.json                       # depends only on xlsx
├── .env                               # API key (auto-created, gitignored)
├── .env.example
├── references/                        # detailed docs loaded on demand
│   ├── api-config.md                  # custom API endpoints, model selection
│   ├── scoring-rubric.md              # how to score 1-10
│   ├── retry-prompts.md               # issue → addon mapping
│   └── error-codes.md                 # full error → user message → action table
└── scripts/
    ├── _lib.js                        # shared utils (args, env, quota log)
    ├── config.js                      # save API key + base_url + model to .env
    ├── import_template.js             # copy dragged template to stable work/
    ├── parse_products.js              # resolve image / folder / excel / url / urls
    ├── quota_status.js                # show default-AK hourly usage
    ├── generate_batch.js              # batch image-gen, enforces quota
    ├── retry_batch.js                 # subset re-run with prompt addons
    ├── recover_results.js             # rebuild results from _progress.jsonl
    ├── write_report.js                # markdown + HTML report
    ├── cleanup.js                     # purge /tmp/bannermorph-products + work/
    └── smoke_test.js                  # local-only sanity test (no network)
```

## Installation across platforms

Same files, three install paths:

```bash
# Claude Code
cp -r /source/bannermorph-skill ~/.claude/skills/bannermorph

# Qoder
cp -r /source/bannermorph-skill ~/.qoder/skills/bannermorph

# Trae
cp -r /source/bannermorph-skill ~/.trae/skills/bannermorph
```

After copy, run `cd <dest> && npm install` once.

## Maintenance

Two local caches grow over time:

- `/tmp/bannermorph-products/` — images downloaded for each Excel/URL run
- `~/.claude/skills/bannermorph/work/` — templates copied by `import_template.js`

Sweep them with `cleanup.js`:

```bash
# Preview what would be deleted (older than 7 days, default)
node ~/.claude/skills/bannermorph/scripts/cleanup.js '{"days":7,"dry_run":true}'

# Actually delete
node ~/.claude/skills/bannermorph/scripts/cleanup.js '{"days":7}'

# More aggressive (30-day window)
node ~/.claude/skills/bannermorph/scripts/cleanup.js '{"days":30}'
```

Returns `{ deleted_files, total_freed_mb, scanned_dirs, errors }`. Safe to run any time — the active session's templates are typically <1 day old and won't be touched at the default 7-day window.

Weekly cron entry:

```
0 3 * * 0  node ~/.claude/skills/bannermorph/scripts/cleanup.js >/dev/null 2>&1
```

For a project-wide sanity check (verifies all scripts wire up correctly, no network calls):

```bash
node ~/.claude/skills/bannermorph/scripts/smoke_test.js
```

Exit 0 = all green, exit 1 = something is broken.
