# Retry Prompt Addons

When asking `retry_batch` to redo failed images, pass a short `prompt_addons` string that targets the **category** of defect observed in the previous round. The addon is appended to the base prompt before the AI call.

**🔴 Addon authoring rule**: addons must be **abstract** — describing the desired outcome via "preserve template / match bbox / extract subject" framing. They must **never** name a specific visual element that appeared as the defect (image-edit models cannot process negation — every named visual concept gets re-activated and re-emitted in the new round). The mapping table below is intentionally written without any visual-primitive nouns; preserve this discipline if you extend it.

## Mapping table: issue category → addon

All addons below are abstract on purpose — they describe what to preserve / how to scale, not what to remove.

| Observed issue category | Addon to append |
|---|---|
| Product covered template text | "宁可缩小商品也不要遮挡模板上的任何文字内容" |
| Product extended beyond original bbox | "新商品的大小和位置严格匹配模板原商品的 bounding box" |
| Product too large (>120% of original area) | "新商品占画面比例 ≈ 模板原商品的 100%" |
| Product too small (<80% of original area) | "新商品占画面比例 ≈ 模板原商品的 100%" |
| Source product brought extra elements alongside the main subject | "严格只提取商品主体,模板上看不到的所有附加内容一律丢弃" |
| Source product packaging text leaked into banner text zones | "源商品包装上的印刷文字只在商品像素范围内保留,banner 的文字位由模板像素决定" |
| Template non-product area changed (color, structure, decoration drift, etc.) | "商品 bbox 外的所有像素必须与模板像素 1:1 一致" |
| Product orientation rotated/mirrored | "保持新商品的原始姿态,与源商品图朝向一致" |
| Shadow / lighting inconsistent | "复刻模板原商品的阴影方向、浓度、柔和度" |
| AI ignored template, output looks like product photo | "必须以第 1 张图作为底图修改,商品 bbox 外区域像素级复刻模板" |

## Combining multiple addons

When several defects appear across the batch, concatenate addons with a separator. Keep total length under ~400 characters.

```
addon = [
  "宁可缩小商品也不要覆盖模板上的任何文字",
  "严格只提取商品主体,丢弃所有附加元素",
].join("。") + "。"
```

## Do not stack addons across rounds

Each retry round should compose addons fresh from the latest round's issues. Do not accumulate prior addons (the AI gets overloaded and starts ignoring everything).

## Cap retry to 2 rounds

After 2 retries on the same product image fail to reach `ok`, advise the user:

- "换个商品图试试" (try a different product photo — often the source image is the root cause)
- "用更高分辨率的商品图重试"
- "接受现状"

Do not loop indefinitely.
