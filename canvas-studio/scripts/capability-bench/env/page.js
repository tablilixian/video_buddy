/**
 * 能力探针 · 页面侧（注入到渲染进程执行）
 *
 * 只读、无副作用、不发起网络请求。返回一个纯 JSON 对象，字段含义见 run.js 的报告映射。
 *
 * 覆盖：
 *   R 运行时      UA / 核数 / 内存
 *   W WebGL       webgl1 / webgl2 + 真实 renderer（SwiftShader 会在这里露馅）
 *   G WebGPU      adapter 可用性（新版本 Chrome 的 3D 通道）
 *   C 2D 全帧捕获  drawElementImage / requestPaint / captureElementImage（Q13）
 *   E 编码器      WebCodecs VideoEncoder / AudioEncoder 逐 codec 支持性（Q14）
 *   M 容器/录制   MediaRecorder mimeType（mp4 / webm+vp9 = 透明通道）
 *   A 解码器       VideoDecoder / ImageDecoder / AudioDecoder
 *   S SVG 光栅化   真画一条 path + 一条 polygon 到 canvas，数像素（Q15 的浏览器侧近似）
 *   T 定时器       rAF 帧数 + setTimeout 漂移（判隐藏窗口是否被节流）
 *   Y 字体        document.fonts.check
 *   X CSS 解析    CSS.supports 基线（注意：只能证明"能解析"，不能证明 web-renderer 会画）
 */
async function __probe() {
  const out = {}
  const t0 = Date.now()

  out.runtime = {
    ua: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory || null,
    visibilityState: document.visibilityState,
    hasFocus: document.hasFocus(),
    isSecureContext: window.isSecureContext,
  }

  // ---- W WebGL ----
  const glProbe = (kind) => {
    try {
      const c = document.createElement('canvas')
      c.width = 64
      c.height = 64
      const gl = kind === 'webgl2' ? c.getContext('webgl2') : c.getContext('webgl')
      if (!gl) return { ok: false }
      const dbg = gl.getExtension('WEBGL_debug_renderer_info')
      const res = {
        ok: true,
        version: gl.getParameter(gl.VERSION),
        glsl: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
        vendor: gl.getParameter(gl.VENDOR),
        renderer: gl.getParameter(gl.RENDERER),
        unmaskedVendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null,
        unmaskedRenderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
        extensions: (gl.getSupportedExtensions() || []).length,
        isLost: gl.isContextLost(),
      }
      // 真画一帧（只清屏），确认不是"有名无实"
      gl.clearColor(0.2, 0.4, 0.8, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      const px = new Uint8Array(4)
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
      res.readPixels = Array.from(px)
      return res
    } catch (error) {
      return { ok: false, error: String(error && error.message ? error.message : error) }
    }
  }
  out.webgl1 = glProbe('webgl')
  out.webgl2 = glProbe('webgl2')

  // ---- G WebGPU ----
  out.webgpu = { navigatorGpu: typeof navigator.gpu !== 'undefined' }
  if (typeof navigator.gpu !== 'undefined') {
    try {
      const adapter = await navigator.gpu.requestAdapter()
      if (!adapter) {
        out.webgpu.adapter = null
      } else {
        out.webgpu.adapter = {
          info: adapter.info ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description } : null,
          features: Array.from(adapter.features || []),
          maxBufferSize: adapter.limits ? adapter.limits.maxBufferSize : null,
        }
      }
    } catch (error) {
      out.webgpu.error = String(error && error.message ? error.message : error)
    }
  }

  // ---- C 2D 全帧捕获（Q13）----
  const canvasEl = document.createElement('canvas')
  const ctx2d = canvasEl.getContext('2d')
  out.canvasCapture = {
    drawElementImage: typeof ctx2d.drawElementImage,
    requestPaint: typeof canvasEl.requestPaint,
    captureElementImage: typeof canvasEl.captureElementImage,
    transferControlToOffscreen: typeof canvasEl.transferControlToOffscreen,
    // 规范里也可能挂在原型上
    protoDrawElementImage: typeof CanvasRenderingContext2D.prototype.drawElementImage,
    protoRequestPaint: typeof HTMLCanvasElement.prototype.requestPaint,
    protoCaptureElementImage: typeof HTMLCanvasElement.prototype.captureElementImage,
  }

  // ---- H HTML-in-canvas 功能实测（Q13b，只有 flag 开了才跑）----
  // 约束是逐步试出来的，浏览器报错文案就是唯一可信文档：
  //   1) 被捕获元素必须是 <canvas> 的**直接子元素**（canvas 的 fallback content）
  //   2) canvas 必须带 **layoutsubtree** 属性
  out.htmlInCanvas = { attempted: false }
  if (typeof ctx2d.drawElementImage === 'function') {
    out.htmlInCanvas.attempted = true
    const steps = []
    try {
      const box = document.createElement('div')
      box.setAttribute('style', 'width:200px;height:120px;' +
        'background:conic-gradient(#ff0000,#00ff00,#0000ff,#ff0000);color:#fff;' +
        'font:bold 20px sans-serif;display:flex;align-items:center;justify-content:center')
      box.textContent = 'DOM'
      const target = document.createElement('canvas')
      target.width = 200
      target.height = 120
      target.setAttribute('layoutsubtree', '')
      target.appendChild(box)
      document.body.appendChild(target)
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const g = target.getContext('2d')
      let drawn = false
      for (const args of [[box, 0, 0, 200, 120], [box, 0, 0]]) {
        try {
          g.drawElementImage.apply(g, args)
          steps.push('drawElementImage(argc=' + args.length + ') ok')
          drawn = true
          break
        } catch (error) {
          steps.push('drawElementImage(argc=' + args.length + ') ' + String(error && error.message ? error.message : error).slice(0, 120))
        }
      }
      if (drawn && typeof target.requestPaint === 'function') {
        try {
          await target.requestPaint()
          steps.push('requestPaint ok')
        } catch (error) {
          steps.push('requestPaint ' + String(error && error.message ? error.message : error).slice(0, 80))
        }
      }
      const data = g.getImageData(0, 0, 200, 120).data
      let nonEmpty = 0
      const seen = new Set()
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 8) nonEmpty++
        if (i % 160 === 0) seen.add(data[i] + ',' + data[i + 1] + ',' + data[i + 2])
      }
      out.htmlInCanvas.steps = steps
      out.htmlInCanvas.result = { nonEmptyPixels: nonEmpty, colorBuckets: seen.size }
      target.remove()
    } catch (error) {
      out.htmlInCanvas.steps = steps
      out.htmlInCanvas.error = String(error && error.message ? error.message : error).slice(0, 200)
    }
  }

  // ---- E 编码器（Q14）----
  const vcodecs = [
    'avc1.42001f',
    'avc1.4d0028',
    'hvc1.1.6.L93.B0',
    'hev1.1.6.L93.B0',
    'vp8',
    'vp09.00.10.08',
    'av01.0.08M.08',
  ]
  const acodecs = ['mp4a.40.2', 'opus', 'mp3', 'flac', 'vorbis', 'pcm-s16', 'pcm-f32']
  out.encoders = { hasVideoEncoder: typeof VideoEncoder !== 'undefined', hasAudioEncoder: typeof AudioEncoder !== 'undefined', video: {}, audio: {} }

  const withTimeout = (p, ms) =>
    Promise.race([
      p,
      new Promise((resolve) => setTimeout(() => resolve({ supported: 'timeout' }), ms)),
    ])

  if (typeof VideoEncoder !== 'undefined') {
    for (const codec of vcodecs) {
      try {
        const r = await withTimeout(
          VideoEncoder.isConfigSupported({ codec, width: 1280, height: 720, bitrate: 4000000, framerate: 30 }),
          4000,
        )
        out.encoders.video[codec] = r && r.supported ? true : r && r.supported === 'timeout' ? 'timeout' : false
      } catch (error) {
        out.encoders.video[codec] = 'error: ' + String(error && error.message ? error.message : error).slice(0, 80)
      }
    }
  }
  if (typeof AudioEncoder !== 'undefined') {
    for (const codec of acodecs) {
      try {
        const r = await withTimeout(
          AudioEncoder.isConfigSupported({ codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 }),
          4000,
        )
        out.encoders.audio[codec] = r && r.supported ? true : r && r.supported === 'timeout' ? 'timeout' : false
      } catch (error) {
        out.encoders.audio[codec] = 'error: ' + String(error && error.message ? error.message : error).slice(0, 80)
      }
    }
  }

  // ---- M MediaRecorder 容器 ----
  out.mediaRecorder = { has: typeof MediaRecorder !== 'undefined', mimes: {} }
  if (typeof MediaRecorder !== 'undefined') {
    const mimes = [
      'video/mp4',
      'video/mp4;codecs=avc1.42001f',
      'video/webm',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'audio/mp4',
      'audio/webm',
    ]
    for (const m of mimes) {
      try {
        out.mediaRecorder.mimes[m] = MediaRecorder.isTypeSupported(m)
      } catch (error) {
        out.mediaRecorder.mimes[m] = 'error'
      }
    }
  }

  // ---- A 解码器 ----
  out.decoders = {
    VideoDecoder: typeof VideoDecoder !== 'undefined',
    VideoFrame: typeof VideoFrame !== 'undefined',
    AudioDecoder: typeof AudioDecoder !== 'undefined',
    AudioData: typeof AudioData !== 'undefined',
    ImageDecoder: typeof ImageDecoder !== 'undefined',
    OffscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    createImageBitmap: typeof createImageBitmap === 'function',
    webgl2Offscreen: (() => {
      if (typeof OffscreenCanvas === 'undefined') return false
      try {
        return !!new OffscreenCanvas(8, 8).getContext('webgl2')
      } catch (error) {
        return false
      }
    })(),
  }

  // ---- S SVG 光栅化（Q15）----
  out.svg = await (async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120">' +
      '<rect width="200" height="120" fill="#101010"/>' +
      '<path d="M10 100 L60 20 L110 100 Z" fill="#ff3b30"/>' +
      '<polygon points="120,100 160,30 195,100" fill="#34c759"/>' +
      '</svg>'
    try {
      const img = new Image()
      const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
      const loaded = await new Promise((resolve) => {
        img.onload = () => resolve(true)
        img.onerror = () => resolve(false)
        img.src = url
        setTimeout(() => resolve(false), 4000)
      })
      if (!loaded) return { ok: false, error: 'svg image load failed' }
      const c = document.createElement('canvas')
      c.width = 200
      c.height = 120
      const g = c.getContext('2d')
      g.drawImage(img, 0, 0)
      const data = g.getImageData(0, 0, 200, 120).data
      let red = 0
      let green = 0
      let nonBg = 0
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]
        const gg = data[i + 1]
        const b = data[i + 2]
        if (r > 200 && gg < 100 && b < 100) red++
        if (gg > 150 && r < 120 && b < 120) green++
        if (Math.abs(r - 16) + Math.abs(gg - 16) + Math.abs(b - 16) > 24) nonBg++
      }
      return { ok: true, redPixels: red, greenPixels: green, nonBgPixels: nonBg }
    } catch (error) {
      return { ok: false, error: String(error && error.message ? error.message : error).slice(0, 120) }
    }
  })()

  // ---- T 定时器（判节流）----
  const rafStart = performance.now()
  let rafTicks = 0
  await new Promise((resolve) => {
    const tick = () => {
      rafTicks++
      if (performance.now() - rafStart < 1000) requestAnimationFrame(tick)
      else resolve()
    }
    requestAnimationFrame(tick)
    setTimeout(resolve, 1400)
  })
  const rafElapsed = performance.now() - rafStart

  let timeoutStart = performance.now()
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const timeoutElapsed = performance.now() - timeoutStart

  out.timers = {
    rafTicksIn1s: rafTicks,
    rafElapsedMs: Math.round(rafElapsed),
    tenTimeouts50msElapsedMs: Math.round(timeoutElapsed),
    timeoutDriftRatio: Number((timeoutElapsed / 500).toFixed(2)),
  }

  // ---- Y 字体 ----
  out.fonts = {
    systemUi: document.fonts ? document.fonts.check('16px -apple-system') : null,
    pingfang: document.fonts ? document.fonts.check('16px "PingFang SC"') : null,
    heiti: document.fonts ? document.fonts.check('16px "Heiti SC"') : null,
    arial: document.fonts ? document.fonts.check('16px Arial') : null,
  }

  // ---- X CSS 解析基线 ----
  const cssProbe = (prop, value) => {
    try {
      return CSS.supports(prop, value)
    } catch (error) {
      return 'error'
    }
  }
  out.cssSupport = {
    mixBlendMode: cssProbe('mix-blend-mode', 'multiply'),
    backdropFilter: cssProbe('backdrop-filter', 'blur(4px)'),
    maskLinear: cssProbe('mask-image', 'linear-gradient(black, transparent)'),
    maskConic: cssProbe('mask-image', 'conic-gradient(black, transparent)'),
    perspective: cssProbe('perspective', '1200px'),
    transformStyle: cssProbe('transform-style', 'preserve-3d'),
    objectPosition: cssProbe('object-position', '30% 40%'),
    clipPathInset: cssProbe('clip-path', 'inset(10% 10% 10% 10%)'),
    clipPathUrl: cssProbe('clip-path', 'url(#x)'),
    filterSvg: cssProbe('filter', 'url(#x)'),
    filterBlur: cssProbe('filter', 'blur(4px)'),
    backgroundClipText: cssProbe('background-clip', 'text'),
    writingMode: cssProbe('writing-mode', 'vertical-rl'),
    textStroke: cssProbe('-webkit-text-stroke', '1px red'),
  }

  out.elapsedMs = Date.now() - t0
  return out
}
