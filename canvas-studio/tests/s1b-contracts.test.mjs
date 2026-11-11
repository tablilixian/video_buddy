/**
 * ≥95% 对齐 S1-B · 四小件契约守卫（dotGrid / timecode / clip:'circle' / group 容器）。
 *
 * 能力前置证据：#16（金属字/点阵/圆裁）与 #14（容器 62 卡）两条能力基准已给像素证据，
 * 这里守「契约有值 → 校验放行/拒收 → 老 manifest 不受影响」这条链：
 * - dotGrid：参数区间 + 非 dotGrid 轨写 dotRadius/dotSpacing 的冗余告警；
 * - timecode：纯帧函数（禁真实时钟的确定性由纯入参保证）+ variant 白名单；
 * - clip：媒体轨白名单 + 缺省零影响；
 * - group：children 准入 / 角度硬闸（#14 D 格 −38° 静默消失）/ id 全局唯一 /
 *   transition 禁指子轨 / 子轨走完整校验器（合成 manifest 复用）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateManifest } from '../lib/remotion/manifest.js'
import { timecodeStringAt } from '../lib/remotion/timecode.js'
import { auditTextFit } from '../lib/remotion/text-fit-audit.js'
import { flattenTracksDeep, mapTracksDeep } from '../lib/remotion/group-children.js'

const baseMeta = { title: 'S1B', width: 1920, height: 1080, fps: 30, durationInFrames: 120 }
/** 零噪音断言用的静音 meta（lint off + 时长对齐 —— 结构守卫只看契约字段，不混入编排体检）。 */
const quietMeta = (durationInFrames = 120) => ({ ...baseMeta, lint: 'off', durationInFrames })

function manifestWith(tracks, meta = baseMeta) {
  return { id: 's1b-test', meta, tracks }
}

const groupOf = (children, extra = {}) => ({
  id: 'wall',
  type: 'group',
  startFrame: 0,
  durationInFrames: 120,
  transform: { rotateY: -18, perspective: 1200 },
  children,
  ...extra,
})

const cardA = { id: 'c1', type: 'shape', shape: 'rect', color: '#1d3358', box: { x: 30, y: 50, w: 20, h: 20 }, startFrame: 0, durationInFrames: 120 }
const cardB = { id: 'c2', type: 'textCard', variant: 'title', text: '47', box: { x: 60, y: 50, w: 30, h: 20 }, startFrame: 0, durationInFrames: 120 }

// ── timecode 纯函数 ──

test('S1-B：timecodeStringAt 帧号口径（FF 是帧不是毫秒）', () => {
  assert.equal(timecodeStringAt(0, 30), '00:00:00:00')
  assert.equal(timecodeStringAt(38, 30), '00:00:01:08')
  assert.equal(timecodeStringAt(30, 30), '00:00:01:00')
  assert.equal(timecodeStringAt(90, 60), '00:00:01:30')
  // 1 小时翻位：fps 30 × 3600s = 108000 帧
  assert.equal(timecodeStringAt(108000, 30), '01:00:00:00')
  // 非法入参回落（确定性兜底，不抛错）
  assert.equal(timecodeStringAt(-5, 30), '00:00:00:00')
  assert.equal(timecodeStringAt(0, 0), '00:00:00:00')
})

test('S1-B ★校验：timecode variant 放行，未知 variant 仍拒收', () => {
  const ok = validateManifest(manifestWith([
    { id: 'tc', type: 'textCard', variant: 'timecode', text: 'REC', startFrame: 0, durationInFrames: 60 },
  ]))
  assert.deepEqual(ok.errors, [], `timecode 应放行：${ok.errors.join('；')}`)
  const bad = validateManifest(manifestWith([
    { id: 'tc', type: 'textCard', variant: 'counter', text: 'REC', startFrame: 0, durationInFrames: 60 },
  ]))
  assert.ok(bad.errors.some((e) => e.includes('variant 非法')))
})

// ── dotGrid ──

test('S1-B ★校验：dotGrid 放行 + 参数区间 + 冗余字段告警', () => {
  const ok = validateManifest(manifestWith([
    { id: 'bg', type: 'shape', shape: 'dotGrid', color: '#96b4e1', dotRadius: 1.4, dotSpacing: 20, startFrame: 0, durationInFrames: 60 },
  ]))
  assert.deepEqual(ok.errors, [], `dotGrid 应放行：${ok.errors.join('；')}`)
  const bad = validateManifest(manifestWith([
    { id: 'bg', type: 'shape', shape: 'dotGrid', color: '#96b4e1', dotRadius: 0, dotSpacing: 500, startFrame: 0, durationInFrames: 60 },
  ]))
  assert.ok(bad.errors.some((e) => e.includes('dotRadius')))
  assert.ok(bad.errors.some((e) => e.includes('dotSpacing')))
  // 老 shape 写 dotRadius = 冗余告警不阻断
  const redundant = validateManifest(manifestWith([
    { id: 'bg', type: 'shape', shape: 'rect', color: '#333', dotRadius: 2, startFrame: 0, durationInFrames: 60 },
  ]))
  assert.deepEqual(redundant.errors, [])
  assert.ok(redundant.warnings.some((w) => w.includes('dotRadius')))
})

// ── clip:'circle' ──

test('S1-B ★校验：media 轨 clip:"circle" 放行，非法值拒收，缺省零告警', () => {
  const ok = validateManifest(manifestWith([
    { id: 'pipv', type: 'video', src: '/canvas-studio/assets/a.mp4', clip: 'circle', startFrame: 0, durationInFrames: 60 },
    { id: 'pip', type: 'image', src: '/canvas-studio/assets/a.png', clip: 'circle', startFrame: 0, durationInFrames: 60 },
  ], quietMeta(60)))
  assert.deepEqual(ok.errors, [], `clip circle 应放行：${ok.errors.join('；')}`)
  const bad = validateManifest(manifestWith([
    { id: 'pip', type: 'image', src: '/canvas-studio/assets/a.png', clip: 'rect', startFrame: 0, durationInFrames: 60 },
  ]))
  assert.ok(bad.errors.some((e) => e.includes('clip 非法')))
  // 老 manifest（无 clip）零影响
  const old = validateManifest(manifestWith([
    { id: 'pip', type: 'image', src: '/canvas-studio/assets/a.png', startFrame: 0, durationInFrames: 60 },
  ], quietMeta(60)))
  assert.deepEqual(old.errors, [])
  assert.deepEqual(old.warnings, [])
})

// ── group 容器 ──

test('S1-B ★校验：group 合法形态放行且零 warning', () => {
  const result = validateManifest(manifestWith([groupOf([cardA, cardB])], quietMeta()))
  assert.deepEqual(result.errors, [], `group 应放行：${result.errors.join('；')}`)
  assert.deepEqual(result.warnings, [], `合法 group 不该有噪音：${result.warnings.join('；')}`)
})

test('S1-B ★校验：容器角度 >30° 拒收（#14 D 格 −38° 静默消失的契约闸）', () => {
  const bad = validateManifest(manifestWith([groupOf([cardA], { transform: { rotateY: -38, perspective: 1200 } })]))
  assert.ok(bad.errors.some((e) => e.includes('容器 3D 角度')), '角度闸必须拦 transform')
  // animate 端点同样受限
  const badAnimate = validateManifest(manifestWith([
    groupOf([cardA], { animate: { from: { rotateY: 0 }, to: { rotateY: 45 }, durationInFrames: 60 } }),
  ]))
  assert.ok(badAnimate.errors.some((e) => e.includes('容器 3D 角度')), '角度闸必须拦 animate 端点')
})

test('S1-B ★校验：children 准入（空/类型/嵌套/startAfter/anchor）', () => {
  const empty = validateManifest(manifestWith([groupOf([])]))
  assert.ok(empty.errors.some((e) => e.includes('children 必须是非空数组')))
  const nested = validateManifest(manifestWith([groupOf([
    { id: 'inner', type: 'group', startFrame: 0, durationInFrames: 60, children: [cardA] },
  ])]))
  assert.ok(nested.errors.some((e) => e.includes('type 非法') && e.includes('group 不收')))
  const transitionChild = validateManifest(manifestWith([groupOf([
    { id: 'tr', type: 'transition', effect: 'fade', fromTrackId: 'c1', toTrackId: 'c2', startFrame: 0, durationInFrames: 10 },
  ])]))
  assert.ok(transitionChild.errors.some((e) => e.includes('type 非法')))
  const startAfterChild = validateManifest(manifestWith([groupOf([
    { ...cardA, startAfter: { trackId: 'c2' } },
  ])]))
  assert.ok(startAfterChild.errors.some((e) => e.includes('不支持 startAfter')))
  const anchorChild = validateManifest(manifestWith([groupOf([
    { ...cardB, animate: { from: { opacity: 0 }, to: { opacity: 1 }, anchor: { phrase: 0 } } },
  ])]))
  assert.ok(anchorChild.errors.some((e) => e.includes('不支持 anchor')))
})

test('S1-B ★校验：子轨 id 与顶层轨 / 其它 group 子轨互查唯一', () => {
  const dupWithTop = validateManifest(manifestWith([
    { id: 'c1', type: 'shape', shape: 'rect', color: '#222', startFrame: 0, durationInFrames: 60 },
    groupOf([{ ...cardA, id: 'c1' }]),
  ]))
  assert.ok(dupWithTop.errors.some((e) => e.includes('id 重复')))
  const dupAcrossGroups = validateManifest(manifestWith([
    groupOf([{ ...cardA, id: 'dup' }]),
    { ...groupOf([{ ...cardA, id: 'dup' }]), id: 'wall2', startFrame: 10 },
  ]))
  assert.ok(dupAcrossGroups.errors.some((e) => e.includes('id 重复')))
})

test('S1-B ★校验：transition 指向子轨 id 拒收（子轨窗口与顶层转场无法对齐）', () => {
  const result = validateManifest(manifestWith([
    groupOf([cardA, cardB]),
    { id: 'tr', type: 'transition', effect: 'fade', fromTrackId: 'c1', toTrackId: 'c2', startFrame: 0, durationInFrames: 10 },
  ]))
  assert.ok(result.errors.some((e) => e.includes('指向 group 子轨')))
})

test('S1-B ★校验：子轨走完整校验器（合成 manifest 复用 —— src 缺失照报）', () => {
  const result = validateManifest(manifestWith([groupOf([
    { id: 'img', type: 'image', src: 'https://evil.example/x.png', startFrame: 0, durationInFrames: 60 },
  ])]))
  assert.ok(
    result.errors.some((e) => e.includes('子轨') && e.includes('src')),
    `子轨的 src 同源校验必须生效：${result.errors.join('；')}`,
  )
})

test('S1-B ★校验：子轨 3D 维度告警、越组窗口告警（不阻断）', () => {
  const result = validateManifest(manifestWith([groupOf([
    { ...cardA, transform: { rotateY: 10 } },
    { id: 'late', type: 'shape', shape: 'rect', color: '#333', startFrame: 100, durationInFrames: 60 },
  ])]))
  assert.ok(result.warnings.some((w) => w.includes('容器内子轨的 3D 不生效')))
  assert.ok(result.warnings.some((w) => w.includes('超出所属 group 窗口')))
  assert.deepEqual(result.errors, [])
})

test('S1-B ★回归：不含新字段的 manifest 零告警零报错（老片逐字节不变）', () => {
  const result = validateManifest(manifestWith([
    { id: 'v', type: 'video', src: '/canvas-studio/assets/a.mp4', startFrame: 0, durationInFrames: 120 },
    { id: 'bg', type: 'shape', shape: 'gradient', color: '#0b1220', startFrame: 0, durationInFrames: 120 },
    { id: 't', type: 'textCard', variant: 'title', text: '标题', startFrame: 0, durationInFrames: 120 },
  ], quietMeta()))
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.warnings, [])
})

// ── 深遍历工具 ──

test('S1-B：flattenTracksDeep / mapTracksDeep（老 manifest 原对象返回）', () => {
  const group = groupOf([cardA, cardB])
  const flat = flattenTracksDeep([group, cardA])
  assert.deepEqual(flat.map((t) => t.id), ['wall', 'c1', 'c2', 'c1'])
  // 无变化映射返回**原对象**（逐字节不变铁律）
  const same = mapTracksDeep([group, cardA], (t) => t)
  assert.equal(same[0], group)
  assert.equal(same[0].children[0], cardA)
  // 子轨映射生效
  const marked = mapTracksDeep([group], (t) => (t.type === 'image' ? { ...t, hasAlpha: true } : t))
  assert.equal(marked[0].children[0], cardA, '非 image 子轨保持原引用')
})

// ── 体检递归 ──

test('S1-B ★体检：auditTextFit 递归进容器子轨（漏了它体检假绿）', () => {
  const longText = '这是一段远超盒子容量的长文案，会被盒子的 overflow 一刀裁掉，必须被体检抓到并上报。'.repeat(3)
  const entries = auditTextFit({
    id: 'audit',
    meta: baseMeta,
    tracks: [groupOf([
      { id: 'inside', type: 'textCard', variant: 'title', text: longText, box: { x: 50, y: 30, w: 20, h: 10 }, startFrame: 0, durationInFrames: 120 },
      cardB,
    ])],
  })
  const ids = entries.map((e) => e.id)
  assert.ok(ids.includes('inside'), `容器子轨文字卡必须进体检：${ids.join(',')}`)
  assert.ok(ids.includes('c2'))
  const inside = entries.find((e) => e.id === 'inside')
  assert.equal(inside.overflow, true, '窄盒长文案必须报溢出')
})
