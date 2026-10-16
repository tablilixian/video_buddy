/**
 * REQ-034 · S10 验证器公共小工具（造素材 / 探真值 / 日志）。
 *
 * 目的：给 `make-assets.mjs` 与 `verify.mjs` 共用「解析 ffmpeg/ffprobe、探测媒体流」的能力，
 * 避免把系统二进制路径判断散落各处。**不改产品代码、不依赖 Remotion 的 compositor**
 * （本机有系统 ffmpeg；没有则显式报错并给出 `FFMPEG_PATH` 指引）。
 */

import { spawnSync } from 'node:child_process'

export const log = (...args) => console.log('[s10]', ...args)
export const ok = (label) => console.log('[s10] ✅', label)
export const warn = (label) => console.log('[s10] ⚠️', label)

/** 解析 ffmpeg / ffprobe：待测环境优先 `FFMPEG_PATH` / `FFPROBE_PATH`，否则走 PATH。 */
export function resolveBinary(envKey, name) {
  const explicit = process.env[envKey]
  if (explicit) return explicit
  const found = spawnSync('command', ['-v', name], { shell: true })
  if (found.status === 0) return found.stdout.toString().trim()
  return null
}

export function requireBinary(envKey, name) {
  const bin = resolveBinary(envKey, name)
  if (!bin) {
    throw new Error(
      `找不到 ${name}。请安装系统 ${name}，或用 ${envKey}=/abs/path/${name} 指定绝对路径。`,
    )
  }
  return bin
}

/** 运行一条命令，非 0 退出即抛错（附最后若干行输出）。 */
export function run(bin, args, label) {
  const result = spawnSync(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.status !== 0) {
    const err = `${result.stderr ?? ''}`.trim().split('\n').slice(-8).join('\n')
    throw new Error(`${label ?? bin} 失败（exit ${result.status}）：\n${err}`)
  }
  return result
}

/** 用 ffprobe 列出媒体流（`codec_type:codec_name`）与容器时长（秒）。 */
export function probe(file, ffprobe = 'ffprobe') {
  const json = spawnSync(
    ffprobe,
    [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,codec_name',
      '-show_entries', 'format=duration',
      '-of', 'json',
      file,
    ],
    { encoding: 'utf8' },
  )
  if (json.status !== 0) return { streams: [], durationSec: null, raw: json.stderr }
  try {
    const parsed = JSON.parse(json.stdout)
    const streams = (parsed.streams ?? []).map((s) => `${s.codec_type}:${s.codec_name}`)
    const durationSec = parsed.format?.duration ? Number(parsed.format.duration) : null
    return { streams, durationSec, raw: json.stdout }
  } catch (error) {
    return { streams: [], durationSec: null, raw: `${error}` }
  }
}
