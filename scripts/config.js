#!/usr/bin/env node
/**
 * 写入 .env: 保存 ideaLAB API key + 可选的 base_url / model 覆盖。
 *
 * 输入: { api_key?, base_url?, model? }
 * 输出: { message }
 *
 * 行为:
 *   - 至少要传一个字段
 *   - 已有 .env 时合并 (不删未传的字段)
 *   - .env 写完 chmod 0600 (仅 owner 读写)
 */

const fs = require('fs')
const path = require('path')
const { readArgs, ok, fail } = require('./_lib')

const args = readArgs()
const { api_key, base_url, model } = args

if (!api_key && !base_url && !model) {
  fail(
    'INVALID_ARGS',
    '没传任何要保存的字段',
    ['至少传 api_key (ideaLAB key) — 例如 { "api_key": "sk-xxxxx" }'],
  )
}

const skillDir = path.resolve(__dirname, '..')
const envFile = path.join(skillDir, '.env')

// 读已有 .env 合并
const existing = {}
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    existing[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
}

// 合并新值
if (api_key) existing.IDEALAB_API_KEY = api_key
if (base_url) existing.BANNER_SKILL_BASE_URL = base_url
if (model) existing.BANNER_SKILL_MODEL = model

// 写 .env (有引号包裹,防止特殊字符)
const lines = [
  '# BannerMorph skill 配置 - 由 config 工具自动管理',
  '# 不要手动改 IDEALAB_API_KEY 那一行 (会被覆盖)',
  '',
]
for (const [k, v] of Object.entries(existing)) {
  lines.push(`${k}="${v}"`)
}
fs.writeFileSync(envFile, lines.join('\n') + '\n')
// chmod 0600 (Unix only — Windows 自动忽略)
try {
  fs.chmodSync(envFile, 0o600)
} catch {
  /* ignore on Windows */
}

const updated = []
if (api_key) updated.push(`API key (末 4 位: ****${api_key.slice(-4)})`)
if (base_url) updated.push(`base_url: ${base_url}`)
if (model) updated.push(`model: ${model}`)

ok({
  message: `✅ 已保存配置: ${updated.join(', ')}。后续调用自动读取,无需再传。`,
  env_file: envFile,
})
