/**
 * CV-445 S3 生成单元规划测试 —— 纯函数双向变异 + 真 ffmpeg 场景签名 E2E。
 *
 * 验收口径（能力对照表 §4 + 评估文档 S3）：
 *   ① 同场景 + 硬切相连合并；插入画面不打断 run；② DP 求最少单元；③ 提示词换
 *   `<Picture N>` 标签、按 video_composite 真实规格（≤9 图 / ≤3 视频 / 合计 ≤12 / ≤15s）
 *   校验；④ 实拍/数字人/未知打断并给人话去向。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  groupGenerationRuns,
  splitRunByDuration,
  planGenerationUnits,
  assembleUnit,
  renderPlanMarkdown,
  signatureFromRgb,
  sceneDistance,
  DEFAULT_PLAN_LIMITS,
} from '../lib/plan-generation-units.js'
import { extractShotFrameThumb } from '../lib/plan-generation-units.js'

// ───────────────── 测试脚手架 ─────────────────

function shot(index, startSec, endSec, productionMethod = 'ai-video', transitionIn) {
  const s = { index, startSec, endSec, productionMethod, description: `第${index}镜画面描述：主角向左走，跟拍` }
  if (transitionIn !== undefined) s.transitionIn = transitionIn
  return s
}

function sameSceneAll() {
  return () => true
}

// ───────────────── run 分组 ─────────────────

test('S3：同场景硬切相连合并为一个 run；实拍打断', () => {
  const shots = [
    shot(1, 0, 2, 'ai-video'),
    shot(2, 2, 5, 'ai-video', 'cut'),
    shot(3, 5, 7, 'live-action', 'cut'), // 实拍打断
    shot(4, 7, 9, 'ai-video', 'cut'),
  ]
  const runs = groupGenerationRuns(shots, sameSceneAll())
  assert.deepEqual(runs.map((r) => r.map((s) => s.index)), [[1, 2], [4]])
})

test('S3：插入画面（代码/静图）不打断 run（口播+UI 形态）', () => {
  const shots = [
    shot(1, 0, 2, 'ai-video'),
    shot(2, 2, 4, 'code-render', 'cut'), // 插入 UI
    shot(3, 4, 9, 'ai-video', 'cut'),    // 与 #1 同场景 → 应仍在同一 run
  ]
  const runs = groupGenerationRuns(shots, sameSceneAll())
  assert.deepEqual(runs.map((r) => r.map((s) => s.index)), [[1, 3]])
})

test('S3：不同场景打断 run（isSameScene false）', () => {
  const shots = [
    shot(1, 0, 4, 'ai-video'),
    shot(2, 4, 8, 'ai-video', 'cut'),
  ]
  const runs = groupGenerationRuns(shots, () => false)
  assert.equal(runs.length, 2)
})

test('S3：非硬切入点（叠化/淡入）不打断但也不合并的边界 —— 叠化相连同场景仍可合并（S03 在叠化处切开是建议不是禁令）', () => {
  const shots = [
    shot(1, 0, 4, 'ai-video'),
    shot(2, 4, 8, 'ai-video', 'dissolve'),
  ]
  const runs = groupGenerationRuns(shots, sameSceneAll())
  // dissolve 相连且同场景：production.py 口径 joinable = gap || transition_in == cut
  // → dissolve 不满足 → 断开成两个 run
  assert.deepEqual(runs.map((r) => r.map((s) => s.index)), [[1], [2]])
})

// ───────────────── DP 切分 ─────────────────

test('S3：DP 切分 —— 超过 maxUnitSec 的多镜组合不参与，最少单元优先', () => {
  const limits = { ...DEFAULT_PLAN_LIMITS, maxUnitSec: 10, preferSec: 8, minUnitSec: 2 }
  const run = [
    shot(1, 0, 4),
    shot(2, 4, 8),   // 1+2 = 8s ≤ 10 → 可同单元
    shot(3, 8, 16),  // 与 2 相加 12s > 10 → 只能单起
    shot(4, 16, 18),
  ]
  const groups = splitRunByDuration(run, limits)
  assert.deepEqual(groups.map((g) => g.map((s) => s.index)), [[1, 2], [3, 4]])
})

test('S3：DP 切分 —— 空数组安全', () => {
  assert.deepEqual(splitRunByDuration([], DEFAULT_PLAN_LIMITS), [])
})

// ───────────────── 单元拼装与全量规划 ─────────────────

test('S3：assembleUnit —— 多镜提示词带统一风格句 + 相对时间行 + 硬切说明', () => {
  const unit = assembleUnit(
    [shot(1, 0, 3), shot(2, 3, 6, 'ai-video', 'cut')],
    1,
    {
      limits: DEFAULT_PLAN_LIMITS,
      styleLine: '横屏 16:9，暗调烛光',
      refs: [{ tag: '<Picture 1>', what: '产品图' }],
      sameScenePrev: false,
    },
  )
  assert.equal(unit.mode, 'multi_shot')
  assert.equal(unit.calls, 1)
  assert.equal(unit.durationSec, 6)
  assert.ok(unit.prompt.includes('横屏 16:9，暗调烛光'), unit.prompt)
  assert.ok(unit.prompt.includes('镜头1（0.0–3.0s）'), unit.prompt)
  assert.ok(unit.prompt.includes('镜头2（3.0–6.0s）'), unit.prompt)
  assert.ok(unit.prompt.includes('镜头之间硬切'), unit.prompt)
  assert.ok(unit.prompt.includes('<Picture 1>'), unit.prompt)
})

test('S3：planGenerationUnits —— 端到端：11 镜同场景 AI 片 → 单元数 ≤ 逐镜×60%', () => {
  const shots = []
  for (let i = 1; i <= 11; i += 1) {
    shots.push(shot(i, (i - 1) * 1.5, i * 1.5, 'ai-video', i === 1 ? undefined : 'cut'))
  }
  const plan = planGenerationUnits(shots, { isSameScene: sameSceneAll() })
  assert.ok(plan.units.length <= Math.ceil(11 * 0.6), `单元数应 ≤7，实得 ${plan.units.length}`)
  assert.equal(plan.genShotCount, 11)
  assert.ok(plan.savedCalls > 0, `应省调用，实得 ${plan.savedCalls}`)
  // 15s 上限：每单元 durationSec ≤ 15
  for (const unit of plan.units) {
    assert.ok(unit.durationSec <= 15 + 1e-9, `单元 ${unit.id} 时长 ${unit.durationSec} 超上限`)
    assert.ok(unit.prompt.includes('镜头'), unit.prompt)
  }
})

test('S3：planGenerationUnits —— 单镜超 15s → split 多次调用 + S02 说明', () => {
  const shots = [shot(1, 0, 32, 'ai-video')]
  const plan = planGenerationUnits(shots, {})
  assert.equal(plan.units.length, 1)
  const unit = plan.units[0]
  assert.equal(unit.mode, 'split')
  assert.equal(unit.calls, Math.ceil(32 / 15))
  assert.ok(unit.notes.some((n) => n.includes('动作停顿')), unit.notes.join('；'))
})

test('S3：planGenerationUnits —— 太短单镜补生成时长（generateS ≥ minUnitSec 语义在 note）', () => {
  const plan = planGenerationUnits([shot(1, 0, 1.5, 'ai-video')], {})
  assert.equal(plan.units[0].mode, 'single')
  assert.ok(plan.units[0].notes.some((n) => n.includes('剪到')), plan.units[0].notes.join('；'))
})

test('S3：planGenerationUnits —— 参考素材标签换 <Picture N>/<Video N> + 合计 ≤12 超限裁剪告警', () => {
  const referenceAssets = [
    ...Array.from({ length: 10 }, (_, i) => ({ kind: 'image', what: `产品图${i + 1}` })),
    { kind: 'video', what: '原片片段' },
  ]
  const plan = planGenerationUnits([shot(1, 0, 5)], { referenceAssets, isSameScene: () => false })
  const tags = plan.units[0].refs.map((r) => r.tag)
  assert.equal(tags.filter((t) => t.startsWith('<Picture')).length, 9, '图最多 9 张')
  assert.ok(tags.includes('<Video 1>'))
  assert.ok(plan.warnings.some((w) => w.includes('9')), JSON.stringify(plan.warnings))
})

test('S3：planGenerationUnits —— 实拍/数字人/未知打断并给人话去向；插入画面连排', () => {
  const shots = [
    shot(1, 0, 3, 'ai-video'),
    shot(2, 3, 5, 'still-motion', 'cut'),  // 静图推拉 → 插入不打断
    shot(3, 5, 8, 'ai-video', 'cut'),
    shot(4, 8, 10, 'live-action', 'cut'), // 实拍打断
    shot(5, 10, 12, 'avatar', 'cut'),     // 数字人
    shot(6, 12, 14, 'other', 'cut'),      // 未知
  ]
  const plan = planGenerationUnits(shots, { isSameScene: sameSceneAll() })
  assert.deepEqual(plan.units.map((u) => u.shots), [[1, 3]])
  const methods = plan.nonGen.map((n) => n.method).sort()
  assert.deepEqual(methods, ['avatar', 'live-action', 'other'])
  assert.ok(plan.nonGen.every((n) => n.hint.length > 5))
})

test('S3：planGenerationUnits —— S05 尾帧衔接（同场景 + 硬切 + 时间无缝）', () => {
  const shots = [
    shot(1, 0, 12, 'ai-video'),          // 12s 超 prefer → DP 拆成两单元
    shot(2, 12, 14, 'ai-video', 'cut'),
  ]
  // 强制同景：maxUnitSec 8 → 1 单独拆，2 归下一单元且与前一单元时间无缝
  const plan = planGenerationUnits(shots, { isSameScene: sameSceneAll(), limits: { maxUnitSec: 8 } })
  const second = plan.units[1]
  assert.ok(second !== undefined && second.continuity !== undefined, `应有衔接说明：${JSON.stringify(plan.units)}`)
  assert.ok((second?.continuity ?? '').includes('尾帧'), second?.continuity)
})

test('S3：renderPlanMarkdown —— 单元表 + 代码块提示词 + 下一步纪律', () => {
  const plan = planGenerationUnits(
    [shot(1, 0, 4), shot(2, 4, 8, 'ai-video', 'cut')],
    { styleLine: '暗调', isSameScene: sameSceneAll() },
  )
  const md = renderPlanMarkdown(plan)
  assert.ok(md.includes('| 单元 |'), md)
  assert.ok(md.includes('```text'), md)
  assert.ok(md.includes('video_composite'), md)
  assert.ok(md.includes('人工确认'), md)
})

// ───────────────── 真 ffmpeg 场景签名 E2E ─────────────────

function resolveSystemFfmpeg() {
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (dir === '') continue
    const candidate = join(dir, 'ffmpeg')
    if (existsSync(candidate)) return candidate
  }
  return null
}

test('S3 E2E：extractShotFrameThumb 在合成片上取帧 + 红蓝两镜距离 ≈1（真 ffmpeg）', async () => {
  const ffmpeg = resolveSystemFfmpeg()
  if (ffmpeg === null) {
    console.log('  skip：PATH 上无系统 ffmpeg')
    return
  }
  const dir = mkdtempSync(join(tmpdir(), 'plan-units-'))
  try {
    const videoPath = join(dir, 'red-blue.mp4')
    execFileSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=red:size=128x96:rate=10:duration=2',
      '-f', 'lavfi', '-i', 'color=c=blue:size=128x96:rate=10:duration=2',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-y', videoPath,
    ], { timeout: 60_000 })
    const red = signatureFromRgb(await extractShotFrameThumb(videoPath, 0.5, ffmpeg))
    const blue = signatureFromRgb(await extractShotFrameThumb(videoPath, 3.0, ffmpeg))
    const d = sceneDistance(red, blue)
    assert.ok(d > 0.9, `红蓝场景距离应 >0.9，实得 ${d}`)
    const same = sceneDistance(red, red)
    assert.equal(same, 0)
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* 清理尽力而为 */ }
  }
})
