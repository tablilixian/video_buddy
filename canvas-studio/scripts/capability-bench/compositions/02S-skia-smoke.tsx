/**
 * 02S · 真 Skia runtime shader 冒烟（#02 的可选冒烟项，能力基准补完 2026-10-31）。
 *
 * 回答一个问题：**真 Skia（CanvasKit wasm）在我们的 CSR 链路里能不能出片** ——
 * SKSL runtime shader（uProgress = frame/duration 驱动波纹环），只判"能出片、逐帧在动"。
 *
 * 接线要点（试出来的，按官方模式）：
 * - rn-skia 主模块**必须在 global.CanvasKit 就绪后才能 import**（否则 import 期崩，
 *   实测 "reading 'S'"）⇒ 本外层模块只引 LoadSkiaWeb，wasm 就绪后再动态 import 内层；
 * - CanvasKit wasm 经 bench 同源服务加载（locateFile → /pool/canvaskit/），不走 CDN；
 * - wasm 异步 ⇒ delayRender 挡首帧：加载完成前不捕获任何帧，占位画面不会进成片。
 */
import React from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web/LoadSkiaWeb.js'
import { Badge, BenchFrame, FONT_FAMILY } from './shared.js'

export const meta = {
  id: '02S',
  axis: 'skia-smoke',
  title: '真 Skia runtime shader 冒烟',
  reference: 'skia-shader',
  durationInFrames: 120,
  expect: { videoCodec: 'h264', audioCodec: 'aac', hasAudio: false, minMotion: true },
  stills: [0, 59, 119],
  assets: ['image', 'canvaskit'],
} as const

/** wasm 同源加载（幂等）：locateFile 把 canvaskit.wasm 指到 bench 静态服务的 /pool/canvaskit/。 */
let skiaPromise: Promise<void> | null = null
function ensureSkiaWeb(): Promise<void> {
  skiaPromise ??= LoadSkiaWeb({
    // 注意：bench 静态服务的 pool key 是**整段路径**（/pool/<key>），wasm 整文件就是一个 key，
    // 所以 locateFile 直接返回 /pool/canvaskit（不要拼子路径 —— 拼了会 404）。
    locateFile: () => '/pool/canvaskit',
  })
  return skiaPromise
}

/**
 * 入口主流程在**任何抽帧/渲染开始前**调用（entry main() 对 02S 特有一步）：
 * wasm 就绪 + 动态 import 内层绘制模块，结果存模块级变量。
 * 不走 React state —— state 提交与 renderMediaOnWeb 的开始时序存在竞速
 * （实测间歇性 TDZ "Cannot access 'Composition' before initialization"），
 * 模块级变量在 main() await 之后必然就位，确定性无竞速。
 */
let innerComp: React.FC | null = null
let loadPromise: Promise<void> | null = null
export function ensureSkiaLoaded(): Promise<void> {
  loadPromise ??= (async () => {
    await ensureSkiaWeb()
    innerComp = (await import('./02S-skia-inner.js')).Composition
  })()
  return loadPromise
}

export const Composition: React.FC = () => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const progress = frame / Math.max(1, durationInFrames)

  // main() 已在任何捕获前完成 ensureSkiaLoaded()；此处只读模块级变量

  return (
    <BenchFrame title="02S · 真 Skia 冒烟 —— SKSL runtime shader" footer={`frame ${frame} / ${durationInFrames - 1}`}>
      <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {innerComp !== null ? (
          React.createElement(innerComp)
        ) : (
          <div
            style={{
              width: 400,
              height: 400,
              borderRadius: 24,
              border: '2px solid rgba(255,90,90,0.5)',
              background: `hsl(${progress * 360}, 60%, 40%)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: FONT_FAMILY,
              color: '#fff',
              fontSize: 24,
              textAlign: 'center',
            }}
          >
            SKIA 未就绪（main() 未完成 ensureSkiaLoaded —— 不应发生）
          </div>
        )}
      </AbsoluteFill>

      <div style={{ position: 'absolute', left: 96, top: 150 }}>
        <Badge
          title={innerComp !== null ? 'SKIA SHADER · runtime 出片' : 'SKIA 未就绪'}
          sub={`@remotion/skia 4.0.535 + rn-skia 1.12.4 · CanvasKit wasm 同源 · uProgress=${progress.toFixed(3)}`}
          color={innerComp !== null ? '#b44dff' : '#ff5c5c'}
        />
      </div>

      <div style={{ position: 'absolute', left: 96, right: 96, bottom: 62, height: 8, background: 'rgba(255,255,255,0.14)', borderRadius: 4 }}>
        <div style={{ width: `${progress * 100}%`, height: '100%', background: '#b44dff', borderRadius: 4 }} />
      </div>
    </BenchFrame>
  )
}
