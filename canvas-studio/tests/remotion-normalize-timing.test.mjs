/**
 * REQ-034 · 三期 W1-2：`startAfter`（顺序衔接）归一化单测。
 *
 * 这条链只有一份实现（`normalize-timing.ts`），所以这里守的就是「它到底怎么算」：
 * 引用只能是**数组里更靠前的轨**（天然无环）· 与 `startFrame` 互斥 ·
 * 归一后必须能被 `validateManifest` 再次收下（这条曾经是 100% 失败的）。
 *
 * 直连 Host tsc 编译产物 `lib/remotion/normalize-timing.js`。
 * 定向跑：node --test tests/remotion-normalize-timing.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatResolvedStarts, normalizeManifestTiming } from '../lib/remotion/normalize-timing.js'
import { validateManifest } from '../lib/remotion/manifest.js'

function base(tracks, overrides = {}) {
  return {
    id: 'comp-norm',
    meta: { title: '顺序衔接', width: 1280, height: 720, fps: 30, durationInFrames: 300, lint: 'off' },
    tracks,
    ...overrides,
  }
}

const TITLE = (id, extra) => ({ id, type: 'textCard', variant: 'title', text: id, durationInFrames: 60, ...extra })

test('没有 startAfter ⇒ 逐轨返回原对象引用（零拷贝），全部 via=startFrame', () => {
  const manifest = base([TITLE('a', { startFrame: 0 }), TITLE('b', { startFrame: 60 })])
  const result = normalizeManifestTiming(manifest)
  assert.deepEqual(result.errors, [])
  assert.equal(result.manifest.tracks[0], manifest.tracks[0], '无改动的轨不该被复制（大 manifest 的性能线）')
  assert.equal(result.manifest.tracks[1], manifest.tracks[1])
  assert.deepEqual(result.resolved.map((entry) => [entry.id, entry.startFrame, entry.via]), [
    ['a', 0, 'startFrame'],
    ['b', 60, 'startFrame'],
  ])
})

test('链式衔接：a → b(gap 4) → c(gap 0) 逐个累加', () => {
  const manifest = base([
    TITLE('a', { startFrame: 10 }),
    TITLE('b', { startAfter: { trackId: 'a', gapFrames: 4 } }),
    TITLE('c', { startAfter: { trackId: 'b' } }),
  ])
  const result = normalizeManifestTiming(manifest)
  assert.deepEqual(result.errors, [])

  const starts = result.manifest.tracks.map((track) => track.startFrame)
  assert.deepEqual(starts, [10, 74, 134], '10 + 60 + 4 = 74；74 + 60 + 0 = 134')

  const chained = result.resolved.filter((entry) => entry.via === 'startAfter')
  assert.deepEqual(chained.map((entry) => [entry.id, entry.refTrackId, entry.gapFrames]), [
    ['b', 'a', 4],
    ['c', 'b', 0],
  ])
  assert.ok(result.warnings.some((warning) => warning.includes('实际起始帧 74')), '解析结果要让模型看得见')
})

test('归一后必须**删掉** startAfter —— 否则 validateManifest 的互斥校验会把每条链都拒收', () => {
  const manifest = base([
    TITLE('a', { startFrame: 0 }),
    TITLE('b', { startAfter: { trackId: 'a', gapFrames: 5 } }),
  ])
  const result = normalizeManifestTiming(manifest)
  assert.deepEqual(result.errors, [])

  const normalized = result.manifest.tracks[1]
  assert.equal(normalized.startFrame, 65)
  assert.equal('startAfter' in normalized, false, '归一后残留 startAfter ⇒ 互斥校验必红（曾经 100% 复现）')

  const validation = validateManifest(result.manifest)
  assert.deepEqual(validation.errors, [], `归一后的 manifest 必须能过契约校验：${validation.errors.join('；')}`)
})

test('归一化不就地改入参（同一份 manifest 可反复使用）', () => {
  const manifest = base([
    TITLE('a', { startFrame: 0 }),
    TITLE('b', { startAfter: { trackId: 'a' } }),
  ])
  const before = JSON.stringify(manifest)
  normalizeManifestTiming(manifest)
  assert.equal(JSON.stringify(manifest), before, '入参被就地改写会让重试 / 预览读到已被改过的 manifest')
})

test('自引用 ⇒ 报错（不能用自己算自己的起点）', () => {
  const result = normalizeManifestTiming(base([TITLE('a', { startAfter: { trackId: 'a' } })]))
  assert.match(result.errors.join('；'), /指向自己/)
})

test('前向引用 ⇒ 报错（只能接在数组更靠前的轨后面，天然无环）', () => {
  const result = normalizeManifestTiming(base([
    TITLE('a', { startAfter: { trackId: 'b' } }),
    TITLE('b', { startFrame: 0 }),
  ]))
  assert.match(result.errors.join('；'), /不在本轨之前/)
})

test('同时给 startFrame 与 startAfter ⇒ 报错（两个来源会让人算不清）', () => {
  const result = normalizeManifestTiming(base([
    TITLE('a', { startFrame: 0 }),
    TITLE('b', { startFrame: 60, startAfter: { trackId: 'a' } }),
  ]))
  assert.match(result.errors.join('；'), /不能同时给 startFrame 与 startAfter/)
})

test('gapFrames 非法（负数 / 小数）⇒ 报错', () => {
  assert.match(
    normalizeManifestTiming(base([TITLE('a', { startFrame: 0 }), TITLE('b', { startAfter: { trackId: 'a', gapFrames: -2 } })])).errors.join('；'),
    /gapFrames 必须是 >= 0 的整数/,
  )
  assert.match(
    normalizeManifestTiming(base([TITLE('a', { startFrame: 0 }), TITLE('b', { startAfter: { trackId: 'a', gapFrames: 1.5 } })])).errors.join('；'),
    /gapFrames 必须是 >= 0 的整数/,
  )
})

test('startFrame 缺失且无 startAfter ⇒ 报错并给 0 占位（不让 NaN 往下游渗）', () => {
  const result = normalizeManifestTiming(base([TITLE('a')]))
  assert.match(result.errors.join('；'), /startFrame 缺失或非法/)
  assert.equal(result.manifest.tracks[0].startFrame, 0, '占位必须是可用的数值，否则后续全变 NaN')
})

test('formatResolvedStarts：无链式返回空串；有链式逐条写成「id=帧(接 谁+空档)」', () => {
  assert.equal(formatResolvedStarts([{ id: 'a', startFrame: 0, via: 'startFrame' }]), '')
  assert.equal(
    formatResolvedStarts([
      { id: 'a', startFrame: 0, via: 'startFrame' },
      { id: 'b', startFrame: 74, via: 'startAfter', refTrackId: 'a', gapFrames: 4 },
      { id: 'c', startFrame: 134, via: 'startAfter', refTrackId: 'b', gapFrames: 0 },
    ]),
    'b=74(接 a+4)，c=134(接 b+0)',
  )
})
