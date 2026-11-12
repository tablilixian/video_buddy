/**
 * 渲染器 A/B 对照探针 · 画面（同一份组件，SSR / CSR 两边渲染同一段）
 *
 * 目的：回答「我们的 CSR 路线与它的 SSR 路线，能力上到底差在哪」。
 * 方法：6 个格子，每格只用一个 CSS 特性；同一份代码分别交给
 *   - SSR：`@remotion/renderer` + 本机 Chrome（headless shell 路线）
 *   - CSR：`@remotion/web-renderer` + Electron 渲染进程（我们的路线）
 * 渲染后逐格做 PSNR 比对：**两格 PSNR 高 = 两边行为一致（该能力 CSR 也有）；
 * PSNR 低 = CSR 读不到该特性（真实能力差）**。
 *
 * 每格顶部 56px 是标签（不参与比对，避开字体抗锯齿差异），比对区 = y 56~500。
 */
import React from 'react'
import { AbsoluteFill } from 'remotion'

const CELL_W = 600
const CELL_H = 500
const LABEL_H = 56

/** 6 个格子的左上角（画布 1920×1080，3 列 × 2 行）。 */
const GRID: Array<[number, number]> = [
  [60, 40],
  [690, 40],
  [1320, 40],
  [60, 580],
  [690, 580],
  [1320, 580],
]

const Label: React.FC<{ text: string; color?: string }> = ({ text, color = '#e2e8f0' }) => (
  <div
    style={{
      height: LABEL_H,
      display: 'flex',
      alignItems: 'center',
      paddingLeft: 18,
      fontFamily: 'monospace',
      fontSize: 26,
      fontWeight: 700,
      color,
      letterSpacing: 1,
    }}
  >
    {text}
  </div>
)

const Cell: React.FC<{ index: number; label: string; children: React.ReactNode }> = ({ index, label, children }) => {
  const [x, y] = GRID[index]
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: CELL_W,
        height: CELL_H,
        background: '#111827',
        overflow: 'hidden',
      }}
    >
      <Label text={label} />
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: LABEL_H,
          width: CELL_W,
          height: CELL_H - LABEL_H,
          overflow: 'hidden',
        }}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * 探针本体。刻意保持静态 —— 任何像素差异都只可能来自「特性读不读得到」，
 * 不会被「帧号不同」污染。
 */
export const Probe: React.FC = () => (
  <AbsoluteFill style={{ background: '#0b1220', width: 1920, height: 1080, position: 'relative' }}>

    {/* ① mix-blend-mode: difference —— 能力基准 #08 的 B1 对照格 */}
    <Cell index={0} label="1 blend-difference">
      <div style={{ position: 'absolute', inset: 0, background: '#1e40af' }} />
      <div
        style={{
          position: 'absolute',
          left: 120,
          top: 80,
          width: 360,
          height: 280,
          background: '#ef4444',
          mixBlendMode: 'difference',
        }}
      />
    </Cell>

    {/* ② backdrop-filter: blur —— 能力基准 #02 的磨砂近似格 */}
    <Cell index={1} label="2 backdrop-blur">
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'repeating-linear-gradient(90deg, #0f172a 0px, #0f172a 18px, #f8fafc 18px, #f8fafc 36px)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 90,
          top: 70,
          width: 420,
          height: 300,
          background: 'rgba(255,255,255,0.35)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
        }}
      />
    </Cell>

    {/* ③ mask-image: conic-gradient —— 能力基准 #09 T07（clock 转场退化成整层突现） */}
    <Cell index={2} label="3 conic-mask">
      <div style={{ position: 'absolute', inset: 0, background: '#0f172a' }} />
      <div
        style={{
          position: 'absolute',
          left: 100,
          top: 60,
          width: 400,
          height: 320,
          background: '#f59e0b',
          maskImage: 'conic-gradient(#000 0deg 90deg, transparent 90deg 360deg)',
          WebkitMaskImage: 'conic-gradient(#000 0deg 90deg, transparent 90deg 360deg)',
        }}
      />
    </Cell>

    {/* ④ z-index —— 层叠是否读得到（CSR 契约里层叠只靠 DOM 顺序） */}
    <Cell index={3} label="4 z-index">
      <div style={{ position: 'absolute', inset: 0, background: '#111827' }} />
      <div style={{ position: 'absolute', left: 60, top: 60, width: 300, height: 300, background: '#ef4444' }} />
      <div style={{ position: 'absolute', left: 150, top: 140, width: 300, height: 300, background: '#3b82f6', zIndex: 5 }} />
      <div style={{ position: 'absolute', left: 240, top: 60, width: 300, height: 300, background: '#22c55e' }} />
    </Cell>

    {/* ⑤ radial-gradient 平铺 —— 能力基准 #16 的 dotGrid 必须改走 SVG pattern 那一项 */}
    <Cell index={4} label="5 radial-tile">
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: '#0f172a',
          backgroundImage: 'radial-gradient(circle, #ffffff 1.5px, transparent 1.5px)',
          backgroundSize: '20px 20px',
        }}
      />
    </Cell>

    {/* ⑥ background-image: url() —— BUG-NEW-3（外部图不加载，组件层要用 <Img>） */}
    <Cell index={5} label="6 bg-url">
      <div style={{ position: 'absolute', inset: 0, background: '#0f172a' }} />
      <div
        style={{
          position: 'absolute',
          left: 80,
          top: 50,
          width: 440,
          height: 340,
          backgroundImage: 'url(./asset/checker.png)',
          backgroundSize: 'cover',
        }}
      />
    </Cell>
  </AbsoluteFill>
)
