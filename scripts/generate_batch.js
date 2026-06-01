#!/usr/bin/env node
/**
 * 核心: 批量调生图 API (OpenAI 兼容 chat completions multimodal 协议) 生成 banner。
 *
 * 输入:
 *   template_image: 模板图本地路径
 *   product_paths: 商品图路径列表 (来自 parse_products)
 *   prompt: 由 LLM 拼好的 prompt (含模板分析 + 用户描述)
 *   output_dir: 输出目录
 *   concurrency?: 默认 5
 *   api_config?: { base_url, api_key, model } - 不传则用默认 ideaLAB
 *
 * 输出:
 *   results: [{ product_id, output_path, success, error?, duration_ms }]
 *   success_count, failed_count, using_default_ak
 *
 * 配额规则:
 *   默认 AK + 数量 > 10 → 拒绝
 *   非默认 AK 不限
 */

const fs = require('fs')
const path = require('path')
const {
  readArgs,
  ok,
  fail,
  resolveApiConfig,
  ensureApiKey,
  ensureDir,
  akHash,
  appendCallLog,
  getRecentCallCount,
  IDEALAB_BATCH_LIMIT,
  IDEALAB_HOURLY_QUOTA,
} = require('./_lib')

async function main() {
  const args = readArgs()
  const { template_image, product_paths, prompt, output_dir, concurrency, api_config, auto_subdir } = args

  // 入参校验
  if (!template_image) fail('INVALID_ARGS', 'template_image 必填')
  if (!fs.existsSync(template_image)) fail('FILE_NOT_FOUND', `模板图不存在: ${template_image}`)
  if (!Array.isArray(product_paths) || product_paths.length === 0) {
    fail('INVALID_ARGS', 'product_paths 必填且不能为空', [
      '先调 parse_products 拿到 product_paths',
    ])
  }
  if (!prompt) fail('INVALID_ARGS', 'prompt 必填')
  if (!output_dir) fail('INVALID_ARGS', 'output_dir 必填')

  // 解析 API 配置
  const cfg = resolveApiConfig(api_config)
  ensureApiKey(cfg)

  // 配额预检 (只有默认 AK 才限)
  if (cfg.using_default && product_paths.length > IDEALAB_BATCH_LIMIT) {
    fail(
      'QUOTA_EXCEEDED',
      `默认 ideaLAB AK 单次限 ${IDEALAB_BATCH_LIMIT} 张 (每小时 10 次调用),你提交了 ${product_paths.length} 张`,
      [
        `我先做前 ${IDEALAB_BATCH_LIMIT} 张?`,
        '你有自己的付费生图 API key 吗 (比如 OpenAI / Gemini 的)?有的话告诉我可以一次跑完',
        `把数量减到 ${IDEALAB_BATCH_LIMIT} 张以下`,
      ],
    )
  }

  // 配额前置预警 (只对默认 AK)
  if (cfg.using_default) {
    const hash = akHash(cfg.api_key)
    const used = getRecentCallCount(hash)
    const remaining = IDEALAB_HOURLY_QUOTA - used
    if (product_paths.length > remaining) {
      fail(
        'QUOTA_PRECHECK',
        `默认 key 本小时已用 ${used}/${IDEALAB_HOURLY_QUOTA},剩 ${remaining} 次,你这批要 ${product_paths.length} 张,会超额`,
        [
          remaining > 0
            ? `先跑 ${remaining} 张?剩下的等下个小时或换 key`
            : '等 30-60 分钟后再试 (本小时配额已用完)',
          '换自己的付费 API key (例如 OpenAI / Gemini 的) 一次跑完',
          remaining > 0 ? `把数量减到 ${remaining} 张以下` : null,
        ].filter(Boolean),
      )
    }
  }

  // 准备输出目录
  ensureDir(output_dir)

  // auto_subdir: 在 output_dir 下建 batch-{YYYYMMDD-HHmmss}/ 子目录,
  // 让每次跑独立成文件夹,不会覆盖历史
  let effectiveOutputDir = output_dir
  if (auto_subdir) {
    const now = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    effectiveOutputDir = path.join(output_dir, `batch-${ts}`)
    ensureDir(effectiveOutputDir)
  }

  const templateBase64 = fs.readFileSync(template_image).toString('base64')
  const templateMime = guessMime(template_image)

  // 默认 AK 才记配额日志
  const akHashForLog = cfg.using_default ? akHash(cfg.api_key) : null

  // 进度落盘文件 — 每完成一张 append 一行,中断后可用 recover_results.js 拉回
  const progressFile = path.join(effectiveOutputDir, '_progress.jsonl')
  // 新一轮 batch 开始时清空旧 progress(避免跨轮混淆)
  try { fs.writeFileSync(progressFile, '') } catch { /* 忽略 */ }

  // 并发执行
  const conc = Math.max(1, Math.min(10, concurrency || 5))
  const total = product_paths.length
  let doneCount = 0
  const results = await runConcurrent(product_paths, conc, async (productPath, i) => {
    const r = await generateOne({
      productPath,
      productIndex: i,
      templateBase64,
      templateMime,
      prompt,
      cfg,
      output_dir: effectiveOutputDir,
      akHashForLog,
    })
    // 进度落盘 (失败也记,便于事后复盘)
    try {
      fs.appendFileSync(progressFile, JSON.stringify({ ts: Date.now(), ...r }) + '\n')
    } catch { /* 写日志失败不影响主流程 */ }
    // stderr 实时进度行 (人读 + 后台任务 TaskOutput 轮询)
    doneCount++
    const secs = ((r.duration_ms || 0) / 1000).toFixed(1)
    const mark = r.success ? '✓' : '✗'
    const tail = r.success
      ? `(${secs}s)`
      : `${(r.error || '').slice(0, 80)} (${secs}s)`
    process.stderr.write(`[generate_batch] ${doneCount}/${total} ${mark} ${r.product_id} ${tail}\n`)
    return r
  })

  const successCount = results.filter((r) => r.success).length
  const failedCount = results.length - successCount

  // 如果所有都失败且全是限流, 提示配额耗尽
  const all429 =
    failedCount === results.length &&
    results.every((r) => /429|限流|配额|IRC-001|MPE-429|周期|超过.*次/.test(r.error || ''))
  if (all429 && cfg.using_default) {
    fail(
      'QUOTA_EXHAUSTED',
      '本小时 ideaLAB 配额用完了 (每小时 10 次)',
      [
        '等 30-60 分钟后再试',
        '换自己的付费 API key (例如 OpenAI / Gemini 的) 一次跑完',
      ],
    )
  }

  ok({
    results,
    success_count: successCount,
    failed_count: failedCount,
    using_default_ak: cfg.using_default,
    effective_output_dir: effectiveOutputDir,
  })
}

// ─── 生图调用 ──────────────────────────────────────────────────────

const RATE_LIMIT_RETRY_DELAY_MS = 60_000

async function generateOne({
  productPath,
  productIndex,
  templateBase64,
  templateMime,
  prompt,
  cfg,
  output_dir,
  akHashForLog,
}) {
  const product_id = path.basename(productPath, path.extname(productPath))
  const t0 = Date.now()

  // 商品图只读一次
  let productBase64, productMime
  try {
    productBase64 = fs.readFileSync(productPath).toString('base64')
    productMime = guessMime(productPath)
  } catch (err) {
    return failResult(product_id, productPath, t0, `读取商品图失败: ${err.message}`)
  }

  const body = {
    model: cfg.model,
    modalities: ['TEXT', 'IMAGE'],
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${templateMime};base64,${templateBase64}` } },
          { type: 'image_url', image_url: { url: `data:${productMime};base64,${productBase64}` } },
        ],
      },
    ],
  }
  const url = `${cfg.base_url.replace(/\/$/, '')}/chat/completions`

  // 限流时 sleep 60s + 重试 1 次,仍失败按现有逻辑返回
  let didRetryRateLimit = false
  while (true) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60_000)
    let res
    try {
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${cfg.api_key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeout)
      }
    } catch (err) {
      return failResult(
        product_id,
        productPath,
        t0,
        err.name === 'AbortError' ? '超时 (60s)' : err.message || String(err),
      )
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      // ideaLAB 把 limit 错误用 HTTP 400 + IRC-001 表达,不是标准 429
      const isRateLimited =
        res.status === 429 ||
        text.includes('IRC-001') ||
        text.includes('MPE-429') ||
        text.includes('Throttling.AllocationQuota') ||
        /周期|配额|超过.*次/.test(text)
      if (isRateLimited && !didRetryRateLimit) {
        didRetryRateLimit = true
        process.stderr.write(
          `[generate_batch] ${product_id} rate-limited (HTTP ${res.status}), sleep ${RATE_LIMIT_RETRY_DELAY_MS / 1000}s and retry once\n`,
        )
        await new Promise((r) => setTimeout(r, RATE_LIMIT_RETRY_DELAY_MS))
        continue
      }
      if (isRateLimited) {
        return failResult(
          product_id,
          productPath,
          t0,
          `限流 (HTTP ${res.status}, 已 retry 1 次): ${text.slice(0, 200)}`,
        )
      }
      return failResult(product_id, productPath, t0, `HTTP ${res.status}: ${text.slice(0, 200)}`)
    }

    let json
    try {
      json = await res.json()
    } catch (err) {
      return failResult(product_id, productPath, t0, `解析响应失败: ${err.message}`)
    }
    const imageB64 = extractImageFromResponse(json)
    if (!imageB64) {
      const preview = JSON.stringify(json).slice(0, 400)
      process.stderr.write(`[generate_batch] no image in response for ${product_id}: ${preview}\n`)
      return failResult(
        product_id,
        productPath,
        t0,
        '响应里没找到图片 (检查 model 是否支持 image output)',
      )
    }

    const outName = `${String(productIndex + 1).padStart(2, '0')}-${product_id}.png`
    const outPath = path.join(output_dir, outName)
    try {
      fs.writeFileSync(outPath, Buffer.from(imageB64, 'base64'))
    } catch (err) {
      return failResult(product_id, productPath, t0, `写文件失败: ${err.message}`)
    }

    // 成功后记一次配额(只对默认 AK)
    if (akHashForLog) {
      try { appendCallLog(akHashForLog) } catch { /* 配额日志失败不影响主流程 */ }
    }

    return {
      product_id,
      source_image: productPath,
      output_image: outPath,
      success: true,
      duration_ms: Date.now() - t0,
    }
  }
}

function failResult(product_id, source, t0, error) {
  return { product_id, source_image: source, success: false, error, duration_ms: Date.now() - t0 }
}

/**
 * 从 OpenAI 兼容响应里提取生图结果 base64。
 * Gemini multimodal via chat completions 把图放在 message.content / images / etc.
 * 兼容几种常见格式 (实测 ideaLAB / OpenRouter 略有差异)
 */
function extractImageFromResponse(json) {
  const msg = json?.choices?.[0]?.message
  if (!msg) return null
  // 1. message.images: [{ url: "data:image/png;base64,..." }] 或 raw base64
  if (Array.isArray(msg.images) && msg.images[0]) {
    const u = msg.images[0].url || msg.images[0].image_url?.url
    const b = parseImageUrl(u)
    if (b) return b
  }
  // 2. message.content 是数组,里面有 image (ideaLAB 当前格式 — url 字段是 raw base64)
  if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if ((part.type === 'image_url' || part.type === 'image') && part.image_url?.url) {
        const b = parseImageUrl(part.image_url.url)
        if (b) return b
      }
      if (part.type === 'image' && part.image?.data) {
        return part.image.data
      }
    }
  }
  // 3. message.content 是 string 且含 data:image
  if (typeof msg.content === 'string') {
    const m = msg.content.match(/data:image\/[a-z]+;base64,([A-Za-z0-9+/=]+)/)
    if (m) return m[1]
  }
  return null
}

// 兼容两种 url:
//   "data:image/png;base64,iVBOR..."  → 取 base64 段
//   "iVBOR..."                        → 已经是 raw base64, 直接返回
function parseImageUrl(url) {
  if (!url || typeof url !== 'string') return null
  const m = url.match(/^data:image\/[a-z]+;base64,(.+)$/)
  if (m) return m[1]
  // raw base64: 长度 > 100 且只含 base64 字符
  if (url.length > 100 && /^[A-Za-z0-9+/]+=*$/.test(url.slice(0, 200))) return url
  return null
}

function guessMime(p) {
  const ext = path.extname(p).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'image/jpeg'
}

// ─── 并发控制 (简易 worker pool) ─────────────────────────────────────

async function runConcurrent(items, n, worker) {
  const results = new Array(items.length)
  let idx = 0
  const workers = Array.from({ length: n }, async () => {
    while (true) {
      const i = idx++
      if (i >= items.length) break
      results[i] = await worker(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

main().catch((err) => {
  process.stderr.write(`[generate_batch PANIC] ${err.stack || err.message}\n`)
  process.exit(1)
})
