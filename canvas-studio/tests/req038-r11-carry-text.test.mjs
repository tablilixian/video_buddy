/**
 * S-5 守卫：`carry` 支持文字层（REQ-038-R11 文档体系整改 · M3）。
 *
 * 抓的是什么：真机那份设计稿要「左上角固定小字 + 右上角分组标签 + 全片统一框线」，
 * 而 `SpecCarry` 只有 `id/box/color/radius` ⇒ **表达不了**。会话在
 * 「spec cards alone cannot deliver the requested visual」这句话上停了 45 分钟。
 *
 * 四条断言（前三条是方案文档 S-5 明确要求的反向变异对象）：
 * 1. **旧字段零回归**：不带 `text` 时输出与改造前**逐字段一致**（只有形状底板）。
 * 2. **时间窗并集**：带 `text` 时 `startFrame` 覆盖 `fromSection..toSection` 并集，
 *    `fadeFrames` 恒 0（常驻层每屏闪一次就不叫常驻）。
 * 3. **白名单拦得住**：非法 `variant` / 空 `text` 在校验期拒收，不到渲染层。
 * 4. 顺序无关 + id 就是 spec 里那个（不挂段前缀，否则跨屏 id 会重名）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateContentSpec, planFromSpec } from '../lib/remotion/content-spec.js'

const meta = { title: 'carry-probe', width: 1080, height: 1920, fps: 30, durationSec: 6 }
const CELL = { x: 50, y: 55, w: 90, h: 40 }

/** 三屏 spec（`durationSec` 各 2s → 60 帧一屏）；`carry` 传单条，内部包成数组。 */
const specOf = (carry) => ({
  meta,
  sections: [
    { id: 's1', label: '一', card: 'A1', copy: '第一句', durationSec: 2, cell: CELL },
    { id: 's2', label: '二', card: 'A1', copy: '第二句', durationSec: 2, cell: CELL },
    { id: 's3', label: '三', card: 'A1', copy: '第三句', durationSec: 2, cell: CELL },
  ],
  ...(carry === undefined ? {} : { carry: Array.isArray(carry) ? carry : [carry] }),
})
const carryTrackOf = (carry) => {
  const plan = planFromSpec(specOf(carry), 180)
  return plan.tracks.find((track) => track.id === carry.id)
}

test('S-5 零回归：不带 text 的 carry 仍是形状底板，且字段与改造前逐字段一致', () => {
  const track = carryTrackOf({ id: 'band', box: { x: 50, y: 8, w: 60, h: 6 }, color: '#222222', radius: 8 })
  assert.deepEqual(track, {
    id: 'band',
    type: 'shape',
    shape: 'rect',
    color: '#222222',
    box: { x: 50, y: 8, w: 60, h: 6 },
    radius: 8,
    startFrame: 0,
    durationInFrames: 180,
    fadeFrames: 0,
  }, '不带 text 的 carry 输出变了 —— 存量 spec 会静默换样子')
})

test('S-5 文字层：出 textCard 轨、fadeFrames 0、时间窗覆盖 fromSection..toSection 并集', () => {
  const track = carryTrackOf({
    id: 'kicker',
    box: { x: 26, y: 9, w: 52, h: 5 },
    color: '#8fa3c4',
    text: '所有策略，只有两个选项',
    textColor: '#8fa3c4',
    letterSpacingEm: 0.1,
  })
  assert.equal(track.type, 'textCard', '带 text 的 carry 必须出文字轨')
  assert.equal(track.text, '所有策略，只有两个选项')
  assert.equal(track.variant, 'subtitle', 'variant 缺省应是 subtitle')
  assert.equal(track.fadeFrames, 0, '常驻层不能有入场淡入（每屏闪一次就不叫常驻）')
  assert.equal(track.startFrame, 0)
  assert.equal(track.durationInFrames, 180, '缺省覆盖首屏到末屏')
  assert.equal(track.color, '#8fa3c4', 'textColor 应落到轨的 color（文字色）')
  assert.equal(track.letterSpacingEm, 0.1)
  assert.deepEqual(track.box, { x: 26, y: 9, w: 52, h: 5 })
})

test('S-5 文字层：fromSection 收窄时间窗（不是恒为全片）', () => {
  const track = carryTrackOf({
    id: 'badge',
    box: { x: 76, y: 9, w: 26, h: 5 },
    color: '#2EE6A8',
    text: 'B 组 · 均值回归',
    fromSection: 's2',
  })
  assert.equal(track.type, 'textCard')
  assert.equal(track.startFrame, 60, 'fromSection=s2 ⇒ 从第二屏首帧开始')
  assert.equal(track.durationInFrames, 120, '并集终点仍是末屏末帧（60 → 180）')
})

test('S-5 白名单：非法 variant / 空 text 在校验期拒收，radius 与 text 并存只警告', () => {
  const badVariant = validateContentSpec(specOf([{
    id: 'x', box: { x: 50, y: 8, w: 40, h: 5 }, color: '#fff', text: '文字', variant: 'banner',
  }]))
  assert.equal(badVariant.ok, false, '非法 variant 必须拒收')
  assert.ok(badVariant.errors.some((message) => message.includes('variant 非法')), `错误文案应点名 variant：${badVariant.errors.join(' / ')}`)

  const emptyText = validateContentSpec(specOf([{
    id: 'x', box: { x: 50, y: 8, w: 40, h: 5 }, color: '#fff', text: '',
  }]))
  assert.equal(emptyText.ok, false, '空串 text 会得到一条看不见的轨，必须拒收')

  const both = validateContentSpec(specOf([{
    id: 'x', box: { x: 50, y: 8, w: 40, h: 5 }, color: '#fff', text: '文字', radius: 8,
  }]))
  assert.equal(both.ok, true, 'radius + text 只是无效组合，不该阻断出片')
  assert.ok(both.warnings.some((message) => message.includes('radius')), 'radius + text 应给一条警告（否则作者以为圆角生效了）')
})

test('S-5 接线：多条 carry 顺序保持、id 原样（不挂段前缀，跨屏不重名）', () => {
  const plan = planFromSpec(specOf([
    { id: 'bg-band', box: { x: 50, y: 50, w: 100, h: 90 }, color: '#0d1322' },
    { id: 'kicker', box: { x: 26, y: 9, w: 52, h: 5 }, color: '#8fa3c4', text: '左上固定小字' },
    { id: 'rule', box: { x: 50, y: 96, w: 88, h: 0.3 }, color: '#333333' },
  ]), 180)
  const ids = plan.tracks.filter((track) => ['bg-band', 'kicker', 'rule'].includes(track.id)).map((track) => track.id)
  assert.deepEqual(ids, ['bg-band', 'kicker', 'rule'], 'carry 顺序应保持 spec 里的书写顺序')
  assert.equal(plan.tracks.filter((track) => track.id === 'kicker')[0].type, 'textCard')
  assert.equal(plan.tracks.filter((track) => track.id === 'rule')[0].type, 'shape')
})
