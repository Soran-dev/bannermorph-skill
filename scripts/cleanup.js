#!/usr/bin/env node
/**
 * 清理 BannerMorph 的本地缓存目录:
 *   - /tmp/bannermorph-products/   (Excel/URL 下载的商品图)
 *   - <skillDir>/work/             (import_template 复制的模板图)
 *
 * 输入: { days?: 7, dry_run?: false, extra_dirs?: string[] }
 * 输出: { scanned_dirs, deleted_files, total_freed_mb, errors, dry_run, days }
 *
 * 用法:
 *   node cleanup.js                                   # 默认清 7 天前的文件
 *   node cleanup.js '{"days":3,"dry_run":true}'       # 看 3 天前的清单不删
 *   node cleanup.js '{"days":30}'                     # 清 30 天前的
 *
 * 周期清理可加到 launchd / cron, 比如每周日凌晨 3 点:
 *   0 3 * * 0  node ~/.claude/skills/bannermorph/scripts/cleanup.js
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const { readArgs, ok } = require('./_lib')

const args = readArgs()
const days = Number.isFinite(args.days) ? args.days : 7
const dry_run = !!args.dry_run
const extraDirs = Array.isArray(args.extra_dirs) ? args.extra_dirs : []

const skillDir = path.resolve(__dirname, '..')
const targetDirs = [
  path.join(os.tmpdir(), 'bannermorph-products'),
  path.join(skillDir, 'work'),
  ...extraDirs,
]

const cutoff = Date.now() - days * 86400_000
const deletedFiles = []
const errors = []
let totalBytes = 0

for (const dir of targetDirs) {
  if (!fs.existsSync(dir)) continue
  let entries
  try {
    entries = fs.readdirSync(dir)
  } catch (err) {
    errors.push({ dir, reason: err.message })
    continue
  }
  for (const name of entries) {
    if (name.startsWith('.')) continue // 跳过 .quota-log / .DS_Store 等
    const p = path.join(dir, name)
    let st
    try {
      st = fs.statSync(p)
    } catch (err) {
      errors.push({ path: p, reason: err.message })
      continue
    }
    if (!st.isFile()) continue
    if (st.mtimeMs >= cutoff) continue

    totalBytes += st.size
    if (dry_run) {
      deletedFiles.push(p)
    } else {
      try {
        fs.unlinkSync(p)
        deletedFiles.push(p)
      } catch (err) {
        errors.push({ path: p, reason: err.message })
      }
    }
  }
}

ok({
  dry_run,
  days,
  scanned_dirs: targetDirs.filter((d) => fs.existsSync(d)),
  deleted_files: deletedFiles,
  total_freed_mb: +(totalBytes / 1024 / 1024).toFixed(2),
  errors,
})
