# Score Agent Prompt Template

This file is the prompt template the **main Claude session** sends to each `general-purpose` subagent during Step 4 of the workflow. Each subagent scores **one** output image.

The main session must spawn N subagents in parallel (one per successful output) by calling the `Agent` tool N times within a single message. Use `subagent_type: "general-purpose"`.

## Why subagents

Scoring N outputs serially in the main session takes ~30-60s per image (vision + freeform writeup). With N parallel subagents that each return strict JSON, the wall-clock drops to roughly the slowest subagent (~10-15s).

Subagents only see the template and the output — not the source product image, and (as of post-W6-C fix) **not the Step 1 template_analysis JSON**. Scoring is grounded purely in direct visual comparison of the two images. Passing a pre-declared "template should contain X" inventory caused real bugs when the Step 1 analysis was wrong (a hallucinated count of small motifs led 4 subagents to deduct points for "missing" them against a clean output, despite the template not actually containing those motifs).

## The prompt

Substitute `{template_path}` and `{output_path}` before sending. Keep the JSON-only output rule strict.

**Important design note**: this prompt deliberately does **not** pass a `{template_analysis}` block of "what the template should contain." Anchoring scoring on a pre-declared inventory caused real bugs (see `template-analysis-schema.md` postmortem section): if Step 1 hallucinated an element the template doesn't actually have, every subagent would deduct points for "missing" it against a clean output. Scoring must be grounded only in what the subagent **directly observes** in the two images.

```
你是 banner 质量审核员。直接对比下面两张图,给输出图打分。

模板原图: {template_path}
本次输出: {output_path}

**评分方法(只基于你直接看到的两张图,不要假设任何"模板应该有什么")**:

步骤 1. 仔细看模板,记住它实际包含哪些视觉元素 (文字、图形、颜色、商品、留白)。
步骤 2. 仔细看输出。
步骤 3. 找出"输出里有但模板里没有"的元素 — 这些是 AI 自创的多余内容。
步骤 4. 找出"模板里有但输出里丢了/变形了"的元素 — 这些是 AI 漏复刻或改坏的内容。
步骤 5. 商品区域单独看:商品被替换得是否干净 (位置、大小、姿态匹配模板原商品所在的区域?有没有把源商品图的附加内容也带进来,如品牌 logo / 圆标 / 第二件商品 / 撒落特效 / 包装文字溢出到 banner 文字位?)。

**重要豁免(不算扣分项)**:
- 商品类型与模板文字描述不匹配 (例如模板写 "SOCCER SHOES" 但实际放了化妆品/手袋)。这是 banner 模板设计本身的事情 (本 skill 只换商品图,不替换 banner 文字),与 AI 生成质量无关,**不扣分**。

扣分(从满分 10 开始):
- 步骤 3 发现任何"输出有、模板没有"的元素: 每类 -3
- 步骤 4 发现任何"模板有、输出丢失或变形": 每类 -2 到 -5 (文字变形扣 -5,装饰变形扣 -3)
- 步骤 5 商品位置偏离模板原商品区域: -2 到 -3
- 步骤 5 商品大小明显偏小或偏大: -1 到 -2
- 步骤 5 源商品图的附加内容被带入: -3 到 -5
- 商品姿态被旋转/镜像 (跟源不一致): -1
- 阴影方向/光照与模板不一致: -1
- 输出几乎完全无视模板,变成商品照: 直接 1 分

verdict (三档):
- score 7-10 → "ok"         (通过,可直接使用 — 包括小瑕疵)
- score 4-6  → "needs_retry" (建议重试,有明显问题)
- score 1-3  → "failed"      (失败,严重问题)

只输出一个严格的 JSON 对象,不要 markdown 包裹,不要前后任何解释文字:

{
  "score": <integer 1-10>,
  "verdict": "ok" | "needs_retry" | "failed",
  "issues": ["短句", "短句"],          // 仅当 verdict 是 "needs_retry" 或 "failed" 时填;verdict 是 "ok" 时一律空数组(通过卡不展示问题文案)
  "retry_suggestion": "一句可执行的提示词"  // 仅当 verdict 是 "needs_retry" 时填,否则 null
}

`retry_suggestion` 的写作规范(只在 verdict = needs_retry 时填):
- 它**必须是一句可执行的提示词**,会被原样追加到下一轮 generate prompt 作为 addon。AI 看了之后就要知道下次怎么改。
- 用**正向描述**告诉 AI "怎么做才对",不要用 negation("不要做 X"会反向激活,见 template-analysis-schema.md postmortem)。
- 不要 mention 任何具体的视觉小元素名词(sparkle/star/confetti/dot/glow/texture 等)。
- 参考 `references/retry-prompts.md` 的 "issue category → addon" 映射表,选最贴近的一条,或者按相同抽象风格自己写一句。
- 长度 ≤ 60 字。
- 例子:
  - ✅ "新商品占画面比例 ≈ 模板原商品的 100%"
  - ✅ "商品 bbox 外的所有像素必须与模板像素 1:1 一致"
  - ✅ "宁可缩小商品也不要遮挡模板上的任何文字内容"
  - ❌ "不要再加 sparkle 了"(negation + 具体名词,会反向激活)
  - ❌ "做得更好点"(空话,AI 无法执行)

JSON **只能**包含上面这 4 个字段。不要新增 verdict_note / confidence / notes / reasoning / explanation 等任何额外字段 — 它们会被下游脚本忽略,但污染 schema。

**写 issues 时的措辞规则**(issues 会直接展示给运营/用户看,必须易读):
- 只描述你直接看到的差异,不要套用预设标签 (例如不要说"模板有 5 个 X 但输出只有 3 个"除非你**真的数过两张图都数到对应的数字**)。
- 用日常中文,避免技术术语:不要写 "bbox / bounding box / canvas / inference / latent / artifact",改成"商品位置 / 商品区域 / 商品所在的格子 / 画面 / 痕迹"等用户能直接看懂的说法。
- 一条 issue 一句话,15-40 字最佳,避免长段落。
- 不引用模板原文字内容做评判 (例如"商品和 SOCCER SHOES 文字不符" — 这种已豁免不算扣分,也不要写进 issues)。

读这两张图后直接输出 JSON。
```

## Output handling

The subagent's response is a single JSON object. Parse it:

1. Try `JSON.parse` first
2. If that fails, regex out the first `{...}` block and try again
3. If parsing still fails OR the subagent returned an `API Error` / empty result / non-image error → **immediately re-issue that ONE Agent call once** (same prompt, new tool_use). Subagent transient failures (model hiccup, network blip) almost always resolve on retry.
4. If the retry also fails → mark this product `verdict: "needs_retry"` with `issues: ["scoring agent failed twice: <reason>"]` and move on.

When re-issuing, you may use a fresh assistant message with just that one Agent block — the parallelism for the rest of the batch already happened in the first round, so the retry being serial is fine.

After all subagents return, merge the per-product score JSON into the `results` array (each entry already has `product_id`, `output_image`, `success`, `duration_ms` from `generate_batch`). Pass the merged array to `write_report.js`.

## Don't

- Don't include the source product image — the subagent doesn't need it
- Don't ask the subagent to write prose; the JSON-only rule is non-negotiable
- Don't pass the full `scoring-rubric.md` — the inline rules above are intentionally short
- Don't loop more than once on a single failing subagent — 2 tries max, then mark `needs_retry`
- Don't retry a subagent that returned a parseable JSON, even if the score seems off — `needs_retry` workflow is for the next generation round, not a re-score
