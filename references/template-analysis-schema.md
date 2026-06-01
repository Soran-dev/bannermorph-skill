# Template Analysis Schema

In Step 1 of the workflow, the main Claude session uses vision to look at the banner template and **outputs a JSON object conforming to this schema**. The same JSON is then rendered into two distinct natural-language fragments:

1. A **generate-prompt block** — appended to the user-visible base prompt that goes to the image-generation API (Step 3 / `generate_batch.js`)
2. A **score-context block** — passed as `{template_analysis}` to each scoring subagent (Step 4 / `score-agent-prompt.md`)

Both fragments come from the same source JSON, so they stay consistent. Don't hand-write either block — render from the JSON.

## Schema

```json
{
  "template_type": "promo|festival|new_arrival|category|generic",
  "headline_zones": [
    { "text": "UP TO 70% OFF", "position": "top|top-left|center|bottom-right|...", "color": "pink-magenta" }
  ],
  "decoration_zones": [
    "<large structural element 1 with position>",
    "<large structural element 2 with position>"
  ],
  "safe_zones": [
    "everything outside the product bbox — must be pixel-identical to template"
  ],
  "product_bbox_hint": {
    "region": "center|center-left|center-right|bottom-right|...",
    "approx_pct": 40
  },
  "color_palette": ["white", "purple-accent", "red-tag", "green-grass-border"],
  "style": "lively|minimal|luxury|generic",
  "extras_to_drop": [
    "brand official store logos",
    "guaranteed-authentic seals",
    "splash / scattered powder effects",
    "second SKU comparison shots"
  ],
  "original_product_kind": "soccer shoes"
}
```

### Field meanings

- **template_type** — high-level category. Drives style hints in the generate prompt.
- **headline_zones** — every text block on the template that MUST stay 100% intact. List each verbatim with rough position + dominant color.
- **decoration_zones** — only the LARGE / structural decorative elements (logo, card shape, frame). Do NOT enumerate small decorative motifs by name. Every visual primitive noun named here will be activated by the image-edit model's attention and reproduced (often multiplied) in the output, including motifs the template doesn't actually contain. Trust the model to reproduce template details via the pixel-identity rule (see `safe_zones` + skeleton rule 4).
- **safe_zones** — describe areas via **positive identity** ("must be pixel-identical to template"), NEVER by enumerating forbidden elements. Image-edit models cannot reliably process negation — every visual concept named in the prompt (whether prohibited or required) gets activated and tends to appear in the output. See the "Developer postmortem" at the bottom of this file for the empirical evidence chain.
- **product_bbox_hint** — where the product sits and how large. `approx_pct` is rough area ratio (5-100).
- **color_palette** — 3-6 dominant colors, free-form labels are fine ("dusty pink" / "pink-magenta" / "tiffany cyan" all OK).
- **style** — drives prompt tone.
- **extras_to_drop** — anti-patterns common in source product photos that the AI must NOT bleed into the banner. Tailor per category (cosmetics → splash effects; tech → comparison shots; fashion → second outfit).
- **original_product_kind** — what the template's pictured original product is, in 1-3 words. Helps the scoring agent understand bbox context. Set to `"none"` if the template doesn't show a product (rare).

## Rendering

### Render → generate-prompt block

Paste this paragraph at the **end** of the base prompt before sending to the image-gen API. **Do NOT enumerate small decoration motifs anywhere in this block** — see W6-C postmortem (`docs/.../prompt-negation-failure.md` if it exists; otherwise see schema field doc above).

```
模板分析:
- 这是一个 {template_type} banner,整体风格 {style}。
- 文字内容(只允许保留,内容/字号/字形/颜色一字一像素不可改): {headline_zones[].text + position 列举}。
- 主要结构元素(只允许保留): {decoration_zones 列举}。
- 商品位置:画面 {product_bbox_hint.region},占比约 {product_bbox_hint.approx_pct}%。
- 模板原商品(将被新商品替换): {original_product_kind}。
- 严格丢弃源商品图里这些附加元素: {extras_to_drop 列举}。
```

注意:这段刻意**不列任何具体的视觉小元素**(装饰、纹理、几何图案的命名一概避免)。凡是被 mention 的视觉概念都会被 Gemini 的 attention 高度激活并复制到输出。整体"哪些区域必须保留"的约束已在 skeleton 的铁律 4 用正向"像素级复刻"表达。具体反例见本文件末尾的 Developer postmortem。

### Render → score-context block (deprecated)

**As of the post-W6-C fix, the score-agent prompt no longer accepts a `{template_analysis}` block.** Scoring is grounded purely in direct visual comparison of the template image and the output image — anchoring on a pre-declared "template should contain X" inventory caused real bugs when the Step 1 analysis hallucinated elements (see Developer postmortem at the bottom of this file). The score-agent prompt template now asks the evaluator to look at both images and find differences directly.

This section is kept for historical reference only. **Do not** wire `{template_analysis}` into score-agent calls.

## Example (Lazada soccer-shoes promo banner)

```json
{
  "template_type": "promo",
  "headline_zones": [
    { "text": "UP TO 70% OFF", "position": "top", "color": "pink-magenta" },
    { "text": "FREE SHIPPING", "position": "upper-middle (cyan band)", "color": "white-on-cyan" },
    { "text": "STUDDED TRAINING SOCCER SHOES", "position": "middle-left", "color": "black" },
    { "text": "WINNER'S TOP PICK!!", "position": "bottom-left (pink oval)", "color": "white-on-pink" },
    { "text": "*T&Cs apply", "position": "bottom-right", "color": "grey" }
  ],
  "decoration_zones": [
    "Lazada logo top-left",
    "white voucher card with serrated edges"
  ],
  "product_bbox_hint": { "region": "center-right", "approx_pct": 40 },
  "color_palette": ["white", "pink-magenta", "tiffany-cyan", "purple-accent", "green-grass-border"],
  "style": "lively",
  "extras_to_drop": [
    "brand OFFICIAL STORE / FLAGSHIP STORE logos",
    "guaranteed-authentic seals",
    "splash / scattered powder effects (cosmetics)",
    "second SKU comparison shots",
    "product packaging text leaking onto banner text zones"
  ],
  "safe_zones": [
    "everything outside the product bbox — must be pixel-identical to template"
  ],
  "original_product_kind": "soccer shoes (silver + blue)"
}
```

## Why JSON, why not just write a paragraph?

Three reasons:

1. **Consistency** — the generate prompt and the score-agent hint must come from the same source. Hand-writing both leads to drift.
2. **Repeatability** — same template → same JSON → same prompt. No prompt-engineering randomness across runs.
3. **Inspectable** — when something goes wrong (AI ignores a text zone), you can compare the JSON to what was actually preserved and pinpoint where the schema was lacking.

Keep the JSON in working memory during the session; you don't need to write it to disk.

## Recommended generate-prompt skeleton

The full `prompt` argument passed to `generate_batch.js` follows this skeleton. The **4 iron rules** at the top are non-negotiable. Rule 4 in particular went through multiple wrong iterations before landing on "pixel-identical" — see the Developer postmortem at the bottom of this file for the evidence chain.

```
你的任务:把第 2 张图(商品图)的商品主体替换到第 1 张图(banner 模板)中原商品的位置上。

四条铁律(任何一条被违反 → 输出作废):
1. 模板上所有文字内容 100% 保留 — 字号、字形、颜色、位置、内容,一字一像素都不能改。
2. 新商品的大小、位置、姿态严格匹配模板原商品的 bounding box,绝不放大或扩展。
3. 严格只提取第 2 张图的商品主体,丢弃所有附加元素(品牌 logo / 价格贴纸 / 第二件商品 / 撒落特效 / 包装文字溢出到 banner 文字位等)。
4. **像素级复刻模板的非商品区域**。把模板当作底图:商品 bbox 内的像素被新商品替换;商品 bbox 外的所有像素必须与模板像素 1:1 完全一致 — 包括颜色、纹理、留白、所有结构元素。你不是设计师,你是像素复刻师。

模板分析:
[这里粘贴上面 "Render → generate-prompt block" 渲染出的段落]

输出要求:必须输出图片。商品 bbox 外的任何像素都不能与模板有差异。
```

主 Claude 在 Step 3 拼 `prompt` 时,把这个 skeleton 完整带上,**永远不要**在 prompt 里出现任何具体的视觉小元素名词 — 不管是 positive("必须保留 X")还是 negative("不要加 X"),只要 mention 就会被激活并复制。如果新模板有特殊小元素需要描述,放进 schema 的 `decoration_zones` 用"位置+结构性名词"(如 "small accents around card edges")而不是 visual primitive 名词。具体反例见末尾 Developer postmortem。

---

## Developer postmortem (do not read during Step 1 workflow)

This section documents two failure modes discovered through 5 rounds of empirical testing on a Lazada promo banner. **Step 1 of the workflow should not read this section** — the specific visual nouns mentioned below would, if echoed into a generated prompt or score-agent prompt, reproduce the very failures the postmortem describes. This section is for skill maintainers reviewing why the design is the way it is.

### Failure mode 1: Negation activation

Image-edit models (Gemini 3.1 flash, Stable Diffusion family, etc.) process prompts via cross-attention that activates on named visual concepts. Negation modifiers ("don't", "do not", "avoid") attached to those concepts are weakly bound — the named concept gets activated regardless.

Evidence chain (the test template was clean — no small motifs at all in reality):

| Round | Generate-prompt mentions of "small motif X" | Outputs containing X (across 5 images) |
|---|---|---|
| Wave 4 | 0 mentions | 0 |
| Wave 5 | 5 mentions (in `safe_zones` listing things "not to add") | ~25 |
| Wave 6-B | 12 mentions (rule 4 enumerated forbidden motifs) | ~12 |
| W6-C | 0 mentions (rule 4 rewritten to positive "pixel-identical") | 0 |

Roughly 1:1 correspondence between mentions and emissions. The fix is the W6-C-and-later skeleton above: rule 4 names only **what to preserve** (template pixels) — never **what to forbid** (specific motif names).

### Failure mode 2: Hallucinated-inventory pollution

This is the upstream cause of failure mode 1 in the original incident, and an independent failure mode on its own.

In Step 1, the main Claude session used vision to analyze the template and **hallucinated a small motif that wasn't actually present** (it described the template as containing "5 small purple motifs, 3 on one side and 2 on the other"). This hallucinated inventory then propagated:

1. Into the generate-prompt's decoration_zones (telling Gemini to "preserve the 5 motifs") — triggered failure mode 1
2. Into the score-agent's template_analysis block (telling evaluators "the template has 5 motifs") — caused clean outputs to be penalized for "missing the 5 motifs" that never existed

Discovered when the user pointed out: *"原模板根本没有这个东西,为什么评估报告都在拿这个来评估?"*

Two fixes, both applied:

- **Schema authoring discipline**: Step 1 must verify each declared element against the actual template image before writing the schema. See SKILL.md Step 1 "vision double-check" guidance.
- **Score-agent isolation**: the score-agent prompt no longer receives any pre-declared template inventory. It scores by directly comparing template image vs output image and reporting differences it actually sees (see `score-agent-prompt.md`). This breaks the dependency that let a Step 1 hallucination corrupt evaluation.

### Combined design rule

> **Anything you mention in a generate-prompt — positive or negative — will appear in the output.**
> **Anything you mention in a score-agent context — true or hallucinated — will be used to penalize outputs.**
>
> Therefore: generate-prompts only describe what to preserve via abstract positive identity ("pixel-identical to template"); score-agent prompts contain zero pre-declared inventory and require the evaluator to ground judgment in direct image comparison.

