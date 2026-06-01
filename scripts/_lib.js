/**
 * 共用工具 — 所有 script 的入口/输出/配置加载。
 *
 * 约定:
 *   - 输入: process.argv[2] 是 JSON 字符串 (或 stdin pipe)
 *   - 成功输出: JSON.stringify(obj) 到 stdout, exit 0
 *   - 错误输出: { error: CODE, message, next_steps? } 到 stdout, exit 0
 *     (这样 LLM 拿到 stdout 永远能 parse,不用看 exit code)
 *   - 内部 panic (不应该发生): exit 1 + stderr
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

/** 读输入参数: process.argv[2] 是 JSON 字符串, 或 --- 表示从 stdin 读 */
function readArgs() {
  const arg = process.argv[2]
  if (!arg || arg === '---') {
    // 从 stdin 读
    const raw = fs.readFileSync(0, 'utf8')
    return raw ? JSON.parse(raw) : {}
  }
  try {
    return JSON.parse(arg)
  } catch {
    panic('INVALID_ARGS', `第一个参数应该是 JSON 字符串, 收到: ${arg.slice(0, 80)}`)
  }
}

/** 成功输出 */
function ok(data) {
  process.stdout.write(JSON.stringify(data, null, 2))
  process.exit(0)
}

/** 业务错误 (用户能理解的) - LLM 应转述给用户 */
function fail(code, message, next_steps = []) {
  process.stdout.write(
    JSON.stringify({ error: code, message, next_steps }, null, 2),
  )
  process.exit(0)
}

/** 内部 panic (bug, 不该发生) */
function panic(code, message) {
  process.stderr.write(`[BannerMorph PANIC ${code}] ${message}\n`)
  process.exit(1)
}

/**
 * 加载 .env 配置 (skill 目录里的)
 * 返回 { IDEALAB_API_KEY, BANNER_SKILL_BASE_URL, BANNER_SKILL_MODEL }
 * 优先级: 显式 env > .env 文件 > 默认值
 */
function loadEnv() {
  const skillDir = path.resolve(__dirname, '..')
  const envFile = path.join(skillDir, '.env')
  const fromFile = {}
  if (fs.existsSync(envFile)) {
    const content = fs.readFileSync(envFile, 'utf8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      // 去掉引号
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      fromFile[key] = value
    }
  }
  return {
    IDEALAB_API_KEY: process.env.IDEALAB_API_KEY || fromFile.IDEALAB_API_KEY,
    BANNER_SKILL_BASE_URL:
      process.env.BANNER_SKILL_BASE_URL ||
      fromFile.BANNER_SKILL_BASE_URL ||
      'https://idealab.alibaba-inc.com/api/openai/v1',
    BANNER_SKILL_MODEL:
      process.env.BANNER_SKILL_MODEL ||
      fromFile.BANNER_SKILL_MODEL ||
      'gemini-3.1-flash-image-preview',
  }
}

/** 解析最终生效的 api_config (合并用户传入 + .env + 默认) */
function resolveApiConfig(userConfig = {}) {
  const env = loadEnv()
  const base_url = userConfig.base_url || env.BANNER_SKILL_BASE_URL
  const api_key = userConfig.api_key || env.IDEALAB_API_KEY
  const model = userConfig.model || env.BANNER_SKILL_MODEL
  const using_default = !userConfig.base_url && !userConfig.api_key
  return { base_url, api_key, model, using_default }
}

/** 校验 api_key 是否已配置, 没配则返回友好错误并退出 */
function ensureApiKey(cfg) {
  if (!cfg.api_key) {
    fail(
      'AK_NOT_CONFIGURED',
      '还没配置 API key',
      ['告诉我你的 ideaLAB key (格式 sk-xxxxx),我帮你保存到本地'],
    )
  }
}

/** ensureDir: 递归创建目录 */
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

/** 默认配额 (ideaLAB 默认 AK) */
const IDEALAB_BATCH_LIMIT = 10
const IDEALAB_HOURLY_QUOTA = 10
const QUOTA_WINDOW_MS = 3600_000

/** AK 哈希 (sha256 前 16 位 hex), 永不存明文 — 跟 v3 api.ts:30 同款 */
function akHash(key) {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16)
}

function _quotaLogPath() {
  return path.join(path.resolve(__dirname, '..'), '.quota-log')
}

/** 把一次 API 调用 append 到 .quota-log (JSON Lines) — 顺手清理 24h 之前的旧记录 */
function appendCallLog(hash) {
  const file = _quotaLogPath()
  const cutoff = Date.now() - 24 * 3600_000
  const records = _readQuotaRecords().filter((r) => r.ts >= cutoff)
  records.push({ hash, ts: Date.now() })
  fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n')
}

/** 读 .quota-log 文件,容错 */
function _readQuotaRecords() {
  const file = _quotaLogPath()
  if (!fs.existsSync(file)) return []
  const content = fs.readFileSync(file, 'utf8')
  const records = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const r = JSON.parse(trimmed)
      if (r && typeof r.hash === 'string' && typeof r.ts === 'number') records.push(r)
    } catch {
      /* 跳过损坏行 */
    }
  }
  return records
}

/** 返回最近 windowMs 内某个 hash 的调用次数 */
function getRecentCallCount(hash, windowMs = QUOTA_WINDOW_MS) {
  const cutoff = Date.now() - windowMs
  return _readQuotaRecords().filter((r) => r.hash === hash && r.ts >= cutoff).length
}

/** 返回最近 windowMs 内某 hash 的所有调用时间戳 (升序) */
function getRecentCalls(hash, windowMs = QUOTA_WINDOW_MS) {
  const cutoff = Date.now() - windowMs
  return _readQuotaRecords()
    .filter((r) => r.hash === hash && r.ts >= cutoff)
    .map((r) => r.ts)
    .sort((a, b) => a - b)
}

module.exports = {
  readArgs,
  ok,
  fail,
  panic,
  loadEnv,
  resolveApiConfig,
  ensureApiKey,
  ensureDir,
  akHash,
  appendCallLog,
  getRecentCallCount,
  getRecentCalls,
  IDEALAB_BATCH_LIMIT,
  IDEALAB_HOURLY_QUOTA,
  QUOTA_WINDOW_MS,
}
