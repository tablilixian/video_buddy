/**
 * #13 卡片墙投影 —— `cardWall` 构件落地前的**真渲探针**。
 *
 * 回答四个问题（D-39 的待验证假设）：
 *   A/B  `boxStyle` 把 `translate(-50%,-50%)` 拼在 `perspective()` **前面**，
 *        是否破坏投影 / 让整块静默消失？两格同参数，唯一差别是有无 `translate`。
 *   C    24 张各自带 `perspective()` 的卡，用 `projectCardWall` 手算投影排布后，
 *        是否真成一面 3D 墙（对称梯形是否可接受）？
 *   D    36 张 + `curve` 弧面墙：数量翻到 36 层 3D 后还能出画吗？整帧 ms/帧 多少？
 *
 * **公式零拷贝**：直接 import 产品纯函数 `projectCardWall` / `boxStyle` /
 * `resolveAnimatedStyle`，用与 `Shape.tsx` 完全相同的方式拼出最终 transform 串
 * （#11 的纪律：探针只读产品源码，公式漂移即本条失真）。
 */
import React from 'react'
import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { BenchFrame, FONT_FAMILY } from './shared.js'
import { boxStyle } from '../../../src/remotion/shape-geometry.js'
import { resolveAnimatedStyle } from '../../../src/remotion/animated-style.js'
import { projectCardWall, type CardWallCell } from '../../../src/remotion/card-wall-geometry.js'

export const meta = {
  id: '13',
  axis: 'cardwall-3d',
  title: '卡片墙 3D 投影（串顺序 / 对称梯形 / 24–36 层性能）',
  reference: '新模板批 · 第 2 步前置探针（D-39）',
  durationInFrames: 240,
  stills: [30, 90, 150, 210],
  assets: [],
} as const

const CELL_W = 900
const CELL_H = 420
const PERSPECTIVE = 900

/** 产品渲染路径：`track.transform` → `resolveAnimatedStyle` → `boxStyle` 的完整串。 */
function productTransform(cell: CardWallCell): { left: string; top: string; width: string; height: string; transform: string } {
  const track = {
    id: 'probe-card',
    type: 'shape',
    shape: 'rect',
    color: '#16233a',
    box: cell.box,
    startFrame: 0,
    durationInFrames: meta.durationInFrames,
    fadeFrames: 0,
    transform: cell.transform,
  } as unknown as Parameters<typeof resolveAnimatedStyle>[0]
  // localFrame = 0 且无 animate ⇒ animateStateAt 直接返回 transform 基线，纯姿势、无插值。
  const shapeTransform = resolveAnimatedStyle(track, 0).shapeTransform
  return boxStyle(cell.box, shapeTransform)
}

/** 卡片内嵌网格 + 左右不等宽色条：真透视（近大远小）一眼可辨。 */
const Tile: React.FC<{ label?: string; accent?: boolean }> = ({ label, accent = false }) => (
  <div
    style={{
      width: '100%',
      height: '100%',
      background: accent ? '#1d3358' : '#16233a',
      border: '1px solid rgba(90,210,255,0.55)',
      position: 'relative',
      overflow: 'hidden',
      fontFamily: FONT_FAMILY,
    }}
  >
    {[1, 2, 3].map((i) => (
      <div key={`v${i}`} style={{ position: 'absolute', top: 0, bottom: 0, left: `${(i * 100) / 4}%`, width: 1, background: 'rgba(90,210,255,0.28)' }} />
    ))}
    {[1, 2, 3].map((i) => (
      <div key={`h${i}`} style={{ position: 'absolute', left: 0, right: 0, top: `${(i * 100) / 4}%`, height: 1, background: 'rgba(90,210,255,0.28)' }} />
    ))}
    <div style={{ position: 'absolute', left: '6%', top: '14%', bottom: '14%', width: '12%', background: accent ? '#f0a43a' : '#2f7bff', borderRadius: 2 }} />
    <div style={{ position: 'absolute', right: '6%', top: '14%', bottom: '14%', width: '3%', background: 'rgba(90,210,255,0.6)' }} />
    {label ? <div style={{ position: 'absolute', left: '28%', top: '12%', fontSize: 22, fontWeight: 700, color: '#e8eefc' }}>{label}</div> : null}
  </div>
)

const Cell: React.FC<{ tag: string; title: string; note: string; children: React.ReactNode }> = ({ tag, title, note, children }) => (
  <div
    style={{
      width: CELL_W,
      height: CELL_H,
      borderRadius: 12,
      border: '1px solid rgba(90,210,255,0.18)',
      background: 'rgba(255,255,255,0.02)',
      position: 'relative',
      overflow: 'hidden',
    }}
  >
    <div style={{ position: 'absolute', left: 14, top: 10, fontFamily: FONT_FAMILY, fontSize: 19, color: '#8aa0c6', zIndex: 2 }}>
      <span style={{ color: '#f0a43a', fontWeight: 700 }}>{tag}</span>　{title}
    </div>
    <div style={{ position: 'absolute', left: 14, top: 36, right: 14, fontFamily: FONT_FAMILY, fontSize: 14, color: '#5b6b86', zIndex: 2 }}>
      {note}
    </div>
    {children}
  </div>
)

/** 单卡：完整产品串（含 translate）。 */
const CardWithTranslate: React.FC<{ cell: CardWallCell; label: string }> = ({ cell, label }) => {
  const s = productTransform(cell)
  return <div style={{ position: 'absolute', left: s.left, top: s.top, width: s.width, height: s.height, transform: s.transform }}><Tile label={label} /></div>
}

/** 单卡对照：只取 shapeTransform，定位交给 flex（没有 translate(-50%,-50%)）。 */
const CardWithoutTranslate: React.FC<{ cell: CardWallCell; label: string }> = ({ cell, label }) => {
  const s = productTransform(cell)
  const without = s.transform.replace(/^translate\(-50%, -50%\) /, '')
  return (
    <div style={{ position: 'absolute', inset: '50px 0 0 0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: s.width, height: s.height, transform: without }}><Tile label={label} accent /></div>
    </div>
  )
}

/** 卡墙：每格位一条独立 3D 层（与构件展开产物同构）。 */
const Wall: React.FC<{ cells: CardWallCell[] }> = ({ cells }) => (
  <>
    {cells.map((cell) => {
      const s = productTransform(cell)
      return (
        <div
          key={cell.index}
          style={{ position: 'absolute', left: s.left, top: s.top, width: s.width, height: s.height, transform: s.transform }}
        >
          <Tile accent={cell.col % 4 === 0} />
        </div>
      )
    })}
  </>
)

export const Composition: React.FC = () => {
  const frame = useCurrentFrame()
  // 轻微摆动：H2「有运动」的机械判据，同时让投影位置随帧变化（顺带验确定性）。
  const angleY = -24 + Math.sin(frame / 26) * 5
  const single = projectCardWall(
    { cols: 1, rows: 1, cardW: 26, cardH: 38, originX: 50, originY: 56, angleY, perspective: PERSPECTIVE },
    CELL_W,
    CELL_H,
  )[0]
  const wall24 = projectCardWall(
    { cols: 6, rows: 4, cardW: 9, cardH: 14, gapX: 2.2, gapY: 3.5, originX: 50, originY: 55, angleY, perspective: PERSPECTIVE },
    CELL_W,
    CELL_H,
  )
  const wall36 = projectCardWall(
    { cols: 9, rows: 4, cardW: 6.4, cardH: 14, gapX: 1.8, gapY: 3.5, originX: 50, originY: 55, angleY, curve: 2.5, perspective: PERSPECTIVE },
    CELL_W,
    CELL_H,
  )

  return (
    <BenchFrame title="13 · 卡片墙 3D 投影（真串 / 无 translate 对照 / 24 与 36 层）" footer={`frame ${frame} / 239 · angleY ${angleY.toFixed(1)}°`}>
      <AbsoluteFill>
        <div style={{ position: 'absolute', left: 40, top: 150, display: 'flex', gap: 20, flexWrap: 'wrap', width: 1840 }}>
          <Cell tag="A" title="产品完整串" note="translate(-50%,-50%) perspective(900px) scale() rotateY() · 期望：真梯形且不出画">
            <CardWithTranslate cell={single} label="A" />
          </Cell>
          <Cell tag="B" title="去掉 translate 对照" note="同一 shapeTransform，改用 flex 居中 · 期望：与 A 形状一致 ⇒ 串顺序无害">
            <CardWithoutTranslate cell={single} label="B" />
          </Cell>
          <Cell tag="C" title="24 卡平面墙" note="4×6，每卡独立 perspective · 期望：成墙、右侧更大、对称梯形可读">
            <Wall cells={wall24} />
          </Cell>
          <Cell tag="D" title="36 卡弧面墙 + curve" note="4×9，每列 +2.5° · 期望：仍出画；整帧 ms/帧 与 #12 的 77ms/帧 对比">
            <Wall cells={wall36} />
          </Cell>
        </div>
      </AbsoluteFill>
    </BenchFrame>
  )
}
