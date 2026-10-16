/**
 * REQ-034 · S10 验证器入口（CSR / route B）。
 *
 * 在 Electron 渲染进程里用 `@remotion/web-renderer` 渲染**产品真实组件**
 * （`StudioComposition` + 标准 `CompositionManifest`），产出剧照 + 成片，并把结果
 * POST 回验证器静态服务的 `/__save`；运行进度经 console 回传（Electron 外壳转发到终端）。
 *
 * 该验证器只覆盖「组件 + `renderMediaOnWeb` 调用形态」；**不覆盖 B3 的渲染工单桥**
 * （宿主 ⇄ 客户端队列/回写那套由 B3 落地 + 冒烟覆盖）。
 *
 * 关键纪律（spike 血泪，勿删）：
 *   - bundle 入口**必须** `registerRoot`，否则整页 JS 不执行（白屏无日志）。
 *   - 日志元素**挂 `documentElement`**（挂 body 会被 Remotion 的 bundle 清掉）。
 *   - `outputTarget: 'arraybuffer'`（默认 `web-fs` 需用户手势，后台渲染不可用）。
 *   - `licenseKey: 'free-license'`（两人公司 Free 档，消告警）。
 */
import React from 'react'
import { registerRoot, Composition } from 'remotion'
import {
  canRenderMediaOnWeb,
  getEncodableAudioCodecs,
  getEncodableVideoCodecs,
  renderMediaOnWeb,
  renderStillOnWeb,
} from '@remotion/web-renderer'
import { StudioComposition } from '../../src/remotion/components/Root.js'

/* ------------------------------- 日志 / 上报 ------------------------------- */

const logEl = document.createElement('pre')
logEl.id = 'verify-log'
logEl.style.cssText = 'position:fixed;left:8px;top:8px;z-index:1;font:12px monospace;color:#8ab4f8;white-space:pre-wrap'
document.documentElement.appendChild(logEl)

function report(step, extra = {}) {
  const line = JSON.stringify({ step, ...extra })
  console.log(`[verify] ${line}`)
  logEl.textContent += `${line}\n`
}

/* --------------------------------- 样例单 --------------------------------- */

const META = {
  title: 'S10 验证',
  width: 1280,
  height: 720,
  fps: 30,
  durationInFrames: 180,
  backgroundColor: '#0b1220',
}

function tracks() {
  return [
    { id: 'card-title', type: 'textCard', variant: 'title', text: ['REQ-034', 'Remotion CSR 验证'], startFrame: 0, durationInFrames: 60 },
    { id: 'img-1', type: 'image', src: '/assets/image.png', fit: 'kenburns', startFrame: 45, durationInFrames: 75 },
    { id: 'clip-1', type: 'video', src: '/assets/clip.mp4', startFrame: 105, durationInFrames: 75 },
    { id: 'fx-1', type: 'transition', effect: 'fade', fromTrackId: 'card-title', toTrackId: 'img-1', startFrame: 45, durationInFrames: 15 },
    { id: 'fx-2', type: 'transition', effect: 'slide', fromTrackId: 'img-1', toTrackId: 'clip-1', startFrame: 105, durationInFrames: 15 },
  ]
}

function manifestWithAudio() {
  return {
    id: 's10-verify-audio',
    meta: META,
    tracks: tracks(),
    audio: { bgmUrl: '/assets/bgm.mp4', voiceOverUrl: '/assets/voice.mp4' },
  }
}

function manifestVideoOnly() {
  return { id: 's10-verify-video', meta: META, tracks: tracks() }
}

function composition(manifest) {
  return {
    id: 'studio-composition',
    component: StudioComposition,
    width: manifest.meta.width,
    height: manifest.meta.height,
    fps: manifest.meta.fps,
    durationInFrames: manifest.meta.durationInFrames,
    defaultProps: { manifest },
    calculateMetadata: null,
  }
}

/* --------------------------------- 落盘 ---------------------------------- */

async function save(name, blob) {
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

async function renderStills(manifest) {
  const shots = [
    ['title', 20],
    ['image', 90],
    ['clip', 150],
  ]
  for (const [name, frame] of shots) {
    const started = performance.now()
    const result = await renderStillOnWeb({
      composition: composition(manifest),
      inputProps: { manifest },
      frame,
      licenseKey: 'free-license',
    })
    const blob = await result.blob({ format: 'png' })
    const bytes = await save(`still-${name}.png`, blob)
    report(`still:${name}`, { bytes, ms: Math.round(performance.now() - started) })
  }
}

async function renderVideo(label, manifest) {
  report('render:start', { label, frames: manifest.meta.durationInFrames })
  const started = performance.now()
  const result = await renderMediaOnWeb({
    composition: composition(manifest),
    inputProps: { manifest },
    container: 'mp4',
    videoCodec: 'h264',
    audioCodec: 'aac',
    outputTarget: 'arraybuffer',
    licenseKey: 'free-license',
  })
  const blob = await result.getBlob()
  const bytes = await save(`render-${label}.mp4`, blob)
  const ms = Math.round(performance.now() - started)
  report('render:done', { label, bytes, ms, msPerFrame: Math.round(ms / manifest.meta.durationInFrames) })
}

async function main() {
  try {
    const manifest = manifestVideoOnly()
    report('env', {
      chromeMajor: Number((navigator.userAgent.match(/Chrome\/(\d+)/) ?? [])[1] ?? 0),
      webCodecs: typeof VideoEncoder !== 'undefined',
    })

    report('codecs', {
      video: await getEncodableVideoCodecs('mp4'),
      audio: await getEncodableAudioCodecs('mp4'),
    })
    report('canRender', {
      value: await canRenderMediaOnWeb({
        container: 'mp4',
        videoCodec: 'h264',
        width: manifest.meta.width,
        height: manifest.meta.height,
      }),
    })

    await renderStills(manifest)
    await renderVideo('video-only', manifest)
    await renderVideo('with-audio', manifestWithAudio())
    report('finished', {})
  } catch (error) {
    report('error', { message: error && error.message ? error.message : String(error) })
  }
}

/* bundle 页面需要一个 Remotion 根；同时触发真渲染。 */
const Anchor = () => null
const Root = () => <Composition id="anchor" component={Anchor} durationInFrames={1} fps={30} width={16} height={16} />
registerRoot(Root)

void main()
