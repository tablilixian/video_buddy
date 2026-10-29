/**
 * 能力基准 · 唯一 bundle 入口（D4：单 bundle 多个 composition）。
 *
 * 后续加新能力项时，**只在这里加一行注册**：
 *   import * as cap11 from './11-xxx.js'
 *   const REGISTRY = { '10': cap10, '11': cap11 }
 * 不要在产物目录里放源码，也不要为每条片单独 bundle（一次 webpack 约 30–60s）。
 *
 * 五条纪律（都是踩过的坑，勿删）：
 *   1. bundle 入口**必须** `registerRoot`，否则整页 JS 不执行（白屏且无日志）；
 *   2. 日志元素挂 `documentElement`（挂 body 会被 Remotion 清掉）；
 *   3. `outputTarget: 'arraybuffer'` —— 默认 `web-fs` 需要用户手势，后台渲染拿不到；
 *   4. 字体**必须**自己注入并等 `document.fonts.ready`，否则回退系统字体 ⇒ 跨机不复现（§11.3 G3）；
 *   5. 一条 composition 失败只影响它自己 —— 但入口异常会让整页挂掉，故 `main()` 全程 try/catch。
 */

import React from 'react'
import { Composition, registerRoot } from 'remotion'
import {
  canRenderMediaOnWeb,
  getEncodableAudioCodecs,
  getEncodableVideoCodecs,
  renderMediaOnWeb,
  renderStillOnWeb,
} from '@remotion/web-renderer'
import * as cap03 from './03-html-in-canvas.js'
import * as cap01 from './01-3d-webgl.js'
import * as cap02 from './02-skia-shader.js'
import * as cap05 from './05-caption-word.js'
import * as cap04 from './04-chart-map.js'
import * as cap06 from './06-audio-viz.js'
import * as cap07 from './07-path-morph.js'
import * as cap08 from './08-effects.js'
import * as cap09 from './09-transition.js'
import * as cap10 from './10-editing.js'

/** 全部能力项。key = 两位编号，与产物文件夹 `NN-<axis>` 一一对应。 */
const REGISTRY: Record<string, { Composition: React.FC }> = {
  '01': cap01,
  '02': cap02,
  '03': cap03,
  '05': cap05,
  '04': cap04,
  '06': cap06,
  '07': cap07,
  '08': cap08,
  '09': cap09,
  '10': cap10,
}

/* ------------------------------- 日志 / 上报 ------------------------------- */

const logEl = document.createElement('pre')
logEl.style.cssText = 'position:fixed;left:8px;top:8px;z-index:1;font:12px monospace;color:#8ab4f8;white-space:pre-wrap'
document.documentElement.appendChild(logEl)

function report(step: string, extra: Record<string, unknown> = {}) {
  const line = JSON.stringify({ step, ...extra })
  console.log(`[bench] ${line}`)
  logEl.textContent += `${line}\n`
}

/* --------------------------------- 字体 ---------------------------------- */

/** 等字体就绪再渲染：不然首帧文字会用系统字体，同一条片两次渲染都可能不一致。 */
async function loadFonts() {
  const faces: Array<[string, string]> = [
    ['/fonts/noto-sans-sc-400.woff2', '400'],
    ['/fonts/noto-sans-sc-700.woff2', '700'],
  ]
  for (const [url, weight] of faces) {
    const face = new FontFace('BenchSansSC', `url(${url})`, { weight, style: 'normal' })
    await face.load()
    document.fonts.add(face)
  }
  await document.fonts.ready
}

/* --------------------------------- 落盘 ---------------------------------- */

async function save(name: string, blob: Blob) {
  const body = await blob.arrayBuffer()
  const res = await fetch(`/__save?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body,
  })
  if (!res.ok) throw new Error(`保存 ${name} 失败：HTTP ${res.status}`)
  return body.byteLength
}

/* --------------------------------- 主流程 -------------------------------- */

type Config = {
  id: string
  outName: string
  width: number
  height: number
  fps: number
  durationInFrames: number
  stills: number[]
  window: string
  allowHtmlInCanvas: boolean
}

async function main() {
  const started = performance.now()
  try {
    const config: Config = await (await fetch('/__config')).json()
    const capability = REGISTRY[config.id]
    if (!capability) throw new Error(`未注册的能力项：${config.id}（在 entry.tsx 的 REGISTRY 里加一行）`)

    await loadFonts()

    report('env', {
      chromeMajor: Number((navigator.userAgent.match(/Chrome\/(\d+)/) ?? [])[1] ?? 0),
      window: config.window,
      fontsReady: document.fonts.check('700 32px BenchSansSC'),
      webCodecs: typeof VideoEncoder !== 'undefined',
      webgl2: (() => {
        const canvas = document.createElement('canvas')
        const gl = canvas.getContext('webgl2')
        return gl ? gl.getParameter(gl.RENDERER) : 'no webgl2'
      })(),
    })

    report('codecs', {
      video: await getEncodableVideoCodecs('mp4'),
      audio: await getEncodableAudioCodecs('mp4'),
    })

    report('canRender', {
      value: await canRenderMediaOnWeb({
        container: 'mp4',
        videoCodec: 'h264',
        width: config.width,
        height: config.height,
      }),
    })

    // R1：HTML-in-canvas 走 Chromium 实验 API（drawElementImage）。这里只报告"内核有没有这个 API"，
    // 真正的开关是下面传给 renderMediaOnWeb 的 allowHtmlInCanvas。
    const probeCanvas = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D | null
    const drawApi = probeCanvas ? typeof (probeCanvas as unknown as { drawElementImage?: unknown }).drawElementImage : 'no-ctx'
    report('htmlInCanvas', { api: String(drawApi), allow: config.allowHtmlInCanvas })

    const composition = {
      id: `${config.id}-bench`,
      component: capability.Composition,
      width: config.width,
      height: config.height,
      fps: config.fps,
      durationInFrames: config.durationInFrames,
      defaultProps: {},
      calculateMetadata: null,
    }

    for (const frame of config.stills) {
      const stillStarted = performance.now()
      const still = await renderStillOnWeb({
        composition,
        inputProps: {},
        frame,
        allowHtmlInCanvas: config.allowHtmlInCanvas,
        licenseKey: 'free-license',
      })
      const blob = await still.blob({ format: 'png' })
      const bytes = await save(`still-${String(frame).padStart(3, '0')}.png`, blob)
      report('still', { frame, bytes, ms: Math.round(performance.now() - stillStarted) })
    }

    const renderStarted = performance.now()
    const result = await renderMediaOnWeb({
      composition,
      inputProps: {},
      container: 'mp4',
      videoCodec: 'h264',
      audioCodec: 'aac',
      outputTarget: 'arraybuffer',
      allowHtmlInCanvas: config.allowHtmlInCanvas,
      licenseKey: 'free-license',
    })
    const blob = await result.getBlob()
    const bytes = await save(config.outName, blob)
    const ms = Math.round(performance.now() - renderStarted)

    report('render:done', {
      outName: config.outName,
      bytes,
      ms,
      frames: config.durationInFrames,
      msPerFrame: Math.round(ms / config.durationInFrames),
    })
    report('finished', { totalMs: Math.round(performance.now() - started) })
  } catch (error) {
    report('error', { message: error && error.message ? error.message : String(error) })
  }
}

/* bundle 页面需要一个 Remotion 根；同时触发真渲染。 */
const Anchor: React.FC = () => null
const Root: React.FC = () => <Composition id="anchor" component={Anchor} durationInFrames={1} fps={30} width={16} height={16} />
registerRoot(Root)

void main()
