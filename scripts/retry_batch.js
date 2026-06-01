#!/usr/bin/env node
/**
 * 重做指定的几张图 (复用 generate_batch 的核心逻辑)。
 *
 * 输入:
 *   template_image
 *   products_to_retry: [{ product_id, product_image_path }]
 *   base_prompt: 上次用的 prompt
 *   prompt_addons?: LLM 根据上次 issues 总结的修正
 *   output_dir: 跟上次同一个目录 (会覆盖)
 *   api_config?
 *
 * 输出: 同 generate_batch
 *
 * 实现: 把 products_to_retry → product_paths,prompt = base_prompt + addons,
 *       复用 generate_batch 逻辑。
 */

const { spawnSync } = require('child_process')
const path = require('path')
const { readArgs, ok, fail } = require('./_lib')

const args = readArgs()
const {
  template_image,
  products_to_retry,
  base_prompt,
  prompt_addons,
  output_dir,
  api_config,
  concurrency,
} = args

if (!template_image) fail('INVALID_ARGS', 'template_image 必填')
if (!Array.isArray(products_to_retry) || products_to_retry.length === 0) {
  fail('INVALID_ARGS', 'products_to_retry 必填且不能为空', [
    '格式: [{ product_id, product_image_path }, ...]',
  ])
}
if (!base_prompt) fail('INVALID_ARGS', 'base_prompt 必填')
if (!output_dir) fail('INVALID_ARGS', 'output_dir 必填')

// 拼最终 prompt
const finalPrompt = prompt_addons
  ? `${base_prompt}\n\n# 本轮 retry 重点强化\n${prompt_addons}`
  : base_prompt

// 提取 product_paths
const product_paths = products_to_retry
  .map((p) => p.product_image_path)
  .filter(Boolean)

if (product_paths.length === 0) {
  fail('INVALID_ARGS', 'products_to_retry 里没有有效的 product_image_path')
}

// 调用 generate_batch
const generateScript = path.resolve(__dirname, 'generate_batch.js')
const payload = {
  template_image,
  product_paths,
  prompt: finalPrompt,
  output_dir,
  concurrency,
  api_config,
}
const proc = spawnSync('node', [generateScript, JSON.stringify(payload)], {
  encoding: 'utf8',
  maxBuffer: 100 * 1024 * 1024,
})
if (proc.status !== 0) {
  fail('RETRY_FAILED', 'retry 子流程异常退出', [
    `stderr: ${proc.stderr?.slice(0, 200)}`,
    'stdout: ' + proc.stdout?.slice(0, 200),
  ])
}
const result = JSON.parse(proc.stdout)
// 透传结果 (generate_batch 已经写盘了)
ok(result)
