/**
 * 1C（CV-462）· 装饰构件层：`expandFurniture` 纯函数。
 *
 * 守的核心只有三条：
 *
 * 1. **几何对**（`box` 是中心语义，这是最容易算错半屏的地方）；
 * 2. **确定性**（同 spec + 同 ctx 逐字节相同，星点靠固定种子）；
 * 3. **零契约扩展**（展开出的轨道能直接过 `validateManifest`，渲染器不认识构件）。
 *
 * 反向变异锚点在下单测末尾（改括线中心公式必须让几何用例变红）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FURNITURE_DEFAULTS,
  FurnitureError,
  expandFurniture,
  expandFurnitureList,
} from '../lib/remotion/furniture.js'
import { validateManifest } from '../lib/remotion/manifest.js'

const CTX = { canvasWidth: 1920, canvasHeight: 1080, fps: 60, totalFrames: 1080 }

/** 把构件轨道塞进一份**最小合法** manifest（用于证明「零契约扩展」）。 */
function withTracks(tracks) {
  return {
    id: 'fx-test',
    meta: { title: '构件', width: CTX.canvasWidth, height: CTX.canvasHeight, fps: CTX.fps, durationInFrames: CTX.totalFrames },
    tracks: [
      { id: 'bg', type: 'shape', shape: 'gradient', color: '#0b1220', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: 0, durationInFrames: CTX.totalFrames },
      ...tracks,
    ],
  }
}

// ── ① 四角括线 ──────────────────────────────────────────────────────────

test('1C：cornerBrackets ⇒ 8 条 shape:rect，且每角一竖一横', () => {
  const tracks = expandFurniture({ id: 'cornerBrackets' }, CTX)
  assert.equal(tracks.length, 8)
  for (const track of tracks) {
    assert.equal(track.type, 'shape')
    assert.equal(track.shape, 'rect')
    assert.equal(track.startFrame, 0)
    assert.equal(track.durationInFrames, CTX.totalFrames)
    assert.equal(track.fadeFrames, 0, '装饰层不整体淡入（硬切）')
  }
  for (const corner of ['tl', 'tr', 'bl', 'br']) {
    const vertical = tracks.find((t) => t.id === `fx-corner-${corner}-v`)
    const horizontal = tracks.find((t) => t.id === `fx-corner-${corner}-h`)
    assert.ok(vertical && horizontal, `缺 ${corner} 的竖/横线`)
    assert.ok(vertical.box.h > vertical.box.w, '竖线：高 > 宽')
    assert.ok(horizontal.box.w > horizontal.box.h, '横线：宽 > 高')
  }
})

test('1C ★几何：框线中心坐标按「中心语义」算（左上竖线 x = inset，y = inset + arm/2）', () => {
  const { inset, arm, thickness } = FURNITURE_DEFAULTS.cornerBrackets
  const tracks = expandFurniture({ id: 'cornerBrackets' }, CTX)
  const tlV = tracks.find((t) => t.id === 'fx-corner-tl-v').box
  const tlH = tracks.find((t) => t.id === 'fx-corner-tl-h').box
  assert.deepEqual(tlV, { x: inset, y: inset + arm / 2, w: thickness, h: arm })
  assert.deepEqual(tlH, { x: inset + arm / 2, y: inset, w: arm, h: thickness })
  // 右下 = 镜像（100 − 对应值）
  const brV = tracks.find((t) => t.id === 'fx-corner-br-v').box
  assert.equal(brV.x, 100 - inset)
  assert.equal(brV.y, 100 - inset - arm / 2)
  // 四角都在画布内侧 10% 以内（不能跑到画面外）
  for (const track of tracks) {
    assert.ok(track.box.x > 0 && track.box.x < 100, `${track.id} 的 x 出画布`)
    assert.ok(track.box.y > 0 && track.box.y < 100, `${track.id} 的 y 出画布`)
  }
})

test('1C：cornerBrackets 的 corner 参数可选单角（"tl" ⇒ 2 条）', () => {
  const tracks = expandFurniture({ id: 'cornerBrackets', params: { corner: 'tl' } }, CTX)
  assert.equal(tracks.length, 2)
  assert.deepEqual(tracks.map((t) => t.id).sort(), ['fx-corner-tl-h', 'fx-corner-tl-v'])
})

// ── ② 底部进度条 ────────────────────────────────────────────────────────

test('1C：progressBar ⇒ ticks + 1 条轨，最后一条是游标且带 animate.x', () => {
  const tracks = expandFurniture({ id: 'progressBar', params: { ticks: 40 } }, CTX)
  assert.equal(tracks.length, 41)
  const cursor = tracks.at(-1)
  assert.equal(cursor.id, 'fx-progress-cursor')
  assert.ok(cursor.animate, '游标必须有 animate（帧内连续移动）')
  assert.equal(cursor.animate.easing, 'linear', '进度条表达时间，缓动会让位置与时间轴不符')
  assert.deepEqual(cursor.animate.from, { x: FURNITURE_DEFAULTS.progressBar.left })
  assert.deepEqual(cursor.animate.to, { x: FURNITURE_DEFAULTS.progressBar.right })
  assert.equal(cursor.animate.durationInFrames, CTX.totalFrames, '缺省走完整片')
})

test('1C：progressBar 的刻度均分在 left→right（首尾落端点，单调不减）', () => {
  const { left, right, ticks } = FURNITURE_DEFAULTS.progressBar
  const trackList = expandFurniture({ id: 'progressBar' }, CTX).filter((t) => t.id.startsWith('fx-tick-'))
  assert.equal(trackList.length, ticks)
  assert.equal(trackList[0].box.x, left)
  assert.equal(trackList.at(-1).box.x, right)
  for (let i = 1; i < trackList.length; i += 1) {
    assert.ok(trackList[i].box.x >= trackList[i - 1].box.x, `第 ${i} 个刻度比前一个小`)
  }
  // 游标 box 的 x 也在起点（animate 的 from 才是真实起点；box 是缺省落点）
  const cursor = expandFurniture({ id: 'progressBar' }, CTX).at(-1)
  assert.equal(cursor.box.x, left)
  assert.ok(cursor.box.y > 90, '进度条必须贴底（y 接近 100）')
})

// ── ③ 星点 ──────────────────────────────────────────────────────────────

test('1C：starfield ⇒ count 条 circle，且同 seed 逐字节相同（确定性）', () => {
  const a = JSON.stringify(expandFurniture({ id: 'starfield', params: { count: 12, seed: 7 } }, CTX))
  const b = JSON.stringify(expandFurniture({ id: 'starfield', params: { count: 12, seed: 7 } }, CTX))
  assert.equal(a, b, '同 spec 两次展开必须逐字节相同（禁 Math.random）')
  assert.equal(expandFurniture({ id: 'starfield', params: { count: 12 } }, CTX).length, 12)
  const other = JSON.stringify(expandFurniture({ id: 'starfield', params: { count: 12, seed: 8 } }, CTX))
  assert.notEqual(a, other, '不同 seed 必须给出不同星图（否则种子没生效）')
})

test('1C：starfield 的星点都在画布内、尺寸为正', () => {
  for (const track of expandFurniture({ id: 'starfield', params: { count: 30 } }, CTX)) {
    assert.equal(track.shape, 'circle')
    assert.ok(track.box.w > 0)
    assert.ok(track.box.x >= 0 && track.box.x <= 100, `${track.id} 的 x 出画布`)
    assert.ok(track.box.y >= 0 && track.box.y <= 100, `${track.id} 的 y 出画布`)
  }
})

// ── ④ 契约边界 ──────────────────────────────────────────────────────────

test('1C：未知 id / 缺 ctx / 非法帧区间 ⇒ 抛 FurnitureError（不静默返回空）', () => {
  assert.throws(() => expandFurniture({ id: 'glassCard' }, CTX), (error) => error instanceof FurnitureError && error.code === 'FURNITURE_UNKNOWN_ID')
  assert.throws(() => expandFurniture({ id: 'cornerBrackets' }, {}), (error) => error.code === 'FURNITURE_BAD_CONTEXT')
  assert.throws(() => expandFurniture({ id: 'cornerBrackets' }, { ...CTX, canvasWidth: 0 }), (error) => error.code === 'FURNITURE_BAD_CONTEXT')
  assert.throws(() => expandFurniture({ id: 'cornerBrackets' }, { ...CTX, totalFrames: 0 }), (error) => error.code === 'FURNITURE_BAD_CONTEXT')
  assert.throws(() => expandFurniture({ id: 'cornerBrackets', startFrame: 100, endFrame: 100 }, CTX), (error) => error.code === 'FURNITURE_BAD_RANGE')
})

test('1C：startFrame / endFrame 生效（装饰只出现在指定区间）', () => {
  for (const track of expandFurniture({ id: 'cornerBrackets', startFrame: 120, endFrame: 480 }, CTX)) {
    assert.equal(track.startFrame, 120)
    assert.equal(track.durationInFrames, 360)
  }
})

test('1C：批量展开轨 id 冲突 ⇒ 抛错（不许静默覆盖）', () => {
  assert.throws(
    () => expandFurnitureList([{ id: 'cornerBrackets' }, { id: 'cornerBrackets' }], CTX),
    (error) => error.code === 'FURNITURE_ID_CONFLICT',
  )
  assert.equal(expandFurnitureList([{ id: 'cornerBrackets' }, { id: 'progressBar' }], CTX).length, 49)
})

test('1C ★零契约扩展：展开出的轨道直接过 validateManifest（ok / 0 error）', () => {
  const tracks = expandFurnitureList(
    [
      { id: 'cornerBrackets' },
      { id: 'progressBar', params: { ticks: 12 } },
      { id: 'starfield', params: { count: 8 } },
    ],
    CTX,
  )
  const manifest = withTracks(tracks)
  const verdict = validateManifest(manifest)
  assert.deepEqual(verdict.errors, [], `构件必须零契约扩展（不许引入新字段）：${verdict.errors.join('；')}`)
})

// ── ⑤ 反向变异锚点 ─────────────────────────────────────────────────────
//
// 变异：把左上竖线的中心 y 从 `inset + arm/2` 改成 `inset`（= 忘记「box 是中心」，
// 构件实现里最容易犯的错，症状是括线整体偏移半个臂长）。
// 期望：只有 ★几何 那条变红。

test('1C ★反向变异锚点：中心语义不可退化（4 条括线各偏半个臂长必须被发现）', () => {
  const { inset, arm } = FURNITURE_DEFAULTS.cornerBrackets
  const tracks = expandFurniture({ id: 'cornerBrackets' }, CTX)
  const tlV = tracks.find((t) => t.id === 'fx-corner-tl-v').box
  const tlH = tracks.find((t) => t.id === 'fx-corner-tl-h').box
  assert.notEqual(tlV.y, inset, '竖线中心不能等于 inset（那是左上角，不是竖线中心）')
  assert.notEqual(tlH.x, inset, '横线中心不能等于 inset')
  assert.ok(Math.abs((tlV.y - tlH.y) - arm / 2) < 1e-9, '横线的中心与竖线的中心必须差半个臂长')
})
