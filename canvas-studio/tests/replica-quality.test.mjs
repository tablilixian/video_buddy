/**
 * 复刻提效批（B1/B2/Q1/V1）：甜品复刻会话根因修复的契约单测。
 *
 * - B1 `detectImageAlpha`：PNG colorType 4/6 / WebP VP8X alpha 位 / 非 alpha 格式 / 坏文件；
 * - B2 `lintMotion` ML-13：文本卡时空双重叠 → 报；反向变异（错位 / 错时）→ 不报；
 * - Q1 `parseEbur128IntegratedLufs`：多行 I: 取最后（Summary）、无音频 → undefined；
 *   真 ffmpeg E2E：正弦波 wav → 返回有限 LUFS；
 * - V1 `normalizeSpotFrames`：钳制 / 去重 / 升序 / 上限 8 / 非法输入。
 *
 * 直连 Host tsc 编译产物 `lib/*.js`。定向跑：corepack yarn build && node --test tests/replica-quality.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectImageAlpha } from '../lib/remotion/asset-check.js'
import { lintMotion } from '../lib/remotion/motion-lint.js'
import { parseEbur128IntegratedLufs, probeLoudnessLufs } from '../lib/ffmpeg-run.js'
import { normalizeSpotFrames } from '../lib/remotion/render-job.js'

/** 尽力而为的临时目录清理 —— 受管环境下 unlink 可能被安全删除守卫拒绝，清理失败不算测试失败。 */
function cleanupDir(dir) {
  try {
    cleanupDir(dir)
  } catch {
    // 留给操作系统 tmp 清理。
  }
}

// ───────────────────────── B1：alpha 探测 ─────────────────────────

/** 手工拼一张 PNG 头（8 字节魔数 + IHDR，colorType 可指定）。 */
function pngWithColorType(colorType) {
  const buf = Buffer.alloc(33)
  buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47
  buf[4] = 0x0d; buf[5] = 0x0a; buf[6] = 0x1a; buf[7] = 0x0a
  // IHDR 长度 + 类型
  buf.writeUInt32BE(13, 8); buf.write('IHDR', 12, 'latin1')
  buf.writeUInt32BE(8, 16); buf.writeUInt32BE(8, 20)
  buf[24] = 8 // bit depth
  buf[25] = colorType
  return buf
}

/** 手工拼 WebP 头：RIFF....WEBP + VP8X（flags 可指定）。 */
function webpWithFlags(flags) {
  const buf = Buffer.alloc(21)
  buf.write('RIFF', 0, 'latin1'); buf.write('WEBP', 8, 'latin1'); buf.write('VP8X', 12, 'latin1')
  buf[20] = flags
  return buf
}

test('B1 detectImageAlpha：PNG colorType 4/6 → true，2 → false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'alpha-'))
  try {
    const rgba = join(dir, 'rgba.png')
    const gray = join(dir, 'gray.png')
    const rgb = join(dir, 'rgb.png')
    writeFileSync(rgba, pngWithColorType(6))
    writeFileSync(gray, pngWithColorType(4))
    writeFileSync(rgb, pngWithColorType(2))
    assert.equal(detectImageAlpha(rgba), true, 'RGBA PNG 应判有 alpha')
    assert.equal(detectImageAlpha(gray), true, '灰度+α PNG 应判有 alpha')
    assert.equal(detectImageAlpha(rgb), false, 'RGB PNG 无 alpha')
  } finally {
    cleanupDir(dir)
  }
})

test('B1 detectImageAlpha：WebP VP8X alpha 位；坏文件 / 不存在 → false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'alpha-'))
  try {
    const withAlpha = join(dir, 'a.webp')
    const without = join(dir, 'b.webp')
    const broken = join(dir, 'broken.png')
    writeFileSync(withAlpha, webpWithFlags(0x10))
    writeFileSync(without, webpWithFlags(0x00))
    writeFileSync(broken, Buffer.from('not a png at all'))
    assert.equal(detectImageAlpha(withAlpha), true, 'VP8X alpha 位应判有 alpha')
    assert.equal(detectImageAlpha(without), false)
    assert.equal(detectImageAlpha(broken), false, '非 PNG/WebP → false')
    assert.equal(detectImageAlpha(join(dir, 'missing.png')), false, '不存在 → false')
  } finally {
    cleanupDir(dir)
  }
})

// ───────────────────────── B2：ML-13 文本卡重叠 ─────────────────────────

/** 最小 textCard（lintMotion 是纯函数，只读用到的字段）。 */
function textCard(id, { startFrame = 0, durationInFrames = 60, box }) {
  return { id, type: 'textCard', variant: 'title', text: ['标题'], startFrame, durationInFrames, box }
}
function manifestOf(tracks) {
  return { meta: { durationInFrames: 300, fps: 30 }, tracks }
}

test('B2 ML-13：两张文本卡时空双重叠 → 报', () => {
  const issues = lintMotion(manifestOf([
    textCard('t1', { box: { x: 50, y: 50, w: 40, h: 30 } }),
    textCard('t2', { box: { x: 55, y: 55, w: 40, h: 30 } }),
  ]))
  const ml13 = issues.filter((issue) => issue.code === 'ML-13')
  assert.equal(ml13.length, 1, `期望 1 条 ML-13，实得 ${JSON.stringify(issues.map((i) => i.code))}`)
  assert.equal(ml13[0].at, 't1 × t2')
  assert.match(ml13[0].message, /时间与空间双重叠/)
})

test('B2 ML-13 反向变异：空间错开 / 时间错开 → 不报', () => {
  // 空间错开：y 完全分离
  const apart = lintMotion(manifestOf([
    textCard('t1', { box: { x: 50, y: 30, w: 40, h: 20 } }),
    textCard('t2', { box: { x: 50, y: 80, w: 40, h: 20 } }),
  ]))
  assert.equal(apart.filter((i) => i.code === 'ML-13').length, 0, '空间分离不该报')
  // 时间错开：不重叠
  const disjoint = lintMotion(manifestOf([
    textCard('t1', { box: { x: 50, y: 50, w: 40, h: 30 } }),
    textCard('t2', { startFrame: 120, durationInFrames: 60, box: { x: 50, y: 50, w: 40, h: 30 } }),
  ]))
  assert.equal(disjoint.filter((i) => i.code === 'ML-13').length, 0, '时间不重叠不该报')
  // 小面积相交（<35%）不该报
  const slight = lintMotion(manifestOf([
    textCard('t1', { box: { x: 50, y: 50, w: 40, h: 30 } }),
    textCard('t2', { box: { x: 70, y: 80, w: 40, h: 30 } }),
  ]))
  assert.equal(slight.filter((i) => i.code === 'ML-13').length, 0, '轻微搭边不该报')
})

// ───────────────────────── Q1：响度解析 ─────────────────────────

test('Q1 parseEbur128IntegratedLufs：多行 I: 取最后（Summary），无匹配 → undefined', () => {
  const stderr = [
    '  Embedded metadata: none',
    '[Parsed_ebur128_0 @ 0x0] t: 1.0  TARGET:-23 LUFS    M: -18.5 S: -19.2     I: -19.4 LUFS',
    '[Parsed_ebur128_0 @ 0x0] t: 2.0  TARGET:-23 LUFS    M: -17.9 S: -18.8     I: -18.9 LUFS',
    '  Summary:',
    '  Integrated loudness:',
    '    I:         -15.3 LUFS',
    '    LRA:       1.4 LU',
  ].join('\n')
  assert.equal(parseEbur128IntegratedLufs(stderr), -15.3)
  assert.equal(parseEbur128IntegratedLufs('nothing here'), undefined)
  assert.equal(parseEbur128IntegratedLufs(''), undefined)
})

test('Q1 probeLoudnessLufs E2E：正弦波 wav → 有限 LUFS', { timeout: 60000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'loud-'))
  try {
    const wav = join(dir, 'tone.wav')
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '0.5', wav])
    const lufs = await probeLoudnessLufs(wav)
    assert.equal(typeof lufs, 'number', `期望测得有限 LUFS，实得 ${String(lufs)}`)
    assert.ok(lufs > -60 && lufs < 0, `LUFS 应在 (-60, 0)，实测 ${lufs}`)
  } finally {
    cleanupDir(dir)
  }
})

// ───────────────────────── V1：spotFrames 收口 ─────────────────────────

test('V1 normalizeSpotFrames：钳制 / 去重 / 升序 / 上限 8', () => {
  assert.deepEqual(normalizeSpotFrames([30, 10, 30, 7], 300), [7, 10, 30])
  assert.deepEqual(normalizeSpotFrames([-5, 999], 300), [0, 299], '越界钳到片长内')
  assert.deepEqual(normalizeSpotFrames([1.4, 2.6], 300), [1, 3], '四舍五入到整数帧')
  assert.deepEqual(normalizeSpotFrames([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 300), [0, 1, 2, 3, 4, 5, 6, 7], '上限 8 张')
  assert.deepEqual(normalizeSpotFrames('not array', 300), [])
  assert.deepEqual(normalizeSpotFrames([Number.NaN, undefined, 'x'], 300), [])
  assert.deepEqual(normalizeSpotFrames([50], 1), [0], '片长 1 帧 → 只能是帧 0')
})
