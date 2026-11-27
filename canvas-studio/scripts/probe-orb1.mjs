/**
 * 一次性探针：ORB1 现在能不能用（生成层 + manifest 校验层）。
 * 看完即删，不入库。
 */
import { getCard } from '../lib/remotion/recipe-cards-all.js'
import { mockCtx } from './gen-card-catalog.mjs'
import { validateManifest } from '../lib/remotion/manifest.js'

const card = getCard('ORB1')
const copy = '月亮走的路\n不是一个圆\n是一个椭圆'
const label = '知识点一 · 轨道是椭圆'

function build(data, durationInFrames = 210) {
  const ctx = { ...mockCtx(card, copy, label), durationInFrames, data }
  return card.generate(ctx)
}

function findGroup(tracks) {
  return tracks.find((t) => t?.type === 'group')
}

function asManifest(tracks, durationInFrames = 210) {
  return {
    id: 'probe-orb1',
    meta: { fps: 30, width: 1920, height: 1080, durationInFrames, title: 'probe' },
    tracks,
  }
}

const cases = [
  { name: '默认（tiltX 不给）', data: {}, dur: 210 },
  { name: 'tiltX=10（3D 容器）', data: { tiltX: 10 }, dur: 210 },
  { name: '大半径+周期 6s（P1-8 边界）', data: { radiusX: 48, periodSec: 6 }, dur: 180 },
  { name: '最小段 2s + 大半径', data: { radiusX: 46, periodSec: 2 }, dur: 60 },
  { name: '四体 + 近远缩放 + 标签', data: { bodies: 4, scaleNearFar: 3, labels: '远地点,近地点' }, dur: 300 },
]

for (const item of cases) {
  let tracks
  try {
    tracks = build(item.data, item.dur)
  } catch (error) {
    console.log(`✗ ${item.name} → 生成抛错：${error.message}`)
    continue
  }
  const group = findGroup(tracks)
  const count = tracks.reduce((sum, t) => sum + 1 + (Array.isArray(t.children) ? t.children.length : 0), 0)
  const check = validateManifest(asManifest(tracks, item.dur))
  const round = works => (works ? '✓' : '✗')
  console.log(
    `${round(check.ok)} ${item.name.padEnd(28)} 轨=${String(tracks.length).padStart(2)} 含子=${String(count).padStart(3)}`
    + ` group=${group ? `有 rotateX=${String(group.transform?.rotateX)}` : '无'}`
    + ` 校验=${check.ok ? 'ok' : `ERROR ${check.errors.slice(0, 2).join(' / ')}`}`,
  )
}

// 槽名验证：真槽名能挂上图，猜的名字静默降级
const ctxReal = mockCtx(card, copy, label)
const realTracks = card.generate({ ...ctxReal, assetSrc: (slot) => (['core', 'satellite'].includes(slot) ? '/x.png' : undefined) })
const wrongTracks = card.generate({ ...ctxReal, assetSrc: () => undefined })
const countImages = ts => ts.reduce((n, t) => n + (t.type === 'image' ? 1 : 0) + (Array.isArray(t.children) ? t.children.filter(c => c.type === 'image').length : 0), 0)
console.log(`槽名 core/satellite → image 轨 ${countImages(realTracks)} 条；全空 → ${countImages(wrongTracks)} 条（0 = 降级纯色圆，不报错）`)
