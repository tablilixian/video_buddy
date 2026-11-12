/**
 * RQ-13 · ffmpeg 帧解码适配（CLI 专用；不进单测 —— 单测在 metrics.mjs 纯函数层）。
 *
 * ffmpeg 从 PATH 解析（`/opt/homebrew/bin` 硬编码是 /tmp 旧脚本的不可复跑根因，
 * 进仓一律 `which` 查找）；解码为灰度 rawvideo（`scale=W:H,format=gray`）。
 */
import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'

/** 解析 ffmpeg 路径（PATH 查找；找不到抛出带安装提示的错误）。 */
export function resolveFfmpeg(): string {
  try {
    return execFileSync('which', ['ffmpeg'], { encoding: 'utf8' }).trim()
  } catch {
    throw new Error('找不到 ffmpeg —— 请先安装（brew install ffmpeg）并确保在 PATH 中')
  }
}

/** 迭代视频的灰度帧（W×H Uint8Array）。 */
export async function* grayFrames(file: string, width = 320, height = 180): AsyncGenerator<Uint8Array> {
  const ffmpeg = resolveFfmpeg()
  const frameBytes = width * height
  const child = spawn(ffmpeg, [
    '-v', 'error',
    '-i', file,
    '-vf', `scale=${width}:${height}:flags=bilinear,format=gray`,
    '-f', 'rawvideo',
    '-',
  ], { stdio: ['ignore', 'pipe', 'inherit'] })
  let pending = Buffer.alloc(0)
  for await (const chunk of child.stdout) {
    pending = pending.length > 0 ? Buffer.concat([pending, chunk]) : chunk
    while (pending.length >= frameBytes) {
      yield new Uint8Array(pending.subarray(0, frameBytes))
      pending = pending.subarray(frameBytes)
    }
  }
}
