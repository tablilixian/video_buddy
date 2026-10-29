/**
 * #03 全量捕获 —— 一格内同时放四件 CSS 白名单外的东西（皇冠片）。
 *
 * 对标官方：`html-in-canvas-compose-webgl` / `html-in-canvas-motion-blur`。
 *
 * 这条要回答的是**天花板问题**：CSR 默认模式只能画 web-renderer 白名单里的 CSS
 * （`parseMaskImage` 只认 linear-gradient/url，`mixBlendMode` / `backdropFilter` / `perspective`
 * 在 4.0.535 里命中 0，§10.9）。打开 `allowHtmlInCanvas` 后改走 Chromium 的
 * `drawElementImage` 整帧截图 ⇒ **白名单整体失效**（§10.2 已在小页面上验证像素）。
 *
 * 所以本片同一屏并置四件事，缺哪件一眼就能看出：
 *   ① 旋转的 `conic-gradient` 光环      （白名单外）
 *   ② `backdrop-filter` 玻璃卡          （白名单外）
 *   ③ `mix-blend-mode` 颗粒叠层          （白名单外）
 *   ④ 手写 WebGL 立方体（`<canvas>`）    （另一条独立路径，顺带替 #01 探路）
 *
 * 另外还放了一个白名单内对照组（`linear-gradient` 底 + `filter: blur` 光斑），
 * 用来区分"整帧没渲"和"只有白名单外的没渲"。
 *
 * 结论口径：①②③④ 全出现 = html-in-canvas 抬天花板成立；只有对照组出现 = 捕获没生效（A10）。
 */

import React from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { Badge, BenchFrame, COLORS, FONT_FAMILY } from './shared.js'

export const meta = {
  id: '03',
  axis: 'html-in-canvas',
  title: '全量捕获（绕过 CSS 白名单）',
  reference: 'html-in-canvas-compose-webgl · html-in-canvas-motion-blur',
  durationInFrames: 300, // 10s @30fps
  expect: { videoCodec: 'h264', audioCodec: 'aac', hasAudio: false, minMotion: true },
  stills: [0, 75, 150, 225, 299],
  assets: [],
} as const

/* ----------------------------- 手写 WebGL 立方体 ---------------------------- */

const VERT = `
attribute vec3 aPos;
attribute vec3 aColor;
uniform mat4 uMvp;
varying vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = uMvp * vec4(aPos, 1.0);
}`

const FRAG = `
precision mediump float;
varying vec3 vColor;
void main() { gl_FragColor = vec4(vColor, 1.0); }`

/**
 * 立方体：8 顶点 + 6 个面。
 * **不用深度测试**——html-in-canvas 的截图上下文里 depth buffer 不可用，开启 DEPTH_TEST
 * 会让所有片元被丢弃（实测现象：只剩 clearColor，一个三角形都不出）。改用画家算法逐帧排序。
 */
const VERTS: Array<[number, number, number]> = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
]

const FACES: Array<{ idx: [number, number, number, number]; color: [number, number, number] }> = [
  { idx: [4, 5, 6, 7], color: [0.35, 0.82, 1.0] },   // +z 前
  { idx: [1, 0, 3, 2], color: [0.48, 0.38, 1.0] },   // -z 后
  { idx: [5, 1, 2, 6], color: [1.0, 0.71, 0.33] },   // +x 右
  { idx: [0, 4, 7, 3], color: [0.92, 0.35, 0.58] },  // -x 左
  { idx: [7, 6, 2, 3], color: [0.35, 1.0, 0.72] },   // +y 上
  { idx: [0, 1, 5, 4], color: [0.55, 0.65, 0.95] },  // -y 下
]

const rotX = (t: number) => {
  const c = Math.cos(t)
  const s = Math.sin(t)
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]
}
const rotY = (t: number) => {
  const c = Math.cos(t)
  const s = Math.sin(t)
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]
}
const perspective = (fovy: number, aspect: number, near: number, far: number) => {
  const f = 1 / Math.tan(fovy / 2)
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]
}
const mul = (a: number[], b: number[]) => {
  const out = new Array<number>(16).fill(0)
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[col * 4 + k]
      out[col * 4 + row] = sum
    }
  }
  return out
}

/** 诊断用：Composition 渲染时读上一帧的 GL 状态（ref 在 commit 时才跑，读到的差一帧，够用）。 */
let GL_STATUS = 'not-run'

/** 极简验证：不看矩阵、不看属性绑定的老 program，直接画一个全屏三角形。
 *  出现黄色 ⇒ drawArrays 有效，问题在矩阵/属性；仍是紫色 ⇒ 该上下文里 draw 本身无效。 */
type GlCache = { prog: WebGLProgram; buf: WebGLBuffer; mvp: WebGLUniformLocation }
const CACHE = new WeakMap<WebGLRenderingContext, GlCache>()

/**
 * 直接画（用 callback ref，**不用 useEffect**）：CSR 逐帧捕获要求 DOM 在 commit 时就已就绪，
 * useEffect 在 paint 之后才跑，会稳定抓到上一帧。
 */
function drawCube(canvas: HTMLCanvasElement, frame: number) {
  const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: true })
  if (!gl) {
    GL_STATUS = canvas.getContext('webgl2') ? 'webgl2-only' : 'no-context'
    return
  }

  // 逐帧渲染里状态会被引擎重置，缓存只留 program/buffer 对象，绑定每帧重做
  let cache = CACHE.get(gl)
  if (!cache) {
    const mk = (type: number, src: string) => {
      const shader = gl.createShader(type)!
      gl.shaderSource(shader, src)
      gl.compileShader(shader)
      return shader
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, mk(gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      GL_STATUS = `link-fail:${String(gl.getProgramInfoLog(prog)).slice(0, 60)}`
      return
    }
    cache = { prog, buf: gl.createBuffer()!, mvp: gl.getUniformLocation(prog, 'uMvp')! }
    CACHE.set(gl, cache)
  }

  const gl2 = gl as WebGLRenderingContext
  gl2.viewport(0, 0, canvas.width, canvas.height)
  gl2.disable(gl2.DEPTH_TEST) // 见 FACES 上方注释：截图上下文没有可用 depth buffer
  gl2.clearColor(0.04, 0.05, 0.09, 1)
  gl2.clear(gl2.COLOR_BUFFER_BIT)

  const t = frame / 30
  const rot = mul(rotX(-0.42 + Math.sin(t * 0.6) * 0.18), rotY(t * 0.9))
  const mvp = mul(perspective(Math.PI / 4, 1, 0.1, 100), mul(rot, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -4.6, 1]))

  // 画家算法：面中心旋转后的 z 越小越远，先画
  const order = FACES.map((face) => {
    const z =
      face.idx.reduce((sum, i) => {
        const [x, y, zz] = VERTS[i]
        return sum + (rot[2] * x + rot[6] * y + rot[10] * zz)
      }, 0) / 4
    return { face, z }
  }).sort((a, b) => a.z - b.z)

  const data: number[] = []
  for (const { face } of order) {
    for (const i of [face.idx[0], face.idx[1], face.idx[2], face.idx[0], face.idx[2], face.idx[3]]) {
      data.push(...VERTS[i], ...face.color)
    }
  }

  gl2.useProgram(cache.prog)
  gl2.bindBuffer(gl2.ARRAY_BUFFER, cache.buf)
  gl2.bufferData(gl2.ARRAY_BUFFER, new Float32Array(data), gl2.DYNAMIC_DRAW)
  const posLoc = gl2.getAttribLocation(cache.prog, 'aPos')
  const colLoc = gl2.getAttribLocation(cache.prog, 'aColor')
  gl2.enableVertexAttribArray(posLoc)
  gl2.vertexAttribPointer(posLoc, 3, gl2.FLOAT, false, 24, 0)
  gl2.enableVertexAttribArray(colLoc)
  gl2.vertexAttribPointer(colLoc, 3, gl2.FLOAT, false, 24, 12)
  gl2.uniformMatrix4fv(cache.mvp, false, new Float32Array(mvp))
  gl2.drawArrays(gl2.TRIANGLES, 0, 36)
  GL_STATUS = `ok rot${Math.round(t * 57) % 360}`

  // 必须 finish：html-in-canvas 的整帧截图发生在 draw 之后，GPU 命令若还排在队列里
  // 就会抓到上一帧甚至空白（实测表现是"只有第 0 帧有立方体"）。
  gl2.finish()
}

/* --------------------------------- 画面 ---------------------------------- */

/** 白名单外的四件事，逐条列在左下角，让评审对着画面核。 */
const CLAIMS = [
  '① conic-gradient 旋转光环',
  '② backdrop-filter 玻璃卡',
  '③ mix-blend-mode 颗粒层',
  '④ WebGL <canvas> 立方体',
] as const

export const Composition: React.FC = () => {
  const frame = useCurrentFrame()
  const spin = frame * 1.4 // 每帧 1.4°：10s 转 14 圈
  const breathe = 1 + Math.sin((frame / 300) * Math.PI * 4) * 0.04
  const cubeSpin = frame / 30

  return (
    <BenchFrame title="03 · 全量捕获 —— 四件白名单外的东西同屏" footer={`frame ${frame} / 299 · allowHtmlInCanvas`}>
      {/* 白名单内对照组：linear-gradient 底 + filter blur 光斑（任何模式都该出现） */}
      <AbsoluteFill style={{ background: 'linear-gradient(160deg, #0b1220 0%, #131a2e 55%, #0a0f1c 100%)' }} />
      <div
        style={{
          position: 'absolute',
          left: 240,
          top: 200,
          width: 620,
          height: 620,
          borderRadius: '50%',
          background: 'linear-gradient(120deg, rgba(90,210,255,0.30), rgba(123,97,255,0.10))',
          filter: 'blur(80px)',
          transform: `scale(${breathe})`,
        }}
      />

      {/* ① conic-gradient 光环：环体 + 中心挖空，整体旋转 */}
      <div
        style={{
          position: 'absolute',
          left: 560,
          top: 90,
          width: 800,
          height: 800,
          borderRadius: '50%',
          background: 'conic-gradient(from 0deg, #ff2d55, #ffb454, #5ad2ff, #7b61ff, #ff2d55)',
          transform: `rotate(${spin}deg)`,
          opacity: 0.95,
        }}
      >
        <div style={{ position: 'absolute', inset: '14%', borderRadius: '50%', background: '#07080d' }} />
      </div>

      {/* ② backdrop-filter 玻璃卡：必须叠在有内容的背景上才看得出模糊 */}
      <div
        style={{
          position: 'absolute',
          left: 560,
          top: 400,
          width: 800,
          height: 300,
          borderRadius: 36,
          border: '2px solid rgba(255,255,255,0.38)',
          background: 'rgba(255,255,255,0.10)',
          backdropFilter: 'blur(26px) saturate(180%)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
        }}
      >
        <div style={{ fontFamily: FONT_FAMILY, fontSize: 62, fontWeight: 700, color: '#ffffff', letterSpacing: 2 }}>
          玻璃卡 · 磨砂 26px
        </div>
        <div style={{ fontFamily: FONT_FAMILY, fontSize: 26, color: 'rgba(255,255,255,0.78)', letterSpacing: 1 }}>
          能看到光环被模糊穿透 = backdrop-filter 生效
        </div>
      </div>

      {/* ③ mix-blend-mode 颗粒层：细密斜纹 + overlay 混合 */}
      <AbsoluteFill
        style={{
          mixBlendMode: 'overlay',
          opacity: 0.55,
          backgroundImage:
            'repeating-linear-gradient(45deg, rgba(255,255,255,0.10) 0px, rgba(255,255,255,0.10) 1px, rgba(0,0,0,0.10) 1px, rgba(0,0,0,0.10) 3px)',
        }}
      />

      {/* ④ WebGL 立方体：手写着色器，不依赖 three */}
      <div style={{ position: 'absolute', right: 110, bottom: 110, width: 300, height: 300, borderRadius: 20, overflow: 'hidden', border: '2px solid rgba(90,210,255,0.5)' }}>
        <canvas ref={(el) => el && drawCube(el, Math.round(cubeSpin * 30))} width={300} height={300} style={{ width: 300, height: 300, display: 'block' }} />
      </div>

      {/* ③b mix-blend-mode 判据块：difference 在白底上必然反相，白雾 vs 反相一眼可分 */}
      <div
        style={{
          position: 'absolute',
          right: 470,
          bottom: 110,
          width: 220,
          height: 220,
          borderRadius: 18,
          background: 'rgba(255,255,255,0.32)',
          mixBlendMode: 'difference',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: FONT_FAMILY,
          fontSize: 22,
          color: '#0b1220',
        }}
      >
        difference
      </div>

      <div
        style={{
          position: 'absolute',
          right: 110,
          bottom: 60,
          width: 300,
          textAlign: 'center',
          fontFamily: FONT_FAMILY,
          fontSize: 18,
          color: GL_STATUS === 'ok' ? COLORS.accent : COLORS.warn,
        }}
      >
        GL: {GL_STATUS}
      </div>

      <div style={{ position: 'absolute', left: 96, top: 150 }}>
        <Badge title="HTML-IN-CANVAS" sub="四件白名单外 · 同屏并置" />
      </div>

      {/* 左下角清单：逐条对着画面核 */}
      <div style={{ position: 'absolute', left: 96, bottom: 150, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {CLAIMS.map((claim) => (
          <div key={claim} style={{ fontFamily: FONT_FAMILY, fontSize: 24, color: COLORS.ink, letterSpacing: 0.5 }}>
            {claim}
          </div>
        ))}
        <div style={{ fontFamily: FONT_FAMILY, fontSize: 20, color: COLORS.dim, marginTop: 6 }}>
          对照组：背景 linear-gradient + filter blur 光斑（白名单内，必现）
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          left: 96,
          right: 96,
          bottom: 62,
          height: 8,
          background: 'rgba(255,255,255,0.14)',
          borderRadius: 4,
        }}
      >
        <div style={{ width: `${interpolate(frame, [0, 299], [0, 100])}%`, height: '100%', background: COLORS.accent, borderRadius: 4 }} />
      </div>
    </BenchFrame>
  )
}
