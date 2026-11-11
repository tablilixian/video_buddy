/**
 * #14 CSS 3D 容器卡片墙 —— `group` 轨方案的**前置能力探针**。
 *
 * 要回答的只有一个问题：62 张带内容的卡，用「父层 transform 包整墙」是不是
 * 真的只需要 1 个 WebGL 预合成层，且画面比「每卡各自 perspective」更接近原片
 * （统一灭点 vs 对称梯形）？
 *
 * #12 的 G 格上半已经证明「容器 transform 包 20 张 Tile」能出画；这里把规模推到
 * 62 张、每张带内部图表，并单独测 ms/帧。#15 是同规模扁平对照，两者相减即
 * 容器方案省下的成本。
 */
import React from 'react'
import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { BenchFrame, FONT_FAMILY } from './shared.js'

export const meta = {
  id: '14',
  axis: 'cardwall-group',
  title: 'CSS 3D 容器卡片墙（62 张内容卡 / 1 个 3D 层）',
  reference: '≥95% 对齐 · S1 group 轨前置探针',
  durationInFrames: 240,
  stills: [30, 90, 150, 210],
  assets: [],
} as const

export const CARD_COUNT = 62
export const GRID_COLS = 10

/** 原片那种「深色 UI 缩略卡」：标题条 + 两行细线 + 三根小柱 + 小色块。 */
export const CardTile: React.FC<{ accent?: boolean }> = ({ accent = false }) => (
  <div
    style={{
      width: '100%',
      height: '100%',
      background: accent ? '#1d3358' : '#16233a',
      border: '1px solid rgba(90,210,255,0.45)',
      borderRadius: 3,
      position: 'relative',
      overflow: 'hidden',
    }}
  >
    <div style={{ position: 'absolute', left: '7%', top: '9%', width: '38%', height: 5, background: '#3fa9f5', borderRadius: 1 }} />
    <div style={{ position: 'absolute', left: '7%', top: '29%', width: '62%', height: 2, background: 'rgba(200,214,235,0.55)' }} />
    <div style={{ position: 'absolute', left: '7%', top: '40%', width: '46%', height: 2, background: 'rgba(200,214,235,0.4)' }} />
    <div style={{ position: 'absolute', left: '7%', bottom: '10%', width: 4, height: '22%', background: '#f0a43a' }} />
    <div style={{ position: 'absolute', left: '22%', bottom: '10%', width: 4, height: '34%', background: '#3fa9f5' }} />
    <div style={{ position: 'absolute', left: '37%', bottom: '10%', width: 4, height: '17%', background: '#8aa0c6' }} />
    <div style={{ position: 'absolute', right: '8%', top: '9%', width: '16%', height: '18%', background: 'rgba(240,164,58,0.65)', borderRadius: 2 }} />
  </div>
)

const Cell: React.FC<{ tag: string; title: string; note: string; children: React.ReactNode }> = ({ tag, title, note, children }) => (
  <div style={{ width: 900, height: 420, borderRadius: 12, border: '1px solid rgba(90,210,255,0.18)', background: 'rgba(255,255,255,0.02)', position: 'relative', overflow: 'hidden' }}>
    <div style={{ position: 'absolute', left: 14, top: 10, fontFamily: FONT_FAMILY, fontSize: 19, color: '#8aa0c6', zIndex: 2 }}>
      <span style={{ color: '#f0a43a', fontWeight: 700 }}>{tag}</span>　{title}
    </div>
    <div style={{ position: 'absolute', left: 14, top: 36, right: 14, fontFamily: FONT_FAMILY, fontSize: 14, color: '#5b6b86', zIndex: 2 }}>{note}</div>
    {children}
  </div>
)

/** 62 张卡铺成 10 列网格；外层只有一个 transform ⇒ 1 个 3D 层。 */
export const CardGrid: React.FC<{ transform: string }> = ({ transform }) => (
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
      transform,
    }}
  >
    {Array.from({ length: CARD_COUNT }, (_, i) => (
      <CardTile key={i} accent={i % 7 === 0} />
    ))}
  </div>
)

export const Composition: React.FC = () => {
  const frame = useCurrentFrame()
  const angle = -24 + Math.sin(frame / 26) * 5
  const push = 1 + Math.sin(frame / 40) * 0.06

  return (
    <BenchFrame title="14 · CSS 3D 容器卡片墙（62 卡 / 1 层）" footer={`frame ${frame} / 239 · angleY ${angle.toFixed(1)}°`}>
      <AbsoluteFill>
        <div style={{ position: 'absolute', left: 40, top: 150, display: 'flex', gap: 20, flexWrap: 'wrap', width: 1840 }}>
          <Cell tag="A" title="容器统一透视" note="父层 transform: perspective(1200px) rotateY() 包 62 张 · 期望：统一灭点、真梯形">
            <CardGrid transform={`perspective(1200px) rotateY(${angle}deg)`} />
          </Cell>
          <Cell tag="B" title="容器 + 缓慢推近" note="同一层再加 scale 随帧变化 · 期望：推近出画且逐帧可复现">
            <CardGrid transform={`perspective(1200px) rotateY(${angle}deg) scale(${push.toFixed(4)})`} />
          </Cell>
          <Cell tag="C" title="单卡内容放大" note="标题条 / 细线 / 柱状 / 小色块 —— 原片每张卡都有真实内容">
            <div style={{ position: 'absolute', left: '22%', top: '20%', width: '56%', height: '70%' }}>
              <CardTile accent />
            </div>
          </Cell>
          <Cell tag="D" title="容器 + 弧面感" note="rotateY 幅度加大到 -38° · 期望：62 张仍全部出画、不静默消失">
            <CardGrid transform={`perspective(1200px) rotateY(${angle * 1.6}deg)`} />
          </Cell>
        </div>
      </AbsoluteFill>
    </BenchFrame>
  )
}
