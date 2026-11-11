/**
 * #12 CSS 3D —— 八种写法在同一次渲染里横向对照（REQ 前置探针）。
 *
 * 要回答的只有一个问题：**在 `@remotion/web-renderer` 4.0.535 下，哪几种 3D 写法真出画。**
 *
 * 背景（与产品代码里的旧结论冲突，故必须实测）：
 *   `src/remotion/timing.ts:311` 写着「web-renderer 4.0.535 不读 `perspective()`」，
 *   但 4.0.535 的实现里有 `handle-3d-transform` / `transform-in-3d`：
 *   `index.mjs:3321` `needs3DTransformViaWebGL = !totalMatrix.is2D` ⇒ 非 2D 矩阵会走
 *   「预合成到临时 canvas → WebGL 纹理映射」。所以「不支持 3D」这个结论存疑。
 *
 * 同时发现一个**结构性差异**（本探针的核心假设）：
 *   `calculate-transforms` 的 `TransformStyle` 只 pick 了
 *   `display | rotate | scale | transform | transformOrigin` —— **不含 `perspective`**。
 *   ⇒ 父层 CSS 属性式的 `perspective: 1200px` 大概会整个丢掉，
 *      而写在元素自身 `transform` 串里的 `perspective(1200px)` 会整串喂给 `new DOMMatrix()`。
 *   这正是「压扁 vs 真透视」的分水岭，故 A/B/C 三格专门对照这件事。
 *
 * 判据（看 still 图，每格独立判）：
 *   真透视 = 卡片左右两条竖边**一长一短**（近大远小），橙色粗条比远处明显更宽；
 *   正交压扁 = 左右边等高、整卡只是变窄（纯 scaleX 观感），橙色粗条等宽。
 *   每张卡内嵌 3 竖 3 横网格线，透视下网格间距会向远端压缩，比只看外框更敏感。
 */

import React from 'react'
import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { BenchFrame, FONT_FAMILY } from './shared.js'

export const meta = {
  id: '12',
  axis: 'css3d',
  title: 'CSS 3D 八种写法（透视是否真出画）',
  reference: 'REQ-034 后续 · 24s 模板 3D 能力前置探针',
  durationInFrames: 240,
  stills: [30, 90, 150, 210],
  assets: [],
} as const

const CARD_W = 300
const CARD_H = 180

/** 卡片自带网格 + 左右不等宽竖条：透视是否成立，靠这两处一眼可辨。 */
const Card: React.FC<{ label: string; tone?: string }> = ({ label, tone = '#5ad2ff' }) => (
  <div
    style={{
      width: CARD_W,
      height: CARD_H,
      borderRadius: 10,
      background: '#152239',
      border: `2px solid ${tone}`,
      position: 'relative',
      fontFamily: FONT_FAMILY,
    }}
  >
    {[1, 2, 3].map((i) => (
      <div
        key={`v${i}`}
        style={{ position: 'absolute', top: 0, bottom: 0, left: (CARD_W / 4) * i, width: 1, background: 'rgba(90,210,255,0.3)' }}
      />
    ))}
    {[1, 2, 3].map((i) => (
      <div
        key={`h${i}`}
        style={{ position: 'absolute', left: 0, right: 0, top: (CARD_H / 4) * i, height: 1, background: 'rgba(90,210,255,0.3)' }}
      />
    ))}
    <div style={{ position: 'absolute', left: 12, top: 12, bottom: 12, width: 26, background: 'rgba(240,164,58,0.9)', borderRadius: 4 }} />
    <div style={{ position: 'absolute', right: 12, top: 12, bottom: 12, width: 6, background: 'rgba(90,210,255,0.65)', borderRadius: 2 }} />
    <div style={{ position: 'absolute', left: 54, top: 12, fontSize: 30, fontWeight: 700, color: '#e8eefc' }}>{label}</div>
  </div>
)

const Cell: React.FC<{ tag: string; title: string; note: string; children: React.ReactNode }> = ({
  tag,
  title,
  note,
  children,
}) => (
  <div
    style={{
      width: 445,
      height: 415,
      borderRadius: 12,
      border: '1px solid rgba(90,210,255,0.18)',
      background: 'rgba(255,255,255,0.02)',
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <div style={{ position: 'absolute', left: 14, top: 10, fontFamily: FONT_FAMILY, fontSize: 19, color: '#8aa0c6' }}>
      <span style={{ color: '#f0a43a', fontWeight: 700 }}>{tag}</span>　{title}
    </div>
    <div style={{ position: 'absolute', left: 14, top: 36, right: 14, fontFamily: FONT_FAMILY, fontSize: 14, color: '#5b6b86' }}>
      {note}
    </div>
    {children}
  </div>
)

/** 小卡：40 张墙用（性能探针，不需要编号可读）。 */
const Tile: React.FC = () => (
  <div
    style={{
      width: 60,
      height: 38,
      borderRadius: 4,
      background: '#16233a',
      border: '1px solid rgba(90,210,255,0.45)',
    }}
  />
)

export const Composition: React.FC = () => {
  const frame = useCurrentFrame()
  // 轻微摆动：H2「有运动」的机械判据需要，同时让透视的形变随时间可见。
  const ang = -30 + Math.sin(frame / 20) * 6
  const angWall = -26 + Math.sin(frame / 26) * 4

  /** D 格：让浏览器自己把 CSS 串算成 matrix3d，零手算符号。 */
  const matrix3dStr = new DOMMatrix(`perspective(1200px) rotateY(${ang}deg)`).toString()

  return (
    <BenchFrame title="12 · CSS 3D — 八种写法对照" footer={`frame ${frame} / 239 · 角度 ${ang.toFixed(1)}°`}>
      <AbsoluteFill>
        <div style={{ position: 'absolute', left: 40, top: 150, display: 'flex', gap: 20, flexWrap: 'wrap', width: 1840 }}>
          <Cell tag="A" title="元素自带 perspective()" note="transform: perspective(1200px) rotateY() · 期望：真透视">
            <div style={{ transform: `perspective(1200px) rotateY(${ang}deg)` }}>
              <Card label="A" />
            </div>
          </Cell>

          <Cell tag="B" title="父层 perspective 属性" note="parent style={{perspective:1200}} + 子层 rotateY · 期望：被丢 → 压扁">
            <div style={{ perspective: 1200 }}>
              <div style={{ transform: `rotateY(${ang}deg)` }}>
                <Card label="B" tone="#f0a43a" />
              </div>
            </div>
          </Cell>

          <Cell tag="C" title="父层 perspective + preserve-3d" note="同上再加 transform-style: preserve-3d · 期望：被丢 → 压扁">
            <div style={{ perspective: 1200, transformStyle: 'preserve-3d' }}>
              <div style={{ transform: `rotateY(${ang}deg)`, transformStyle: 'preserve-3d' }}>
                <Card label="C" tone="#f0a43a" />
              </div>
            </div>
          </Cell>

          <Cell tag="D" title="matrix3d 直给" note="浏览器算好的 perspective×rotateY 矩阵 · 期望：真透视">
            <div style={{ transform: matrix3dStr }}>
              <Card label="D" tone="#7fddb0" />
            </div>
          </Cell>

          <Cell tag="E" title="rotateX 俯仰" note="transform: perspective(1200px) rotateX(28deg) · 期望：真透视（上下边收窄）">
            <div style={{ transform: `perspective(1200px) rotateX(28deg)` }}>
              <Card label="E" tone="#c9a0ff" />
            </div>
          </Cell>

          <Cell tag="F" title="backface-visibility 剔除" note="左 rotateY(150deg) + hidden 应消失；右 rotateY(-30deg) 应可见">
            <div style={{ display: 'flex', gap: 18 }}>
              <div style={{ transform: `perspective(1200px) rotateY(150deg)`, backfaceVisibility: 'hidden' }}>
                <div
                  style={{
                    width: 130,
                    height: CARD_H,
                    borderRadius: 10,
                    background: '#3a1620',
                    border: '2px solid #e24b4a',
                    fontFamily: FONT_FAMILY,
                    fontSize: 22,
                    color: '#f09595',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  hidden
                </div>
              </div>
              <div style={{ transform: `perspective(1200px) rotateY(-30deg)` }}>
                <div
                  style={{
                    width: 130,
                    height: CARD_H,
                    borderRadius: 10,
                    background: '#152239',
                    border: '2px solid #5ad2ff',
                    fontFamily: FONT_FAMILY,
                    fontSize: 22,
                    color: '#8aa0c6',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  visible
                </div>
              </div>
            </div>
          </Cell>

          <Cell tag="G" title="40 层：父层包裹 vs 各自带" note="上＝容器 transform 包 20 张；下＝每张自带 · 只判能否出画与 ms/帧">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(6, 60px)',
                  gap: 3,
                  transform: `perspective(900px) rotateY(${angWall}deg)`,
                }}
              >
                {Array.from({ length: 20 }, (_, i) => (
                  <Tile key={i} />
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 60px)', gap: 3 }}>
                {Array.from({ length: 20 }, (_, i) => (
                  <div key={i} style={{ transform: `perspective(900px) rotateY(${angWall}deg) translateZ(${(i % 6) * 4}px)` }}>
                    <Tile />
                  </div>
                ))}
              </div>
            </div>
          </Cell>

          <Cell tag="H" title="3D + filter blur" note="perspective rotateY + filter: blur(2px) · 期望：两者都生效">
            <div style={{ transform: `perspective(1200px) rotateY(${ang}deg)`, filter: 'blur(2px)' }}>
              <Card label="H" tone="#ffb454" />
            </div>
          </Cell>
        </div>
      </AbsoluteFill>
    </BenchFrame>
  )
}
