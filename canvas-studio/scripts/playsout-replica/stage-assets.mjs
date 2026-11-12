#!/usr/bin/env node
/**
 * playsout 复刻 · 素材铺放器（stage）。
 *
 * 做什么：
 *   ① 把源工程 `public/` 下的 239 个素材**平铺**复制到 staging 目录
 *      （产品资产路由只吃 `/<projectId>/<file>` 两段，目录层级会被 400 拒收）；
 *   ② 生成一批**预生成 PNG**（灰阶 logo / 径向光晕 / 压暗条 / 扫光 / 药丸底板 / 代码面板）——
 *      这些画面在 manifest DSL 里没有对应原语（CSS `radial-gradient` / `filter:grayscale()`
 *      / `backdrop-filter` 在 CSR 捕获路径下读不到），预生成是正常工程手段；
 *   ③ 产出 `assets.json`（素材 → 同源 URL 清单），供 manifest 组装器引用。
 *
 * 产物：`<repo>/canvas-studio/build/assets/playsout/`（扁平，无子目录）
 *
 * 用法：node scripts/playsout-replica/stage-assets.mjs --source "<源工程目录>"
 *
 * 源工程（只读参考，别人做的工程）目录由 **`--source <dir>`** 或**环境变量
 * `PLAYOUT_SOURCE`** 提供（前者优先）。**刻意不留本机路径默认值**：硬编码默认值
 * 会让脚本在别人机器上跑歪，也会因微信清缓存 / 升级而指向失效路径。
 * 素材本体**不入库**，源工程必须由使用者自行提供。
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createCanvas, encodePng, hexToRgb, lerp, smoothstep } from './lib/png.mjs'
import { C } from './lib/theme.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback
}

/** 源工程根目录（只读参考，别人做的工程）。空串 = 未提供（`resolve('')` 会变成 cwd，必须先判空）。 */
const SOURCE_RAW = argOf('--source', process.env.PLAYOUT_SOURCE ?? '').trim()
const SOURCE = SOURCE_RAW === '' ? '' : resolve(SOURCE_RAW)

/** staging 目录（扁平）。 */
const STAGE = join(REPO, 'build', 'assets', 'playsout')

/** staging 目录在产品资产 URL 里的段名（取证台按 URL 的 projectId 段定位磁盘）。 */
export const STAGE_SLUG = 'playsout'

const log = (msg) => console.log(`[stage] ${msg}`)

/* ─────────────────────────── ① 拷贝源素材 ─────────────────────────── */

/** `partners/grab.png` → `partners-grab.png`（路径分隔符换成 `-`，保证扁平且唯一）。 */
function flatName(relPath) {
  return relPath.split('/').join('-')
}

function walk(dir, base = '') {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    const rel = base === '' ? entry.name : `${base}/${entry.name}`
    if (entry.isDirectory()) out.push(...walk(abs, rel))
    else if (entry.isFile()) out.push(rel)
  }
  return out
}

/* ─────────────────────────── ② 预生成 PNG ─────────────────────────── */

const W = 1920
const H = 1080

/**
 * 径向光晕：椭圆径向渐变，中心色 → 透明。
 * @param {{ cx: number, cy: number, rx: number, ry: number, color: string, peak: number, falloff?: number }} spec
 */
function glowPng(spec) {
  const { cx, cy, rx, ry, color, peak, falloff = 0.7 } = spec
  const [r, g, b] = hexToRgb(color)
  const { data } = createCanvas(W, H, (x, y) => {
    const dx = (x - cx * W) / (rx * W)
    const dy = (y - cy * H) / (ry * H)
    const d = Math.sqrt(dx * dx + dy * dy)
    const a = (1 - smoothstep(0, falloff, d)) * peak
    return [r, g, b, Math.round(a * 255)]
  })
  return encodePng(W, H, data)
}

/**
 * 压暗条：**贴住某一边**、厚度为 `height` 像素的竖直渐变带，带外完全透明。
 *
 * 源工程口径（CSS `linear-gradient` 三段线性，照抄）：
 *   Hero    `0deg`   .96@0%  .80@42%  0@100%   height 300  贴底（Hero.tsx:36-42）
 *   Sdk     `180deg` .94@0%  .72@55%  0@100%   height 210  贴顶（Sdk.tsx:45-53）
 *   Caption `0deg`   .86@0%  .55@46%  0@100%   height 260  贴底（Captions.tsx:32-41）
 *
 * ⚠️ 旧实现把 `t = 1 - y/height` 当成「带内相对位置」，于是 y > height 时 t 变负、
 * `t >= 1` 不成立、smoothstep 被钳到 0 ⇒ **带子以下整屏都是 peak**。
 * 实测后果：字幕一出现，75% 画面被 86% 暗罩盖住（整帧均亮 41 → 12.7），
 * 且字幕条无淡入淡出 ⇒ 全片 9 次「整屏忽明忽暗」的硬跳变。
 *
 * @param {{ from: 'bottom'|'top', height: number, color: string, peak: number, mid: number, midAt: number }} spec
 */
function scrimPng(spec) {
  const { from, height, color, peak, mid, midAt } = spec
  const [r, g, b] = hexToRgb(color)
  const { data } = createCanvas(W, H, (x, y) => {
    const d = from === 'bottom' ? H - 1 - y : y // 距该边的像素距离
    if (d >= height) return [r, g, b, 0] // 带外：完全透明
    const t = d / height // 0 = 贴边，1 = 带的另一端
    const a = t <= midAt
      ? peak + (mid - peak) * (t / midAt)
      : mid * (1 - (t - midAt) / (1 - midAt))
    return [r, g, b, Math.round(Math.max(0, Math.min(1, a)) * 255)]
  })
  return encodePng(W, H, data)
}

/**
 * 上下双压暗条：整屏 `180deg` 渐变，中段透明。
 *
 * 源工程口径（两镜头参数不同 ⇒ 必须各出一张，不能共用）：
 *   Compute  .92@0%  0@26%  0@74%  .92@100%（Compute.tsx 尾）
 *   Audience .85@0%  0@20%  0@62%  .9@100% （Audience.tsx:46）
 *
 * ⚠️ 旧实现的下带是**反的**（带顶最暗、带底透明），与源工程相反。
 */
function scrimTopBottomPng(spec) {
  const { topPeak, topEnd, bottomStart, bottomPeak, color } = spec
  const [r, g, b] = hexToRgb(color)
  const { data } = createCanvas(W, H, (x, y) => {
    const p = y / (H - 1) // 0 = 顶，1 = 底
    let a = 0
    if (p <= topEnd) a = topPeak * (1 - p / topEnd)
    else if (p >= bottomStart) a = bottomPeak * ((p - bottomStart) / (1 - bottomStart))
    return [r, g, b, Math.round(Math.max(0, Math.min(1, a)) * 255)]
  })
  return encodePng(W, H, data)
}

/**
 * 暗角：源工程 `Vignette`（ui.tsx:48-55）的径向渐变。
 * `radial-gradient(118% 88% at 50% 44%, transparent 38%, rgba(0,0,0,strength) 100%)`
 * —— 椭圆半径 118%×88%、圆心 (50%,44%)，38% 以内全透明，到边缘线性升到 strength。
 *
 * DSL 的 `meta.look.vignetteBackground` 是**全局一份**（Root 用 multiply 混合），
 * 逐镜头强度不同 ⇒ 只能预生成 PNG，逐镜头挂一条全屏 image 轨。
 */
function vignettePng(strength) {
  const { data } = createCanvas(W, H, (x, y) => {
    const dx = (x - 0.5 * W) / (1.18 * W)
    const dy = (y - 0.44 * H) / (0.88 * H)
    const d = Math.sqrt(dx * dx + dy * dy)
    const a = d <= 0.38 ? 0 : strength * ((d - 0.38) / (1 - 0.38))
    return [0, 0, 0, Math.round(Math.max(0, Math.min(1, a)) * 255)]
  })
  return encodePng(W, H, data)
}

/** 斜向扫光（Outro 用）：一条旋转 −18° 的横向渐变光带，已画进画布。 */
function sweepPng() {
  const angle = (-18 * Math.PI) / 180
  const bandW = W * 0.26
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const [r, g, b] = hexToRgb(C.peri)
  const { data } = createCanvas(W, H, (x, y) => {
    // 沿旋转后的坐标轴量距离 ⇒ 得到一条真正倾斜的光带
    const dx = x - W * 0.5
    const dy = y - H * 0.5
    const along = dx * cos + dy * sin
    const t = Math.abs(along) / (bandW / 2)
    const a = (1 - smoothstep(0, 1, t)) * 0.3
    return [r, g, b, Math.round(a * 255)]
  })
  return encodePng(W, H, data)
}

/** 收场舞台光：上方柔光池 + 下方地面光池。 */
function stageLightPng() {
  const [br, bg, bb] = hexToRgb(C.blue)
  const [pr, pg, pb] = hexToRgb(C.peri)
  const { data } = createCanvas(W, H, (x, y) => {
    // 上方柔光池（源工程：left 210 / top −330 / 1500×1100）
    const dx1 = (x - (210 + 750)) / 750
    const dy1 = (y - (-330 + 550)) / 550
    const d1 = Math.sqrt(dx1 * dx1 + dy1 * dy1)
    const a1 = (1 - smoothstep(0, 1, d1)) * 0.34
    // 下方地面光池（源工程：left 260 / bottom 40 / 1400×190）
    const dx2 = (x - (260 + 700)) / 700
    const dy2 = (y - (H - 40 - 95)) / 95
    const d2 = Math.sqrt(dx2 * dx2 + dy2 * dy2)
    const a2 = (1 - smoothstep(0, 1, d2)) * 0.2
    if (a1 >= a2) return [br, bg, bb, Math.round(a1 * 255)]
    return [pr, pg, pb, Math.round(a2 * 255)]
  })
  return encodePng(W, H, data)
}

/** 收场中央压暗（源工程：`radial-gradient(46% 42% at 50% 50%, rgba(7,7,15,.72) 0%, transparent)`）。 */
function outroScrimPng() {
  const [r, g, b] = hexToRgb(C.bg)
  const { data } = createCanvas(W, H, (x, y) => {
    const dx = (x - W * 0.5) / (W * 0.46)
    const dy = (y - H * 0.5) / (H * 0.42)
    const d = Math.sqrt(dx * dx + dy * dy)
    const a = (1 - smoothstep(0, 1, d)) * 0.72
    return [r, g, b, Math.round(a * 255)]
  })
  return encodePng(W, H, data)
}

/**
 * 圆角药丸底板（Hero 的三格式 chip）——DSL 没有「圆角矩形」原语，预生成底板。
 * 2× 尺寸出图，渲染时缩到一半 ⇒ 圆角与描边都是抗锯齿的。
 */
function pillPng(width, height, radius, fill, border) {
  const S = 2
  const w = width * S
  const h = height * S
  const [fr, fg, fb, fa] = parseColor(fill)
  const [br, bg, bb, ba] = parseColor(border)
  const { data } = createCanvas(w, h, (x, y) => {
    // 到圆角矩形边界的距离（负 = 内部）
    const dx = Math.max(radius * S - x, 0, x - (w - radius * S))
    const dy = Math.max(radius * S - y, 0, y - (h - radius * S))
    const d = Math.sqrt(dx * dx + dy * dy) - radius * S
    const inside = d <= 0 ? 1 : 0
    const edge = Math.abs(d)
    const borderAlpha = ba * (1 - smoothstep(0, 1.5, edge)) * inside
    const fillAlpha = fa * inside
    // 描边画在填充之上
    const a = Math.max(fillAlpha, borderAlpha)
    const r = lerp(fr, br, borderAlpha > fillAlpha ? 1 : 0)
    const g = lerp(fg, bg, borderAlpha > fillAlpha ? 1 : 0)
    const b = lerp(fb, bb, borderAlpha > fillAlpha ? 1 : 0)
    return [Math.round(r), Math.round(g), Math.round(b), Math.round(a * 255)]
  })
  return encodePng(w, h, data)
}

/** 圆角代码面板（SDK）——同样预生成，替代 `backdrop-filter` 玻璃底。 */
function codePanelPng(width, height) {
  const S = 2
  const w = width * S
  const h = height * S
  const radius = 22 * S
  const [fr, fg, fb, fa] = parseColor('rgba(10,10,24,0.94)')
  const [br, bg, bb, ba] = parseColor('rgba(255,255,255,0.16)')
  const { data } = createCanvas(w, h, (x, y) => {
    const dx = Math.max(radius - x, 0, x - (w - radius))
    const dy = Math.max(radius - y, 0, y - (h - radius))
    const d = Math.sqrt(dx * dx + dy * dy) - radius
    const inside = d <= 0 ? 1 : 0
    const edge = Math.abs(d)
    const borderAlpha = ba * (1 - smoothstep(0, 1.5, edge)) * inside
    const fillAlpha = fa * inside
    const a = Math.max(fillAlpha, borderAlpha)
    const isBorder = borderAlpha > fillAlpha
    return [
      Math.round(isBorder ? br : fr),
      Math.round(isBorder ? bg : fg),
      Math.round(isBorder ? bb : fb),
      Math.round(a * 255),
    ]
  })
  return encodePng(w, h, data)
}

/** `#rgb` / `#rrggbb` / `rgba(r,g,b,a)` → [r,g,b,a(0–1)]。 */
function parseColor(value) {
  if (value.startsWith('#')) {
    const [r, g, b] = hexToRgb(value)
    return [r, g, b, 1]
  }
  const m = /rgba?\(([^)]+)\)/.exec(value)
  if (m === null) return [255, 255, 255, 1]
  const parts = m[1].split(',').map((s) => Number.parseFloat(s.trim()))
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1]
}

/**
 * 圆角描边框（内容卡的描边 + 收场合影的画框）——DSL 的 `shape` 没有描边原语。
 * @param {number} size 逻辑边长（输出 2×）
 * @param {number} radius 逻辑圆角半径
 * @param {number} borderWidth 逻辑描边宽
 * @param {string} color 描边色
 */
function roundFramePng(size, radius, borderWidth, color) {
  const S = 2
  const w = size * S
  const h = size * S
  const r = radius * S
  const bw = borderWidth * S
  const [cr, cg, cb, ca] = parseColor(color)
  const { data } = createCanvas(w, h, (x, y) => {
    const dx = Math.max(r - x, 0, x - (w - r))
    const dy = Math.max(r - y, 0, y - (h - r))
    const d = Math.sqrt(dx * dx + dy * dy) - r
    // 描边 = 距边界 0..bw 的环带
    const a = d <= 0 ? (1 - smoothstep(bw - 1.5, bw, -d)) : 0
    return [cr, cg, cb, Math.round(a * ca * 255)]
  })
  return encodePng(w, h, data)
}

/** 命中环（描边圆）——同上，DSL 无描边圆原语。 */
function circleRingPng(size, ringWidth, color) {
  const S = 2
  const w = size * S
  const cx = w / 2
  const cy = w / 2
  const radius = w / 2 - ringWidth * S
  const [cr, cg, cb, ca] = parseColor(color)
  const { data } = createCanvas(w, w, (x, y) => {
    const d = Math.abs(Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) - radius)
    const a = 1 - smoothstep(ringWidth * S - 1.5, ringWidth * S, d)
    return [cr, cg, cb, Math.round(a * ca * 255)]
  })
  return encodePng(w, w, data)
}

/** 灰阶 logo：用 ffmpeg 的 colorchannelmixer 做 Rec.601 luma（保留 alpha）。 */
function grayscaleViaFfmpeg(src, dest) {
  const filter = [
    'colorchannelmixer=rr=0.299:rg=0.587:rb=0.114',
    'gr=0.299:gg=0.587:gb=0.114',
    'br=0.299:bg=0.587:bb=0.114',
  ].join(':')
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-i', src,
    '-vf', filter,
    '-pix_fmt', 'rgba',
    dest,
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
}

/* ─────────────────────────── 主流程 ─────────────────────────── */

function main() {
  if (SOURCE === '' || !existsSync(SOURCE)) {
    console.error([
      `[stage] 找不到源工程目录：${SOURCE || '(未提供)'}`,
      '',
      '源工程（只读参考，别人做的工程）位置请用下面任一方式提供：',
      '  ① 命令行参数：--source "<源工程目录>"',
      '  ② 环境变量：  PLAYOUT_SOURCE="<源工程目录>"',
      '',
      '该目录需包含 public/ 子目录（素材本体从这里读，**不入库**）。',
    ].join('\n'))
    process.exit(2)
  }
  const publicDir = join(SOURCE, 'public')
  if (!existsSync(publicDir)) {
    console.error(`[stage] 源工程缺少 public/ 子目录：${publicDir}`)
    process.exit(2)
  }
  log(`源工程：${SOURCE}`)
  mkdirSync(STAGE, { recursive: true })

  // ① 拷贝素材
  const files = walk(publicDir)
  const copied = []
  for (const rel of files) {
    const src = join(publicDir, rel)
    const name = flatName(rel)
    const dest = join(STAGE, name)
    copyFileSync(src, dest)
    copied.push({ name, source: rel, bytes: statSync(dest).size })
  }
  log(`拷贝素材 ${copied.length} 个 → ${relative(REPO, STAGE)}`)

  // ② 灰阶 logo
  const grayNames = []
  for (const entry of copied) {
    if (!entry.source.startsWith('partners/')) continue
    const dest = join(STAGE, entry.name.replace(/\.png$/, '-gray.png'))
    grayscaleViaFfmpeg(join(STAGE, entry.name), dest)
    grayNames.push(dest.split('/').pop())
  }
  log(`生成灰阶 logo ${grayNames.length} 个`)

  // ③ 预生成 PNG
  const generated = []
  const emit = (name, buf) => {
    writeFileSync(join(STAGE, name), buf)
    generated.push({ name, bytes: buf.length })
  }

  emit('gen-glow-open.png', glowPng({ cx: 0.5, cy: 0.52, rx: 0.6, ry: 0.5, color: C.blue, peak: 0.2 }))
  emit('gen-glow-left.png', glowPng({ cx: 0.3, cy: 0.56, rx: 0.52, ry: 0.46, color: C.blue, peak: 0.18 }))
  emit('gen-glow-center.png', glowPng({ cx: 0.5, cy: 0.5, rx: 0.7, ry: 0.6, color: C.blue, peak: 0.16 }))
  emit('gen-glow-left2.png', glowPng({ cx: 0.26, cy: 0.52, rx: 0.56, ry: 0.54, color: C.blue, peak: 0.2 }))
  emit('gen-glow-mid.png', glowPng({ cx: 0.5, cy: 0.5, rx: 0.6, ry: 0.56, color: C.blue, peak: 0.18 }))
  emit('gen-core-light.png', glowPng({ cx: 0.5, cy: 0.5, rx: 340 / W, ry: 340 / H, color: '#BEC8FF', peak: 0.95, falloff: 0.5 }))
  emit('gen-scrim-bottom.png', scrimPng({ from: 'bottom', height: 300, color: C.bg, peak: 0.96, mid: 0.80, midAt: 0.42 }))
  emit('gen-scrim-top.png', scrimPng({ from: 'top', height: 210, color: C.bg, peak: 0.94, mid: 0.72, midAt: 0.55 }))
  emit('gen-scrim-top-bottom.png', scrimTopBottomPng({ color: C.bg, topPeak: 0.92, topEnd: 0.26, bottomStart: 0.74, bottomPeak: 0.92 }))
  emit('gen-scrim-audience.png', scrimTopBottomPng({ color: C.bg, topPeak: 0.85, topEnd: 0.20, bottomStart: 0.62, bottomPeak: 0.90 }))
  emit('gen-scrim-caption.png', scrimPng({ from: 'bottom', height: 260, color: C.bg, peak: 0.86, mid: 0.55, midAt: 0.46 }))
  // 暗角：源工程 11 个镜头各一份（强度不同 ⇒ 按强度去重出图）
  for (const strength of [0.45, 0.5, 0.52, 0.55, 0.58, 0.7]) {
    emit(`gen-vignette-${String(Math.round(strength * 100)).padStart(2, '0')}.png`, vignettePng(strength))
  }
  emit('gen-sweep.png', sweepPng())
  emit('gen-stage-light.png', stageLightPng())
  emit('gen-outro-scrim.png', outroScrimPng())
  emit('gen-chip-pill.png', pillPng(260, 56, 28, 'rgba(9,9,20,0.82)', 'rgba(255,255,255,0.16)'))
  emit('gen-code-panel.png', codePanelPng(900, 470))
  emit('gen-logo-chip.png', pillPng(120, 40, 20, 'rgba(255,255,255,0.06)', 'rgba(255,255,255,0.14)'))
  emit('gen-card-frame.png', roundFramePng(214, 22, 2, 'rgba(255,255,255,0.18)'))
  emit('gen-tile-frame.png', roundFramePng(132, 20, 2, 'rgba(255,255,255,0.18)'))
  emit('gen-hit-ring.png', circleRingPng(238, 2, 'rgba(152,163,255,0.95)'))
  log(`生成预生成 PNG ${generated.length} 个`)

  // ④ 素材清单（同源 URL 用 staging slug；装机时按目标 projectId 重写）
  const manifestPath = join(STAGE, 'assets.json')
  const list = [
    ...copied.map((c) => ({ name: c.name, kind: 'source', source: c.source, bytes: c.bytes })),
    ...grayNames.map((n) => ({ name: n, kind: 'generated-gray', bytes: statSync(join(STAGE, n)).size })),
    ...generated.map((g) => ({ name: g.name, kind: 'generated', bytes: g.bytes })),
  ]
  writeFileSync(
    manifestPath,
    `${JSON.stringify({ slug: STAGE_SLUG, prefix: `/canvas-studio/assets/${STAGE_SLUG}/`, files: list }, null, 2)}\n`,
    'utf8',
  )
  log(`素材清单：${list.length} 条 → ${relative(REPO, manifestPath)}`)
}

main()
