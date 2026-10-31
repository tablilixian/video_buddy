/**
 * 02S 内层 —— 真 Skia 绘制实验（两层对照）：
 *
 * 实验 A（rn-skia 组件层）：`SkiaCanvas` + `<Fill><Shader>` —— 实测**完全不出画**
 * （rn-skia web 的 Canvas 走自己的 reconciler + rAF 绘制，渲染目标不在 web-renderer
 * 的模拟 DOM 里，连元素都不出现）；
 *
 * 实验 B（CanvasKit 直绘 <canvas>）：`LoadSkiaWeb` 后拿 `global.CanvasKit`，
 * `MakeCanvasSurface(el)` + `RuntimeEffect` 逐帧同步绘制 —— 用 #03 立方体的
 * callback-ref 模式（内联箭头 ref 每次提交重发，uProgress 逐帧更新）。
 * web-renderer 对 <canvas> 元素的原生支持已被 #01（ThreeCanvas）证明。
 *
 * 结论口径：谁出画谁成立 —— 这就是"真 Skia 在 CSR 里怎么用"的答案。
 */
import React from 'react'
import { useCurrentFrame, useVideoConfig } from 'remotion'
import { SkiaCanvas } from '@remotion/skia'
import { Fill, Shader, Skia } from '@shopify/react-native-skia'

const SKSL = `
uniform float uProgress;
half4 main(float2 xy) {
  float2 uv = xy / 400.0;
  float2 center = float2(200.0 + 100.0 * sin(uProgress * 6.2831), 200.0 + 100.0 * cos(uProgress * 4.1888));
  float d = distance(xy, center);
  float ring = abs(sin(d * 0.06 - uProgress * 12.566));
  float g = smoothstep(0.0, 1.0, ring);
  return half4(0.15 + 0.45 * g, 0.3 + 0.4 * g, 0.85, 1.0);
}
`

type CkLike = {
  MakeCanvasSurface: (el: HTMLCanvasElement) => { flush: () => void; getCanvas: () => { drawPaint: (p: unknown) => void } | null } | null
  RuntimeEffect: { Make: (s: string) => { makeShader: (uniforms: number[]) => unknown } | null }
  Paint: new () => { setShader: (s: unknown) => void }
}

/** 实验 B：CanvasKit 直绘（global.CanvasKit 由 LoadSkiaWeb 在 main() 前置步就绪）。 */
function drawWithCanvasKit(el: HTMLCanvasElement, progress: number): string {
  const CK = (globalThis as unknown as { CanvasKit?: CkLike }).CanvasKit
  if (!CK) return 'CanvasKit 未就绪'
  try {
    const surface = CK.MakeCanvasSurface(el)
    if (!surface) return 'MakeCanvasSurface 失败'
    const effect = CK.RuntimeEffect.Make(SKSL)
    if (!effect) return 'SKSL 编译失败'
    const paint = new CK.Paint()
    paint.setShader(effect.makeShader([progress]))
    const canvas = surface.getCanvas()
    if (!canvas) return 'surface.getCanvas 为空'
    canvas.drawPaint(paint)
    surface.flush()
    return `直绘 ok · uProgress=${progress.toFixed(3)}`
  } catch (e) {
    return `直绘异常：${String((e as Error).message).slice(0, 60)}`
  }
}

export const Composition: React.FC = () => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const progress = frame / Math.max(1, durationInFrames)

  // 实验 A：rn-skia 组件层（预期不出画 —— 留在画面上作为证据格）
  const shader = Skia.RuntimeEffect.Make(SKSL)

  // 实验 B：CanvasKit 直绘（callback ref，每次提交重发 ⇒ 逐帧重画）
  const directRef = React.useRef<string>('未绘制')
  const directCanvasRef = React.useCallback(
    (el: HTMLCanvasElement | null) => {
      if (el) directRef.current = drawWithCanvasKit(el, progress)
    },
    [progress],
  )

  return (
    <div style={{ display: 'flex', gap: 40, alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
      <div style={{ textAlign: 'center' }}>
        <SkiaCanvas width={400} height={400} style={{ width: 400, height: 400, borderRadius: 24, border: '2px solid rgba(255,92,92,0.6)' }}>
          {shader !== null ? (
            <Fill>
              <Shader source={shader} uniforms={{ uProgress: progress }} />
            </Fill>
          ) : (
            <Fill color="#5a1a5a" />
          )}
        </SkiaCanvas>
        <div style={{ fontFamily: 'BenchSansSC, sans-serif', fontSize: 22, color: '#ff9c9c', marginTop: 12 }}>
          A · rn-skia 组件层（预期不出画）
        </div>
      </div>

      <div style={{ textAlign: 'center' }}>
        <canvas
          ref={directCanvasRef}
          width={400}
          height={400}
          style={{ width: 400, height: 400, borderRadius: 24, border: '2px solid rgba(180,77,255,0.7)' }}
        />
        <div style={{ fontFamily: 'BenchSansSC, sans-serif', fontSize: 22, color: '#d8b4ff', marginTop: 12 }}>
          B · CanvasKit 直绘（{directRef.current}）
        </div>
      </div>
    </div>
  )
}
