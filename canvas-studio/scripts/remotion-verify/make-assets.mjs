/**
 * REQ-034 · S10 验证器：造测试素材。
 *
 * 产出（落到本目录 `assets/`，gitignored、可随时重造）：
 *   - image.png   静态图（`ImageClip` 用）
 *   - clip.mp4    H.264 + AAC 的短片（`VideoClip` 用，**自带音轨**以验证 native 声）
 *   - bgm.mp4     AAC 音频（BGM）
 *   - voice.mp4   AAC 音频（旁白）
 *
 * 为什么用系统 ffmpeg：route B（CSR）不随包 `@remotion/compositor-*`，验证器不该为了
 * 造素材把 route A 的二进制拉进来。本机（arm64 Mac / homebrew）自带 ffmpeg/ffprobe。
 *
 * 跑法（用户终端）：
 *   NODE_OPTIONS= node scripts/remotion-verify/make-assets.mjs
 *   如需指定二进制：FFMPEG_PATH=/opt/homebrew/bin/ffmpeg FFPROBE_PATH=/opt/homebrew/bin/ffprobe ...
 */

import { mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { log, ok, requireBinary, run } from './lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ASSETS = join(HERE, 'assets')

const WIDTH = 1280
const HEIGHT = 720
const FPS = 30

function main() {
  const ffmpeg = requireBinary('FFMPEG_PATH', 'ffmpeg')
  mkdirSync(ASSETS, { recursive: true })

  // 1) image.png —— 渐变底 + 一块高亮，便于肉眼确认 ImageClip 的 fit / kenburns。
  run(
    ffmpeg,
    [
      '-y',
      '-f', 'lavfi',
      '-i', `color=c=0x101a2e:s=${WIDTH}x${HEIGHT}`,
      '-vf', 'drawbox=x=0:y=0:w=1280:h=360:color=0x1b2a4a:t=fill,drawbox=x=90:y=90:w=1100:h=540:color=0x4f9cf9@0.28:t=fill',
      '-frames:v', '1',
      join(ASSETS, 'image.png'),
    ],
    '生成 image.png',
  )

  // 2) clip.mp4 —— testsrc2 画面 + 440Hz 正弦音轨（自带音轨，验证 `<Video>` 原声）。
  run(
    ffmpeg,
    [
      '-y',
      '-f', 'lavfi', '-i', `testsrc2=s=${WIDTH}x${HEIGHT}:r=${FPS}`,
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
      '-t', '6',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-shortest',
      join(ASSETS, 'clip.mp4'),
    ],
    '生成 clip.mp4',
  )

  // 3) bgm.mp4 / voice.mp4 —— 纯音频（AAC）。
  run(
    ffmpeg,
    ['-y', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000', '-t', '8', '-c:a', 'aac', join(ASSETS, 'bgm.mp4')],
    '生成 bgm.mp4',
  )
  run(
    ffmpeg,
    ['-y', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000', '-t', '4', '-c:a', 'aac', join(ASSETS, 'voice.mp4')],
    '生成 voice.mp4',
  )

  for (const name of ['image.png', 'clip.mp4', 'bgm.mp4', 'voice.mp4']) {
    const file = join(ASSETS, name)
    if (!existsSync(file)) throw new Error(`素材未生成：${file}`)
    ok(name)
  }
  log('素材就绪：', ASSETS)
}

main()
