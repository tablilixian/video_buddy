/**
 * REQ-034 · O-04 S0 spike 页面（**未提交的探针，不属于产品构建**）。
 *
 * 回答三件事（Q2 / Q3 / Q4）：
 * - Q2：隐藏窗口 + `backgroundThrottling:false` 下 rAF 是否真的在跑（`window.__spike.rafTicks`）；
 * - Q3：隐藏窗口里 WebCodecs 编码 + `<video>` 解码是否正常（一次真实 manifest 渲染）；
 * - Q4：隐藏窗口与可见窗口渲出的帧是否**逐像素一致**（抽帧 PNG 的 SHA-256 比对）。
 *
 * 为什么用 PNG 哈希而不是 ffmpeg 取点：`renderManifestOnWeb` 的抽帧走
 * `OffscreenCanvas.convertToBlob({type:'image/png'})` —— 同一份 RGBA 输入必然得到同一串
 * PNG 字节，哈希相等 ⇔ 像素相等，而且**整帧**比对，比取 6 个点更硬。
 *
 * 驱动：`scripts/spike/render-host/main.mjs`（Electron main）。构建：同目录 tsdown.config.ts。
 */
import { renderManifestOnWeb } from '../../../src/client/remotion-render.js'
import type { CompositionManifest } from '../../../src/remotion/manifest.js'

interface SampleDigest {
  frame: number
  bytes: number
  sha256: string
}

interface RenderDigest {
  ok: boolean
  error: string
  msPerFrame: number
  totalMs: number
  width: number
  height: number
  frames: number
  mp4Bytes: number
  mp4Sha256: string
  warnings: string[]
  samples: SampleDigest[]
}

interface SpikeState {
  ready: boolean
  rafTicks: number
  rafTicksPerSecond: number
  webCodecs: { VideoEncoder: boolean; VideoDecoder: boolean; supportedConfigs: boolean }
  render: RenderDigest | null
}

const params = new URLSearchParams(location.search)
const VIDEO_URL = params.get('video') ?? '/assets/test.mp4'
const FRAMES = Number(params.get('frames') ?? '30')
const WIDTH = Number(params.get('width') ?? '480')
const HEIGHT = Number(params.get('height') ?? '270')
const FPS = 30

const state: SpikeState = {
  ready: false,
  rafTicks: 0,
  rafTicksPerSecond: 0,
  webCodecs: { VideoEncoder: false, VideoDecoder: false, supportedConfigs: false },
  render: null,
}
;(window as unknown as { __spike: SpikeState; __spikeRun: () => Promise<RenderDigest> }).__spike = state

// ── Q2：rAF 计数（页面一加载就开始，主进程按时间差算 ticks/s） ──
let tickWindowStart = performance.now()
let tickWindowCount = 0
function tick(): void {
  state.rafTicks += 1
  tickWindowCount += 1
  const elapsed = performance.now() - tickWindowStart
  if (elapsed >= 1000) {
    state.rafTicksPerSecond = Math.round((tickWindowCount * 1000) / elapsed)
    tickWindowStart = performance.now()
    tickWindowCount = 0
  }
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)

async function sha256(data: Uint8Array): Promise<string> {
  // `crypto.subtle.digest` 需要 ArrayBuffer 视图，`Uint8Array` 直接给会按 buffer 全量算。
  const buffer = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
    ? data.buffer
    : data.slice().buffer
  const digest = await crypto.subtle.digest('SHA-256', buffer as ArrayBuffer)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** 探一次 WebCodecs 能力（Q3 的前置事实，失败时也能说清是哪一层不支持）。 */
async function probeWebCodecs(): Promise<void> {
  const encoder = (globalThis as { VideoEncoder?: unknown }).VideoEncoder
  const decoder = (globalThis as { VideoDecoder?: unknown }).VideoDecoder
  state.webCodecs = {
    VideoEncoder: typeof encoder === 'function',
    VideoDecoder: typeof decoder === 'function',
    supportedConfigs: false,
  }
  if (typeof encoder !== 'function' || typeof decoder !== 'function') return
  try {
    const support = await (encoder as { isConfigSupported: (config: unknown) => Promise<{ supported?: boolean }> })
      .isConfigSupported({ codec: 'avc1.42001f', width: WIDTH, height: HEIGHT, bitrate: 2_000_000, framerate: FPS })
    state.webCodecs.supportedConfigs = support.supported === true
  } catch {
    state.webCodecs.supportedConfigs = false
  }
}

function buildManifest(): CompositionManifest {
  return {
    id: 'spike-parity',
    meta: { title: 'spike-parity', width: WIDTH, height: HEIGHT, fps: FPS, durationInFrames: FRAMES },
    tracks: [
      // 满画布渐变底（box 中心语义 = 50,50,100,100）
      {
        id: 'bg', type: 'shape', shape: 'gradient', color: '#1f2937',
        box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: 0, durationInFrames: FRAMES,
      },
      // Q3 的关键：一条真实 <video> 轨（WebCodecs 解码路径）
      {
        id: 'clip', type: 'video', src: VIDEO_URL, startFrame: 0, durationInFrames: FRAMES,
        muted: true, fit: 'cover',
      },
      // 文本（字体面必须先就绪，否则两窗口可能拍到不同的回退字体）
      {
        id: 'title', type: 'textCard', variant: 'title', text: ['像素一致', 'PARITY'],
        startFrame: 0, durationInFrames: FRAMES,
        animate: { from: { opacity: 0, y: 12 }, to: { opacity: 1, y: 0 }, durationInFrames: 12, easing: 'easeOutCubic' },
      },
    ],
  }
}

const sampleFrames = [0, Math.floor(FRAMES / 2), FRAMES - 1]

async function runRender(): Promise<RenderDigest> {
  const manifest = buildManifest()
  try {
    const result = await renderManifestOnWeb(manifest, {
      quality: 'standard',
      sampleFrames,
      // 跳过浏览器侧 ffprobe 兜底：测试素材的时长主进程已用 ffprobe 探过（Q4 要的是同参渲染）
      realDurations: { [VIDEO_URL]: FRAMES / FPS },
    })
    const samples: SampleDigest[] = []
    for (const sample of result.samples) {
      samples.push({ frame: sample.frame, bytes: sample.png.length, sha256: await sha256(sample.png) })
    }
    const digest: RenderDigest = {
      ok: true,
      error: '',
      msPerFrame: result.metrics.msPerFrame,
      totalMs: result.metrics.totalMs,
      width: result.metrics.width,
      height: result.metrics.height,
      frames: result.metrics.frames,
      mp4Bytes: result.bytes.length,
      mp4Sha256: await sha256(result.bytes),
      warnings: result.warnings,
      samples,
    }
    state.render = digest
    state.ready = true
    // 兜一层：确认不是空产物（空产物 = 编码器静默失败）
    if (digest.mp4Bytes === 0) throw new Error('mp4 字节为 0')
    return digest
  } catch (cause) {
    const digest: RenderDigest = {
      ok: false,
      error: cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause),
      msPerFrame: 0,
      totalMs: 0,
      width: 0,
      height: 0,
      frames: 0,
      mp4Bytes: 0,
      mp4Sha256: '',
      warnings: [],
      samples: [],
    }
    state.render = digest
    state.ready = true
    return digest
  }
}

;(window as unknown as { __spikeRun: () => Promise<RenderDigest> }).__spikeRun = runRender

void probeWebCodecs().then(() => {
  state.ready = true
})
