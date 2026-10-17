/**
 * REQ-034 · 二期验收：**两帧像素差 / 两次渲染一致性**判定（本机 ffmpeg，零依赖）。
 *
 * 为什么需要它：Remotion 的确定性铁律（禁 CSS transition / 动画必须是纯函数）只靠读代码
 * 守不住 —— 必须真渲一次、量一次。本脚本给两个判据：
 *
 *   1. **帧间差 > 0**：同一份 manifest 的两个不同时间点必须不同（证明动画真的在动，
 *      而不是"声明了动画但被钉死"这类静默失效）；
 *   2. **两次渲染差 == 0**（可选）：同一份 manifest 渲两次、取同一帧，必须逐像素一致
 *      （证明确定性没被时钟 / 随机数污染）。
 *
 * 判据用 ffmpeg 的 `psnr` 滤镜：完全相同时输出 `average:inf`；不同则给出 dB 值。
 * 「不同」本身不设阈值 —— 只要不是 inf 就说明画面变了（我们只关心"动了没有"）。
 *
 * 跑法：
 *   node scripts/remotion-verify/frame-diff.mjs a.mp4 b.mp4 --at 2.0
 *   node scripts/remotion-verify/frame-diff.mjs a.mp4 b.mp4 --at 2.0 --expect=same
 *   node scripts/remotion-verify/frame-diff.mjs out/render-phase2.mp4 out/render-phase2-again.mp4 --at 2.0 --expect=same
 *
 * 退出码：判据不成立时 1（可直接串进验收脚本）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

function usage(message) {
  if (message !== undefined) console.error(`frame-diff: ${message}`)
  console.error('用法：node scripts/remotion-verify/frame-diff.mjs <a> <b> [--at 秒] [--expect=same|diff]')
  process.exit(2)
}

const argv = process.argv.slice(2)
const positional = argv.filter((arg) => !arg.startsWith('--'))
if (positional.length !== 2) usage('需要两个输入文件')

const atArg = argv.find((arg) => arg.startsWith('--at=')) ?? (argv.includes('--at') ? `--at=${argv[argv.indexOf('--at') + 1]}` : '--at=1.0')
const at = Number(atArg.split('=')[1])
if (!Number.isFinite(at) || at < 0) usage(`--at 需要非负秒数，收到 ${atArg}`)

const expectArg = argv.find((arg) => arg.startsWith('--expect='))
const expect = expectArg === undefined ? 'diff' : expectArg.split('=')[1]
if (expect !== 'same' && expect !== 'diff') usage(`--expect 只接受 same / diff，收到 ${expect}`)

const inputs = positional.map((item) => resolve(item))
for (const file of inputs) {
  if (!existsSync(file)) usage(`文件不存在：${file}`)
}

/** 找 ffmpeg：环境变量优先，其次 PATH。 */
function resolveFfmpeg() {
  const configured = process.env.CANVAS_STUDIO_FFMPEG ?? process.env.FFMPEG_PATH
  if (configured !== undefined && configured.length > 0) return configured
  return 'ffmpeg'
}

const ffmpeg = resolveFfmpeg()
const tempDir = mkdtempSync(join(tmpdir(), 'cs-frame-diff-'))
const frames = inputs.map((_, index) => join(tempDir, `frame-${index}.png`))

function run(args) {
  return spawnSync(ffmpeg, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

try {
  // 1) 各取一帧（同一起点 ⇒ 帧号一致，才谈得上"逐像素比较"）
  for (let i = 0; i < inputs.length; i += 1) {
    const grab = run(['-ss', at.toFixed(3), '-i', inputs[i], '-frames:v', '1', '-y', frames[i]])
    if (grab.status !== 0) {
      console.error(`frame-diff: 抽帧失败（${inputs[i]}）：${(grab.stderr ?? '').trim().split('\n').at(-1) ?? '未知原因'}`)
      process.exit(1)
    }
  }

  // 2) psnr 比较
  const compare = run(['-i', frames[0], '-i', frames[1], '-filter_complex', 'psnr', '-f', 'null', '-'])
  const output = `${compare.stderr ?? ''}\n${compare.stdout ?? ''}`
  const match = output.match(/average:\s*([0-9.]+|inf)/i)
  if (match === null) {
    console.error('frame-diff: 无法从 ffmpeg 输出中解析 PSNR —— 输出片段：')
    console.error(output.trim().split('\n').slice(-6).join('\n'))
    process.exit(1)
  }
  const average = match[1].toLowerCase()
  const identical = average === 'inf'

  console.log(`frame-diff @ ${at.toFixed(3)}s：PSNR average=${average} ⇒ ${identical ? '逐像素一致' : '画面不同'}`)
  if (expect === 'same' && !identical) {
    console.error('frame-diff ❌ 期望两次渲染一致（确定性），实际不同 —— 先查有没有 CSS transition / 随机数 / Date.now。')
    process.exit(1)
  }
  if (expect === 'diff' && identical) {
    console.error('frame-diff ❌ 期望两个时间点不同（动画生效），实际完全一致 —— 动画被钉死了。')
    process.exit(1)
  }
  console.log('frame-diff ✅ 判据成立')
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}
