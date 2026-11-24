/**
 * A1 响度交付闸（2026-11-24）。
 *
 * 起因：`media-probe` 早就在量 `lufs`，但全仓**没有一处拿它做阈值判断** —— 2026-11-04
 * 科普 0.1 验收那次事故（TTS −27 LUFS → 成片 −22.0 → loudnorm 重混 → −14.0，自检全绿
 * 而片子是废的）缺的就是一个 `if`。本文件钉住三件事：
 *
 *   ① 判据分级：削波（真峰 > −1.5 dBTP）与音轨丢失是**不可逆**的 ⇒ 硬拒；
 *      响度超界能靠 loudnorm 修 ⇒ 只标注。「未测得」单列，不当成合格。
 *   ② 拒收的后果：`deliver/final.mp4` **不被覆盖**（上一版不被废片顶掉），但 card.json
 *      照写 —— 拒绝的理由必须落盘，否则「deliver/ 为什么没更新」只能靠猜。
 *   ③ 未传 loudness 时行为与 A1 之前**逐字段一致**（缺省不判 = 放行）。
 *
 * 直连 Host tsc 编译产物 `lib/*.js`；全量走 `yarn test:smoke`。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  DELIVER_LUFS_TARGET,
  DELIVER_TRUE_PEAK_CEILING_DBTP,
  deliveryReceiptLines,
  evaluateLoudnessGate,
  writeDeliverable,
} from '../lib/deliverable.js'
import { parseEbur128TruePeakDbtp, probeLoudness } from '../lib/ffmpeg-run.js'

/** 受管环境下 unlink 可能被拒，清理失败不算测试失败。 */
function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // 留给操作系统 tmp 清理。
  }
}

function fixtureDir() {
  const dir = mkdtempSync(join(tmpdir(), 'a1-loudness-'))
  writeFileSync(join(dir, 'source.mp4'), 'fake-mp4-bytes', 'utf8')
  return dir
}

function baseInput(dir, overrides = {}) {
  return {
    projectDir: dir,
    sourceFile: join(dir, 'source.mp4'),
    url: '/canvas-studio/assets/p/x.mp4',
    assetFile: 'x.mp4',
    nodeId: 'node-1',
    durationSec: 30,
    width: 1920,
    height: 1080,
    fps: 30,
    quality: 'standard',
    manifestHash: createHash('sha256').update('{}').digest('hex').slice(0, 16),
    anchorVersion: 3,
    targetDurationSec: 30,
    openIssues: '音色未锁',
    now: 1794620546663,
    ...overrides,
  }
}

/** 一次达标的实测（−16 LUFS / −2 dBTP / 有轨 / 声明有轨）。 */
const HEALTHY = { lufs: -16, truePeakDbtp: -2, hasAudio: true, expectsAudio: true }

// ─────────────────── ① 判据分级（纯函数） ───────────────────

test('A1 判据：达标样本放行，四项红旗全 false、issues 全空', () => {
  const gate = evaluateLoudnessGate(HEALTHY)
  assert.equal(gate.deliverable, true)
  assert.equal(gate.audioMissing, false)
  assert.equal(gate.truePeakOver, false)
  assert.equal(gate.lufsOutOfRange, false)
  assert.equal(gate.unmeasured, false)
  assert.deepEqual(gate.blockers, [])
  assert.deepEqual(gate.warnings, [])
})

test('A1 判据：响度超界是**软**标注（能 loudnorm 修），照交付', () => {
  // −22 LUFS 正是 2026-11-04 那次事故的成片值：差 6 LU，必须被看见，但不必拒收。
  const gate = evaluateLoudnessGate({ ...HEALTHY, lufs: DELIVER_LUFS_TARGET - 6 })
  assert.equal(gate.lufsOutOfRange, true)
  assert.equal(gate.deliverable, true, '响度超界不许升级成拒收 —— 削波才不可逆')
  assert.equal(gate.blockers.length, 0)
  assert.equal(gate.warnings.length, 1)
  assert.match(gate.warnings[0], /-22 LUFS/u)
  assert.match(gate.warnings[0], /loudnorm/u, '标注必须给出可执行的修法')
})

test('A1 判据：真峰超 −1.5 dBTP 是**硬**拒收（削波不可逆）', () => {
  const gate = evaluateLoudnessGate({ ...HEALTHY, truePeakDbtp: -1.0 })
  assert.equal(gate.truePeakOver, true)
  assert.equal(gate.deliverable, false)
  assert.match(gate.blockers[0], /削波不可逆/u)
  // 边界：恰好 −1.5 不算超（判据是 > 而非 >=）
  assert.equal(evaluateLoudnessGate({ ...HEALTHY, truePeakDbtp: DELIVER_TRUE_PEAK_CEILING_DBTP }).truePeakOver, false)
})

test('A1 判据：声明有音轨而实测无音轨 = 硬拒收；本来就无声的片子不冤判', () => {
  const missing = evaluateLoudnessGate({ ...HEALTHY, hasAudio: false, lufs: null, truePeakDbtp: null })
  assert.equal(missing.audioMissing, true)
  assert.equal(missing.deliverable, false)
  assert.equal(missing.unmeasured, false, '音轨都没有就别谈「响度未测得」了，那是两件事')
  assert.match(missing.blockers[0], /旁白\/BGM 全丢/u)

  const silentByDesign = evaluateLoudnessGate({ ...HEALTHY, expectsAudio: false, hasAudio: false, lufs: null, truePeakDbtp: null })
  assert.equal(silentByDesign.audioMissing, false, "audioComposition='none' 的片子本来就没有音轨")
  assert.equal(silentByDesign.deliverable, true)
})

test('A1 判据：响度未测得单列 unmeasured，不当成合格（也不拦）', () => {
  const gate = evaluateLoudnessGate({ ...HEALTHY, lufs: null })
  assert.equal(gate.unmeasured, true)
  assert.equal(gate.deliverable, true, '环境测不到不等于片子废 —— 不能因为 ffmpeg 挂了就拒收')
  assert.match(gate.warnings.join('\n'), /本项未判，不等于合格/u)
})

// ─────────────────── ② 真峰解析（纯函数） ───────────────────

/** 真实 `ffmpeg -af ebur128=peak=true` 的尾部（2026-11-24 本机 sine 样本原样拷贝）。 */
const EBUR_TAIL = `[Parsed_ebur128_0 @ 0x148204980] t: 2.999979   TARGET:-23 LUFS    M: -27.8 S: -27.8     I: -27.8 LUFS       LRA:  20.0 LU  FTPK: -27.1 -27.1 dBFS  TPK: -27.1 -27.1 dBFS
[Parsed_ebur128_0 @ 0x148204980] Summary:

  Integrated loudness:
    I:         -27.8 LUFS
    Threshold: -37.8 LUFS

  Loudness range:
    LRA:        20.0 LU
    Threshold: -47.8 LUFS
    LRA low:   -47.8 LUFS
    LRA high:  -27.8 LUFS

  True peak:
    Peak:      -27.1 dBFS
`

test('A1 解析：真峰取 Summary 的 True peak 段，不被实时行的 TPK 骗到', () => {
  assert.equal(parseEbur128TruePeakDbtp(EBUR_TAIL), -27.1)
})

test('A1 解析：静音产物报 Peak: -inf ⇒ 未测得（undefined），不许当 0 dBTP', () => {
  const silent = `${EBUR_TAIL.split('  True peak:')[0]}  True peak:\n    Peak:      -inf dBFS\n`
  assert.equal(parseEbur128TruePeakDbtp(silent), undefined,
    '把 -inf 读成 0 会让静音片被判成「真峰顶格」而误拒')
})

test('A1 解析：没有 True peak 段（peak=none 的老输出）⇒ undefined，不抛', () => {
  const noPeak = '  Integrated loudness:\n    I:         -15.3 LUFS\n'
  assert.equal(parseEbur128TruePeakDbtp(noPeak), undefined)
})

// ─────────────────── ③ 拒收的后果（写盘行为） ───────────────────

test('A1 落盘：硬拒收 ⇒ 不写 final.mp4，但 card.json 照写并留全套实测值', () => {
  const dir = fixtureDir()
  try {
    const result = writeDeliverable(baseInput(dir, {
      loudness: { ...HEALTHY, truePeakDbtp: -0.3 },
    }))
    assert.equal(result.written, true, '卡必须写 —— 拒绝的理由不落盘就只能靠猜')
    assert.equal(result.rejected, true)
    assert.equal(existsSync(join(dir, 'deliver', 'final.mp4')), false, '被拒的片不许占据权威交付路径')
    const card = JSON.parse(readFileSync(join(dir, 'deliver', 'card.json'), 'utf8'))
    assert.equal(card.verdict.deliverable, false)
    assert.match(card.verdict.blockers.join('\n'), /削波不可逆/u)
    assert.equal(card.loudnessCheck.measuredTruePeakDbtp, -0.3)
    assert.equal(card.loudnessCheck.truePeakOver, true)
    assert.equal(card.loudnessCheck.targetLufs, DELIVER_LUFS_TARGET, '阈值一并落盘，读卡不必翻源码')
    assert.equal(card.pointers.url, '/canvas-studio/assets/p/x.mp4', '成片指向 assets，不陪葬')
  } finally {
    cleanup(dir)
  }
})

test('A1 落盘：拒收不覆盖上一版 final.mp4，并把它标成 stale（别当本次产物）', () => {
  const dir = fixtureDir()
  try {
    // 先交付一版达标的
    const first = writeDeliverable(baseInput(dir, { loudness: HEALTHY }))
    assert.equal(first.rejected, false)
    const before = readFileSync(join(dir, 'deliver', 'final.mp4'), 'utf8')
    assert.equal(before, 'fake-mp4-bytes')

    // 再交付一版真峰削波的：final.mp4 必须原封不动
    writeFileSync(join(dir, 'source.mp4'), 'second-render-bytes', 'utf8')
    const second = writeDeliverable(baseInput(dir, { loudness: { ...HEALTHY, truePeakDbtp: 0.5 } }))
    assert.equal(second.rejected, true)
    assert.equal(second.finalIsStale, true)
    assert.equal(readFileSync(join(dir, 'deliver', 'final.mp4'), 'utf8'), 'fake-mp4-bytes',
      '上一版合格的 final.mp4 不许被削波废片顶掉')
    assert.equal(JSON.parse(readFileSync(join(dir, 'deliver', 'card.json'), 'utf8')).verdict.finalIsStale, true)
  } finally {
    cleanup(dir)
  }
})

test('A1 落盘：达标 ⇒ final.mp4 照写，verdict 通过，响度明细进卡', () => {
  const dir = fixtureDir()
  try {
    const result = writeDeliverable(baseInput(dir, { loudness: { ...HEALTHY, lufs: -13.5 } }))
    assert.equal(result.rejected, false)
    assert.equal(readFileSync(join(dir, 'deliver', 'final.mp4'), 'utf8'), 'fake-mp4-bytes')
    const card = JSON.parse(readFileSync(join(dir, 'deliver', 'card.json'), 'utf8'))
    assert.equal(card.verdict.deliverable, true)
    assert.deepEqual(card.verdict.blockers, [])
    assert.equal(card.loudnessCheck.lufsOutOfRange, true, '软标注照进卡（交付了但用户该知道）')
    assert.equal(card.loudnessCheck.measuredLufs, -13.5)
  } finally {
    cleanup(dir)
  }
})

test('A1 兼容：不传 loudness ⇒ 行为与 A1 之前逐字段一致（不判即放行）', () => {
  const dir = fixtureDir()
  try {
    const result = writeDeliverable(baseInput(dir))
    assert.equal(result.rejected, false)
    assert.equal(result.loudness, null)
    assert.equal(readFileSync(join(dir, 'deliver', 'final.mp4'), 'utf8'), 'fake-mp4-bytes')
    const card = JSON.parse(readFileSync(join(dir, 'deliver', 'card.json'), 'utf8'))
    assert.equal(card.verdict.deliverable, true, '没测过 = 不判 = 放行，不许凭空降级既有交付')
    assert.equal(card.loudnessCheck, undefined, '没测就别造一段空明细（读卡的人会以为是「测了全过」）')
  } finally {
    cleanup(dir)
  }
})

// ─────────────────── ④ 回执文案 ───────────────────

test('A1 回执：拒收走 ❌ 且说清 final.mp4 未更新；达标走 📦 并带软标注', () => {
  const dir = fixtureDir()
  try {
    const rejected = deliveryReceiptLines(writeDeliverable(baseInput(dir, {
      loudness: { ...HEALTHY, truePeakDbtp: 0.2 },
    })))
    assert.match(rejected[0], /^❌ 权威交付被拒/u)
    assert.ok(rejected.some(line => line.startsWith('❌ ') && /削波不可逆/u.test(line)))
    assert.ok(!rejected.some(line => line.startsWith('📦')), '拒收就别说「已交付」')

    const ok = deliveryReceiptLines(writeDeliverable(baseInput(dir, {
      projectDir: dir, loudness: { ...HEALTHY, lufs: -22 },
    })))
    assert.match(ok[0], /^📦 权威交付/u)
    assert.ok(ok.some(line => line.startsWith('⚠️ ') && /loudnorm/u.test(line)))
  } finally {
    cleanup(dir)
  }
})

// ─────────────────── ⑤ 真 ffmpeg E2E ───────────────────

test('A1 E2E：真 ffmpeg 能同时测出 LUFS 与真峰（解析器对着真实输出验一次）', { timeout: 60000 }, async (t) => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
  } catch {
    t.skip('本机无 ffmpeg，跳过 E2E（纯函数与写盘分支已覆盖）')
    return
  }
  const dir = mkdtempSync(join(tmpdir(), 'a1-ffmpeg-'))
  try {
    const wav = join(dir, 'tone.wav')
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '0.5', wav])
    const probe = await probeLoudness(wav)
    assert.equal(probe.hasAudio, true)
    assert.equal(typeof probe.lufs, 'number', `期望测得 LUFS，实得 ${String(probe.lufs)}`)
    assert.equal(typeof probe.truePeakDbtp, 'number',
      `期望测得真峰，实得 ${String(probe.truePeakDbtp)} —— peak=true 没生效或解析正则对不上真实输出`)
    assert.ok(probe.truePeakDbtp < 0, '正弦波样本的真峰必然是负值（dBFS 相对满刻度）')
  } finally {
    cleanup(dir)
  }
})
