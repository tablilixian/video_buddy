/**
 * #09 转场 —— 8 种现有转场连播 + clock-poly 修正版 + 3 种无 WebGL 近似（12 格 × 1.5s）。
 *
 * 对标官方：`webgl-transition` / `light-leak`。
 *
 * 这条是"生死判据"（R3）：产品 8 种转场里 clock 用 `mask-image: conic-gradient`、
 * flipX 用 `perspective(1200px) rotateY`，而 web-renderer 4.0.535 的 parseMaskImage
 * 只认 linear-gradient/url（radial/conic 进不去）、perspective 系属性不读（§10.9 命中 0）。
 * 预期：clock 格 = 整层突现（mask 被无视 ⇒ 硬切）；flipX 格 = 水平压扁或不动。
 * 所以本片逐格标名连播，哪格是硬切、哪格是压扁，contact sheet 一眼可判。
 *
 * 额外三格是"不引依赖就能近似"的证明：zoomBlur / linearBlur / crossWarp 全部
 * 只用 transform + filter（白名单内），clock-poly 用 clip-path: polygon() 每帧算扇形
 * （R3 给的干净解）——如果这三四格成立，产品转场表就有零依赖的补法。
 */

import React from 'react'
import { AbsoluteFill, Img, Sequence, interpolate, useCurrentFrame } from 'remotion'
import { Badge, BenchFrame, COLORS, FONT_FAMILY, POOL } from './shared.js'

export const meta = {
  id: '09',
  axis: 'transition',
  title: '转场（8 种现有 + clock-poly 修正 + 3 种近似）',
  reference: 'webgl-transition · light-leak',
  durationInFrames: 555, // 12 格 × 45f + 15f 尾板
  expect: { videoCodec: 'h264', audioCodec: 'aac', hasAudio: false, minMotion: true },
  stills: [0, 292, 337, 382, 554],
  assets: ['image'],
} as const

const CELL = 45 // 每格 1.5s：A 12f → 转场 21f → B 12f
const TRANSITION_IN = 12
const TRANSITION_OUT = 33

type Variant = {
  name: string
  note: string
  /** 返回 A/B 两层的样式片段；p ∈ [0,1]，0=纯 A，1=纯 B。 */
  styleA?: (p: number) => React.CSSProperties
  styleB: (p: number) => React.CSSProperties
}

/** clock-poly 的扇形：中心 + 每 10° 一个弧点，半径 120% 盖住四角。 */
const fanPolygon = (p: number): string | undefined => {
  if (p >= 1) return undefined
  const sweep = p * 360
  const steps = Math.max(2, Math.ceil(sweep / 10))
  const pts: string[] = ['50% 50%']
  for (let i = 0; i <= steps; i += 1) {
    const deg = -90 + (sweep * i) / steps
    const rad = (deg * Math.PI) / 180
    pts.push(`${(50 + 120 * Math.cos(rad)).toFixed(2)}% ${(50 + 120 * Math.sin(rad)).toFixed(2)}%`)
  }
  return `polygon(${pts.join(', ')})`
}

const VARIANTS: Variant[] = [
  {
    name: 'fade',
    note: 'opacity 交叉淡化 · 白名单内',
    styleA: (p) => ({ opacity: 1 - p }),
    styleB: (p) => ({ opacity: p }),
  },
  {
    name: 'slide',
    note: 'translateX 推入 · 白名单内',
    styleA: () => ({}),
    styleB: (p) => ({ transform: `translateX(${(1 - p) * 100}%)` }),
  },
  {
    name: 'zoom',
    note: 'scale 推近 + 淡出 · 白名单内',
    styleA: (p) => ({ transform: `scale(${1 + p * 0.5})`, opacity: 1 - p }),
    styleB: (p) => ({ transform: `scale(${1.4 - p * 0.4})`, opacity: p }),
  },
  {
    name: 'dissolve',
    note: '颗粒交叉淡化（近似）· 无逐像素噪声能力',
    styleA: (p) => ({ opacity: 1 - p }),
    styleB: (p) => ({ opacity: p }),
  },
  {
    name: 'wipeL',
    note: 'clip-path inset 左开 · 白名单内',
    styleA: () => ({}),
    styleB: (p) => ({ clipPath: `inset(0 ${(1 - p) * 100}% 0 0)` }),
  },
  {
    name: 'wipeR',
    note: 'clip-path inset 右开 · 白名单内',
    styleA: () => ({}),
    styleB: (p) => ({ clipPath: `inset(0 0 0 ${(1 - p) * 100}%)` }),
  },
  {
    name: 'clock',
    note: 'conic-gradient mask 原版 · 预期 mask 无效 ⇒ 整层突现',
    styleA: () => ({}),
    styleB: (p) => ({
      maskImage: `conic-gradient(from -90deg at 50% 50%, #000 0deg, #000 ${p * 360}deg, transparent ${p * 360}deg)`,
      WebkitMaskImage: `conic-gradient(from -90deg at 50% 50%, #000 0deg, #000 ${p * 360}deg, transparent ${p * 360}deg)`,
    }),
  },
  {
    name: 'clock-poly',
    note: 'clip-path polygon 扇形（R3 修正解）· 白名单内',
    styleA: () => ({}),
    styleB: (p) => {
      const poly = fanPolygon(p)
      return poly ? { clipPath: poly } : {}
    },
  },
  {
    name: 'flipX',
    note: 'perspective(1200px) rotateY 原版 · 预期压扁或不动',
    styleA: (p) => ({ transform: `perspective(1200px) rotateY(${-p * 180}deg)`, opacity: p < 0.5 ? 1 : 0 }),
    styleB: (p) => ({ transform: `perspective(1200px) rotateY(${(1 - p) * 180}deg)`, opacity: p < 0.5 ? 0 : 1 }),
  },
  {
    name: 'zoomBlur',
    note: 'scale + blur 双向（近似）· 白名单内',
    styleA: (p) => ({ transform: `scale(${1 + p * 0.35})`, filter: `blur(${p * 24}px)`, opacity: 1 - p }),
    styleB: (p) => ({ transform: `scale(${1.35 - p * 0.35})`, filter: `blur(${(1 - p) * 24}px)`, opacity: p }),
  },
  {
    name: 'linearBlur',
    note: '位移方向模糊（近似）· 白名单内',
    styleA: (p) => ({ transform: `translateX(${-p * 30}%)`, filter: `blur(${p * 20}px)`, opacity: 1 - p }),
    styleB: (p) => ({ transform: `translateX(${(1 - p) * 30}%)`, filter: `blur(${(1 - p) * 20}px)`, opacity: p }),
  },
  {
    name: 'crossWarp',
    note: '水平挤压交换（近似）· 白名单内',
    styleA: (p) => ({ transform: `scaleX(${Math.max(0.08, 1 - p)})`, filter: `blur(${p * 16}px)`, opacity: 1 - p }),
    styleB: (p) => ({ transform: `scaleX(${Math.max(0.08, p)})`, filter: `blur(${(1 - p) * 16}px)`, opacity: p }),
  },
]

const TOTAL_CELLS = VARIANTS.length
const TOTAL = TOTAL_CELLS * CELL + 15

/** B 侧内容：每格一块不同色相的渐变文字卡（不依赖素材，确定性）。 */
const NextCard: React.FC<{ hue: number; name: string }> = ({ hue, name }) => (
  <AbsoluteFill
    style={{
      background: `linear-gradient(135deg, hsl(${hue}, 72%, 42%) 0%, hsl(${(hue + 60) % 360}, 68%, 24%) 100%)`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <div
      style={{
        fontFamily: FONT_FAMILY,
        fontSize: 110,
        fontWeight: 700,
        color: '#fff',
        letterSpacing: 6,
        textShadow: '0 6px 30px rgba(0,0,0,0.45)',
      }}
    >
      {name}
    </div>
    <div style={{ fontFamily: FONT_FAMILY, fontSize: 34, color: 'rgba(255,255,255,0.85)', letterSpacing: 2, marginTop: 18 }}>
      B 侧（转场完成）
    </div>
  </AbsoluteFill>
)

/** dissolve 格的颗粒层：双向细纹，转场中段最浓。 */
const Grain: React.FC<{ opacity: number }> = ({ opacity }) => (
  <AbsoluteFill
    style={{
      opacity,
      backgroundImage:
        'repeating-linear-gradient(45deg, rgba(255,255,255,0.5) 0px, rgba(255,255,255,0.5) 2px, transparent 2px, transparent 5px),' +
        'repeating-linear-gradient(-45deg, rgba(0,0,0,0.5) 0px, rgba(0,0,0,0.5) 2px, transparent 2px, transparent 5px)',
    }}
  />
)

const Cell: React.FC<{ index: number }> = ({ index }) => {
  const frame = useCurrentFrame()
  const variant = VARIANTS[index]
  const hue = (index * 47 + 8) % 360

  const p = interpolate(frame, [TRANSITION_IN, TRANSITION_OUT], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const phase = frame < TRANSITION_IN ? 'A 侧' : frame > TRANSITION_OUT ? 'B 侧' : '转场中'

  return (
    <AbsoluteFill>
      {/* A 侧：素材图（唯一的外部素材，各格复用）。
          注意：web-renderer 不画 backgroundImage: url()（外部图不会加载），必须用白名单内的 <Img>。 */}
      <AbsoluteFill style={variant.styleA ? variant.styleA(p) : undefined}>
        <Img
          src={POOL.image}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
        <div
          style={{
            position: 'absolute',
            left: 96,
            bottom: 170,
            fontFamily: FONT_FAMILY,
            fontSize: 44,
            fontWeight: 700,
            color: '#fff',
            textShadow: '0 3px 18px rgba(0,0,0,0.7)',
          }}
        >
          A 侧 · 素材图
        </div>
      </AbsoluteFill>

      {/* B 侧：渐变文字卡（按各转场的方式进来） */}
      <AbsoluteFill style={variant.styleB(p)}>
        <NextCard hue={hue} name={variant.name.toUpperCase()} />
      </AbsoluteFill>

      {/* dissolve 的颗粒层盖在最上（转场中段最浓，两端消失） */}
      {index === 3 ? <Grain opacity={Math.max(0, 1 - Math.abs(2 * p - 1)) * 0.65} /> : null}

      {/* 角标：格名 + 实现方式 + 当前相位 */}
      <div style={{ position: 'absolute', left: 96, top: 150 }}>
        <Badge title={`T${String(index + 1).padStart(2, '0')} · ${variant.name}`} sub={`${variant.note} · ${phase}`} />
      </div>

      {/* 大号格号：contact sheet 上 12 格一眼可分 */}
      <div
        style={{
          position: 'absolute',
          right: 110,
          bottom: 120,
          fontFamily: FONT_FAMILY,
          fontSize: 190,
          fontWeight: 700,
          color: 'rgba(255,255,255,0.18)',
          lineHeight: 1,
        }}
      >
        {String(index + 1).padStart(2, '0')}
      </div>
    </AbsoluteFill>
  )
}

export const Composition: React.FC = () => {
  const frame = useCurrentFrame()
  const index = Math.min(TOTAL_CELLS - 1, Math.floor(frame / CELL))
  const inEndCard = frame >= TOTAL_CELLS * CELL

  return (
    <BenchFrame title="09 · 转场 —— 8 现有 + clock-poly + 3 近似（逐格标名）" footer={`frame ${frame} / ${TOTAL - 1}`}>
      {VARIANTS.map((_, i) => (
        <Sequence key={i} from={i * CELL} durationInFrames={CELL} layout="none">
          <Cell index={i} />
        </Sequence>
      ))}

      {/* 尾板：12 格索引（0.5s） */}
      {inEndCard ? (
        <AbsoluteFill style={{ backgroundColor: COLORS.bg, padding: '110px 130px', flexWrap: 'wrap', flexDirection: 'row', alignContent: 'center', gap: 14 }}>
          {VARIANTS.map((v, i) => (
            <div
              key={v.name}
              style={{
                fontFamily: FONT_FAMILY,
                fontSize: 30,
                color: COLORS.ink,
                background: 'rgba(255,255,255,0.07)',
                border: '1px solid rgba(90,210,255,0.35)',
                borderRadius: 10,
                padding: '10px 22px',
                marginRight: 10,
              }}
            >
              {String(i + 1).padStart(2, '0')} {v.name}
            </div>
          ))}
        </AbsoluteFill>
      ) : null}

      <div style={{ position: 'absolute', left: 96, right: 96, bottom: 62, height: 8, background: 'rgba(255,255,255,0.14)', borderRadius: 4 }}>
        <div style={{ width: `${(frame / (TOTAL - 1)) * 100}%`, height: '100%', background: COLORS.accent, borderRadius: 4 }} />
      </div>
    </BenchFrame>
  )
}
