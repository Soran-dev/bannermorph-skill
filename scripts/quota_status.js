#!/usr/bin/env node
/**
 * 查看默认 ideaLAB AK 本小时已用配额。
 *
 * 输入: 无 (直接 node quota_status.js)
 * 输出: { used_last_hour, limit, remaining, reset_estimate_at, recent_calls: [iso...] }
 *
 * 说明:
 *   - 只统计默认 AK (用户自带 key 不在本表里)
 *   - .quota-log 存的是 hash, 不存明文 key
 *   - reset_estimate_at = 最早一次调用 + 1h, 即"那一次最早从滑动窗口里掉出去的时间"
 */

const {
  ok,
  fail,
  resolveApiConfig,
  akHash,
  getRecentCalls,
  IDEALAB_HOURLY_QUOTA,
  QUOTA_WINDOW_MS,
} = require('./_lib')

const cfg = resolveApiConfig({})
if (!cfg.api_key) {
  fail('AK_NOT_CONFIGURED', '还没配置默认 ideaLAB key', [
    '先调 config.js 保存 api_key',
  ])
}

const hash = akHash(cfg.api_key)
const calls = getRecentCalls(hash, QUOTA_WINDOW_MS)
const used = calls.length
const remaining = Math.max(0, IDEALAB_HOURLY_QUOTA - used)

let resetEstimateAt = null
if (calls.length > 0) {
  resetEstimateAt = new Date(calls[0] + QUOTA_WINDOW_MS).toISOString()
}

ok({
  using_default_ak: cfg.using_default,
  used_last_hour: used,
  limit: IDEALAB_HOURLY_QUOTA,
  remaining,
  reset_estimate_at: resetEstimateAt,
  recent_calls: calls.map((ts) => new Date(ts).toISOString()),
})
