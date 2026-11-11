/**
 * #15 扁平卡片墙对照 —— 与 #14 同规模、同卡片内容，但**每张卡各自带 perspective()**
 * ⇒ 62 个独立 WebGL 预合成层。
 *
 * 用途：与 #14（容器 1 层）比较 ms/帧，量化 `group` 轨能省下多少；
 * 同时目视对比「每卡对称梯形」与「容器统一灭点」哪个更像原片。
 * 这是 S1 是否值得引入 `group` 轨的决策证据，不是产品代码。
 */
import React from 'react'
import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { BenchFrame, FONT_FAMILY } from './shared.js'
import { CARD_COUNT, GRID_COLS, CardTile } from './14-cardwall-group.js'

export const meta = {
  id: '15',
  axis: 'cardwall-flat',
  title: 'CSS 3D 扁平卡片墙（62 张各自 perspective）',
  reference: '≥95% 对齐 · S1 group 轨决策对照',
  durationInFrames: 240,
  stills: [30, 90, 150, 210],
  assets: [],
} as const

const Cell: React.FC<{ tag: string; title: string; note: string; children: React.ReactNode }> = ({ tag, title, note, children }) => (
  <div style={{ width: 900, height: 420, borderRadius: 12, border: '1px solid rgba(90,210,255,0.18)', background: 'rgba(255,255,255,0.02)', position: 'relative', overflow: 'hidden' }}>
    <div style={{ position: 'absolute', left: 14, top: 10, fontFamily: FONT_FAMILY, fontSize: 19, color: '#8aa0c6', zIndex: 2 }}>
      <span style={{ color: '#f0a43a', fontWeight: 700 }}>{tag}</span>　{title}
    </div>
    <div style={{ position: 'absolute', left: 14, top: 36, right: 14, fontFamily: FONT_FAMILY, fontSize: 14, color: '#5b6b86', zIndex: 2 }}>{note}</div>
    {children}
  </div>
)

/** 每张卡外面套一层自带 perspective 的 div —— 62 个独立 3D 层。 */
const FlatGrid: React.FC<{ angle: number }> = ({ angle }) => (
  <div
    style={{
      position: 'absolute',
      left: '8%',
      top: '18%',
      width: '84%',
      height: '76%',
      display: 'grid',
      gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`,
      gridAutoRows: '1fr',
      gap: 3,
    }}
  >
    {Array.from({ length: CARD_COUNT }, (_, i) => (
      <div key={i} style={{ transform: `perspective(900px) rotateY(${angle}deg)`, width: '100%', height: '100%' }}>
        <CardTile accent={i % 7 === 0} />
      </div>
    ))}
  </div>
)

export const Composition: React.FC = () => {
  const frame = useCurrentFrame()
  const angle = -24 + Math.sin(frame / 26) * 5

  return (
    <BenchFrame title="15 · CSS 3D 扁平卡片墙（62 卡 / 62 层）" footer={`frame ${frame} / 239 · angleY ${angle.toFixed(1)}°`}>
      <AbsoluteFill>
        <div style={{ position: 'absolute', left: 40, top: 150, display: 'flex', gap: 20, flexWrap: 'wrap', width: 1840 }}>
          <Cell tag="A" title="62 张各自透视" note="每卡外层 perspective(900px) rotateY() · 期望：都出画，但灭点在各自中心（对称梯形）">
            <FlatGrid angle={angle} />
          </Cell>
          <Cell tag="B" title="单卡梯形放大" note="与 #14 A 格的容器梯形做目视对照">
            <div style={{ position: 'absolute', left: '26%', top: '22%', width: '48%', height: '62%', transform: `perspective(900px) rotateY(${angle}deg)` }}>
              <CardTile accent />
            </div>
          </Cell>
          <Cell tag="C" title="2D 基线（无 3D）" note="同样的 62 张卡，零 transform · 用来确认成本差不是卡片内容造成的">
            <div style={{ position: 'absolute', left: '8%', top: '18%', width: '84%', height: '76%', display: 'grid', gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`, gridAutoRows: '1fr', gap: 3 }}>
              {Array.from({ length: CARD_COUNT }, (_, i) => <CardTile key={i} accent={i % 7 === 0} />)}
            </div>
          </Cell>
          <Cell tag="D" title="留白对照" note="保持与 #14 同等的画面信息量下限（H1/H2 需要非纯色画面）">
            <div style={{ position: 'absolute', inset: '25% 12%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT_FAMILY, fontSize: 26, color: '#8aa0c6' }}>
              {CARD_COUNT} independent 3D layers
            </div>
          </Cell>
        </div>
      </AbsoluteFill>
    </BenchFrame>
  )
}
