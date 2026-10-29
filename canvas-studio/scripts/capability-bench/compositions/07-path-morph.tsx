/**
 * #07 矢量路径变形 —— 圆 → 星 → 箭头（同时验三条渲染路径）。
 *
 * 对标官方：`path-morph` / `shapes-morph` / `scale-path`。
 *
 * 这条是**SVG 生死判据**：产品的 4 种自绘 shape（star/arrow/triangle/polygon）+ `path` 轨
 * 全押在 DOM `<svg>` 上，而这分支在 4.0.535 的 web-renderer 里没被官方文档逐条覆盖（§11.2 R4）。
 * 所以一帧里并排放三条**同一份 path 字符串**的不同渲染路径，红绿一眼分开：
 *
 *   A · SVG `<path stroke>` + `evolvePath` 生长   ← 官方 path-morph 的做法
 *   B · SVG `<path fill>`                        ← 填充是否生效
 *   C · CSS `clip-path: path()`                  ← 不依赖 SVG 的后手（已验证受支持）
 *
 * 三形状都用 64 点闭合折线表达、同起点同绕向，才能被 `interpolatePaths` 逐点插值。
 * 全部 frame 纯函数（禁 transition / 随机数），可复现。
 */

import React from 'react'
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from 'remotion'
import { evolvePath, interpolatePaths } from '@remotion/paths'
import { Badge, BenchFrame, COLORS, FONT_FAMILY } from './shared.js'

export const meta = {
  id: '07',
  axis: 'path-morph',
  title: '矢量路径变形（interpolatePath）',
  reference: 'path-morph · shapes-morph · scale-path',
  durationInFrames: 240, // 8s @30fps
  expect: { videoCodec: 'h264', audioCodec: 'aac', hasAudio: false, minMotion: true },
  stills: [0, 40, 80, 120, 160, 200, 239],
  assets: [],
} as const

type P = [number, number]

const POINTS = 64
const PANEL = 560
const R = 200
const CY = 600

/** 闭合折线按**弧长均匀**重采样：三个形状点数与点序都一致，插值才不会扭成麻花。 */
function resample(vertices: P[], n: number): P[] {
  const segs = vertices.map((from, i) => {
    const to = vertices[(i + 1) % vertices.length]
    return { from, to, len: Math.hypot(to[0] - from[0], to[1] - from[1]) }
  })
  const total = segs.reduce((sum, s) => sum + s.len, 0)
  const out: P[] = []
  for (let i = 0; i < n; i += 1) {
    let rest = (i / n) * total
    let placed: P | null = null
    for (const s of segs) {
      if (rest <= s.len) {
        const t = s.len === 0 ? 0 : rest / s.len
        placed = [s.from[0] + (s.to[0] - s.from[0]) * t, s.from[1] + (s.to[1] - s.from[1]) * t]
        break
      }
      rest -= s.len
    }
    out.push(placed ?? vertices[0])
  }
  return out
}

const toPath = (points: P[]) => `M ${points.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L ')} Z`

/** 圆：从最右点起逆时针（screen 坐标里 θ 递减），与下面两个形状同向。 */
function circleShape(cx: number, cy: number, r: number): P[] {
  return Array.from({ length: POINTS }, (_, i) => {
    const a = -(i / POINTS) * Math.PI * 2
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as P
  })
}

/** 五角星：10 顶点（5 尖 5 内）→ 重采样到 64 点。 */
function starShape(cx: number, cy: number, r: number): P[] {
  const verts: P[] = []
  for (let i = 0; i < 10; i += 1) {
    const a = -(i / 10) * Math.PI * 2
    const rr = i % 2 === 0 ? r : r * 0.42
    verts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr])
  }
  return resample(verts, POINTS)
}

/** 右向箭头：7 顶点（尖 / 两翼 / 杆）→ 重采样到 64 点。 */
function arrowShape(cx: number, cy: number, r: number): P[] {
  const u = r
  const verts: P[] = [
    [cx + u, cy],
    [cx + u * 0.25, cy - u * 0.62],
    [cx + u * 0.25, cy - u * 0.26],
    [cx - u, cy - u * 0.26],
    [cx - u, cy + u * 0.26],
    [cx + u * 0.25, cy + u * 0.26],
    [cx + u * 0.25, cy + u * 0.62],
  ]
  return resample(verts, POINTS)
}

/** 三个面板中心（560×3 + 120×2 = 1920，正好铺满）。 */
const CX = [0, 1, 2].map((i) => 60 + PANEL / 2 + i * (PANEL + 120))

/**
 * 三个阶段 path —— 用**面板局部坐标**（中心 280,280），这样 SVG 的 `viewBox="0 0 560 560"`
 * 与 CSS `clip-path: path()`（原点就是元素左上角）能共用同一份字符串，不必来回平移。
 */
const LOCAL = PANEL / 2
const STAGE_PATHS = [
  toPath(circleShape(LOCAL, LOCAL, R)),
  toPath(starShape(LOCAL, LOCAL, R)),
  toPath(arrowShape(LOCAL, LOCAL, R)),
]

const STAGES = [
  { from: 0, to: 70, name: 'CIRCLE → STAR' },
  { from: 70, to: 150, name: 'STAR → ARROW' },
  { from: 150, to: 239, name: 'ARROW → CIRCLE' },
] as const

const stageAt = (frame: number) => STAGES.find((s) => frame <= s.to) ?? STAGES[STAGES.length - 1]

const Panel: React.FC<{ cx: number; d: string; grow: number; label: string; kind: 'stroke' | 'fill' | 'clip' }> = ({
  cx,
  d,
  grow,
  label,
  kind,
}) => {
  const left = cx - PANEL / 2
  return (
    <div style={{ position: 'absolute', left, top: CY - PANEL / 2, width: PANEL, height: PANEL }}>
      {kind === 'clip' ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `linear-gradient(135deg, ${COLORS.accent} 0%, #7b61ff 100%)`,
            // 同一份 path 字符串；clip-path 的坐标原点是元素左上角 ⇒ 形状已按面板坐标生成
            clipPath: `path("${d}")`,
          }}
        />
      ) : (
        <svg width={PANEL} height={PANEL} viewBox={`0 0 ${PANEL} ${PANEL}`}>
          <path
            d={d}
            fill={kind === 'fill' ? 'rgba(90,210,255,0.85)' : 'none'}
            stroke={kind === 'stroke' ? COLORS.ink : 'none'}
            strokeWidth={kind === 'stroke' ? 7 : 0}
            strokeLinecap="round"
            strokeLinejoin="round"
            {...(kind === 'stroke' ? evolvePath(grow, d) : {})}
          />
        </svg>
      )}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: -54,
          textAlign: 'center',
          fontFamily: FONT_FAMILY,
          fontSize: 24,
          letterSpacing: 1,
          color: COLORS.dim,
        }}
      >
        {label}
      </div>
    </div>
  )
}

export const Composition: React.FC = () => {
  const frame = useCurrentFrame()
  const stage = stageAt(frame)
  const stageProgress = (frame - stage.from) / Math.max(1, stage.to - stage.from)
  const grow = interpolate(stageProgress, [0, 1], [0.28, 1], { extrapolateRight: 'clamp' })

  // 一条插值链：圆 → 星 → 箭头 → 圆（三形状 64 点同绕向，逐点插值）
  const d = interpolatePaths(frame, [0, 70, 150, 239], [STAGE_PATHS[0], STAGE_PATHS[1], STAGE_PATHS[2], STAGE_PATHS[0]], {
    easing: Easing.inOut(Easing.cubic),
  })

  return (
    <BenchFrame
      title="07 · 矢量路径变形 —— 64 点 / 三段插值"
      footer={`frame ${frame} / 239 · ${stage.name} · 三条渲染路径并排（A stroke / B fill / C clip-path）`}
    >
      <Panel cx={CX[0]} d={d} grow={grow} label="A · SVG path + evolvePath" kind="stroke" />
      <Panel cx={CX[1]} d={d} grow={grow} label="B · SVG path（fill）" kind="fill" />
      <Panel cx={CX[2]} d={d} grow={grow} label="C · CSS clip-path: path()" kind="clip" />

      <div style={{ position: 'absolute', left: 96, top: 150 }}>
        <Badge title={stage.name} sub={`grow ${(grow * 100).toFixed(0)}% · ${POINTS} pts`} />
      </div>

      {/* 生长指示条：证明 evolvePath 的 dash 参数真的进了画面 */}
      <div style={{ position: 'absolute', left: 96, right: 96, bottom: 62, height: 8, background: 'rgba(255,255,255,0.14)', borderRadius: 4 }}>
        <div style={{ width: `${grow * 100}%`, height: '100%', background: COLORS.accent, borderRadius: 4 }} />
      </div>
    </BenchFrame>
  )
}
