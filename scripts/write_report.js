#!/usr/bin/env node
/**
 * 把 LLM 评好分的结果 → markdown + HTML 报告 → 写到 output_dir。
 *
 * 输入:
 *   template_image, prompt, output_dir, title?
 *   format? — "md" (默认) / "html" (base64 inline, 自包含可邮件) /
 *             "html-light" (相对路径, 体积小, 需配套图片目录) /
 *             "both" (md + html base64) / "both-light" (md + html-light)
 *   results: [{ product_id, output_image, source_image?, success?,
 *               score(1-10), verdict("ok"|"needs_retry"|"failed"),
 *               issues?: string[], retry_suggestion?: string,
 *               duration_ms?, error? }]
 *   旧的 "acceptable" verdict 自动归入 "ok",兼容历史数据。
 *
 * 输出:
 *   md only:   { report_path }
 *   html only: { html_report_path }
 *   both:      { report_path, html_report_path }
 *
 * 体积:html 用 base64, 5 张 ~10MB / 100 张 ~180MB (邮件超限);
 *       html-light 用相对路径 <100KB, 但分享需要 zip 整个 output_dir。
 */

const fs = require('fs')
const path = require('path')
const { readArgs, ok, fail, ensureDir } = require('./_lib')

const args = readArgs()
const { template_image, prompt, results, output_dir } = args
const title = args.title || 'Banner 批量生成报告'
const format = args.format || 'md'
if (!['md', 'html', 'html-light', 'both', 'both-light'].includes(format)) {
  fail('INVALID_ARGS', `format 取值必须是 md / html / html-light / both / both-light,收到 ${format}`)
}
const htmlInline = format === 'html' || format === 'both'   // base64 inline
const htmlLight = format === 'html-light' || format === 'both-light'  // 相对路径
const writeMd = format === 'md' || format === 'both' || format === 'both-light'
const writeHtml = htmlInline || htmlLight

if (!Array.isArray(results)) fail('INVALID_ARGS', 'results 必填且必须是数组')
if (!output_dir) fail('INVALID_ARGS', 'output_dir 必填')

ensureDir(output_dir)
const now = new Date().toISOString().replace('T', ' ').slice(0, 19)

// 复制模板到 output_dir/_template.<ext>,让 md 报告自包含
let templateRel = null
let templateAbs = null
if (template_image && fs.existsSync(template_image)) {
  const ext = path.extname(template_image).toLowerCase() || '.png'
  templateAbs = path.join(output_dir, `_template${ext}`)
  try {
    fs.copyFileSync(template_image, templateAbs)
    templateRel = `./_template${ext}`
  } catch {
    templateAbs = null
  }
}

const toRelImage = (absPath) => {
  if (!absPath) return null
  const dir = path.dirname(absPath)
  if (path.resolve(dir) === path.resolve(output_dir)) {
    return `./${path.basename(absPath)}`
  }
  return absPath
}

// 分组 (3 档:ok / needs_retry / failed;旧的 acceptable 归入 ok)
const ok_list = []
const needs_retry = []
const failed = []
for (const r of results) {
  if (r.verdict === 'failed' || r.success === false) failed.push(r)
  else if (r.verdict === 'needs_retry' || (r.score != null && r.score >= 1 && r.score <= 6)) needs_retry.push(r)
  else ok_list.push(r)  // ok / acceptable (legacy) / score >= 7 → 通过
}

const total = results.length

const summary = {
  total,
  ok: ok_list.length,
  needs_retry: needs_retry.length,
  failed: failed.length,
}

const groups = [
  { label: '通过', items: ok_list, emoji: '✅', cssClass: 'ok' },
  { label: '建议重试', items: needs_retry, emoji: '⚠️', cssClass: 'needs_retry' },
  { label: '失败', items: failed, emoji: '❌', cssClass: 'failed' },
]

const written = {}

if (writeMd) {
  const reportPath = path.join(output_dir, 'report.md')
  fs.writeFileSync(reportPath, renderMd())
  written.report_path = reportPath
}

if (writeHtml) {
  const htmlPath = path.join(output_dir, 'report.html')
  fs.writeFileSync(htmlPath, renderHtml({ inlineImages: htmlInline }))
  written.html_report_path = htmlPath
}

ok(written)

// ─── Markdown ───────────────────────────────────────────────────────

function renderMd() {
  const lines = []
  lines.push(`# ${title}`, '')
  lines.push(`生成时间: ${now}`, '')
  lines.push('## 基本信息', '')
  if (templateRel) {
    lines.push(`<img src="${templateRel}" alt="template" width="240">`, '')
  }
  lines.push(`| 字段 | 值 |`, `|---|---|`)
  lines.push(`| 模板 | \`${template_image || '-'}\` |`)
  lines.push(`| 输出目录 | \`${output_dir}\` |`)
  lines.push(`| 总数 | ${summary.total} |`)
  lines.push(`| 通过 | ${summary.ok} |`)
  lines.push(`| 建议重试 | ${summary.needs_retry} |`)
  lines.push(`| 失败 | ${summary.failed} |`, '')

  if (prompt) {
    lines.push('<details><summary>本次使用的 prompt</summary>', '', '```', prompt, '```', '', '</details>', '')
  }

  for (const g of groups) {
    if (g.items.length === 0) continue
    lines.push(`## ${g.emoji} ${g.label} (${g.items.length})`, '')
    for (const r of g.items) {
      lines.push(`### ${r.product_id || '(unknown)'}`, '')
      const rel = toRelImage(r.output_image)
      if (rel && r.success !== false) {
        lines.push(`<img src="${rel}" alt="${r.product_id || 'output'}" width="240">`, '')
      }
      if (r.output_image) lines.push(`- 输出: \`${r.output_image}\``)
      if (r.source_image) lines.push(`- 商品: \`${r.source_image}\``)
      const mdIsOk = r.verdict === 'ok' || r.verdict === 'acceptable'
      if (!mdIsOk && r.issues && r.issues.length === 1) {
        lines.push(`- 问题: ${r.issues[0]}`)
      } else if (!mdIsOk && r.issues && r.issues.length > 1) {
        lines.push(`- 问题:`)
        for (const i of r.issues) lines.push(`  - ${i}`)
      }
      if (r.retry_suggestion && r.verdict === 'needs_retry') {
        lines.push(`- 重试提示词: ${r.retry_suggestion}`)
      }
      if (r.error) lines.push(`- 错误: ${r.error}`)
      lines.push('')
    }
  }

  if (needs_retry.length > 0) {
    lines.push('---', '', '## 💡 下一步建议', '')
    lines.push(`- 跟 chat 说: "retry 那些不达标的" 或 "retry 第 X 张"`)
    lines.push(`- 默认 ideaLAB 每小时 10 次,如果累计接近上限,先换自己的 API key`, '')
  }

  return lines.join('\n')
}

// ─── HTML (base64 inline, self-contained) ───────────────────────────

function imageToDataUri(absPath) {
  if (!absPath || !fs.existsSync(absPath)) return null
  const ext = path.extname(absPath).toLowerCase().slice(1)
  const mime =
    ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
    : ext === 'webp' ? 'image/webp'
    : ext === 'gif' ? 'image/gif'
    : ext === 'bmp' ? 'image/bmp'
    : 'image/png'
  try {
    const buf = fs.readFileSync(absPath)
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderHtml({ inlineImages = true } = {}) {
  // light 模式:用相对路径而非 base64
  const templateSrc = inlineImages
    ? imageToDataUri(templateAbs || template_image)
    : (templateRel || (templateAbs ? path.basename(templateAbs) : null))

  // verdict 中文映射;legacy "acceptable" 归到 "通过"
  const verdictLabel = (v) => ({
    ok: '通过',
    acceptable: '通过',
    needs_retry: '建议重试',
    failed: '失败',
  })[v] || v
  const verdictClass = (v) => (v === 'acceptable' ? 'ok' : v)

  const cardHtml = (r, cssClass) => {
    const productImgSrc = inlineImages
      ? imageToDataUri(r.output_image)
      : toRelImage(r.output_image)
    const imgPart = productImgSrc && r.success !== false
      ? `<div class="card-img-wrap"><img src="${productImgSrc}" alt="${escapeHtml(r.product_id || 'output')}"></div>`
      : '<div class="card-img-wrap card-img-empty">无输出</div>'
    const verdictBadge = r.verdict
      ? `<span class="verdict verdict-${escapeHtml(verdictClass(r.verdict))}">${escapeHtml(verdictLabel(r.verdict))}</span>`
      : ''
    // issues 只在非通过情况显示(通过卡只剩 verdict + 标题 + 图)
    // legacy "acceptable" 在 verdictClass 里也归 ok,所以一并隐藏
    const isOk = r.verdict === 'ok' || r.verdict === 'acceptable'
    let issuesHtml = ''
    if (!isOk && r.issues && r.issues.length === 1) {
      issuesHtml = `<p class="issue-single">${escapeHtml(r.issues[0])}</p>`
    } else if (!isOk && r.issues && r.issues.length > 1) {
      issuesHtml = `<ul class="issues">${r.issues.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`
    }
    // retry_suggestion 只在 needs_retry 时输出(由 score-agent 端保证,这里再加一层防御)
    const showRetry = r.retry_suggestion && r.verdict === 'needs_retry'
    const retryHtml = showRetry
      ? `<div class="callout callout-warn"><strong>重试提示词</strong> ${escapeHtml(r.retry_suggestion)}</div>`
      : ''
    const errorHtml = r.error
      ? `<div class="callout callout-error"><strong>错误</strong> ${escapeHtml(r.error)}</div>`
      : ''
    return `<article class="card">
      ${imgPart}
      <div class="card-body">
        <div class="card-title-row">
          ${verdictBadge}
          <h3 class="card-title">${escapeHtml(r.product_id || '(unknown)')}</h3>
        </div>
        ${issuesHtml}
        ${retryHtml}
        ${errorHtml}
      </div>
    </article>`
  }

  const groupHtml = groups
    .filter((g) => g.items.length > 0)
    .map((g) => `
      <section class="group">
        <header class="group-header">
          <h2 class="group-title">${g.emoji} ${escapeHtml(g.label)}</h2>
          <span class="group-count">${g.items.length}</span>
        </header>
        <div class="cards">
          ${g.items.map((r) => cardHtml(r, g.cssClass)).join('\n')}
        </div>
      </section>
    `).join('\n')

  const templateHtml = templateSrc
    ? `<img class="template-thumb" src="${templateSrc}" alt="template">`
    : '<div class="template-thumb template-thumb-empty">无模板预览</div>'

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root {
    --bg: #fafaf9;
    --surface: #ffffff;
    --border: #e7e5e4;
    --border-strong: #d6d3d1;
    --fg: #1c1917;
    --fg-muted: #78716c;
    --primary: #d97706;
    --primary-soft: #fef3c7;
    --primary-fg: #78350f;
    --success: #16a34a;
    --success-soft: #dcfce7;
    --success-fg: #14532d;
    --info: #0284c7;
    --info-soft: #e0f2fe;
    --info-fg: #075985;
    --warn: #ca8a04;
    --warn-soft: #fef9c3;
    --warn-fg: #713f12;
    --danger: #dc2626;
    --danger-soft: #fee2e2;
    --danger-fg: #7f1d1d;
    --radius-sm: 6px;
    --radius: 10px;
    --radius-lg: 14px;
    --shadow-sm: 0 1px 2px rgb(0 0 0 / 0.04);
    --shadow: 0 1px 3px rgb(0 0 0 / 0.06), 0 1px 2px rgb(0 0 0 / 0.04);
    --shadow-lg: 0 4px 10px rgb(0 0 0 / 0.06), 0 2px 4px rgb(0 0 0 / 0.04);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0c0a09;
      --surface: #1c1917;
      --border: #292524;
      --border-strong: #44403c;
      --fg: #fafaf9;
      --fg-muted: #a8a29e;
      --primary: #f59e0b;
      --primary-soft: #422006;
      --primary-fg: #fcd34d;
      --success-soft: #052e16;
      --success-fg: #86efac;
      --info-soft: #082f49;
      --info-fg: #7dd3fc;
      --warn-soft: #422006;
      --warn-fg: #fde68a;
      --danger-soft: #450a0a;
      --danger-fg: #fca5a5;
    }
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft Yahei", sans-serif;
    max-width: 1240px;
    margin: 0 auto;
    padding: 32px 24px 64px;
    color: var(--fg);
    background: var(--bg);
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }

  /* ───── header ───── */
  .page-header { margin-bottom: 28px; }
  .page-header h1 {
    font-size: 26px;
    font-weight: 600;
    margin: 0 0 6px;
    letter-spacing: -0.01em;
  }
  .page-header .timestamp {
    font-size: 13px;
    color: var(--fg-muted);
  }

  /* ───── summary panel ───── */
  .summary-panel {
    display: grid;
    grid-template-columns: minmax(220px, 280px) 1fr;
    gap: 24px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 20px;
    box-shadow: var(--shadow);
    margin-bottom: 32px;
  }
  @media (max-width: 720px) {
    .summary-panel { grid-template-columns: 1fr; }
  }
  .template-thumb {
    width: 100%;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    display: block;
    object-fit: contain;
    background: var(--bg);
  }
  .template-thumb-empty {
    height: 200px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--fg-muted);
    font-size: 13px;
  }

  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
  @media (max-width: 720px) {
    .stats { grid-template-columns: repeat(2, 1fr); }
  }
  .stat {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 14px;
  }
  .stat-label { font-size: 12px; color: var(--fg-muted); margin-bottom: 4px; }
  .stat-value { font-size: 22px; font-weight: 600; letter-spacing: -0.02em; }
  .stat-value.accent-ok { color: var(--success); }
  .stat-value.accent-warn { color: var(--warn); }
  .stat-value.accent-danger { color: var(--danger); }

  .meta-list {
    display: grid;
    grid-template-columns: 80px 1fr;
    gap: 6px 12px;
    font-size: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }
  .meta-list dt { color: var(--fg-muted); }
  .meta-list dd { margin: 0; word-break: break-all; }
  .meta-list code {
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 11px;
    background: var(--bg);
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
  }

  details.prompt {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    margin-bottom: 24px;
  }
  details.prompt summary {
    cursor: pointer;
    padding: 12px 16px;
    font-size: 13px;
    color: var(--fg-muted);
    user-select: none;
  }
  details.prompt[open] summary { border-bottom: 1px solid var(--border); }
  details.prompt pre {
    margin: 0;
    padding: 14px 16px;
    background: var(--bg);
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-word;
    border-radius: 0 0 var(--radius) var(--radius);
  }

  /* ───── group sections ───── */
  .group { margin-top: 32px; }
  .group-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
  }
  .group-title { margin: 0; font-size: 17px; font-weight: 600; }
  .group-count {
    background: var(--bg);
    color: var(--fg-muted);
    border: 1px solid var(--border);
    padding: 2px 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 500;
  }

  /* ───── product cards ───── */
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    box-shadow: var(--shadow-sm);
    display: flex;
    flex-direction: column;
    transition: box-shadow .15s ease, transform .15s ease;
  }
  .card:hover { box-shadow: var(--shadow-lg); }
  .card-img-wrap {
    aspect-ratio: 1 / 1;
    background: var(--bg);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .card-img-wrap img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .card-img-empty { color: var(--fg-muted); font-size: 13px; }
  .card-body { padding: 14px; display: flex; flex-direction: column; gap: 8px; }
  .card-title-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .card-title {
    font-size: 14px;
    font-weight: 600;
    margin: 0;
    word-break: break-all;
    line-height: 1.35;
    flex: 1;
    min-width: 0;
  }

  /* ───── verdict badges (soft pill) ───── */
  .verdict {
    display: inline-flex;
    align-items: center;
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 500;
    border: 1px solid transparent;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .verdict-ok { background: var(--success-soft); color: var(--success-fg); border-color: color-mix(in oklab, var(--success) 30%, transparent); }
  .verdict-needs_retry { background: var(--warn-soft); color: var(--warn-fg); border-color: color-mix(in oklab, var(--warn) 30%, transparent); }
  .verdict-failed { background: var(--danger-soft); color: var(--danger-fg); border-color: color-mix(in oklab, var(--danger) 30%, transparent); }

  /* ───── issues / callouts ───── */
  .issues {
    margin: 4px 0 0;
    padding-left: 18px;
    font-size: 13px;
    color: var(--fg);
    line-height: 1.5;
  }
  .issues li { margin-bottom: 4px; color: var(--fg-muted); }
  .issue-single {
    margin: 0;
    font-size: 13px;
    color: var(--fg-muted);
    line-height: 1.5;
  }
  .callout {
    font-size: 12px;
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    line-height: 1.5;
  }
  .callout strong { font-weight: 600; margin-right: 6px; }
  .callout-warn { background: var(--warn-soft); color: var(--warn-fg); }
  .callout-error { background: var(--danger-soft); color: var(--danger-fg); }

  /* ───── footer hint ───── */
  .next-step {
    margin-top: 40px;
    background: var(--primary-soft);
    border: 1px solid color-mix(in oklab, var(--primary) 30%, transparent);
    border-radius: var(--radius);
    padding: 16px 20px;
    color: var(--primary-fg);
  }
  .next-step h2 {
    font-size: 14px;
    font-weight: 600;
    margin: 0 0 8px;
  }
  .next-step ul { margin: 0; padding-left: 20px; font-size: 13px; }
  .next-step li { margin-bottom: 4px; }
</style>
</head>
<body>

<header class="page-header">
  <h1>${escapeHtml(title)}</h1>
  <div class="timestamp">${escapeHtml(now)}</div>
</header>

<section class="summary-panel">
  ${templateHtml}
  <div class="summary-right">
    <div class="stats">
      <div class="stat">
        <div class="stat-label">总数</div>
        <div class="stat-value">${summary.total}</div>
      </div>
      <div class="stat">
        <div class="stat-label">通过</div>
        <div class="stat-value accent-ok">${summary.ok}</div>
      </div>
      <div class="stat">
        <div class="stat-label">建议重试</div>
        <div class="stat-value accent-warn">${summary.needs_retry}</div>
      </div>
      <div class="stat">
        <div class="stat-label">失败</div>
        <div class="stat-value accent-danger">${summary.failed}</div>
      </div>
    </div>
    <dl class="meta-list">
      <dt>模板</dt><dd><code>${escapeHtml(template_image || '-')}</code></dd>
      <dt>输出目录</dt><dd><code>${escapeHtml(output_dir)}</code></dd>
    </dl>
  </div>
</section>

${prompt ? `<details class="prompt"><summary>本次使用的 prompt</summary><pre>${escapeHtml(prompt)}</pre></details>` : ''}

${groupHtml}

${needs_retry.length > 0 ? `
<section class="next-step">
  <h2>💡 下一步建议</h2>
  <ul>
    <li>跟我说"retry 那些不达标的"或者"retry 第 X 张",我帮你重生</li>
    <li>默认 ideaLAB 每小时 10 次,如果累计接近上限,先换自己的 API key</li>
  </ul>
</section>
` : ''}

</body>
</html>`
}
