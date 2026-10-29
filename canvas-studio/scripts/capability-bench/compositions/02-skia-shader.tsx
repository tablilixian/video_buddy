/**
 * #02 Skia 着色器（近似片）—— 磨砂玻璃卡 + 噪点 + 光晕三连，用 filter 链复刻 Skia 观感（零依赖）。
 *
 * 对标官方：`skia-shader` / `skia-zoomblur`（真 Skia 需 @remotion/skia + CanvasKit wasm 9.6MB，
 * spec 定为"可选冒烟、排最后"——本轮按近似方案交付，真 Skia 冒烟未做，见 DECISIONS D15）。
 *
 * 要证明的一件事：**在不动依赖的前提下，Skia 类质感（磨砂/噪点/光晕）能到多少成色**。
 *   - 磨砂卡：#03 已证真 `backdrop-filter` 要走 html-in-canvas flag 才生效 ⇒ 这里用
 *     "手动模糊底图副本 + 半透明卡面"近似，即产品现有 filter 白名单内的做法；
 *   - 噪点：多层 repeating-gradient 按帧偏移（纯函数，无随机数）⇒ 可复现的胶片颗粒；
 *   - 光晕：纯色块 + filter blur 位移扫过（#08 已证 filter 链可用）。
 */

import React from 'react'
import { AbsoluteFill, Img, interpolate, useCurrentFrame } from 'remotion'
import { Badge, BenchFrame, COLORS, FONT_FAMILY, POOL } from './shared.js'

export const meta = {
  id: '02',
  axis: 'skia-shader',
  title: 'Skia 着色器（磨砂 / 噪点 / 光晕）· 近似片',
  reference: 'skia-shader · skia-zoomblur',
  durationInFrames: 240, // 8s @30fps
  expect: { videoCodec: 'h264', audioCodec: 'aac', hasAudio: false, minMotion: true },
  stills: [60, 119, 200],
  assets: ['image'],
} as const

const osc = (frame: number, period: number) => (Math.sin((frame / period) * Math.PI * 2) + 1) / 2

const BaseImg: React.FC<{ blur?: number }> = ({ blur }) => (
  <Img
    src={POOL.image}
    style={{
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      ...(blur ? { filter: `blur(${blur}px)`, transform: `scale(${1 + blur * 0.014})` } : {}),
    }}
  />
)

const PanelLabel: React.FC<{ tag: string; note: string }> = ({ tag, note }) => (
  <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: 'rgba(4,8,16,0.8)', padding: '12px 16px' }}>
    <span style={{ fontFamily: FONT_FAMILY, fontSize: 27, fontWeight: 700, color: COLORS.accent }}>{tag}</span>
    <span style={{ fontFamily: FONT_FAMILY, fontSize: 21, color: COLORS.dim, marginLeft: 12 }}>{note}</span>
  </div>
)

const Panel: React.FC<{ tag: string; note: string; children: React.ReactNode }> = ({ tag, note, children }) => (
  <div style={{ position: 'relative', flex: 1, borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(90,210,255,0.3)' }}>
    {children}
    <PanelLabel tag={tag} note={note} />
  </div>
)

export const Composition: React.FC = () => {
  const frame = useCurrentFrame()

  // ① 磨砂卡：卡面内放一张放大 + 模糊的底图副本（模拟 backdrop-filter 透过模糊）
  const cardBlur = 16 + osc(frame, 6) * 10

  // ② 噪点：三层 repeating-gradient，各按不同速度偏移（纯帧函数 ⇒ 可复现"颗粒滚动"）
  const o1 = (frame * 7) % 12
  const o2 = (-frame * 11) % 17
  const o3 = (frame * 5) % 9
  const grainStrength = interpolate(osc(frame, 8), [0, 1], [0.35, 0.8])

  // ③ 光晕：两团纯色光斑绕画面缓慢移动
  const t = frame / 30
  const glow1x = 30 + Math.sin(t * 0.7) * 22
  const glow1y = 30 + Math.cos(t * 0.5) * 18
  const glow2x = 70 - Math.sin(t * 0.45) * 20
  const glow2y = 65 + Math.sin(t * 0.8) * 16

  return (
    <BenchFrame title="02 · Skia 近似片 —— 磨砂 / 噪点 / 光晕（filter 链，零依赖）" footer={`frame ${frame} / 239`}>
      <div style={{ position: 'absolute', left: 90, right: 90, top: 214, bottom: 126, display: 'flex', gap: 20 }}>
        {/* ① 磨砂玻璃卡：底图 + 模糊副本卡面 */}
        <Panel tag="① 磨砂" note="手动模糊底图副本（非 backdrop-filter · 那要 flag）">
          <BaseImg />
          <div style={{ position: 'absolute', left: '12%', right: '12%', top: '16%', bottom: '30%', borderRadius: 22, overflow: 'hidden', border: '2px solid rgba(255,255,255,0.4)', boxShadow: '0 18px 60px rgba(0,0,0,0.5)' }}>
            <AbsoluteFill style={{ transform: 'scale(1.35)' }}>
              <BaseImg blur={cardBlur} />
            </AbsoluteFill>
            <AbsoluteFill style={{ background: 'rgba(255,255,255,0.10)' }} />
            <div style={{ position: 'absolute', left: 0, right: 0, top: '34%', textAlign: 'center', fontFamily: FONT_FAMILY, fontSize: 44, fontWeight: 700, color: '#fff', textShadow: '0 3px 16px rgba(0,0,0,0.6)' }}>
              磨砂 {cardBlur.toFixed(0)}px
            </div>
          </div>
        </Panel>

        {/* ② 噪点：三层偏移细纹叠原图 */}
        <Panel tag="② 噪点" note="三层 repeating-gradient 按帧偏移（纯函数）">
          <BaseImg />
          <AbsoluteFill
            style={{
              opacity: grainStrength,
              backgroundImage:
                `repeating-linear-gradient(37deg, rgba(255,255,255,0.55) 0px, rgba(255,255,255,0.55) 1px, transparent 1px, transparent 3px),` +
                `repeating-linear-gradient(-53deg, rgba(0,0,0,0.5) 0px, rgba(0,0,0,0.5) 1px, transparent 1px, transparent 3px),` +
                `repeating-linear-gradient(90deg, rgba(255,255,255,0.35) 0px, rgba(255,255,255,0.35) 1px, transparent 1px, transparent 4px)`,
              backgroundPosition: `${o1}px ${o2}px, ${o2}px ${o3}px, ${o3}px ${o1}px`,
            }}
          />
          <div style={{ position: 'absolute', left: 0, right: 0, top: 26, textAlign: 'center', fontFamily: FONT_FAMILY, fontSize: 26, color: 'rgba(255,255,255,0.85)', textShadow: '0 2px 10px rgba(0,0,0,0.8)' }}>
            颗粒强度 {grainStrength.toFixed(2)}
          </div>
        </Panel>

        {/* ③ 光晕：两团模糊光斑扫过 */}
        <Panel tag="③ 光晕" note="纯色块 + filter blur 扫过（白名单内）">
          <BaseImg />
          <div
            style={{
              position: 'absolute',
              left: `${glow1x}%`,
              top: `${glow1y}%`,
              width: 320,
              height: 320,
              marginLeft: -160,
              marginTop: -160,
              borderRadius: '50%',
              background: 'rgba(90,210,255,0.85)',
              filter: 'blur(90px)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: `${glow2x}%`,
              top: `${glow2y}%`,
              width: 260,
              height: 260,
              marginLeft: -130,
              marginTop: -130,
              borderRadius: '50%',
              background: 'rgba(255,120,80,0.8)',
              filter: 'blur(70px)',
            }}
          />
        </Panel>
      </div>

      <div style={{ position: 'absolute', left: 90, top: 142, display: 'flex' }}>
        <Badge title="SKIA 近似 · filter 链复刻质感（真 Skia wasm 未引入）" color="#b44dff" />
      </div>

      <div style={{ position: 'absolute', left: 90, right: 90, bottom: 62, height: 8, background: 'rgba(255,255,255,0.14)', borderRadius: 4 }}>
        <div style={{ width: `${(frame / 239) * 100}%`, height: '100%', background: COLORS.accent, borderRadius: 4 }} />
      </div>
    </BenchFrame>
  )
}
