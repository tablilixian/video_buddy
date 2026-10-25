// @ts-nocheck
/**
 * 渲染取证台 · 渲染页（在 Electron 渲染进程里跑）
 *
 * 为什么独立成页：会话里的失败全发生在"产品工单桥 + 隐藏窗口 + 画布页三重耦合"里，
 * 任何一个环节都能背锅。这一页把耦合全拆掉，只留 **Remotion + 浏览器编码器**，
 * 于是"同一份 manifest 在这里能不能过"就成了归因的判决点。
 *
 * 关键纪律（沿用 scripts/remotion-verify 的血泪）：
 *   - 必须 registerRoot，否则整页 JS 不执行（白屏无日志）。
 *   - outputTarget 必须 'arraybuffer'（默认 web-fs 需用户手势）。
 *   - 日志挂 documentElement，挂 body 会被 bundle 清掉。
 *   - 每个阶段自己打表，**不相信 metrics 里的字段**（encodeMs 在那边是"时刻"不是"耗时"）。
 */
import React from 'react'
import { registerRoot } from 'remotion'
import { getEncodableVideoCodecs, getEncodableAudioCodecs, canRenderMediaOnWeb, renderMediaOnWeb } from '@remotion/web-renderer'
import { StudioComposition } from '../../src/remotion/components/Root.js'
import { RENDER_QUALITY_SCALE, validateManifest } from '../../src/remotion/manifest.js'

/* ───────────────────────────── 日志 / 上报 ───────────────────────────── */

const logEl = document.createElement('pre')
logEl.id = 'rf-log'
logEl.style.cssText = 'position:fixed;left:8px;top:8px;z-index:9999;font:11px monospace;color:#7ee787;white-space:pre-wrap'
document.documentElement.appendChild(logEl)

/** 同步 XHR：页面可能被 abort / 卸载，fetch 会被打断。 */
function post(payload) {
  const line = JSON.stringify(payload)
  console.log('[rf] ' + line)
  logEl.textContent += line.slice(0, 300) + '\n'
  try {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/report', false)
    xhr.setRequestHeader('content-type', 'application/json')
    xhr.send(line)
  } catch (err) {
    console.log('[rf] post failed ' + String(err))
  }
}

const now = () => performance.now()

/** 把成片字节回传宿主落盘（不落盘的话"渲通了"无法自证）。 */
async function saveMp4(id, buf) {
  try {
    const res = await fetch(`/save?id=${encodeURIComponent(id)}`, { method: 'POST', body: buf })
    const text = await res.text()
    console.log(`[rf] saved ${id} -> ${text}`)
    return text
  } catch (err) {
    console.log(`[rf] save failed ${id}: ${String(err)}`)
    return null
  }
}

/** 实测 rAF 频率（窗口被节流时这里最先露馅）。 */
function measureRaf(ms = 1000) {
  return new Promise((resolve) => {
    let n = 0
    const t0 = performance.now()
    const tick = () => {
      n += 1
      if (performance.now() - t0 < ms) requestAnimationFrame(tick)
      else resolve(Math.round((n * 1000) / (performance.now() - t0)))
    }
    requestAnimationFrame(tick)
  })
}

/* ───────────────────────────── 质量档 ───────────────────────────── */

const PRESETS = {
  draft: {
    scale: RENDER_QUALITY_SCALE.draft,
    videoBitrate: 'low',
    keyframeIntervalInSeconds: 10,
    pageResponsiveness: 'disabled',
    hardwareAcceleration: 'prefer-hardware',
    mediaCacheSizeInBytes: 128 * 1024 * 1024,
  },
  'draft-sw': {
    scale: RENDER_QUALITY_SCALE.draft,
    videoBitrate: 'low',
    keyframeIntervalInSeconds: 10,
    pageResponsiveness: 'disabled',
    hardwareAcceleration: 'no-preference',
    mediaCacheSizeInBytes: 128 * 1024 * 1024,
  },
  'draft-resp': {
    scale: RENDER_QUALITY_SCALE.draft,
    videoBitrate: 'low',
    keyframeIntervalInSeconds: 10,
    pageResponsiveness: 'medium',
    hardwareAcceleration: 'prefer-hardware',
    mediaCacheSizeInBytes: 128 * 1024 * 1024,
  },
  standard: {
    scale: RENDER_QUALITY_SCALE.standard,
    videoBitrate: 'medium',
    keyframeIntervalInSeconds: 5,
    pageResponsiveness: 'medium',
    hardwareAcceleration: 'no-preference',
    mediaCacheSizeInBytes: null,
  },
}

/* ───────────────────────────── 单次渲染 ───────────────────────────── */

async function runOne(run, windowMode) {
  const t0 = now()
  const manifestResp = await fetch(run.manifestUrl)
  const manifest = await manifestResp.json()
  const fetchMs = Math.round(now() - t0)

  // 校验器是产品同款：先确认这份 manifest 本身合法，避免把校验错记成渲染慢
  const validation = validateManifest(manifest)
  if (!validation.ok) {
    return { id: run.id, ok: false, stage: 'validate', errors: validation.errors.slice(0, 6), fetchMs }
  }

  if (run.mode === 'product') return runProduct(run, manifest, windowMode, fetchMs)

  const { width, height, fps, durationInFrames } = manifest.meta
  const frames = Math.max(1, Math.round(run.frames ?? durationInFrames))
  const preset = PRESETS[run.quality] ?? PRESETS.draft

  const rafHz = await measureRaf(800)

  const tCap = now()
  const capability = await canRenderMediaOnWeb({ container: 'mp4', videoCodec: 'h264', width, height })
  const canRenderMs = Math.round(now() - tCap)
  if (!capability.canRender) {
    return { id: run.id, ok: false, stage: 'capability', issues: capability.issues.map((i) => i.message), rafHz, canRenderMs }
  }

  const controller = new AbortController()
  let aborted = false
  if (typeof run.abortAfterMs === 'number' && run.abortAfterMs > 0) {
    setTimeout(() => {
      aborted = true
      controller.abort()
    }, run.abortAfterMs)
  }

  const progress = []
  let framesEmitted = 0
  let firstFrameAt = null
  let lastFrameAt = null
  let encodeDoneAt = null
  /**
   * 镜头卡验证用：在 6 个时间点各抓一帧（含首尾），压到 64×36 灰度，
   * 记录 亮度均值 / 非黑像素占比 / 与上一采样的平均绝对差（MAE）。
   *
   * ⚠️ 为什么不能只看亮度均值：位移类（orbit）、取景类（kenBurns）改的是**位置**，
   * 平均亮度不变 —— 第一轮用均值判，把这两张卡误判成"没动"。MAE 才是"在动"的证据。
   */
  const sampleAt = [0.02, 0.15, 0.35, 0.55, 0.75, 0.96]
    .map((r) => Math.min(frames - 1, Math.max(0, Math.round(frames * r))))
  type SampleStat = { frame: number; mean: number; std: number; nonBlack: number; mae: number }
  const samples: SampleStat[] = []
  let prevGray: Uint8Array | null = null
  const measure = (frame: unknown, index: number): void => {
    try {
      const W = 64
      const H = 36
      const canvas = new OffscreenCanvas(W, H)
      const ctx = canvas.getContext('2d')
      if (ctx === null) return
      ctx.drawImage(frame as CanvasImageSource, 0, 0, W, H)
      const { data } = ctx.getImageData(0, 0, W, H)
      const n = W * H
      const gray = new Uint8Array(n)
      let sum = 0
      let sumSq = 0
      let nonBlack = 0
      for (let i = 0, p = 0; p < n; i += 4, p += 1) {
        const y = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
        gray[p] = y
        sum += y
        sumSq += y * y
        if (y > 8) nonBlack += 1
      }
      const mean = sum / n
      const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean))
      let mae = 0
      if (prevGray !== null) {
        let diff = 0
        for (let p = 0; p < n; p += 1) diff += Math.abs(gray[p] - prevGray[p])
        mae = diff / n
      }
      prevGray = gray
      const r1 = (v: number): number => Math.round(v * 10) / 10
      samples.push({ frame: index, mean: r1(mean), std: r1(std), nonBlack: r1((nonBlack / n) * 100), mae: r1(mae) })
    } catch {
      // 采样是附加证据，失败不影响渲染
    }
  }
  const tRender = now()
  let bytes = 0
  let failure = null
  try {
    const result = await renderMediaOnWeb({
      composition: {
        id: 'studio-composition',
        component: StudioComposition,
        width,
        height,
        fps,
        durationInFrames: frames,
        defaultProps: { manifest },
        calculateMetadata: null,
      },
      inputProps: { manifest },
      container: 'mp4',
      videoCodec: 'h264',
      audioCodec: 'aac',
      outputTarget: 'arraybuffer',
      licenseKey: 'free-license',
      scale: preset.scale,
      videoBitrate: preset.videoBitrate,
      keyframeIntervalInSeconds: preset.keyframeIntervalInSeconds,
      pageResponsiveness: preset.pageResponsiveness,
      hardwareAcceleration: preset.hardwareAcceleration,
      mediaCacheSizeInBytes: preset.mediaCacheSizeInBytes,
      signal: controller.signal,
      onFrame: (frame) => {
        framesEmitted += 1
        const at = now() - tRender
        if (firstFrameAt === null) firstFrameAt = Math.round(at)
        lastFrameAt = Math.round(at)
        while (sampleAt.length > 0 && framesEmitted - 1 >= sampleAt[0]) {
          const slot = sampleAt.shift() as number
          measure(frame, slot)
        }
        return frame
      },
      onProgress: (p) => {
        const at = Math.round(now() - tRender)
        if (typeof p.doneIn === 'number') encodeDoneAt = Math.round(p.doneIn)
        if (progress.length < 12) progress.push({ at, progress: p.progress, encoded: p.encodedFrames, doneIn: p.doneIn })
      },
    })
    const tBlob = now()
    const blob = await result.getBlob()
    const buf = await blob.arrayBuffer()
    bytes = buf.byteLength
    const blobMs = Math.round(now() - tBlob)
    const savedAs = bytes > 0 ? await saveMp4(run.id, buf) : null
    return {
      id: run.id,
      ok: bytes > 0,
      savedAs,
      windowMode,
      quality: run.quality,
      frames,
      rafHz,
      fetchMs,
      canRenderMs,
      renderMs: Math.round(tBlob - tRender),
      blobMs,
      totalMs: Math.round(now() - t0),
      msPerFrame: Math.round(((tBlob - tRender) / frames) * 100) / 100,
      framesEmitted,
      samples,
      firstFrameAt,
      lastFrameAt,
      encodeDoneAt,
      bytes,
      progress,
    }
  } catch (err) {
    failure = String(err && err.message ? err.message : err)
    return {
      id: run.id,
      ok: false,
      stage: aborted ? 'aborted' : 'render',
      aborted,
      windowMode,
      quality: run.quality,
      frames,
      rafHz,
      canRenderMs,
      renderMs: Math.round(now() - tRender),
      totalMs: Math.round(now() - t0),
      framesEmitted,
      firstFrameAt,
      lastFrameAt,
      error: failure,
      progress,
    }
  }
}

/* ───────────────────────────── 产品路径（含字体注入 + 时长探测） ───────────────────────────── */

/**
 * 直接调产品自己的 `renderManifestOnWeb`。
 *
 * 为什么单列一组：它会先 `applyManifestFonts` 再 `probeManifestDurations`（逐个资产在浏览器里
 * 探真值时长），这两步都在计时区间内，且与帧数无关 —— 也就是最可能产生"固定 45–60s"的地方。
 * 这一组的耗时减去 raw 组，就是**产品包装层的净开销**。
 */
async function runProduct(run, manifest, windowMode, fetchMs) {
  const { renderManifestOnWeb } = await import('../../src/client/remotion-render.js')
  const rafHz = await measureRaf(800)
  const t = now()
  let metrics = null
  let warnings = []
  try {
    const out = await renderManifestOnWeb(manifest, { quality: run.quality ?? 'draft' })
    metrics = out.metrics
    warnings = out.warnings
    const savedAs = out.bytes.length > 0 ? await saveMp4(run.id, out.bytes) : null
    return {
      id: run.id,
      ok: out.bytes.length > 0,
      savedAs,
      mode: 'product',
      windowMode,
      quality: run.quality ?? 'draft',
      frames: metrics.frames,
      rafHz,
      fetchMs,
      renderMs: Math.round(now() - t),
      msPerFrame: metrics.msPerFrame,
      bytes: out.bytes.length,
      // 产品自报字段，原样带回（对比用，不作为结论依据）
      reported: { totalMs: metrics.totalMs, msPerFrame: metrics.msPerFrame, encodeMs: metrics.encodeMs, warm: metrics.warm },
      warnings: warnings.slice(0, 6),
    }
  } catch (err) {
    return {
      id: run.id,
      ok: false,
      mode: 'product',
      stage: 'render',
      windowMode,
      quality: run.quality ?? 'draft',
      rafHz,
      renderMs: Math.round(now() - t),
      error: String(err && err.message ? err.message : err),
    }
  }
}

/* ───────────────────────────── 主流程 ───────────────────────────── */

async function main() {
  const params = new URLSearchParams(location.search)
  const group = params.get('group') ?? 'Q1'
  const windowMode = params.get('window') ?? 'hidden'

  const codecs = {
    video: safe(() => getEncodableVideoCodecs('mp4')),
    audio: safe(() => getEncodableAudioCodecs('mp4')),
  }
  post({
    kind: 'env',
    group,
    windowMode,
    ua: navigator.userAgent,
    cores: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory ?? null,
    codecs,
    hasWebCodecs: typeof window.VideoEncoder === 'function',
    hasGpu: Boolean(navigator.gpu),
    dpr: window.devicePixelRatio,
    visible: document.visibilityState,
  })

  const plan = await (await fetch(`/plan?group=${encodeURIComponent(group)}`)).json()
  for (const run of plan.runs) {
    post({ kind: 'begin', id: run.id, title: run.title })
    const out = await runOne(run, windowMode)
    post({ kind: 'run', title: run.title, note: run.note ?? null, ...out })
  }
  post({ kind: 'finished', group })
}

function safe(fn) {
  try {
    const v = fn()
    // web-renderer 的 codec 查询返回 Set，JSON 会序列化成 {}，这里统一摊平
    return v instanceof Set ? Array.from(v) : v
  } catch (err) {
    return String(err)
  }
}

/* Remotion bundle 需要一个 root，否则整页不执行 */
const Root = () => null
registerRoot(Root)

main().catch((err) => {
  post({ kind: 'fatal', error: String(err && err.stack ? err.stack : err) })
  post({ kind: 'finished', group: 'fatal' })
})
