/**
 * REQ-034 · 三期 W1-3：**编排体检**（motion lint）单测。
 *
 * 这层是「合法但难看」的唯一回执：`validateManifest` 只管结构，6 个元素同帧冒出、
 * 动画只跑 3 帧、有进无出最后硬切，全靠这 12 条规则说话。所以必须双向验：
 * **该报的要报**（真问题不漏）、**不该报的不报**（噪声会把真问题淹掉）。
 *
 * 直连 Host tsc 编译产物 `lib/remotion/motion-lint.js` 与 `manifest.js`。
 * 定向跑：node --test tests/remotion-motion-lint.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatMotionLint, lintMotion } from '../lib/remotion/motion-lint.js'
import { validateManifest } from '../lib/remotion/manifest.js'

function manifest(tracks, meta = {}) {
  return {
    id: 'comp-lint',
    meta: { title: '编排体检', width: 1280, height: 720, fps: 30, durationInFrames: 120, ...meta },
    tracks,
  }
}

function codes(issues) {
  return issues.map((issue) => issue.code)
}

const ENTER = { from: { y: 70, opacity: 0 }, to: { y: 50, opacity: 1 }, durationInFrames: 60, easing: 'easeOutCubic' }

/** 一份「没毛病」的片子：两条轨错峰、都有入场、首条有退场、末条收在片尾。 */
function cleanManifest() {
  return manifest([
    { id: 'a', type: 'textCard', variant: 'title', text: 'A', startFrame: 0, durationInFrames: 60, animate: ENTER, exit: { to: { opacity: 0 }, durationInFrames: 8 } },
    { id: 'b', type: 'textCard', variant: 'title', text: 'B', startFrame: 60, durationInFrames: 60, animate: ENTER },
  ])
}

test('干净片子零意见（体检不能变成噪声源）', () => {
  assert.deepEqual(lintMotion(cleanManifest()), [])
})

test('meta.lint:"off" 整体关闭（刻意的写法不该被淹）', () => {
  const bad = manifest([
    { id: 'a', type: 'textCard', variant: 'title', text: 'A', startFrame: 0, durationInFrames: 30, animate: { from: { x: 0 }, to: { x: 100 }, durationInFrames: 3, easing: 'linear' } },
  ], { lint: 'off' })
  assert.deepEqual(lintMotion(bad), [])
})

test('ML-01：≥3 条轨同帧入场且都带动画', () => {
  const issues = lintMotion(manifest([
    { id: 'a', type: 'textCard', variant: 'title', text: 'A', startFrame: 0, durationInFrames: 60, animate: ENTER },
    { id: 'b', type: 'textCard', variant: 'title', text: 'B', startFrame: 0, durationInFrames: 60, animate: ENTER },
    { id: 'c', type: 'textCard', variant: 'title', text: 'C', startFrame: 0, durationInFrames: 60, animate: ENTER },
  ]))
  assert.ok(codes(issues).includes('ML-01'), `应报 ML-01，实际：${codes(issues).join(',')}`)
  const issue = issues.find((entry) => entry.code === 'ML-01')
  assert.equal(issue.at, 'startFrame=0', '定位到具体的起始帧')
  assert.match(issue.hint, /startAfter|错峰/, '建议必须可执行')
})

test('ML-02：提前结束 + fadeFrames:0 + 无 exit / 无尾部转场 ⇒ 凭空消失', () => {
  const issues = lintMotion(manifest([
    { id: 'a', type: 'textCard', variant: 'title', text: 'A', startFrame: 0, durationInFrames: 40, fadeFrames: 0 },
  ]))
  assert.ok(codes(issues).includes('ML-02'), `应报 ML-02，实际：${codes(issues).join(',')}`)

  // 有 exit / 收在片尾 / 缺省淡出（fadeFrames 未写）都不该报
  for (const track of [
    { id: 'a', type: 'textCard', variant: 'title', text: 'A', startFrame: 0, durationInFrames: 40, fadeFrames: 0, exit: { to: { opacity: 0 } } },
    { id: 'a', type: 'textCard', variant: 'title', text: 'A', startFrame: 0, durationInFrames: 120, fadeFrames: 0 },
    { id: 'a', type: 'textCard', variant: 'title', text: 'A', startFrame: 0, durationInFrames: 40 },
  ]) {
    const found = lintMotion(manifest([track]))
    assert.ok(!codes(found).includes('ML-02'), `不该报 ML-02：${JSON.stringify(track)}`)
  }
})

test('ML-03：动画短于 6 帧（观感是抖动）', () => {
  const issues = lintMotion(manifest([
    { id: 'a', type: 'textCard', variant: 'title', text: 'A', startFrame: 0, durationInFrames: 60, animate: { from: { opacity: 0 }, to: { opacity: 1 }, durationInFrames: 4 } },
  ]))
  assert.ok(codes(issues).includes('ML-03'), `应报 ML-03，实际：${codes(issues).join(',')}`)
})

test('ML-04：动画过长且几乎不动（拖沓）', () => {
  const issues = lintMotion(manifest([
    { id: 'a', type: 'textCard', variant: 'title', text: 'A', startFrame: 0, durationInFrames: 120, animate: { from: { x: 50 }, to: { x: 51 }, durationInFrames: 100, easing: 'easeOutCubic' } },
  ]))
  assert.ok(codes(issues).includes('ML-04'), `应报 ML-04，实际：${codes(issues).join(',')}`)
})

test('ML-05：位移 / 缩放用 linear（机械感）', () => {
  const issues = lintMotion(manifest([
    { id: 'a', type: 'textCard', variant: 'title', text: 'A', startFrame: 0, durationInFrames: 60, animate: { from: { x: 0 }, to: { x: 40 }, durationInFrames: 20, easing: 'linear' } },
  ]))
  assert.ok(codes(issues).includes('ML-05'), `应报 ML-05，实际：${codes(issues).join(',')}`)

  // 只动 opacity 用 linear 是可以的（透明度线性推进本来就是常见做法）
  const opacityOnly = lintMotion(manifest([
    { id: 'a', type: 'textCard', variant: 'title', text: 'A', startFrame: 0, durationInFrames: 60, animate: { from: { opacity: 0 }, to: { opacity: 1 }, durationInFrames: 20, easing: 'linear' } },
  ]))
  assert.ok(!codes(opacityOnly).includes('ML-05'), '纯透明度不该被 ML-05 管')
})

test('ML-06：转场短于 6 帧（肉眼看不见）', () => {
  const issues = lintMotion(manifest([
    { id: 'a', type: 'image', src: '/canvas-studio/assets/p/a.png', startFrame: 0, durationInFrames: 80 },
    { id: 'b', type: 'image', src: '/canvas-studio/assets/p/b.png', startFrame: 60, durationInFrames: 60 },
    { id: 'tr', type: 'transition', effect: 'fade', fromTrackId: 'a', toTrackId: 'b', startFrame: 60, durationInFrames: 4 },
  ]))
  assert.ok(codes(issues).includes('ML-06'), `应报 ML-06，实际：${codes(issues).join(',')}`)
})

test('ML-07：同帧 ≥4 条轨在动（主次不清）', () => {
  const issues = lintMotion(manifest([
    ...['a', 'b', 'c', 'd'].map((id, index) => ({
      id, type: 'textCard', variant: 'title', text: id,
      startFrame: index, durationInFrames: 60,
      animate: { from: { opacity: 0 }, to: { opacity: 1 }, durationInFrames: 30, easing: 'easeOutCubic' },
    })),
  ]))
  assert.ok(codes(issues).includes('ML-07'), `应报 ML-07，实际：${codes(issues).join(',')}`)
})

test('ML-08：全片 ≥5 条轨且没有任何 exit', () => {
  const tracks = Array.from({ length: 5 }, (_, index) => ({
    id: `t${index}`, type: 'textCard', variant: 'title', text: `T${index}`,
    startFrame: index * 10, durationInFrames: 60,
  }))
  const issues = lintMotion(manifest(tracks))
  assert.ok(codes(issues).includes('ML-08'), `应报 ML-08，实际：${codes(issues).join(',')}`)

  // 只要一条有 exit 就不报
  const withExit = [...tracks]
  withExit[0] = { ...withExit[0], exit: { to: { opacity: 0 } } }
  assert.ok(!codes(lintMotion(manifest(withExit))).includes('ML-08'))
})

test('ML-09：动画端点跑出画布（x/y 越界）', () => {
  const issues = lintMotion(manifest([
    { id: 'a', type: 'textCard', variant: 'title', text: 'A', startFrame: 0, durationInFrames: 60, animate: { from: { x: 120 }, to: { x: 50 }, durationInFrames: 20, easing: 'easeOutCubic' } },
  ]))
  assert.ok(codes(issues).includes('ML-09'), `应报 ML-09，实际：${codes(issues).join(',')}`)
})

test('ML-10：动效覆盖 < 30% 轨道总时长（幻灯片）', () => {
  const issues = lintMotion(manifest([
    { id: 'a', type: 'textCard', variant: 'title', text: 'A', startFrame: 0, durationInFrames: 120, animate: { from: { opacity: 0 }, to: { opacity: 1 }, durationInFrames: 10, easing: 'easeOutCubic' } },
  ]))
  assert.ok(codes(issues).includes('ML-10'), `应报 ML-10，实际：${codes(issues).join(',')}`)
})

/**
 * 真机《修表的人》的轨道构成（REQ-034 O-02 的回归样本）：
 * 满画布 bg 600 + 三镜 video 155×3 + 整片长 audioViz 600 + 文字卡 656（入场 44 + 退场 72）。
 * 原实现：分子 116 / 分母 2321 = 5% ⇒ 连续 7 次渲染都在报，一次没消失。
 */
function materialDrivenManifest() {
  const textCard = (id, startFrame) => ({
    id,
    type: 'textCard',
    variant: 'subtitle',
    text: '一句字幕',
    startFrame,
    durationInFrames: 328,
    animate: { from: { opacity: 0, y: 8 }, to: { opacity: 1, y: 0 }, durationInFrames: 22, easing: 'easeOutCubic' },
    exit: { to: { opacity: 0 }, durationInFrames: 36 },
  })
  return manifest([
    // 满画布背景板：常驻装饰，不该要求它写 animate
    { id: 'bg-base', type: 'shape', shape: 'gradient', color: '#111827', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: 0, durationInFrames: 600 },
    // 三镜素材：视频本身在动
    { id: 's1', type: 'video', src: '/canvas-studio/assets/p/s1.mp4', startFrame: 0, durationInFrames: 155 },
    { id: 's2', type: 'video', src: '/canvas-studio/assets/p/s2.mp4', startFrame: 155, durationInFrames: 155 },
    { id: 's3', type: 'video', src: '/canvas-studio/assets/p/s3.mp4', startFrame: 310, durationInFrames: 155 },
    // 整片长音频可视化：柱高由真实振幅逐帧驱动
    { id: 'pulse-line', type: 'audioViz', src: '/canvas-studio/assets/p/bgm.mp3', startFrame: 0, durationInFrames: 600 },
    textCard('t1', 0),
    textCard('t2', 328),
  ], { durationInFrames: 600 })
}

test('ML-10（REQ-034 O-02）：素材驱动片不再恒报——视频/满画布背景/整片长波形都不该算「静态」', () => {
  const issues = lintMotion(materialDrivenManifest())
  assert.ok(
    !codes(issues).includes('ML-10'),
    `素材驱动片不该报 ML-10，实际：${codes(issues).join(',')}（${issues.map((i) => i.message).join(' / ')}）`,
  )
})

test('ML-10（REQ-034 O-02）：纯图文片仍然要报（不能为了消噪声把真问题一起关掉）', () => {
  // 同一份片子去掉三条视频轨 —— 只剩静态图文 + 短动画，这才是真幻灯片。
  const staticOnly = materialDrivenManifest()
  staticOnly.tracks = staticOnly.tracks.filter((track) => track.type !== 'video')
  const issues = lintMotion(staticOnly)
  assert.ok(codes(issues).includes('ML-10'), `纯静态图文片应报 ML-10，实际：${codes(issues).join(',')}`)
})

test('ML-11 / ML-12：字幕超 3 行、单行超 28 字', () => {
  const tooManyLines = lintMotion(manifest([
    { id: 's', type: 'textCard', variant: 'subtitle', text: ['一', '二', '三', '四'], startFrame: 0, durationInFrames: 120 },
  ]))
  assert.ok(codes(tooManyLines).includes('ML-11'), `应报 ML-11，实际：${codes(tooManyLines).join(',')}`)

  const tooLong = lintMotion(manifest([
    { id: 's', type: 'textCard', variant: 'subtitle', text: '这'.repeat(29), startFrame: 0, durationInFrames: 120 },
  ]))
  assert.ok(codes(tooLong).includes('ML-12'), `应报 ML-12，实际：${codes(tooLong).join(',')}`)

  // 3 行 / 28 字恰好合法（边界不能提前一帧）
  const boundary = lintMotion(manifest([
    { id: 's', type: 'textCard', variant: 'subtitle', text: ['甲'.repeat(28), '乙', '丙'], startFrame: 0, durationInFrames: 120 },
  ]))
  assert.ok(!codes(boundary).includes('ML-11'))
  assert.ok(!codes(boundary).includes('ML-12'))
})

test('上限 12 条：超出折成 ML-00 汇总（不刷屏）', () => {
  const tracks = Array.from({ length: 20 }, (_, index) => ({
    id: `t${index}`, type: 'textCard', variant: 'title', text: `T${index}`,
    startFrame: index * 2, durationInFrames: 120,
    animate: { from: { opacity: 0 }, to: { opacity: 1 }, durationInFrames: 3, easing: 'easeOutCubic' },
  }))
  const issues = lintMotion(manifest(tracks))
  assert.equal(issues.filter((issue) => issue.code !== 'ML-00').length, 12, '正文最多 12 条')
  assert.equal(issues.at(-1).code, 'ML-00', '最后一条必须是汇总')
  assert.match(issues.at(-1).message, /仅显示前 12 条/)
})

test('formatMotionLint：文案带编号与定位，message 与 hint 之间有句号（不粘成一句）', () => {
  const lines = formatMotionLint([
    { code: 'ML-03', at: 'tracks[0]', message: '动画只有 3 帧', hint: '建议 ≥ 10 帧' },
  ])
  assert.deepEqual(lines, ['[编排体检 ML-03] tracks[0]：动画只有 3 帧。建议 ≥ 10 帧'])
  assert.deepEqual(formatMotionLint([]), [])
})

test('接线：validateManifest 会把体检结果并入 warnings（只告警、不阻断）', () => {
  const input = manifest([
    { id: 'a', type: 'textCard', variant: 'title', text: 'A', startFrame: 0, durationInFrames: 60, animate: ENTER },
    { id: 'b', type: 'textCard', variant: 'title', text: 'B', startFrame: 0, durationInFrames: 60, animate: ENTER },
    { id: 'c', type: 'textCard', variant: 'title', text: 'C', startFrame: 0, durationInFrames: 60, animate: ENTER },
  ])
  const result = validateManifest(input)
  assert.equal(result.ok, true, '体检绝不阻断渲染')
  assert.ok(
    result.warnings.some((warning) => warning.startsWith('[编排体检 ML-01]')),
    `warnings 里应有体检回执，实际：\n${result.warnings.join('\n')}`,
  )

  // lint:'off' 后同一份片子不再有体检回执
  const muted = validateManifest({ ...input, meta: { ...input.meta, lint: 'off' } })
  assert.ok(!muted.warnings.some((warning) => warning.startsWith('[编排体检')), 'lint:off 必须真的静音')
})

test('接线：结构有错时不跑体检（避免噪声淹没真问题）', () => {
  const result = validateManifest(manifest([
    { id: 'a', type: 'textCard', variant: 'title', text: 'A', startFrame: -5, durationInFrames: 60, animate: ENTER },
    { id: 'b', type: 'textCard', variant: 'title', text: 'B', startFrame: 0, durationInFrames: 60, animate: ENTER },
    { id: 'c', type: 'textCard', variant: 'title', text: 'C', startFrame: 0, durationInFrames: 60, animate: ENTER },
  ]))
  assert.equal(result.ok, false)
  assert.ok(!result.warnings.some((warning) => warning.startsWith('[编排体检')), '结构错的时候体检结论不可信')
})

// ── REQ-035 F-09：去重 + 往复豁免 ───────────────────────────────────────────

test('F-09：同一条轨的多段长动画只报一条 ML-04（不许刷屏挤掉别的告警）', () => {
  // 事故现场：glowWide 轨上 3 段 900/760/1040 帧的呼吸动画 → 原实现产出 3 条一样的 ML-04
  const m = manifest([
    {
      id: 'glowWide',
      type: 'shape',
      shape: 'rect',
      color: '#123456',
      box: { x: 50, y: 50, w: 10, h: 10 },
      startFrame: 0,
      durationInFrames: 120,
      animate: [
        { from: { x: 50 }, to: { x: 53 }, durationInFrames: 60 },
        { from: { x: 53 }, to: { x: 57 }, durationInFrames: 60 },
        { from: { x: 57 }, to: { x: 60 }, durationInFrames: 60 },
      ],
    },
  ])
  const ml04 = lintMotion(m).filter((issue) => issue.code === 'ML-04')
  assert.equal(ml04.length, 1, `同轨同规则只留一条，实际 ${ml04.length} 条`)
})

test('F-09：往复呼吸（首尾状态相同）不算「动画拖沓」，不报 ML-04', () => {
  // 典型环境光呼吸：x 从 50 漂到 53 再回到 50，时长很长 —— 这是设计意图
  const m = manifest([
    {
      id: 'glowCore',
      type: 'shape',
      shape: 'rect',
      color: '#123456',
      box: { x: 50, y: 50, w: 10, h: 10 },
      startFrame: 0,
      durationInFrames: 120,
      animate: [
        { from: { x: 50 }, to: { x: 53 }, durationInFrames: 60 },
        { from: { x: 53 }, to: { x: 50 }, durationInFrames: 60 },
      ],
    },
  ])
  assert.deepEqual(lintMotion(m).filter((issue) => issue.code === 'ML-04'), [])
})

test('F-09：首尾不同的长动画仍要报 ML-04（豁免不能放太宽）', () => {
  const m = manifest([
    {
      id: 'lazy',
      type: 'shape',
      shape: 'rect',
      color: '#123456',
      box: { x: 50, y: 50, w: 10, h: 10 },
      startFrame: 0,
      durationInFrames: 120,
      animate: [
        { from: { x: 10 }, to: { x: 12 }, durationInFrames: 60 },
        { from: { x: 12 }, to: { x: 14 }, durationInFrames: 60 },
      ],
    },
  ])
  assert.equal(lintMotion(m).filter((issue) => issue.code === 'ML-04').length, 1)
})
