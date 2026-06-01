#!/usr/bin/env node
/**
 * 从 output_dir/_progress.jsonl 恢复 results 数组。
 * 用于 generate_batch 中断时(panic / Ctrl-C)拉回已经成功的部分。
 *
 * 输入: { output_dir: "/abs/path" }
 * 输出: { results: [...], total, success_count, failed_count }
 */

const fs = require('fs')
const path = require('path')
const { readArgs, ok, fail } = require('./_lib')

const { output_dir } = readArgs()
if (!output_dir) fail('INVALID_ARGS', 'output_dir 必填')
const progressFile = path.join(output_dir, '_progress.jsonl')
if (!fs.existsSync(progressFile)) {
  fail('FILE_NOT_FOUND', `没找到 _progress.jsonl: ${progressFile}`, [
    'output_dir 路径对吗?',
    '可能这次 generate_batch 还没跑过,或者用的是老版本(无进度落盘)',
  ])
}

const results = []
const content = fs.readFileSync(progressFile, 'utf8')
for (const line of content.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed) continue
  try {
    const r = JSON.parse(trimmed)
    if (r && r.product_id) {
      // 剥掉 ts (那是 progress 元数据,不属于 result schema)
      const { ts: _ts, ...result } = r
      results.push(result)
    }
  } catch {
    /* 跳过损坏行 */
  }
}

const success_count = results.filter((r) => r.success).length
const failed_count = results.length - success_count

ok({ results, total: results.length, success_count, failed_count })
