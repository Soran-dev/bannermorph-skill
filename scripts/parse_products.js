#!/usr/bin/env node
/**
 * 解析 4 种商品来源 → 统一的本地图片路径列表。
 *
 * 输入: { source: { image|folder|excel|url }, cache_dir? }
 * 输出: { product_paths: string[], count: number }
 *
 * 行为:
 *   - image: 直接返回 [path]
 *   - folder: 列文件夹下所有图片 (jpg/jpeg/png/webp/gif)
 *   - excel: xlsx 解析,找像 URL 的列,下载到 cache_dir
 *   - url: 单 URL 下载到 cache_dir
 *
 * SSRF 防护: URL 必须 http/https, hostname 不能是私网 (复用 v3 的简化版)
 */

const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const os = require('os')
const net = require('net')
const dns = require('dns/promises')
const { readArgs, ok, fail, ensureDir } = require('./_lib')

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']
const FETCH_TIMEOUT_MS = 20_000
const MAX_REMOTE_IMAGE_BYTES = 15 * 1024 * 1024 // 15MB

async function main() {
  const { source, cache_dir, allow_partial } = readArgs()
  if (!source || typeof source !== 'object') {
    fail('INVALID_ARGS', 'source 字段必填', [
      '传 source: { image|folder|excel|url|urls } 中任选其一',
    ])
  }
  const cacheDir = cache_dir || path.join(os.tmpdir(), 'bannermorph-products')
  ensureDir(cacheDir)

  let result = { paths: [], failed: [], expected: null }
  if (source.image) {
    result.paths = await fromImage(source.image)
  } else if (source.folder) {
    result.paths = await fromFolder(source.folder)
  } else if (source.excel) {
    result = await fromExcel(source.excel, cacheDir)
  } else if (Array.isArray(source.urls)) {
    result = await fromUrls(source.urls, cacheDir)
  } else if (source.url) {
    result.paths = await fromUrl(source.url, cacheDir)
  } else {
    fail('INVALID_ARGS', 'source 必须包含 image / folder / excel / url / urls 中至少一个', [
      '检查你传的 source 字段',
    ])
  }

  if (result.paths.length === 0) {
    fail('NO_PRODUCTS', '没找到任何商品图片', [
      '检查路径 / 文件夹里有没有图 / Excel 里有没有图片 URL 列',
    ])
  }

  // 部分下载失败 — 默认拒绝(避免静默丢图),allow_partial=true 才放行
  if (result.failed && result.failed.length > 0) {
    if (!allow_partial) {
      const failPreview = result.failed.slice(0, 5).map((f) => `${f.url} → ${f.reason}`)
      fail(
        'PARTIAL_DOWNLOAD_FAILED',
        `从源里找到 ${result.expected} 张图,只成功下载 ${result.paths.length} 张,${result.failed.length} 张失败`,
        [
          `失败清单 (前 5 条): ${JSON.stringify(failPreview)}`,
          '如果用户同意"成功多少算多少",重新调用本脚本时加 "allow_partial": true',
          '如果用户希望全部下完,先排查失败 URL(可能是网络抖动 → retry,或源失效 → 让用户换 URL)',
        ],
      )
    }
    // allow_partial=true 时仍要在结果里如实暴露
    ok({
      product_paths: result.paths,
      count: result.paths.length,
      expected: result.expected,
      failed: result.failed,
      partial: true,
    })
  }

  ok({ product_paths: result.paths, count: result.paths.length })
}

async function fromImage(imagePath) {
  const abs = path.resolve(imagePath)
  if (!fs.existsSync(abs)) fail('FILE_NOT_FOUND', `图片不存在: ${imagePath}`)
  const ext = path.extname(abs).toLowerCase()
  if (!IMAGE_EXTS.includes(ext)) {
    fail('INVALID_FORMAT', `不支持的图片格式 ${ext}`, [
      `支持的格式: ${IMAGE_EXTS.join(', ')}`,
    ])
  }
  return [abs]
}

async function fromFolder(folder) {
  const abs = path.resolve(folder)
  if (!fs.existsSync(abs)) fail('FILE_NOT_FOUND', `文件夹不存在: ${folder}`)
  const stat = fs.statSync(abs)
  if (!stat.isDirectory()) fail('INVALID_FORMAT', `不是文件夹: ${folder}`)
  const files = fs.readdirSync(abs).filter((f) => IMAGE_EXTS.includes(path.extname(f).toLowerCase()))
  return files.map((f) => path.join(abs, f)).sort()
}

async function fromExcel(excelPath, cacheDir) {
  const abs = path.resolve(excelPath)
  if (!fs.existsSync(abs)) fail('FILE_NOT_FOUND', `Excel 不存在: ${excelPath}`)
  let XLSX
  try {
    XLSX = require('xlsx')
  } catch {
    fail('DEPENDENCY_MISSING', '缺 xlsx 依赖', ['在 skill 目录跑 `npm install`'])
  }
  const workbook = XLSX.read(fs.readFileSync(abs), { type: 'buffer' })
  const urls = []
  // 图片直链:扩展名结尾 (允许 query string 跟在后面)
  const IMAGE_URL_RE = /^https?:\/\/.+\.(jpg|jpeg|png|webp|gif|bmp)(\?.*)?$/i
  const isImageHeader = (cell) =>
    typeof cell === 'string' && /image|img|photo|picture|主图|图片|图像/i.test(cell)

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
    if (!data || data.length === 0) continue

    // 表头行检测:扫前 10 行,看哪一行的 cell 含图片关键字 (兜底用)
    const SCAN = Math.min(10, data.length)
    let headerIdx = 0
    for (let i = 0; i < SCAN; i++) {
      if ((data[i] || []).some(isImageHeader)) {
        headerIdx = i
        break
      }
    }

    // 优先策略:数据采样 — 扫每列前 5 个数据行,看 cell 是否像图片直链
    // 至少 2 个 cell 命中,该列就当图片 URL 列
    const dataStartRow = headerIdx + 1
    const sampleRowCount = Math.min(5, data.length - dataStartRow)
    const headerRow = data[headerIdx] || []
    const colCount = Math.max(headerRow.length, ...data.slice(dataStartRow, dataStartRow + sampleRowCount).map((r) => (r || []).length))
    const imageCols = []
    for (let c = 0; c < colCount; c++) {
      let hits = 0
      for (let r = dataStartRow; r < dataStartRow + sampleRowCount; r++) {
        const cell = (data[r] || [])[c]
        if (typeof cell === 'string' && IMAGE_URL_RE.test(cell.trim())) hits++
      }
      if (hits >= 2) imageCols.push(c)
    }

    // 兜底策略:数据采样没识别到任何列 → 用列名启发式
    if (imageCols.length === 0) {
      headerRow.forEach((cell, idx) => {
        if (isImageHeader(cell)) imageCols.push(idx)
      })
    }

    if (imageCols.length === 0) continue

    // 收集 URL — 每行只取第一个非空 (含 http/https) URL,放宽匹配 (兼容数据列识别后的非严格直链)
    for (let r = dataStartRow; r < data.length; r++) {
      const row = data[r] || []
      for (const c of imageCols) {
        const cell = row[c]
        if (typeof cell === 'string' && /^https?:\/\//i.test(cell.trim())) {
          urls.push(cell.trim())
          break
        }
      }
    }
  }
  // 去重
  const unique = [...new Set(urls)]
  if (unique.length === 0) {
    fail('NO_PRODUCTS', 'Excel 里没找到图片 URL', [
      '检查表里是否有图片直链列 (URL 以 .jpg / .png / .webp / .gif 等扩展名结尾)',
      '或列名包含 image / img / photo / picture / 主图 / 图片 / 图像',
    ])
  }
  // 并发下载 — 抽出来给 fromExcel / fromUrls 共用,失败列表如实暴露
  return await batchDownload(unique, cacheDir)
}

async function batchDownload(urls, cacheDir) {
  const results = []
  const errors = []
  await Promise.all(
    urls.map(async (url, i) => {
      try {
        results[i] = await downloadOne(url, cacheDir)
      } catch (e) {
        errors.push({ url, reason: e.message })
      }
    }),
  )
  const downloaded = results.filter(Boolean)
  if (downloaded.length === 0) {
    fail(
      'DOWNLOAD_FAILED',
      `所有 ${urls.length} 张图片下载失败`,
      errors.slice(0, 5).map((e) => `${e.url} → ${e.reason}`),
    )
  }
  return { paths: downloaded, failed: errors, expected: urls.length }
}

async function fromUrls(urls, cacheDir) {
  const cleaned = [...new Set(urls.map((u) => (typeof u === 'string' ? u.trim() : '')).filter(Boolean))]
  if (cleaned.length === 0) {
    fail('INVALID_ARGS', 'source.urls 不能是空数组', ['传至少 1 个图片 URL'])
  }
  return await batchDownload(cleaned, cacheDir)
}

async function fromUrl(url, cacheDir) {
  try {
    const p = await downloadOne(url, cacheDir)
    return [p]
  } catch (e) {
    fail('DOWNLOAD_FAILED', `URL 下载失败: ${e.message}`, ['检查网络 / URL 是否能直接访问'])
  }
}

// ─── SSRF + 下载 ──────────────────────────────────────────────────────

function isPrivateIp(ip) {
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase()
    if (lower === '::1' || lower === '::') return true
    if (lower.startsWith('fe80:') || /^f[cd]/.test(lower)) return true
    const v4 = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (v4) return isPrivateIp(v4[1])
    return false
  }
  if (!net.isIPv4(ip)) return false
  const [a, b] = ip.split('.').map(Number)
  if (a === 0 || a === 127 || a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 169 && b === 254) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

async function assertPublicUrl(url) {
  let u
  try {
    u = new URL(url)
  } catch {
    throw new Error('URL 格式错')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('只允许 http(s)')
  const hostname = u.hostname.toLowerCase()
  if (hostname === 'localhost') throw new Error('不允许 localhost')
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error(`私网 IP ${hostname}`)
    return
  }
  const records = await dns.lookup(hostname, { all: true, verbatim: false })
  for (const r of records) {
    if (isPrivateIp(r.address)) throw new Error(`hostname 解析到私网 IP ${r.address}`)
  }
}

async function downloadOne(url, cacheDir) {
  await assertPublicUrl(url)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 BannerMorph/1.0',
      },
      redirect: 'follow',
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const cl = Number(res.headers.get('content-length') || 0)
    if (cl > MAX_REMOTE_IMAGE_BYTES) {
      throw new Error(`文件过大 ${(cl / 1024 / 1024).toFixed(1)}MB`)
    }
    const ct = res.headers.get('content-type') || ''
    let ext = '.jpg'
    if (ct.includes('png')) ext = '.png'
    else if (ct.includes('webp')) ext = '.webp'
    else if (ct.includes('gif')) ext = '.gif'
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_REMOTE_IMAGE_BYTES) {
      throw new Error(`文件过大 ${(buf.length / 1024 / 1024).toFixed(1)}MB`)
    }
    if (buf.length < 1024) throw new Error('文件过小,可能不是有效图片')
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
    const localPath = path.join(cacheDir, filename)
    await fsp.writeFile(localPath, buf)
    return localPath
  } finally {
    clearTimeout(timeoutId)
  }
}

main().catch((err) => {
  process.stderr.write(`[parse_products PANIC] ${err.stack || err.message}\n`)
  process.exit(1)
})
