#!/usr/bin/env node
/**
 * 把临时位置的图(比如 ~/.claude/image-cache/<session>/<n>.png)
 * 复制到 skill 内的稳定位置,后续步骤用稳定路径,不怕被清理。
 *
 * 输入: { source: "/abs/path/to/image" }
 * 输出: { stable_path, original_path, size_bytes, ext }
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { readArgs, ok, fail, ensureDir } = require('./_lib')

const SUPPORTED_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']

function main() {
  const { source } = readArgs()
  if (!source || typeof source !== 'string') {
    fail('INVALID_ARGS', 'source 字段必填,要传图片绝对路径', [
      '比如 {"source":"/Users/.../template.png"}',
    ])
  }

  const abs = path.resolve(source)
  if (!fs.existsSync(abs)) {
    fail('FILE_NOT_FOUND', `图片不存在: ${source}`)
  }

  const ext = path.extname(abs).toLowerCase()
  if (!SUPPORTED_EXTS.includes(ext)) {
    fail('INVALID_FORMAT', `不支持的图片格式 ${ext || '(无扩展名)'}`, [
      `支持的格式: ${SUPPORTED_EXTS.join(', ')}`,
    ])
  }

  const buf = fs.readFileSync(abs)
  const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8)

  const skillDir = path.resolve(__dirname, '..')
  const workDir = path.join(skillDir, 'work')
  ensureDir(workDir)

  const stableName = `template-${Date.now()}-${hash}${ext}`
  const stablePath = path.join(workDir, stableName)
  fs.copyFileSync(abs, stablePath)

  ok({
    stable_path: stablePath,
    original_path: abs,
    size_bytes: buf.length,
    ext: ext.slice(1),
  })
}

main()
