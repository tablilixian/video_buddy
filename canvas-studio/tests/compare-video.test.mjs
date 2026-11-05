/**
 * CV-445 S4 对比片测试 —— argv 纯函数双向变异 + 真 ffmpeg E2E + 能力地图 schema。
 * （能力地图校验独立成文件 capabilities-schema.test.mjs；这里只测 make_compare。）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildCompareArgs,
  decideCompareLabels,
  defaultCompareOutPath,
  makeCompareVideo,
  COMPARE_CELL_W,
  COMPARE_CELL_H,
} from '../lib/compare-video.js'

// ───────────────── 纯函数 ─────────────────

test('S4：buildCompareArgs —— hstack 双信箱 + 标签 + 时长取较短者 + 音频取复刻', () => {
  const args = buildCompareArgs(
    { originalPath: '/a/orig.mp4', remakePath: '/b/remake.mp4', outPath: '/b/compare.mp4' },
    { originalSec: 20, remakeSec: 15.5 },
  )
  const chain = args[args.indexOf('-filter_complex') + 1]
  assert.ok(chain.includes('hstack=inputs=2'), chain)
  assert.ok(chain.includes(`scale=${COMPARE_CELL_W}:${COMPARE_CELL_H}:force_original_aspect_ratio=decrease`), chain)
  // 仓里有随包 CJK 字体 → 中文标签；断言两种合法形态之一
  const hasCjk = chain.includes('原片') && chain.includes('复刻') && chain.includes('fontfile=')
  const hasAscii = chain.includes('ORIGINAL') && chain.includes('REMAKE') && !chain.includes('fontfile=')
  assert.ok(hasCjk !== hasAscii, `标签形态应二选一，实得 ${chain}`)
  const tIndex = args.indexOf('-t')
  assert.notEqual(tIndex, -1)
  assert.equal(args[tIndex + 1], '15.500')
  // -map 在 -t 之前输出，按值整体断言两个映射流
  const mapValues = args.filter((arg, i) => args[i - 1] === '-map')
  assert.deepEqual(mapValues, ['[v]', '1:a?'], `视频取滤镜输出、音频应取复刻片（输入 1），实得 ${JSON.stringify(mapValues)}`)
  assert.equal(args[args.length - 1], '/b/compare.mp4')
})

test('S4：buildCompareArgs —— 探不到时长时不加 -t（降级自然结束）', () => {
  const args = buildCompareArgs(
    { originalPath: '/a.mp4', remakePath: '/b.mp4', outPath: '/c.mp4' },
    {},
  )
  assert.equal(args.indexOf('-t'), -1)
})

test('S4：decideCompareLabels —— 字体缺失退 ASCII 标签', () => {
  const labels = decideCompareLabels('/nonexistent/font.ttf')
  assert.equal(labels.left, 'ORIGINAL')
  assert.equal(labels.right, 'REMAKE')
  assert.equal(labels.fontFile, undefined)
})

test('S4：defaultCompareOutPath —— 缺省复刻片同目录 compare.mp4', () => {
  assert.equal(defaultCompareOutPath('/x/y/remake.mp4'), '/x/y/compare.mp4')
  assert.equal(defaultCompareOutPath('/x/y/remake.mp4', '/z/out.mp4'), '/z/out.mp4')
})

// ───────────────── 真 ffmpeg E2E ─────────────────

function resolveSystemFfmpeg() {
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (dir === '') continue
    const candidate = join(dir, 'ffmpeg')
    if (existsSync(candidate)) return candidate
  }
  return null
}

test('S4 E2E：makeCompareVideo 产出可播的并排对比片（真 ffmpeg）', async () => {
  const ffmpeg = resolveSystemFfmpeg()
  if (ffmpeg === null) {
    console.log('  skip：PATH 上无系统 ffmpeg')
    return
  }
  const dir = mkdtempSync(join(tmpdir(), 'compare-'))
  try {
    const original = join(dir, 'orig.mp4')
    const remake = join(dir, 'remake.mp4')
    execFileSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=red:size=320x240:rate=10:duration=2',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-y', original,
    ], { timeout: 60_000 })
    execFileSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=blue:size=640x360:rate=10:duration=3',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-y', remake,
    ], { timeout: 60_000 })
    const result = await makeCompareVideo({ originalPath: original, remakePath: remake, ffmpegPath: ffmpeg })
    assert.ok(existsSync(result.outPath))
    assert.equal(result.outPath, join(dirname(remake), 'compare.mp4'))
    assert.ok(Math.abs((result.durationSec ?? 0) - 2) < 0.2, `时长应取较短者 ≈2s，实得 ${result.durationSec}`)
    assert.ok((result.durationSec ?? 0) > 0)
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* 清理尽力而为 */ }
  }
})
