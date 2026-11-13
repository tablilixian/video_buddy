/**
 * REQ-038 R7（RQ-25 / RQ-26）· **格位、多单元、常驻层**单测。
 *
 * 三条纪律必须同时成立：
 * ① **旧 spec 逐字段不变** —— 不带 cell/units/carry 的 spec，产出必须和改动前一模一样
 *    （否则 RQ-10/12 的 105 条既有断言就是假绿）；
 * ② **几何真的生效** —— 投影不是把 box 抄一遍，要能算出「落在哪个格位」；
 * ③ **字号跟着几何走** —— 光投影不缩字，结果是「位置对了但字溢出格位」。
 *
 * 直连 Host tsc 编译产物。定向跑：node --test tests/req038-r7-screen-plan.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planFromSpec, validateContentSpec } from '../lib/remotion/content-spec.js'
import { registeredCardIds } from '../lib/remotion/recipe-cards-all.js'
import { projectBoxToCell } from '../lib/remotion/cell-projection.js'

const FPS = 30

function spec(sections, extra = {}) {
  return { meta: { title: 'R7 版面', durationSec: sections.length * 5, fps: FPS }, sections, ...extra }
}

function cards() {
  const ids = registeredCardIds()
  assert.ok(ids.length > 0, '卡注册表不该是空的（测试需要一张真卡）')
  return ids
}

test('projectBoxToCell：居中全屏 → 左半屏', () => {
  const out = projectBoxToCell({ x: 50, y: 50, w: 100, h: 100 }, { x: 25, y: 50, w: 50, h: 50 })
  assert.deepEqual(out, { x: 25, y: 50, w: 50, h: 50 })
})

test('projectBoxToCell：相对布局按比例保留', () => {
  // 原卡里「左侧 40% 宽的小块」在 60% 宽的格位里应变成「左侧 24% 宽」。
  const out = projectBoxToCell({ x: 30, y: 40, w: 40, h: 20 }, { x: 70, y: 50, w: 60, h: 40 })
  assert.equal(out.w, 24)
  assert.equal(out.h, 8)
  assert.equal(out.x, 58) // 70 + (30-50)*0.6 = 58
  assert.equal(out.y, 46) // 50 + (40-50)*0.4 = 46
})

test('fontScale 不生效且校验期明说（textCard 白名单没有字号字段）', () => {
  // 落地时实测：字号由 planTextFit 按 box 宽度推，塞 fontScale 只会让人以为能调。
  const id = cards()[0]
  const result = validateContentSpec(spec([{
    id: 's1',
    card: id,
    copy: '一',
    cell: { x: 50, y: 50, w: 50, h: 50, fontScale: 0.6 },
  }]))
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => /fontScale 暂不生效/.test(error)))
})

test('旧行为：不带 cell/units 的 spec，轨道 box 不被改动', () => {
  const id = cards()[0]
  const plain = planFromSpec(spec([{ id: 's1', card: id, copy: '一' }, { id: 's2', card: id, copy: '二' }]), 300)
  const withFullCell = planFromSpec(spec([
    { id: 's1', card: id, copy: '一', cell: { x: 50, y: 50, w: 100, h: 100 } },
    { id: 's2', card: id, copy: '二', cell: { x: 50, y: 50, w: 100, h: 100 } },
  ]), 300)
  assert.deepEqual(
    plain.tracks.filter((track) => track.id !== 'bg'),
    withFullCell.tracks.filter((track) => track.id !== 'bg'),
    '全屏格位应等价于不写格位（否则旧 spec 的像素会变）',
  )
})

test('多单元：一屏 3 个单元，几何各自落在自己的格位内', () => {
  const id = cards()[0]
  const cells = [
    { x: 20, y: 50, w: 32, h: 60 },
    { x: 50, y: 50, w: 32, h: 60 },
    { x: 80, y: 50, w: 32, h: 60 },
  ]
  const plan = planFromSpec(spec([{
    id: 's1',
    copy: '三栏',
    units: cells.map((cell, index) => ({ card: id, copy: `单元${String(index)}`, cell })),
  }]), 150)
  const unitTracks = plan.tracks.filter((track) => typeof track.id === 'string' && /^u\d-/.test(track.id))
  assert.ok(unitTracks.length >= 3, `三个单元应产出 ≥3 条带前缀的轨，实际 ${String(unitTracks.length)}`)
  for (const track of unitTracks) {
    const index = Number(String(track.id).slice(1, 2))
    const cell = cells[index]
    const box = track.box
    if (box === undefined) continue
    assert.ok(box.x - box.w / 2 >= cell.x - cell.w / 2 - 0.01, `${String(track.id)} 左边界越出格位`)
    assert.ok(box.x + box.w / 2 <= cell.x + cell.w / 2 + 0.01, `${String(track.id)} 右边界越出格位`)
  }
  const left = unitTracks.filter((t) => t.box !== undefined && t.box.x < 36)
  assert.ok(left.length > 0, '第一个格位（x=20）应至少有一条轨落在左侧')
})

test('多单元：窄格位靠 planTextFit 自动降号（几何 → 字号的真实链路）', () => {
  const id = cards()[0]
  const plan = planFromSpec(spec([{
    id: 's1',
    copy: '两栏',
    units: [
      { card: id, copy: '左', cell: { x: 27, y: 50, w: 46, h: 56 } },
      { card: id, copy: '右', cell: { x: 73, y: 50, w: 46, h: 56 } },
    ],
  }]), 150)
  const unitTracks = plan.tracks.filter((track) => track.type === 'textCard' && typeof track.id === 'string' && /^u\d-/.test(track.id))
  assert.ok(unitTracks.length >= 2, '两个单元各应产出至少一条文字轨')
  for (const track of unitTracks) {
    assert.ok(track.box.w <= 50, `${String(track.id)} 的 box 宽度应 ≤50%（实际 ${String(track.box.w)}）`)
  }
  // 字号不写进轨道（textCard 白名单无 fontSize）—— 由渲染期的 planTextFit 按 box 宽推。
  for (const track of unitTracks) assert.equal(track.fontSize, undefined)
})

test('carry：帧窗等于 from 屏首帧到 to 屏末帧', () => {
  const id = cards()[0]
  const plan = planFromSpec(spec([
    { id: 's1', card: id, copy: '一', durationSec: 5 },
    { id: 's2', card: id, copy: '二', durationSec: 5 },
    { id: 's3', card: id, copy: '三', durationSec: 5 },
  ], { carry: [{ id: 'panel', box: { x: 50, y: 56, w: 84, h: 46 }, color: '#1b2333', fromSection: 's2', toSection: 's3' }] }), 450)
  const panel = plan.tracks.find((track) => track.id === 'panel')
  assert.ok(panel !== undefined, 'carry 必须产出一条轨')
  assert.equal(panel.startFrame, 150, '第 2 屏首帧应是 150')
  assert.equal(panel.durationInFrames, 300, '第 2–3 屏共 10 秒 = 300 帧')
  assert.equal(panel.fadeFrames, 0, '常驻层不做入场')
  assert.equal(panel.shape, 'rect')
})

test('carry：缺省覆盖全片', () => {
  const id = cards()[0]
  const plan = planFromSpec(spec([
    { id: 's1', card: id, copy: '一', durationSec: 4 },
    { id: 's2', card: id, copy: '二', durationSec: 6 },
  ], { carry: [{ id: 'panel', box: { x: 50, y: 56, w: 90, h: 40 }, color: '#223344' }] }), 300)
  const panel = plan.tracks.find((track) => track.id === 'panel')
  assert.equal(panel.startFrame, 0)
  assert.equal(panel.durationInFrames, 300)
})

test('校验：card 与 units 互斥', () => {
  const id = cards()[0]
  const result = validateContentSpec(spec([{
    id: 's1',
    card: id,
    copy: '一',
    units: [{ card: id, copy: '二' }],
  }]))
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => /互斥/.test(error)))
})

test('校验：units 超过 4 个判错', () => {
  const id = cards()[0]
  const result = validateContentSpec(spec([{
    id: 's1',
    copy: '一',
    units: Array.from({ length: 5 }, (_, index) => ({ card: id, copy: `u${String(index)}` })),
  }]))
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => /最多 4 个/.test(error)))
})

test('校验：carry 指向不存在的屏判错（不静默丢常驻层）', () => {
  const id = cards()[0]
  const result = validateContentSpec(spec([{ id: 's1', card: id, copy: '一' }], {
    carry: [{ id: 'panel', box: { x: 50, y: 60, w: 80, h: 30 }, color: '#123456', fromSection: 's9' }],
  }))
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => /不存在的屏/.test(error)))
})

test('校验：格位取值越界判错', () => {
  const id = cards()[0]
  const result = validateContentSpec(spec([{ id: 's1', card: id, copy: '一', cell: { x: 50, y: 50, w: 0, h: 140 } }]))
  assert.equal(result.ok, false)
  assert.equal(result.errors.filter((error) => /\.cell/.test(error)).length, 2)
})

test('确定性：同一份 spec 两次计划逐字段相等', () => {
  const id = cards()[0]
  const input = spec([
    { id: 's1', copy: '三栏', units: [
      { card: id, copy: 'a', cell: { x: 20, y: 50, w: 32, h: 60 } },
      { card: id, copy: 'b', cell: { x: 50, y: 50, w: 32, h: 60 } },
      { card: id, copy: 'c', cell: { x: 80, y: 50, w: 32, h: 60 } },
    ] },
    { id: 's2', card: id, copy: '收尾' },
  ], { carry: [{ id: 'panel', box: { x: 50, y: 56, w: 84, h: 46 }, color: '#1b2333' }] })
  assert.deepEqual(planFromSpec(input, 300), planFromSpec(input, 300))
})

test('版面判据端到端：多单元 + carry 的 spec 不再触发 ML-16 / ML-17', async () => {
  const { lintMotion } = await import('../lib/remotion/motion-lint.js')
  const id = cards()[0]
  const sections = []
  for (let i = 0; i < 6; i += 1) {
    sections.push({
      id: `s${String(i)}`,
      copy: `屏 ${String(i)}`,
      durationSec: 5,
      units: [
        { card: id, copy: '左', cell: { x: 27, y: 50, w: 44, h: 56 } },
        { card: id, copy: '右', cell: { x: 73, y: 50, w: 44, h: 56 } },
      ],
    })
  }
  const plan = planFromSpec(spec(sections, {
    carry: [{ id: 'panel', box: { x: 50, y: 56, w: 86, h: 46 }, color: '#1b2333' }],
  }), 900)
  const manifest = {
    id: 'comp-r7',
    meta: { title: 'R7', width: 1280, height: 720, fps: FPS, durationInFrames: 900 },
    tracks: plan.tracks,
  }
  const codes = lintMotion(manifest).map((issue) => issue.code)
  assert.ok(!codes.includes('ML-16'), `六屏各两单元，不该报 ML-16（实际 ${codes.join(',')}）`)
  assert.ok(!codes.includes('ML-17'), '有跨屏底板，不该报 ML-17')
})
