/**
 * 把整片 manifest **精确**切成两段。
 *
 * 为什么需要它：产品的渲染回执（`warnings` + `metrics`，含逐条文字轨体检明细）
 * 走的是 **URL 查询串**（`src/client/api.ts:1226-1230`），而 `@deepseek-ai/dsh-host-webserver`
 * 用裸 `createServer(listener)`（无 `maxHeaderSize`）⇒ Node 默认上限 **16,384B**。
 * 本片整片的回执实测 16,270B（query 16,239B）⇒ 压线越界 ⇒ HTTP 431，
 * 表现为「渲染完成 55s / 进度 100% 后回执失败，mp4 从未落盘」。
 *
 * 切两段后每段的回执只有一半（文字轨 44 / 16 条 ⇒ 约 12KB / 7KB）⇒ 两段都能过线。
 *
 * **精确性**：切点必须落在「无跨轨」的帧上 —— 即该帧没有任何轨跨越
 * （每条轨要么整段在前、要么整段在后）。此时切分不需要重基任何动画：
 * `animate` / `exit` 的帧号是**相对轨起点**的，轨起点整体平移即保持动画不变。
 * 本 manifest 的 9 个镜头边界（444/612/666/834/1002/1170/1338/1506/1560）全是干净切点。
 *
 * 用法：
 *   node scripts/playsout-replica/split-manifest.mjs \
 *     --manifest <整片 manifest> --cut 1002 \
 *     --out-dir <目录> --name <前缀>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback
}

const manifestPath = resolve(argOf('--manifest', 'build/playsout/manifest.json'))
const cut = Number(argOf('--cut', '1002'))
const outDir = resolve(argOf('--out-dir', 'build/playsout'))
const name = argOf('--name', 'playsout')

const m = JSON.parse(readFileSync(manifestPath, 'utf8'))
const total = m.meta.durationInFrames

if (!Number.isInteger(cut) || cut <= 0 || cut >= total) {
  throw new Error(`--cut 必须是 1..${total - 1} 的整数，收到 ${cut}`)
}

/** 收集所有轨（含 group 子轨；子轨时间相对组起点 ⇒ 只需平移组起点）。 */
function collect(tracks, out = []) {
  for (const t of tracks) {
    out.push(t)
    if (Array.isArray(t.children)) collect(t.children, out)
  }
  return out
}
const all = collect(m.tracks ?? [])

// ① 切点必须无跨轨
const crossing = all.filter((t) => (t.startFrame ?? 0) < cut && (t.startFrame ?? 0) + (t.durationInFrames ?? 0) > cut)
if (crossing.length > 0) {
  throw new Error(
    `切点 ${cut} 有 ${crossing.length} 条轨跨越（${crossing.slice(0, 5).map((t) => t.id).join(', ')}）—— ` +
    '切段会丢动画。改用镜头边界等「无跨轨」帧。',
  )
}

// ② 音频：sfx 是 {src, startFrame, gain}；startFrame < cut 的归前半，
//    ≥ cut 的归后半并平移。VO 音频挂在 caption 轨的 src 上（轨不跨切点 ⇒ 自动跟随）。
const sfx = m.audio?.sfx ?? []
const sfxBefore = sfx.filter((s) => (s.startFrame ?? 0) < cut)
const sfxAfter = sfx.filter((s) => (s.startFrame ?? 0) >= cut).map((s) => ({ ...s, startFrame: s.startFrame - cut }))

function half({ from, to, duration, shift, sfxList }) {
  const tracks = (m.tracks ?? [])
    .filter((t) => {
      const s = t.startFrame ?? 0
      return shift === 0 ? s < to : s >= from
    })
    .map((t) => (shift === 0 ? t : { ...t, startFrame: (t.startFrame ?? 0) - shift }))
  return {
    ...m,
    id: `${m.id}-${name}-${shift === 0 ? 'a' : 'b'}`,
    meta: { ...m.meta, durationInFrames: duration },
    tracks,
    audio: { ...(m.audio ?? {}), sfx: sfxList },
  }
}

const p1 = half({ from: 0, to: cut, duration: cut, shift: 0, sfxList: sfxBefore })
const p2 = half({ from: cut, to: total, duration: total - cut, shift: cut, sfxList: sfxAfter })

const outA = join(outDir, `${name}-p1.json`)
const outB = join(outDir, `${name}-p2.json`)
writeFileSync(outA, JSON.stringify(p1, null, 2))
writeFileSync(outB, JSON.stringify(p2, null, 2))

const textCount = (h) => (h.tracks ?? []).filter((t) => t.type === 'textCard' || t.type === 'caption').length
const bytes = (h) => Buffer.byteLength(JSON.stringify(h))
console.log(`切点 ${cut}（无跨轨 ✓）｜整片 ${total} 帧`)
console.log(`  p1: ${p1.tracks.length} 顶层轨 / 文字轨 ${textCount(p1)} 条 / ${p1.meta.durationInFrames} 帧 → ${outA}`)
console.log(`  p2: ${p2.tracks.length} 顶层轨 / 文字轨 ${textCount(p2)} 条 / ${p2.meta.durationInFrames} 帧 → ${outB}`)
console.log(`  sfx: 前 ${sfxBefore.length} / 后 ${sfxAfter.length}（总计 ${sfx.length}，跨切点的会整段归前半）`)
console.log(`  manifest 体积：p1 ${(bytes(p1) / 1024).toFixed(1)}KB / p2 ${(bytes(p2) / 1024).toFixed(1)}KB`)
