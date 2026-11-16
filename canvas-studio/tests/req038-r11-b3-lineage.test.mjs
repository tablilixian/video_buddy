/**
 * R11 · O-1（B3，2026-11-16）· **镜 ↔ 段血缘**
 *
 * 锁四件事：
 * ① 备份拍不落卡（否则声明时长凭空翻倍：真机 3 段片落 6 张卡 = 40s 声明 / 20s 成片）；
 * ② 屏与分镜卡**数量相等才按序对位**，否则一个都不绑并给出原因（错一位就改错屏）；
 * ③ 卡面段行**幂等**（scaffold 会重跑，重跑不能让卡面无限变长，也不能冲掉手改的正文）；
 * ④ `patch_spec_section` **只改一处**：diff 唯一、其余字段逐字节不变、units 型屏改 `copy` 被拒。
 *
 * 反向变异（改回旧行为必须红）：
 * - 删掉 seed 里的 `if (shot.backup) continue` ⇒ ①红（6 张卡）；
 * - `planSegmentBindings` 去掉长度相等判断、直接按序 zip ⇒ ②红（2 屏配 3 卡会硬绑）；
 * - `withSegmentLine` 改成 `text + '\n' + line` ⇒ ③红（第二次写入后出现两行【段】）；
 * - `applySpecPatch` 允许多字段 ⇒ ④红（diff 不再是「一处」）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { planSeedFromStoryboard } from '../lib/storyboard-seed.js'
import { createStoryboard, emptyStoryboardSections } from '../lib/contracts/storyboard.js'
import { isShotCard } from '../lib/contracts/canvas.js'
import {
  SEGMENT_LINE_LABEL,
  applySegmentBindings,
  planSegmentBindings,
  segmentIdFromRef,
  segmentLine,
  segmentRefOf,
  withSegmentLine,
} from '../lib/segment-binding.js'
import { applySpecPatch, patchSpecSection, resolveSegmentIdFromNode } from '../lib/host-tools-spec-patch.js'
import { readContentSpecFile } from '../lib/host-tools-spec.js'
import { createStudioTools } from '../lib/host-tools.js'

/** 可复现 id 序列。 */
function seqIds() {
  let n = 0
  return () => `id-${String(++n)}`
}

/** 3 主镜 + 3 备份拍（备份插在主镜之后，模拟真机会话的写法）。 */
function sectionsWithBackups() {
  const shots = []
  for (let i = 1; i <= 3; i++) {
    shots.push({
      id: `S1-Sh${String(i)}`,
      duration: 6.67,
      frames: 200,
      camera: 'Static',
      visual: `主镜画面 ${String(i)}`,
      audio: '环境',
      promptEn: `primary ${String(i)}`,
      backup: false,
    })
    shots.push({
      id: `S1-Sh${String(i)}b`,
      duration: 6.67,
      frames: 200,
      camera: 'Handheld',
      visual: `备份：另一条拍法 ${String(i)}`,
      audio: '环境',
      promptEn: `backup ${String(i)}`,
      backup: true,
    })
  }
  return {
    ...emptyStoryboardSections(),
    '00_creative': { brief: '冷芯' },
    '04_storyboard': { scenes: [{ id: 'S1', title: '开场', shots }] },
    '06_sound': { bgm: { bpm: 60, lufs: -16, sidechain: '' }, sfx: [] },
  }
}

function seedPlan() {
  const doc = createStoryboard({
    projectId: 'p1',
    title: '《冷芯》',
    meta: { genre: '科普', targetDuration: 20, aspect: '16:9' },
    sections: sectionsWithBackups(),
  })
  return planSeedFromStoryboard(doc, { newId: seqIds(), now: 1000 })
}

/** 3 屏 spec：s1 单单元、s2 两单元、s3 单单元（20s ⇒ autoStages 算 3 屏）。 */
function specThreeScreens() {
  return {
    meta: { title: '冷芯', fps: 30, durationSec: 20, autoStages: true },
    sections: [
      { id: 's1', card: 'A2', copy: '−60°C 的冰芯' },
      {
        id: 's2',
        units: [
          { card: 'B1', copy: '真实温度:−60°C；芯径:1.2mm', cell: { x: 26, y: 50, w: 44, h: 60 } },
          { card: 'A4', copy: '越冷越慢；−60°C 是临界点', cell: { x: 74, y: 50, w: 40, h: 60 } },
        ],
      },
      { id: 's3', card: 'A5', copy: '关注我，下期讲冰芯' },
    ],
  }
}

test('B3-1：备份拍不落卡，镜号连续（3 主 + 3 备 ⇒ 3 张）', () => {
  const plan = seedPlan()
  const cards = plan.nodes.filter((node) => isShotCard(node))
  assert.equal(cards.length, 3, '备份拍不能落成分镜卡（否则声明时长凭空翻倍）')
  assert.equal(plan.skippedBackups, 3, '跳过的条数要能回报给用户，不能静默')
  assert.equal(plan.shotNumbers.length, 3, '镜号只为主镜铸')
  assert.deepEqual(plan.shotNumbers, [1, 2, 3], '备份拍不占号：主镜必须是 1/2/3 而不是 1/3/5')
  const titles = cards.map((card) => card.title ?? '')
  assert.ok(titles[0]?.startsWith('分镜 1 ·'), titles[0])
  assert.ok(titles[2]?.startsWith('分镜 3 ·'), titles[2])
})

test('B3-2：数量相等才按序对位（createdAt 决定镜序）', () => {
  const cards = [
    { id: 'n2', title: '分镜 2', createdAt: 1002 },
    { id: 'n1', title: '分镜 1', createdAt: 1001 },
    { id: 'n3', title: '分镜 3', createdAt: 1003 },
  ]
  const plan = planSegmentBindings(specThreeScreens().sections, cards)
  assert.equal(plan.reason, null)
  assert.deepEqual(plan.bindings.map((binding) => binding.segmentId), ['s1', 's2', 's3'])
  assert.deepEqual(plan.bindings.map((binding) => binding.nodeId), ['n1', 'n2', 'n3'])
  assert.equal(segmentRefOf('s2'), 'spec:s2')
  assert.equal(segmentIdFromRef('spec:s2'), 's2')
  assert.equal(segmentIdFromRef('04:S1/shots/S1-Sh1'), null, 'sbRef 形态不能被误认成段指针')
})

test('B3-2：数量不等时一个都不绑，并说清「为什么 + 怎么改」', () => {
  const plan = planSegmentBindings(specThreeScreens().sections, [
    { id: 'n1', title: '分镜 1', createdAt: 1 },
    { id: 'n2', title: '分镜 2', createdAt: 2 },
  ])
  assert.equal(plan.bindings.length, 0, '宁可不对位，也不做位置错配')
  assert.match(plan.reason ?? '', /屏 3 ≠ 分镜卡 2/)
  assert.match(plan.reason ?? '', /segmentId/, '必须给出可执行的替代路径')
})

test('B3-2：卡面段行幂等，且不动其它行', () => {
  const brief = { id: 's2', units: [{ card: 'B1', copy: '真实温度:−60°C' }] }
  const first = withSegmentLine('【视觉】冰芯截面\n【运镜】Static', segmentLine('s2', brief))
  assert.ok(first.endsWith(segmentLine('s2', brief)))
  assert.match(first, /【视觉】冰芯截面/, '手改的正文不能被段行覆盖')
  const second = withSegmentLine(first, segmentLine('s2', { id: 's2', card: 'A4', copy: '换过文案' }))
  const segmentRows = second.split('\n').filter((row) => row.startsWith(`【${SEGMENT_LINE_LABEL}】`))
  assert.equal(segmentRows.length, 1, '重跑 scaffold 不能追加第二行段指针')
  assert.match(second, /换过文案/)
  assert.doesNotMatch(second, /真实温度/, '旧段摘要要被替换掉')
})

test('B3-2：applySegmentBindings 只改点名的节点，其余保持同一引用', () => {
  const nodes = [
    { id: 'n1', kind: 'text', title: '分镜 1', text: '【视觉】a', x: 0, y: 0, width: 1, height: 1, createdAt: 1, origin: 'agent', sourceIds: [] },
    { id: 'n2', kind: 'text', title: '分镜 2', text: '【视觉】b', x: 0, y: 0, width: 1, height: 1, createdAt: 2, origin: 'agent', sourceIds: [] },
  ]
  const applied = applySegmentBindings(nodes, [
    { segmentId: 's1', nodeId: 'n1', nodeTitle: '分镜 1', line: segmentLine('s1', { id: 's1', card: 'A2' }) },
  ])
  assert.equal(applied.changed, 1)
  assert.equal(applied.nodes[0]?.segmentRef, 'spec:s1')
  assert.equal(applied.nodes[1], nodes[1], '未命中的节点必须是同一个引用（否则全画布 diff 都变）')
})

test('B3-3：applySpecPatch 只改一处，diff 指出精确路径', () => {
  const spec = specThreeScreens()
  const before = JSON.parse(JSON.stringify(spec))
  const diff = applySpecPatch(spec, 's1', { copy: '−62°C 的冰芯' })
  assert.equal(diff.path, 'sections[0].copy')
  assert.equal(diff.before, '−60°C 的冰芯')
  assert.equal(diff.after, '−62°C 的冰芯')
  assert.equal(spec.sections[0].copy, '−62°C 的冰芯')
  assert.deepEqual(spec.sections.slice(1), before.sections.slice(1), '其它屏必须逐字节不变')
  assert.deepEqual(spec.meta, before.meta)
})

test('B3-3：units 型屏改 copy 被拒（那字段不上屏），并列出各单元', () => {
  assert.throws(
    () => applySpecPatch(specThreeScreens(), 's2', { copy: '拼合文案' }),
    (error) => {
      const message = String(error.message)
      assert.match(message, /units 型屏/, message)
      assert.match(message, /unitCopy/, '要给出正确字段')
      assert.match(message, /真实温度/, '要把各单元文案列出来（否则模型只能猜）')
      return true
    },
  )
})

test('B3-3：一次改两处被拒（范围不误解是产品承诺）', () => {
  assert.throws(
    () => applySpecPatch(specThreeScreens(), 's1', { copy: 'a', label: 'b' }),
    /一次只改一处/,
  )
})

test('B3-3：unitIndex 越界 / 缺省都被点名', () => {
  assert.throws(() => applySpecPatch(specThreeScreens(), 's2', { unitCopy: 'x' }), /unitIndex/)
  assert.throws(() => applySpecPatch(specThreeScreens(), 's2', { unitIndex: 9, unitCopy: 'x' }), /越界/)
  const diff = applySpecPatch(specThreeScreens(), 's2', { unitIndex: 1, unitCopy: '越冷越慢；−62°C 是临界点' })
  assert.equal(diff.path, 'sections[1].units[1].copy')
})

test('B3-3：段 id 不存在时列出真实 id（不猜）', () => {
  assert.throws(
    () => applySpecPatch(specThreeScreens(), 's9', { copy: 'x' }),
    /没有段 s9.*s1 \/ s2 \/ s3/s,
  )
})

test('B3-3：resolveSegmentIdFromNode 三种情况都有明确原因', () => {
  const sections = specThreeScreens().sections
  const ids = sections.map((section) => section.id)
  const base = { id: 'n1', kind: 'text', title: '分镜 2', x: 0, y: 0, width: 1, height: 1, createdAt: 1, origin: 'agent', sourceIds: [] }

  const missing = resolveSegmentIdFromNode(base, ids)
  assert.ok('reason' in missing)
  assert.match(missing.reason, /没有段指针/)
  assert.match(missing.reason, /备份拍/, '要给出最可能的原因，而不是一句「失败」')

  const stale = resolveSegmentIdFromNode({ ...base, segmentRef: 'spec:s9' }, ids)
  assert.ok('reason' in stale)
  assert.match(stale.reason, /已过期/)

  const ok = resolveSegmentIdFromNode({ ...base, segmentRef: 'spec:s2' }, ids)
  assert.deepEqual(ok, { segmentId: 's2' })
})

test('B3-3：patchSpecSection 端到端 —— 文件只变一处，写回可读', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-b3-'))
  try {
    const file = join(dir, 'spec.json')
    writeFileSync(file, `${JSON.stringify(specThreeScreens(), null, 2)}\n`, 'utf8')
    const before = JSON.parse(readFileSync(file, 'utf8'))
    const result = patchSpecSection({
      specPath: file,
      segmentId: 's1',
      set: { copy: '−62°C 的冰芯', dataSource: 'observed' },
    })
    assert.match(result.text, /已改 1 处/)
    assert.match(result.text, /sections\[0\]\.copy/)
    assert.match(result.text, /影响面/)
    const after = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(after.sections[0].copy, '−62°C 的冰芯')
    assert.equal(after.sections[0].dataSource, 'observed', 'dataSource 是附加信息，可与内容改动同批')
    assert.deepEqual(after.sections.slice(1), before.sections.slice(1))
    // 写回后仍是合法 spec（读入口会再校验一次，非法会抛）。
    assert.equal(readContentSpecFile(file).sections.length, 3)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('B3-3：工具已注册且描述写明段级口径', () => {
  const tool = createStudioTools({}, 3000).find((entry) => entry.name === 'patch_spec_section')
  assert.ok(tool, 'patch_spec_section 必须注册（没有入口的能力等于不存在）')
  const description = String(tool.description)
  assert.match(description, /段级原子改/)
  assert.match(description, /一次只改一处/)
  assert.match(description, /segmentId/)
  const params = tool.parameters?.properties ?? {}
  assert.ok(params.shotNodeId, '要支持「对着某张分镜卡说话」')
  assert.ok(params.segmentId, '也要能手填段 id')
})
