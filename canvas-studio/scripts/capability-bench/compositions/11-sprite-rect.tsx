/**
 * 11 · sourceRect 精灵图子区域裁切（CV-392，REQ-036 R-2）。
 *
 * 验证两件事，都在真渲染器里：
 *   1. **几何公式**：直接 import 产品纯函数 `src/remotion/sprite.ts` 的
 *      `spriteRegionStyle`（bench 只读产品源码、零拷贝 —— 公式漂移即本条失真）；
 *   2. **测量流程**：复刻产品 ImageClip 的 onLoad → delayRender/continueRender
 *      门（帧截图必等自然尺寸测得）。
 *
 * 素材自造：offscreen canvas 合成 2×2 四色象限精灵图（红1/绿2/蓝3/黄4 + 白色
 * 分隔线），toDataURL 进 `<Img>` —— 不依赖 pool 素材，象限对错一眼可判。
 * 四块板：q1/q2 cover（同 40×52 盒）、q3 cover（宽扁盒 40×24，区域被裁 → 验
 * cover 裁切方向）、q4 contain（同宽扁盒 → 验留边居中）。整体 1→1.04 缓推过 H2。
 */
import React, { useState } from 'react'
import { AbsoluteFill, Img, continueRender, delayRender, useCurrentFrame, useVideoConfig } from 'remotion'
import { BenchFrame, FONT_FAMILY, SPEC } from './shared.js'
// 产品纯函数直连（.js → .ts 由 bench webpack extensionAlias 解析）。
import { spriteRegionStyle } from '../../../src/remotion/sprite.js'

const SHEET_PX = 800

function buildSpriteSheet(): string {
  const canvas = document.createElement('canvas')
  canvas.width = SHEET_PX
  canvas.height = SHEET_PX
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('2d context unavailable')
  const half = SHEET_PX / 2
  // ⚠️ 只用整数坐标 fillRect：canvas fillText/arc 的 GPU 光栅跨页面加载**不确定**
  // （首轮 H4 86/90 视频帧不一致的实测根因）—— 实心整数矩形是精确光栅，跨加载逐字节稳定。
  // 四象限标记：红=素色 / 绿=中格深斑 / 蓝=双竖条 / 黄=四角斑（q1..q4 靠色与标记辨认）。
  ctx.fillStyle = '#e5484d'
  ctx.fillRect(0, 0, half, half)
  ctx.fillStyle = '#46a758'
  ctx.fillRect(half, 0, half, half)
  ctx.fillStyle = '#2c7a3f'
  ctx.fillRect(half + 300, 300, 200, 200)
  ctx.fillStyle = '#3b82f6'
  ctx.fillRect(0, half, half, half)
  ctx.fillStyle = '#1d4ed8'
  ctx.fillRect(140, half + 80, 60, 340)
  ctx.fillRect(300, half + 80, 60, 340)
  ctx.fillStyle = '#f5a623'
  ctx.fillRect(half, half, half, half)
  ctx.fillStyle = '#b9770e'
  ctx.fillRect(half + 80, half + 80, 80, 80)
  ctx.fillRect(half + half - 160, half + 80, 80, 80)
  ctx.fillRect(half + 80, half + half - 160, 80, 80)
  ctx.fillRect(half + half - 160, half + half - 160, 80, 80)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(half - 4, 0, 8, SHEET_PX)
  ctx.fillRect(0, half - 4, SHEET_PX, 8)
  return canvas.toDataURL('image/png')
}

type Panel = { box: { x: number; y: number; w: number; h: number }; rect: { x: number; y: number; w: number; h: number }; mode: 'cover' | 'contain'; caption: string }

const PANELS: Panel[] = [
  { box: { x: 4, y: 16, w: 43, h: 50 }, rect: { x: 0, y: 0, w: 50, h: 50 }, mode: 'cover', caption: 'q1 {0,0,50,50} cover' },
  { box: { x: 53, y: 16, w: 43, h: 50 }, rect: { x: 50, y: 0, w: 50, h: 50 }, mode: 'cover', caption: 'q2 {50,0,50,50} cover' },
  { box: { x: 4, y: 70, w: 43, h: 24 }, rect: { x: 0, y: 50, w: 50, h: 50 }, mode: 'cover', caption: 'q3 {0,50,50,50} cover（宽扁盒 → 裁切）' },
  { box: { x: 53, y: 70, w: 43, h: 24 }, rect: { x: 50, y: 50, w: 50, h: 50 }, mode: 'contain', caption: 'q4 {50,50,50,50} contain（留边）' },
]

export const meta = {
  axis: 'sprite-rect',
  durationInFrames: 90,
  expect: { videoCodec: 'h264', audioCodec: 'aac', hasAudio: false, minMotion: true },
  stills: [0, 45, 89],
  assets: [],
}

export const Composition: React.FC = () => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const progress = frame / Math.max(1, durationInFrames - 1)

  const [src] = useState(() => buildSpriteSheet())
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [handle] = useState(() => delayRender('11: 等精灵图 dataURL 测自然尺寸'))
  const release = (img: HTMLImageElement | null) => {
    setNatural(img === null ? { w: 0, h: 0 } : { w: img.naturalWidth, h: img.naturalHeight })
    continueRender(handle)
  }

  const scale = 1 + 0.04 * progress

  return (
    <BenchFrame title="11 · sourceRect 精灵图子区域裁切 —— spriteRegionStyle @真渲染器" footer={`frame ${frame} / ${durationInFrames - 1}`}>
      <AbsoluteFill style={{ transform: `scale(${scale})`, transformOrigin: 'center' }}>
        <Img
          src={src}
          onLoad={(e) => release(e.currentTarget)}
          onError={() => release(null)}
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
        />
        {PANELS.map((p) => {
          const layerW = (SPEC.width * p.box.w) / 100
          const layerH = (SPEC.height * p.box.h) / 100
          const geo =
            natural !== null
              ? spriteRegionStyle(p.rect, natural, { mode: p.mode, layerW, layerH })
              : { left: 0, top: 0, width: layerW, height: layerH }
          return (
            <div
              key={p.caption}
              style={{
                position: 'absolute',
                left: `${p.box.x}%`,
                top: `${p.box.y}%`,
                width: `${p.box.w}%`,
                height: `${p.box.h}%`,
                overflow: 'hidden',
                border: '2px solid rgba(255,255,255,0.35)',
                backgroundColor: '#05080f',
              }}
            >
              <Img
                src={src}
                style={
                  natural === null
                    ? { position: 'absolute', visibility: 'hidden', width: '100%', height: '100%' }
                    : { position: 'absolute', objectFit: 'fill', ...geo }
                }
              />
              <div
                style={{
                  position: 'absolute',
                  left: 12,
                  bottom: 10,
                  font: `600 22px ${FONT_FAMILY}`,
                  color: '#f0f3f7',
                  background: 'rgba(0,0,0,0.55)',
                  padding: '4px 10px',
                  borderRadius: 6,
                }}
              >
                {p.caption}
              </div>
            </div>
          )
        })}
      </AbsoluteFill>
    </BenchFrame>
  )
}
