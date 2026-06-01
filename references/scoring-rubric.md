# Scoring Rubric

> **Heads up**: as of Wave 1, scoring is performed by parallel `general-purpose` subagents, not by the main Claude session. The actual prompt the subagents receive lives in `score-agent-prompt.md` (a condensed version of this rubric). This file remains the authoritative reference for the rubric — keep it in sync if criteria change.

Use vision to compare each output banner against (1) the original template and (2) the source product image. Assign an integer score 1-10 plus a verdict.

## Verdict mapping (3 levels)

- **ok** (score 7-10): Pass — usable as-is. Includes both pristine outputs and ones with minor cosmetic issues that don't hurt usability.
- **needs_retry** (score 4-6): Visible defects that hurt usability — recommend regenerating.
- **failed** (score 1-3): Severe defect (template ignored, product distorted, text broken, etc.).

Previously there was a separate `acceptable` verdict (score 7-8); it was merged into `ok` after user feedback that 3 levels are easier to act on. Legacy reports with `acceptable` are auto-mapped to `ok` by `write_report.js`.

## Scoring criteria (deduct points)

| Defect | Severity | Points off |
|---|---|---|
| Product covers template text | High | -3 to -5 |
| Product placed far from original bbox | High | -2 to -3 |
| Product scaled significantly larger / smaller than original | Medium | -1 to -2 |
| Source product's extra elements bled in (price stickers, gift boxes, second SKU) | High | -3 to -5 |
| Template colors / decorations modified | High | -3 |
| Product brand logo / printed text became illegible | Medium | -2 |
| Lighting / shadow inconsistent with template | Low | -1 |
| Color cast or saturation drift | Low | -1 |
| Output completely ignored the template, replaced with the product photo | Critical | score = 1 |
| AI re-rendered text using product's printed model code | Medium | -2 |

## Required fields per result

For every result the script returns, enrich with these fields before passing to `write_report`:

```json
{
  "product_id": "...",
  "output_image": "...",
  "score": 7,
  "verdict": "ok",
  "issues": ["product slightly clips '70% OFF' headline"],
  "retry_suggestion": null
}
```

- `issues`: array of short strings, only when score ≤ 8.
- `retry_suggestion`: only when verdict is `needs_retry`. One sentence that maps to a concrete prompt addon (see `retry-prompts.md` for the mapping table).

## When in doubt

Default to the lower score. Users prefer accurate feedback over inflated scores; a 9 that turns out to have problems hurts trust more than a 6 that surprises with usability.
