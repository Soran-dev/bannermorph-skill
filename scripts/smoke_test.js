#!/usr/bin/env node
/**
 * 本地烟测 — 无网络依赖,验证所有脚本能正常 wire up。
 *
 * 用法:
 *   node smoke_test.js              # 跑全部用例
 *
 * 退出码:
 *   0 = 所有用例 PASS
 *   1 = 有用例 FAIL (或脚本本身 panic)
 *
 * 注意: 用例 6 (generate_batch fake base_url) 故意让 fetch 失败 — 这是预期行为,验证流程跑得通即可。
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawnSync } = require('child_process')

const SCRIPTS_DIR = __dirname
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bannermorph-smoke-'))

const cases = []
let passed = 0
let failed = 0

function test(name, fn) {
  cases.push({ name, fn })
}

function runNode(scriptName, jsonArg) {
  const args = [path.join(SCRIPTS_DIR, scriptName)]
  if (jsonArg !== undefined) args.push(typeof jsonArg === 'string' ? jsonArg : JSON.stringify(jsonArg))
  const result = spawnSync('node', args, { encoding: 'utf8' })
  return {
    code: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    json: tryParseJson(result.stdout || ''),
  }
}

function tryParseJson(s) {
  try { return JSON.parse(s) } catch { return null }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// 制造一张最小有效 PNG (1x1 红点) — 用于不依赖外部资源的 image 测试
const ONE_PX_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
  '0000000d49444154789c63f8cfc0c0c0000003000100ffff03000005000158a2c8' +
  '8f0000000049454e44ae426082',
  'hex',
)

// ─── 用例 ────────────────────────────────────────────────────────────

test('1. _lib.js exports complete', () => {
  const lib = require('./_lib')
  for (const k of [
    'readArgs', 'ok', 'fail', 'panic', 'loadEnv', 'resolveApiConfig', 'ensureApiKey',
    'ensureDir', 'akHash', 'appendCallLog', 'getRecentCallCount', 'getRecentCalls',
    'IDEALAB_BATCH_LIMIT', 'IDEALAB_HOURLY_QUOTA', 'QUOTA_WINDOW_MS',
  ]) {
    assert(lib[k] !== undefined, `_lib.js missing export: ${k}`)
  }
  assert(lib.IDEALAB_HOURLY_QUOTA === 10, 'IDEALAB_HOURLY_QUOTA should be 10')
})

test('2. import_template.js copies an image', () => {
  const src = path.join(TMP, 'tpl.png')
  fs.writeFileSync(src, ONE_PX_PNG)
  const r = runNode('import_template.js', { source: src })
  assert(r.code === 0, `exit ${r.code}, stderr=${r.stderr.slice(0, 200)}`)
  assert(r.json && r.json.stable_path, `no stable_path in: ${r.stdout.slice(0, 200)}`)
  assert(fs.existsSync(r.json.stable_path), 'stable_path file missing')
  assert(r.json.size_bytes === ONE_PX_PNG.length, `size mismatch: ${r.json.size_bytes} vs ${ONE_PX_PNG.length}`)
  // 清理这个 work/ 文件,避免污染
  try { fs.unlinkSync(r.json.stable_path) } catch {}
})

test('3a. parse_products.js image mode', () => {
  const src = path.join(TMP, 'single.png')
  fs.writeFileSync(src, ONE_PX_PNG)
  const r = runNode('parse_products.js', { source: { image: src } })
  assert(r.code === 0, `exit ${r.code}, out=${r.stdout.slice(0, 200)}`)
  assert(r.json && Array.isArray(r.json.product_paths), `no product_paths`)
  assert(r.json.count === 1, `count should be 1`)
})

test('3b. parse_products.js folder mode', () => {
  const folder = path.join(TMP, 'folder')
  fs.mkdirSync(folder, { recursive: true })
  fs.writeFileSync(path.join(folder, 'a.png'), ONE_PX_PNG)
  fs.writeFileSync(path.join(folder, 'b.png'), ONE_PX_PNG)
  const r = runNode('parse_products.js', { source: { folder } })
  assert(r.code === 0, `exit ${r.code}`)
  assert(r.json && r.json.count === 2, `count should be 2, got ${r.json?.count}`)
})

test('4. parse_products.js excel mode (column detection)', () => {
  const XLSX = require(path.join(path.resolve(__dirname, '..'), 'node_modules/xlsx'))
  const wb = XLSX.utils.book_new()
  const data = [
    ['SKU', 'Banner URL'],
    ['A1', 'https://example.invalid/a.jpg'],
    ['A2', 'https://example.invalid/b.jpg'],
    ['A3', 'https://example.invalid/c.jpg'],
  ]
  const ws = XLSX.utils.aoa_to_sheet(data)
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  const xlsxPath = path.join(TMP, 'test.xlsx')
  XLSX.writeFile(wb, xlsxPath)

  const cacheDir = path.join(TMP, 'excel-cache')
  const r = runNode('parse_products.js', { source: { excel: xlsxPath }, cache_dir: cacheDir })
  // 期望:列识别到了 (3 个 URL),但下载会全部失败 → DOWNLOAD_FAILED
  assert(r.code === 0, `exit ${r.code}`)
  assert(r.json && r.json.error === 'DOWNLOAD_FAILED', `expected DOWNLOAD_FAILED, got: ${JSON.stringify(r.json).slice(0, 200)}`)
  assert(Array.isArray(r.json.next_steps) && r.json.next_steps.length === 3, `expected 3 next_steps (3 URLs)`)
})

test('5. quota_status.js returns required fields', () => {
  const r = runNode('quota_status.js')
  // 如果没有配 .env,会返回 AK_NOT_CONFIGURED,但这也是合法响应
  assert(r.code === 0, `exit ${r.code}`)
  assert(r.json, `no JSON output`)
  if (r.json.error) {
    assert(r.json.error === 'AK_NOT_CONFIGURED', `unexpected error: ${r.json.error}`)
  } else {
    for (const k of ['used_last_hour', 'limit', 'remaining', 'reset_estimate_at', 'recent_calls']) {
      assert(k in r.json, `missing field: ${k}`)
    }
  }
})

test('6. generate_batch.js with fake base_url (expect all fail but flow works)', () => {
  const tplPath = path.join(TMP, 'tpl-gen.png')
  fs.writeFileSync(tplPath, ONE_PX_PNG)
  const p1 = path.join(TMP, 'p1.png'); fs.writeFileSync(p1, ONE_PX_PNG)
  const p2 = path.join(TMP, 'p2.png'); fs.writeFileSync(p2, ONE_PX_PNG)
  const outDir = path.join(TMP, 'gen-out')
  fs.mkdirSync(outDir, { recursive: true })

  const r = runNode('generate_batch.js', {
    template_image: tplPath,
    product_paths: [p1, p2],
    prompt: 'smoke',
    output_dir: outDir,
    concurrency: 2,
    api_config: { base_url: 'http://127.0.0.1:1/v1', api_key: 'fake-key-for-smoke' },
  })
  assert(r.code === 0, `exit ${r.code}, stderr=${r.stderr.slice(0, 200)}`)
  assert(r.json && Array.isArray(r.json.results), `no results array`)
  assert(r.json.results.length === 2, `expected 2 results`)
  assert(r.json.failed_count === 2, `expected all fail`)
  // _progress.jsonl 应该有 2 行
  const progressFile = path.join(outDir, '_progress.jsonl')
  assert(fs.existsSync(progressFile), `_progress.jsonl missing`)
  const lines = fs.readFileSync(progressFile, 'utf8').split('\n').filter(Boolean)
  assert(lines.length === 2, `expected 2 progress lines, got ${lines.length}`)
  // 进度行也应该出现在 stderr
  assert(r.stderr.includes('[generate_batch] 1/2') || r.stderr.includes('[generate_batch] 2/2'),
    `stderr should contain progress line, got: ${r.stderr.slice(0, 300)}`)
})

test('7. recover_results.js rebuilds results from _progress.jsonl', () => {
  const outDir = path.join(TMP, 'gen-out') // 复用用例 6 的 output
  const r = runNode('recover_results.js', { output_dir: outDir })
  assert(r.code === 0, `exit ${r.code}`)
  assert(r.json && r.json.total === 2, `expected total 2, got ${r.json?.total}`)
  assert(Array.isArray(r.json.results) && r.json.results.length === 2, `expected 2 results`)
})

test('8. write_report.js generates md + html (both, base64 inline)', () => {
  const tplPath = path.join(TMP, 'tpl-rpt.png')
  fs.writeFileSync(tplPath, ONE_PX_PNG)
  const out1 = path.join(TMP, 'rpt', '01.png')
  fs.mkdirSync(path.dirname(out1), { recursive: true })
  fs.writeFileSync(out1, ONE_PX_PNG)
  const outDir = path.dirname(out1)

  const r = runNode('write_report.js', {
    template_image: tplPath,
    output_dir: outDir,
    format: 'both',
    results: [
      { product_id: '01', output_image: out1, success: true, score: 9, verdict: 'ok', issues: [], retry_suggestion: null, duration_ms: 1234 },
      // legacy acceptable verdict — should be auto-mapped to 通过
      { product_id: '02-legacy', output_image: out1, success: true, score: 8, verdict: 'acceptable', issues: ['略小'], retry_suggestion: null, duration_ms: 1500 },
    ],
  })
  assert(r.code === 0, `exit ${r.code}, stdout=${r.stdout.slice(0, 200)}`)
  assert(r.json && r.json.report_path && r.json.html_report_path, `expected both paths in result`)
  assert(fs.existsSync(r.json.report_path), `report.md missing`)
  assert(fs.existsSync(r.json.html_report_path), `report.html missing`)
  const md = fs.readFileSync(r.json.report_path, 'utf8')
  const html = fs.readFileSync(r.json.html_report_path, 'utf8')
  assert(md.includes('# Banner'), `md missing title`)
  assert(!md.includes('生成质量'), `md should NOT show 生成质量 anymore (score is hidden)`)
  assert(!md.includes('平均评分'), `md should NOT show 平均评分 anymore`)
  assert(html.includes('<!doctype html>') && html.includes('data:image/png;base64,'),
    `html content missing expected strings`)
  // legacy acceptable should land in the "通过" group (count = 2), not its own group
  assert(md.includes('通过 | 2'), `legacy acceptable should merge into ok bucket, md=${md.slice(0, 500)}`)
  // ok/acceptable cards should NOT show issues even when issues array is non-empty
  assert(!md.includes('略小'), `ok/acceptable cards should hide issues, md=${md.slice(0, 800)}`)
})

test('8b. write_report.js html-light (relative paths, no base64)', () => {
  const tplPath = path.join(TMP, 'tpl-light.png')
  fs.writeFileSync(tplPath, ONE_PX_PNG)
  const out1 = path.join(TMP, 'rpt-light', '01.png')
  fs.mkdirSync(path.dirname(out1), { recursive: true })
  fs.writeFileSync(out1, ONE_PX_PNG)
  const outDir = path.dirname(out1)

  const r = runNode('write_report.js', {
    template_image: tplPath,
    output_dir: outDir,
    format: 'html-light',
    results: [
      { product_id: '01', output_image: out1, success: true, score: 9, verdict: 'ok', issues: [], retry_suggestion: null, duration_ms: 1234 },
    ],
  })
  assert(r.code === 0, `exit ${r.code}, stdout=${r.stdout.slice(0, 200)}`)
  assert(r.json && r.json.html_report_path && !r.json.report_path, `expected only html, got: ${JSON.stringify(r.json)}`)
  const html = fs.readFileSync(r.json.html_report_path, 'utf8')
  assert(!html.includes('data:image/png;base64,'),
    `html-light should NOT contain base64 data URIs`)
  assert(html.includes('src="./_template.png"') || html.includes('src="./01.png"'),
    `html-light should use relative paths, got fragment: ${html.match(/<img[^>]*>/)?.[0] || 'no img'}`)
  // 体积应该 < 50KB (1 张 1x1 + 模板)
  const sizeKb = fs.statSync(r.json.html_report_path).size / 1024
  assert(sizeKb < 50, `html-light too large: ${sizeKb.toFixed(1)} KB`)
})

test('9. cleanup.js --dry_run runs without error', () => {
  const r = runNode('cleanup.js', { days: 7, dry_run: true })
  assert(r.code === 0, `exit ${r.code}`)
  assert(r.json, `no JSON output`)
  for (const k of ['dry_run', 'days', 'scanned_dirs', 'deleted_files', 'total_freed_mb', 'errors']) {
    assert(k in r.json, `missing field: ${k}`)
  }
  assert(r.json.dry_run === true, `dry_run should be true`)
})

// ─── 跑用例 ───────────────────────────────────────────────────────────

console.log(`\n🧪 BannerMorph smoke test (tmp=${TMP})\n`)
for (const c of cases) {
  process.stdout.write(`  ${c.name} ... `)
  try {
    c.fn()
    console.log('PASS')
    passed++
  } catch (err) {
    console.log('FAIL')
    console.log(`      └─ ${err.message}`)
    failed++
  }
}

console.log(`\n${passed} passed, ${failed} failed (of ${cases.length})`)

// 清理临时目录
try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {}

process.exit(failed === 0 ? 0 : 1)
