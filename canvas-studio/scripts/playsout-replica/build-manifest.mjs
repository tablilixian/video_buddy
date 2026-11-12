#!/usr/bin/env node
/**
 * playsout 复刻 · manifest 组装器。
 *
 * 输入：`lib/spec.mjs`（分镜内容与时序）→ 输出：一份 1800 帧 / 1920×1080@30 的
 * CompositionManifest（12 镜头等价复刻）。
 *
 * 为什么是「脚本生成」而不是手写 JSON：全片 160+ 条轨、每条都要算画布百分比与
 * 帧号，手写 60–120KB 的 JSON 必然出错（2026-11-05 有 3h37m 零成片的前车之鉴）。
 * 脚本化之后，规格（spec）与产物（manifest）分离，改规格不改产物。
 *
 * 用法：node scripts/playsout-replica/build-manifest.mjs [--slug playsout] [--out <path>]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { initMetrics, textWidth } from './lib/metrics.mjs'
import { CANVAS, C, PARTNER_LOGOS, SHOT_START, round2, wallCell } from './lib/theme.mjs'
import {
  AUDIENCE_TICKS, CAPTIONS, COMPUTE_NODES, EYEBROWS, HERO_CAM, HERO_CHIPS, METRIC_ROWS,
  OUTRO_TILES, PRISM_CARDS, PRISM_IN_APP, SDK_CAM, SDK_CODE, SFX, TITLE_CARDS, VO,
} from './lib/spec.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')

/* ─────────────────────────── 入参 ─────────────────────────── */

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback
}

/** staging 段名（= 取证台按 URL 里的 projectId 段定位磁盘用的那一段）。 */
const SLUG = argOf('--slug', 'playsout')
/** 产物路径。 */
const OUT = resolve(REPO, argOf('--out', 'build/playsout/manifest.json'))
/** staging 素材目录（字体度量要用）。 */
const STAGE = join(REPO, 'build', 'assets', SLUG)

const PREFIX = `/canvas-studio/assets/${SLUG}/`
/** 源素材（按 staging 的扁平命名规则）。 */
const src = (rel) => `${PREFIX}${rel.split('/').join('-')}`
/** 预生成素材。 */
const gen = (name) => `${PREFIX}${name}`

/* ─────────────────────────── 几何与排版助手 ─────────────────────────── */

const W = CANVAS.width
const H = CANVAS.height

/** 像素矩形 → 画布百分比 box（中心语义）。 */
const rect = (left, top, w, h) => ({
  x: round2(((left + w / 2) / W) * 100),
  y: round2(((top + h / 2) / H) * 100),
  w: round2((w / W) * 100),
  h: round2((h / H) * 100),
})

/** `title` 变体的实际字号（产品写死 84px，1080p 设计值）。 */
const TITLE_PX = 84
/**
 * 源工程展示字体的字距（-0.022em）—— **仅作溯源记录，产品渲染器并不施加它**
 * （`textCard` 的四个变体都没写 `letterSpacing`，实测「The」墨迹宽 144px =
 * HarfBuzz 无字距 advance 147px，扣掉字距应是 141px ⇒ 证明没施加）。
 */
const SOURCE_TITLE_TRACKING = -0.022 * TITLE_PX
/**
 * 排版度量用的字距：**恒为 0**。
 *
 * 踩坑记录：用 `-0.022em` 度量会让每个词少算 `n × 1.85px`，于是
 * ① 词与词之间的 18px 间隙被压到 ~10px；② box 比文字窄，字有被 `overflow:hidden` 裁的风险。
 * 度量必须按**渲染器真实画出来的宽度**算（无字距）。
 */
const TITLE_LETTER = 0

/**
 * 左对齐展示文本的 box：DSL 的 `textCard` 一律把文字**居中**在 box 里，
 * 所以要让文字从 `leftPx` 起排，box 的中心必须落在 `leftPx + 字宽/2`。
 *
 * @param {number} leftPx 文字左边缘（画布像素）
 * @param {number} centerYPx 文字垂直中心
 * @param {number} w 文字宽度（像素）
 * @param {{ h?: number, pad?: number }} options h = 盒高；pad = 盒宽相对字宽的富余
 */
function textBox(leftPx, centerYPx, w, { h = 96, pad = 1.16 } = {}) {
  const boxW = w * pad
  return rect(leftPx + w / 2 - boxW / 2, centerYPx - h / 2, boxW, h)
}

/**
 * 小号标签（`subtitle` 变体）的 box。
 *
 * `subtitle` 的字号由**盒高**决定（`floor(可用高 / 1.35)`），文字贴在盒子底部、
 * 盒内还有 16×8 的内边距 —— 所以盒子要比文字大一圈。
 */
function labelBox(leftPx, centerYPx, text, size, { faceKey = 'NBDisplay-800', letterSpacing = 0 } = {}) {
  const w = textWidth(text, { faceKey, size, letterSpacing })
  const boxH = size * 1.35 + 16
  const boxTop = centerYPx - boxH + 8 + (size * 1.35) / 2
  return {
    box: rect(leftPx - 16, boxTop, w + 32, boxH),
    width: w,
  }
}

/* ─────────────────────────── 轨道收集 ─────────────────────────── */

const tracks = []
const push = (track) => {
  if (tracks.some((t) => t.id === track.id)) throw new Error(`轨 id 重复：${track.id}`)
  tracks.push(track)
  return track
}

/* ─────────────────────────── S1 · Open ─────────────────────────── */

function buildOpen() {
  const from = SHOT_START.open
  const dur = 150

  push({
    id: 'open-dots', type: 'shape', shape: 'dotGrid', color: 'rgba(255,255,255,0.05)', dotSpacing: 30, dotRadius: 1,
    box: rect(0, 0, W, H), startFrame: from, durationInFrames: dur, fadeFrames: 0,
  })

  push({
    id: 'open-glow', type: 'image', src: gen('gen-glow-open.png'), fit: 'cover', hasAlpha: true,
    startFrame: from, durationInFrames: dur, fadeFrames: 0,
    animate: [
      { startFrame: 112, durationInFrames: 24, from: { opacity: 0 }, to: { opacity: 1 }, easing: 'easeOut' },
      { startFrame: 136, durationInFrames: 14, from: { opacity: 1 }, to: { opacity: 0.55 }, easing: 'easeOut' },
    ],
  })

  // logo 墙：3D 容器（group）+ 21 个格子（底板 / 灰阶 logo / 彩色 logo）
  const children = []
  PARTNER_LOGOS.forEach((name, i) => {
    const cell = wallCell(i)
    const cellBox = rect(cell.cx - cell.cellW / 2, cell.cy - cell.cellH / 2, cell.cellW, cell.cellH)
    const logoBox = rect(cell.cx - 88, cell.cy - 42, 176, 84)
    const appear = 4 + i * 2.2
    const colorAt = 54 + cell.col * 5 + cell.row * 3

    children.push({
      id: `open-cell-${i}`, type: 'shape', shape: 'rect', color: 'rgba(255,255,255,0.035)',
      box: cellBox, startFrame: 0, durationInFrames: dur, fadeFrames: 0,
      animate: [{
        startFrame: Math.round(appear), durationInFrames: 20,
        from: { opacity: 0 }, to: { opacity: 1 }, easing: 'easeOut',
      }],
    })
    children.push({
      id: `open-gray-${i}`, type: 'image', src: src(`partners/${name}.png`).replace(/\.png$/, '-gray.png'),
      fit: 'contain', hasAlpha: true, box: logoBox, startFrame: 0, durationInFrames: dur, fadeFrames: 0,
      animate: [{
        startFrame: Math.round(appear), durationInFrames: 20,
        from: { opacity: 0 }, to: { opacity: 1 }, easing: 'easeOut',
      }],
    })
    children.push({
      id: `open-color-${i}`, type: 'image', src: src(`partners/${name}.png`),
      fit: 'contain', hasAlpha: true, box: logoBox, startFrame: 0, durationInFrames: dur, fadeFrames: 0,
      reveal: { kind: 'wipe', direction: 'right', startFrame: Math.round(colorAt), durationInFrames: 18 },
      animate: [{
        startFrame: Math.round(appear), durationInFrames: 20,
        from: { opacity: 0 }, to: { opacity: 1 }, easing: 'easeOut',
      }],
    })
  })

  push({
    id: 'open-wall', type: 'group', children,
    startFrame: from, durationInFrames: dur, fadeFrames: 0,
    transform: { perspective: 1700 },
    // ⚠️ 多段 `animate` 的窗口必须**首尾相接**：渲染器对每个维度独立选段，
    // 帧落在两段之间的空档时取「末段终点」⇒ 空档里整块会被钉成末态（本例 opacity=0 ⇒ 整墙消失）。
    // 所以这里用「淡入 → 保持 → 收束」三段相接，而不是「淡入 … 收束」两段留空。
    animate: [
      {
        startFrame: 0, durationInFrames: 14,
        from: { opacity: 0, scale: 1.18, rotateX: 13, rotation: -3.2 },
        to: { opacity: 1, scale: 1.18, rotateX: 13, rotation: -3.2 },
        easing: 'easeOut',
      },
      {
        startFrame: 14, durationInFrames: 86,
        from: { opacity: 1, scale: 1.18, rotateX: 13, rotation: -3.2 },
        to: { opacity: 1, scale: 1.18, rotateX: 13, rotation: -3.2 },
        easing: 'linear',
      },
      {
        startFrame: 100, durationInFrames: 38,
        from: { opacity: 1, scale: 1.18, rotateX: 13, rotation: -3.2 },
        to: { opacity: 0, scale: 0.0177, rotateX: 0, rotation: 0 },
        easing: 'easeIn',
      },
    ],
  })

  push({
    id: 'open-core', type: 'image', src: gen('gen-core-light.png'), fit: 'cover', hasAlpha: true,
    startFrame: from, durationInFrames: dur, fadeFrames: 0,
    animate: [
      {
        startFrame: 104, durationInFrames: 32,
        from: { opacity: 0, scale: 0.3 }, to: { opacity: 0.9, scale: 1.2 }, easing: 'easeOut',
      },
      {
        startFrame: 136, durationInFrames: 14,
        from: { opacity: 0.9, scale: 1.2 }, to: { opacity: 0.36, scale: 0.66 }, easing: 'easeOut',
      },
    ],
  })

  // 字标：icon + 文字（实测字宽定位，整体居中）
  const wordW = textWidth('PlaysOut', { size: TITLE_PX, letterSpacing: TITLE_LETTER })
  const iconSize = 104
  const gap = 28
  const total = iconSize + gap + wordW
  const left = (W - total) / 2
  const iconCx = left + iconSize / 2
  const wordLeft = left + iconSize + gap

  push({
    id: 'open-icon', type: 'image', src: src('brand/playsout-icon.png'), fit: 'contain', hasAlpha: true,
    box: rect(iconCx - iconSize / 2, 540 - iconSize / 2, iconSize, iconSize),
    startFrame: from + 116, durationInFrames: 34, fadeFrames: 0,
    animate: [{
      startFrame: 0, durationInFrames: 22,
      from: { opacity: 0, scale: 0.82 }, to: { opacity: 1, scale: 1 }, easing: 'easeOut',
    }],
  })
  push({
    id: 'open-word', type: 'textCard', variant: 'title', text: 'PlaysOut', fx: 'glow',
    box: textBox(wordLeft, 540, wordW),
    startFrame: from + 116, durationInFrames: 34, fadeFrames: 0,
    anim: 'fadeUp', animOptions: { wordDelayFrames: 2, offsetY: 8, blur: 6 },
  })

  push({
    id: 'open-eyebrow', type: 'textCard', variant: 'subtitle',
    text: EYEBROWS.open.text,
    box: labelBox(120, 92 + 10, EYEBROWS.open.text, 19).box,
    startFrame: from + EYEBROWS.open.from, durationInFrames: 150 - EYEBROWS.open.from, fadeFrames: 0,
  })
}

/* ─────────────────────────── S2/S5/S11 · 呼吸字卡 ─────────────────────────── */

function buildTitleCard(card) {
  const from = SHOT_START[card.shot]
  const dur = card.shot === 't1' ? 54 : 54
  const left = 176

  push({
    id: `${card.shot}-dots`, type: 'shape', shape: 'dotGrid', color: 'rgba(255,255,255,0.045)', dotSpacing: 30, dotRadius: 1,
    box: rect(0, 0, W, H), startFrame: from, durationInFrames: dur, fadeFrames: 0,
  })
  push({
    id: `${card.shot}-glow`, type: 'image', src: gen('gen-glow-left.png'), fit: 'cover', hasAlpha: true,
    startFrame: from, durationInFrames: dur, fadeFrames: 0,
  })

  // 眉标 + 前置横线（源工程：rule 0→132px 生长 + 22px 眉标）
  const eyebrowSize = 22
  const eyebrowW = textWidth(card.eyebrow, { size: eyebrowSize })
  const ruleW = 132
  const gap = 18
  const blockTop = 540 - (eyebrowSize * 1.35 + 34 + card.lines.length * 94.6) / 2
  const eyebrowCy = blockTop + (eyebrowSize * 1.35) / 2

  push({
    id: `${card.shot}-rule`, type: 'shape', shape: 'line', color: C.peri,
    box: rect(left, eyebrowCy - 1, ruleW, 2), pivot: { x: 0, y: 50 },
    startFrame: from, durationInFrames: dur, fadeFrames: 0,
    animate: [{
      startFrame: 0, durationInFrames: 16,
      from: { scale: 0.001 }, to: { scale: 1 }, easing: 'easeOut',
    }],
  })
  push({
    id: `${card.shot}-eyebrow`, type: 'textCard', variant: 'subtitle', text: card.eyebrow,
    box: labelBox(left + ruleW + gap, eyebrowCy, card.eyebrow, eyebrowSize).box,
    startFrame: from, durationInFrames: dur, fadeFrames: 0,
    animate: [{
      startFrame: 0, durationInFrames: 12,
      from: { opacity: 0 }, to: { opacity: 1 }, easing: 'easeOut',
    }],
  })

  // 正文行：每行按「词」错峰进场（wipe 用 maskReveal，slide 用 wordStagger，rise 用 fadeUp）
  const preset = card.variant === 'wipe' ? 'maskReveal' : card.variant === 'rise' ? 'fadeUp' : 'wordStagger'
  let wordIndex = 0
  card.lines.forEach((line, li) => {
    const centerY = blockTop + (eyebrowSize * 1.35) + 34 + li * 94.6 + 94.6 / 2
    let cursor = left
    line.segments.forEach((seg, si) => {
      const w = textWidth(seg.text, { size: TITLE_PX, letterSpacing: TITLE_LETTER })
      const track = {
        id: `${card.shot}-line-${li}-${si}`,
        type: 'textCard',
        variant: 'title',
        text: seg.text,
        box: textBox(cursor, centerY, w),
        startFrame: from,
        durationInFrames: dur,
        fadeFrames: 0,
        anim: preset,
        animOptions: { wordDelayFrames: card.variant === 'wipe' ? 0 : 1, offsetY: 14, blur: 4 },
      }
      if (seg.accent === true) track.fx = 'metal'
      // 行内首词的进场时机 = 源工程的全局词序
      const delay = card.variant === 'wipe' ? li * 5 : 1 + wordIndex * 1.4
      track.animate = [{
        startFrame: Math.round(delay), durationInFrames: card.variant === 'wipe' ? 20 : 12,
        from: { opacity: 0 }, to: { opacity: 1 }, easing: 'easeOut',
      }]
      push(track)
      cursor += w + 18
      wordIndex += 1
    })
  })
}

/* ─────────────────────────── S3 · Hero ─────────────────────────── */

function buildHero() {
  const from = SHOT_START.hero
  const dur = 240

  // 2.5D 相机：源工程 PageCam 的 5 个关键帧 → 多段 animate 串成关键帧链。
  // 说明：`perspective` 只能静态写在 `transform`（逐帧变透视没有对应视觉语义），
  // 关键帧里的 zoom/cy 换算成「层的 y 位移 + 缩放」。
  push({
    id: 'hero-page', type: 'image', src: src('textures/live/home-full.png'),
    fit: 'cover', sourceRect: { x: 0, y: 0, w: 100, h: 20 },
    transform: { perspective: 1500 },
    startFrame: from, durationInFrames: dur, fadeFrames: 0,
    animate: [
      {
        startFrame: 0, durationInFrames: 56,
        from: { y: 71.3, scale: 0.95, rotateX: 0, rotateY: 0 },
        to: { y: 55.6, scale: 1.0, rotateX: 0, rotateY: 0 },
        easing: 'easeInOut',
      },
      {
        startFrame: 56, durationInFrames: 64,
        from: { y: 55.6, scale: 1.0, rotateX: 0, rotateY: 0 },
        to: { y: 37.9, scale: 1.07, rotateX: 4, rotateY: -5 },
        easing: 'easeInOut',
      },
      {
        startFrame: 120, durationInFrames: 70,
        from: { y: 37.9, scale: 1.07, rotateX: 4, rotateY: -5 },
        to: { y: 25.5, scale: 1.26, rotateX: 8, rotateY: 0 },
        easing: 'easeInOut',
      },
      {
        startFrame: 190, durationInFrames: 50,
        from: { y: 25.5, scale: 1.26, rotateX: 8, rotateY: 0 },
        to: { y: 22.3, scale: 1.3, rotateX: 8, rotateY: 0 },
        easing: 'easeInOut',
      },
    ],
  })

  push({
    id: 'hero-scrim', type: 'image', src: gen('gen-scrim-bottom.png'), fit: 'cover', hasAlpha: true,
    startFrame: from, durationInFrames: dur, fadeFrames: 0,
  })

  // 三格式 chip：药丸底板（预生成）+ 彩色圆点 + 标签
  const pillW = 260
  const pillH = 56
  const chipGap = 18
  const chipY = 1080 - 262 - pillH / 2
  const totalW = HERO_CHIPS.length * pillW + (HERO_CHIPS.length - 1) * chipGap
  let chipLeft = (W - totalW) / 2
  HERO_CHIPS.forEach((chip, i) => {
    const cx = chipLeft + pillW / 2
    push({
      id: `hero-chip-pill-${i}`, type: 'image', src: gen('gen-chip-pill.png'), fit: 'contain', hasAlpha: true,
      box: rect(chipLeft, chipY - pillH / 2, pillW, pillH),
      startFrame: from + chip.from, durationInFrames: dur - chip.from, fadeFrames: 0,
      animate: [{
        startFrame: 0, durationInFrames: 20,
        from: { opacity: 0, scale: 0.94 }, to: { opacity: 1, scale: 1 }, easing: 'easeOut',
      }],
    })
    push({
      id: `hero-chip-dot-${i}`, type: 'shape', shape: 'circle', color: chip.color,
      box: rect(chipLeft + 30, chipY - 4.5, 9, 9),
      startFrame: from + chip.from, durationInFrames: dur - chip.from, fadeFrames: 0,
      animate: [{
        startFrame: 0, durationInFrames: 20,
        from: { opacity: 0 }, to: { opacity: 1 }, easing: 'easeOut',
      }],
    })
    const label = labelBox(chipLeft + 51, chipY, chip.text, 26)
    push({
      id: `hero-chip-text-${i}`, type: 'textCard', variant: 'subtitle', text: chip.text,
      box: label.box,
      startFrame: from + chip.from, durationInFrames: dur - chip.from, fadeFrames: 0,
      animate: [{
        startFrame: 0, durationInFrames: 20,
        from: { opacity: 0 }, to: { opacity: 1 }, easing: 'easeOut',
      }],
    })
    chipLeft += pillW + chipGap
  })

  push({
    id: 'hero-eyebrow', type: 'textCard', variant: 'subtitle', text: EYEBROWS.hero.text,
    box: labelBox(120, 102, EYEBROWS.hero.text, 19).box,
    startFrame: from + EYEBROWS.hero.from, durationInFrames: dur - EYEBROWS.hero.from, fadeFrames: 0,
  })
}

/* ─────────────────────────── S4 · Metrics ─────────────────────────── */

function buildMetrics() {
  const from = SHOT_START.metrics
  const dur = 168

  push({
    id: 'metrics-dots', type: 'shape', shape: 'dotGrid', color: 'rgba(255,255,255,0.05)', dotSpacing: 30, dotRadius: 1,
    box: rect(0, 0, W, H), startFrame: from, durationInFrames: dur, fadeFrames: 0,
  })
  push({
    id: 'metrics-glow', type: 'image', src: gen('gen-glow-center.png'), fit: 'cover', hasAlpha: true,
    startFrame: from, durationInFrames: dur, fadeFrames: 0,
  })

  const colW = 1656 / 4
  METRIC_ROWS.forEach((row, i) => {
    const left = 132 + i * colW
    const numW = textWidth(row.value, { size: TITLE_PX, letterSpacing: TITLE_LETTER })
    push({
      id: `metrics-num-${i}`, type: 'textCard', variant: 'title', text: row.value,
      box: textBox(left, 525, numW),
      startFrame: from, durationInFrames: dur, fadeFrames: 0,
      animate: [{
        startFrame: i * 5, durationInFrames: 18,
        from: { opacity: 0 }, to: { opacity: 1 }, easing: 'easeOut',
      }],
    })
    push({
      id: `metrics-rule-${i}`, type: 'shape', shape: 'line', color: 'rgba(255,255,255,0.12)',
      box: rect(left, 622, 380, 1), pivot: { x: 0, y: 50 },
      startFrame: from, durationInFrames: dur, fadeFrames: 0,
      animate: [{
        startFrame: i * 5 + 6, durationInFrames: 24,
        from: { scale: 0.001 }, to: { scale: 1 }, easing: 'easeOut',
      }],
    })
    const label = labelBox(left, 663, row.label, 26)
    push({
      id: `metrics-label-${i}`, type: 'textCard', variant: 'subtitle', text: row.label,
      box: label.box,
      startFrame: from, durationInFrames: dur, fadeFrames: 0,
      animate: [{
        startFrame: row.start + 44, durationInFrames: 22,
        from: { opacity: 0 }, to: { opacity: 1 }, easing: 'easeOut',
      }],
    })
  })

  push({
    id: 'metrics-eyebrow', type: 'textCard', variant: 'subtitle', text: EYEBROWS.metrics.text,
    box: labelBox(120, 102, EYEBROWS.metrics.text, 19).box,
    startFrame: from + EYEBROWS.metrics.from, durationInFrames: dur - EYEBROWS.metrics.from, fadeFrames: 0,
  })
}

/* ─────────────────────────── S6 · SDK ─────────────────────────── */

function buildSdk() {
  const from = SHOT_START.sdk
  const dur = 168

  push({
    id: 'sdk-page', type: 'image', src: src('textures/live/dev-full.png'),
    fit: 'cover', sourceRect: { x: 0, y: 0, w: 100, h: 50 },
    transform: { perspective: 1600 },
    startFrame: from, durationInFrames: dur, fadeFrames: 0,
    animate: [
      {
        startFrame: 0, durationInFrames: 64,
        from: { y: 45.6, scale: 0.98, rotateX: 0, rotateY: 0 },
        to: { y: 27.8, scale: 1.08, rotateX: 3, rotateY: -4 },
        easing: 'easeInOut',
      },
      {
        startFrame: 64, durationInFrames: 104,
        from: { y: 27.8, scale: 1.08, rotateX: 3, rotateY: -4 },
        to: { y: 17.2, scale: 1.18, rotateX: 5, rotateY: 0 },
        easing: 'easeInOut',
      },
    ],
  })

  push({
    id: 'sdk-scrim', type: 'image', src: gen('gen-scrim-top.png'), fit: 'cover', hasAlpha: true,
    startFrame: from, durationInFrames: dur, fadeFrames: 0,
  })

  // 代码面板（预生成的圆角玻璃底板，替代 backdrop-filter）
  const panelW = 900
  const panelH = 470
  const panelLeft = W - 118 - panelW
  const panelTop = 300
  push({
    id: 'sdk-panel', type: 'image', src: gen('gen-code-panel.png'), fit: 'contain', hasAlpha: true,
    box: rect(panelLeft, panelTop, panelW, panelH),
    startFrame: from + 54, durationInFrames: dur - 54, fadeFrames: 0,
    animate: [{
      startFrame: 0, durationInFrames: 34,
      from: { opacity: 0, scale: 0.96 }, to: { opacity: 1, scale: 1 }, easing: 'easeOut',
    }],
  })

  // 标题栏：三颗交通灯 + 文件名 + READY 徽标
  ;['#FF5F57', '#FEBC2E', '#28C840'].forEach((color, i) => {
    push({
      id: `sdk-dot-${i}`, type: 'shape', shape: 'circle', color,
      box: rect(panelLeft + 26 + i * 23, panelTop + 18, 11, 11),
      startFrame: from + 54, durationInFrames: dur - 54, fadeFrames: 0,
      animate: [{
        startFrame: 0, durationInFrames: 34,
        from: { opacity: 0 }, to: { opacity: 1 }, easing: 'easeOut',
      }],
    })
  })
  push({
    id: 'sdk-filename', type: 'textCard', variant: 'subtitle', text: 'sdk.ts',
    box: labelBox(panelLeft + 100, panelTop + 30, 'sdk.ts', 23).box,
    startFrame: from + 54, durationInFrames: dur - 54, fadeFrames: 0,
    animate: [{
      startFrame: 0, durationInFrames: 34,
      from: { opacity: 0 }, to: { opacity: 1 }, easing: 'easeOut',
    }],
  })
  push({
    id: 'sdk-ready-dot', type: 'shape', shape: 'circle', color: C.lime,
    box: rect(panelLeft + panelW - 148, panelTop + 30, 8, 8),
    startFrame: from + 136, durationInFrames: dur - 136, fadeFrames: 0,
    animate: [{
      startFrame: 0, durationInFrames: 14,
      from: { opacity: 0, scale: 0.9 }, to: { opacity: 1, scale: 1 }, easing: 'easeOut',
    }],
  })
  push({
    id: 'sdk-ready', type: 'textCard', variant: 'subtitle', text: 'READY',
    box: labelBox(panelLeft + panelW - 132, panelTop + 30, 'READY', 17).box,
    startFrame: from + 136, durationInFrames: dur - 136, fadeFrames: 0,
    animate: [{
      startFrame: 0, durationInFrames: 14,
      from: { opacity: 0 }, to: { opacity: 1 }, easing: 'easeOut',
    }],
  })

  // 代码：逐行左对齐（源工程是等宽语法高亮，我们的 DSL 只能单色）
  SDK_CODE.forEach((line, li) => {
    if (line.length === 0) return
    const w = textWidth(line, { faceKey: 'RedHatDisplay-500', size: 28 })
    push({
      id: `sdk-code-${li}`, type: 'textCard', variant: 'subtitle', text: line,
      box: textBox(panelLeft + 62, panelTop + 118 + li * 50 - 20, w, { h: 40, pad: 1.12 }),
      startFrame: from + 54, durationInFrames: dur - 54, fadeFrames: 0,
      animate: [{
        startFrame: 0, durationInFrames: 20,
        from: { opacity: 0 }, to: { opacity: 1 }, easing: 'easeOut',
      }],
    })
  })

  push({
    id: 'sdk-eyebrow', type: 'textCard', variant: 'subtitle', text: EYEBROWS.sdk.text,
    box: labelBox(120, 102, EYEBROWS.sdk.text, 19).box,
    startFrame: from + EYEBROWS.sdk.from, durationInFrames: dur - EYEBROWS.sdk.from, fadeFrames: 0,
  })
}

/* ─────────────────────────── S7 · PRISM ─────────────────────────── */

function buildPrism() {
  const from = SHOT_START.prism
  const dur = 168

  push({
    id: 'prism-dots', type: 'shape', shape: 'dotGrid', color: 'rgba(255,255,255,0.05)', dotSpacing: 30, dotRadius: 1,
    box: rect(0, 0, W, H), startFrame: from, durationInFrames: dur, fadeFrames: 0,
  })
  push({
    id: 'prism-glow', type: 'image', src: gen('gen-glow-left2.png'), fit: 'cover', hasAlpha: true,
    startFrame: from, durationInFrames: dur, fadeFrames: 0,
  })

  // 宿主 App 面板
  const hostLeft = 176
  const hostTop = 336
  push({
    id: 'prism-host', type: 'shape', shape: 'rect', color: 'rgba(17,17,41,0.92)',
    box: rect(hostLeft, hostTop, 452, 486),
    startFrame: from, durationInFrames: dur, fadeFrames: 0,
    animate: [{
      startFrame: 0, durationInFrames: 26,
      from: { opacity: 0 }, to: { opacity: 1 }, easing: 'easeOut',
    }],
  })
  push({
    id: 'prism-host-label', type: 'textCard', variant: 'subtitle', text: 'HOST APP',
    box: labelBox(hostLeft + 30, hostTop + 30, 'HOST APP', 17).box,
    startFrame: from, durationInFrames: dur, fadeFrames: 0,
    animate: [{
      startFrame: 0, durationInFrames: 20,
      from: { opacity: 0 }, to: { opacity: 1 }, easing: 'easeOut',
    }],
  })
  push({
    id: 'prism-live-dot', type: 'shape', shape: 'circle', color: C.lime,
    box: rect(hostLeft + 452 - 74, hostTop + 22, 8, 8),
    startFrame: from, durationInFrames: dur, fadeFrames: 0,
  })
  push({
    id: 'prism-live-text', type: 'textCard', variant: 'subtitle', text: 'live',
    box: labelBox(hostLeft + 452 - 58, hostTop + 30, 'live', 16).box,
    startFrame: from, durationInFrames: dur, fadeFrames: 0,
  })

  PRISM_IN_APP.forEach((name, i) => {
    const col = i % 3
    const row = Math.floor(i / 3)
    const cellLeft = hostLeft + 30 + col * (98 + 18)
    const cellTop = hostTop + 62 + row * (96 + 18)
    push({
      id: `prism-inapp-${i}`, type: 'image', src: src(`partners/${name}.png`), fit: 'contain', hasAlpha: true,
      box: rect(cellLeft, cellTop, 62, 42),
      startFrame: from + 10 + i * 2, durationInFrames: dur - 10 - i * 2, fadeFrames: 0,
      animate: [{
        startFrame: 0, durationInFrames: 18,
        from: { opacity: 0 }, to: { opacity: 1 }, easing: 'easeOut',
      }],
    })
  })
  push({
    id: 'prism-host-foot', type: 'textCard', variant: 'subtitle', text: 'one SDK · native / webview',
    box: labelBox(hostLeft + 30, hostTop + 486 - 26 - 12, 'one SDK · native / webview', 19).box,
    startFrame: from, durationInFrames: dur, fadeFrames: 0,
  })

  // PRISM 标
  const prismW = textWidth('PRISM', { size: TITLE_PX, letterSpacing: TITLE_LETTER })
  push({
    id: 'prism-title', type: 'textCard', variant: 'title', text: 'PRISM',
    box: textBox(768, 282 + 30, prismW),
    startFrame: from + 30, durationInFrames: dur - 30, fadeFrames: 0,
    animate: [{
      startFrame: 0, durationInFrames: 22,
      from: { opacity: 0 }, to: { opacity: 1 }, easing: 'easeOut',
    }],
  })
  push({
    id: 'prism-sub', type: 'textCard', variant: 'subtitle', text: 'AI MATCHING',
    box: labelBox(768 + prismW + 16, 282 + 30, 'AI MATCHING', 21).box,
    startFrame: from + 30, durationInFrames: dur - 30, fadeFrames: 0,
    animate: [{
      startFrame: 0, durationInFrames: 22,
      from: { opacity: 0 }, to: { opacity: 1 }, easing: 'easeOut',
    }],
  })

  // FEED 容器
  push({
    id: 'prism-feed', type: 'shape', shape: 'rect', color: 'rgba(11,11,26,0.66)',
    box: rect(742, 330, 744, 556),
    startFrame: from + 26, durationInFrames: dur - 26, fadeFrames: 0,
    animate: [{
      startFrame: 0, durationInFrames: 22,
      from: { opacity: 0 }, to: { opacity: 1 }, easing: 'easeOut',
    }],
  })
  push({
    id: 'prism-feed-label', type: 'textCard', variant: 'subtitle', text: 'YOUR FEED',
    box: labelBox(770, 330 + 32, 'YOUR FEED', 18).box,
    startFrame: from + 26, durationInFrames: dur - 26, fadeFrames: 0,
  })
  push({
    id: 'prism-feed-label2', type: 'textCard', variant: 'subtitle', text: '3 FORMATS',
    box: labelBox(742 + 744 - 28 - 96, 330 + 32, '3 FORMATS', 18).box,
    startFrame: from + 26, durationInFrames: dur - 26, fadeFrames: 0,
  })

  // 宿主 → feed 的连接线
  push({
    id: 'prism-link', type: 'shape', shape: 'line', color: C.peri,
    box: rect(628, 600, 114, 1),
    startFrame: from + 40, durationInFrames: dur - 40, fadeFrames: 0,
    animate: [{
      startFrame: 0, durationInFrames: 24,
      from: { opacity: 0 }, to: { opacity: 1 }, easing: 'easeOut',
    }],
  })

  // 内容卡汇聚：每张卡 = group（负责位移）+ image（带 box 的卡片）+ 圆角描边
  const cardSize = 214
  PRISM_CARDS.forEach((card, i) => {
    const start = 18 + i * 5
    const toCx = card.to.x + cardSize / 2
    const toCy = card.to.y + cardSize / 2
    const fromCx = card.from.x + cardSize / 2
    const fromCy = card.from.y + cardSize / 2
    const dx = ((fromCx - toCx) / W) * 100
    const dy = ((fromCy - toCy) / H) * 100
    push({
      id: `prism-card-${i}`, type: 'group',
      children: [{
        id: `prism-card-img-${i}`, type: 'image', src: src(card.src), fit: 'cover',
        box: rect(card.to.x, card.to.y, cardSize, cardSize),
        startFrame: 0, durationInFrames: dur, fadeFrames: 0,
        animate: [{
          startFrame: start, durationInFrames: 52,
          from: { rotation: card.rot, opacity: 0 },
          to: { rotation: 0, opacity: 1 },
          easing: 'easeOut',
        }],
      }],
      startFrame: from, durationInFrames: dur, fadeFrames: 0,
      animate: [{
        startFrame: start, durationInFrames: 52,
        from: { x: 50 + dx, y: 50 + dy },
        to: { x: 50, y: 50 },
        easing: 'easeOut',
      }],
    })
    push({
      id: `prism-card-frame-${i}`, type: 'image', src: gen('gen-card-frame.png'), fit: 'contain', hasAlpha: true,
      box: rect(card.to.x, card.to.y, cardSize, cardSize),
      startFrame: from + start, durationInFrames: dur - start, fadeFrames: 0,
      animate: [{
        startFrame: 0, durationInFrames: 52,
        from: { rotation: card.rot, opacity: 0 },
        to: { rotation: 0, opacity: 1 },
        easing: 'easeOut',
      }],
    })
  })

  // 命中环 + MATCHED 徽标
  const hit = PRISM_CARDS[0]
  push({
    id: 'prism-hit-ring', type: 'image', src: gen('gen-hit-ring.png'), fit: 'contain', hasAlpha: true,
    box: rect(hit.to.x - 12, hit.to.y - 12, 238, 238),
    startFrame: from + 118, durationInFrames: dur - 118, fadeFrames: 0,
    animate: [{
      startFrame: 0, durationInFrames: 20,
      from: { opacity: 0, scale: 0.92 }, to: { opacity: 1, scale: 1 }, easing: 'easeOut',
    }],
  })
  push({
    id: 'prism-matched-dot', type: 'shape', shape: 'circle', color: C.peri,
    box: rect(1156, 286 + 22, 8, 8),
    startFrame: from + 118, durationInFrames: dur - 118, fadeFrames: 0,
    animate: [{
      startFrame: 0, durationInFrames: 20,
      from: { opacity: 0 }, to: { opacity: 1 }, easing: 'easeOut',
    }],
  })
  push({
    id: 'prism-matched', type: 'textCard', variant: 'subtitle', text: 'MATCHED',
    box: labelBox(1174, 286 + 22, 'MATCHED', 21).box,
    startFrame: from + 118, durationInFrames: dur - 118, fadeFrames: 0,
    animate: [{
      startFrame: 0, durationInFrames: 20,
      from: { opacity: 0 }, to: { opacity: 1 }, easing: 'easeOut',
    }],
  })
}

/* ─────────────────────────── S8 · Compute ─────────────────────────── */

function buildCompute() {
  const from = SHOT_START.compute
  const dur = 168

  // 地球：group 承担推镜与横移（带 box 的轨不能声明 x/y）
  push({
    id: 'compute-globe-group', type: 'group',
    children: [{
      id: 'compute-globe', type: 'image', src: src('textures/live/hi-globe.png'), fit: 'cover',
      box: rect(0, (H - 939) / 2, W, 939),
      startFrame: 0, durationInFrames: dur, fadeFrames: 0,
    }],
    startFrame: from, durationInFrames: dur, fadeFrames: 0,
    animate: [{
      startFrame: 0, durationInFrames: dur,
      from: { scale: 1, x: 50 },
      to: { scale: 1.07, x: 50 - (18 / W) * 100 },
      easing: 'easeInOut',
    }],
  })

  push({
    id: 'compute-scrim', type: 'image', src: gen('gen-scrim-top-bottom.png'), fit: 'cover', hasAlpha: true,
    startFrame: from, durationInFrames: dur, fadeFrames: 0,
  })

  COMPUTE_NODES.forEach((node, i) => {
    push({
      id: `compute-node-${i}`, type: 'shape', shape: 'circle', color: C.lime,
      box: rect(node.x - 4.5, node.y - 4.5, 9, 9),
      startFrame: from + i * 10, durationInFrames: dur - i * 10, fadeFrames: 0,
      animate: [{
        startFrame: 0, durationInFrames: 22,
        from: { opacity: 0 }, to: { opacity: 1 }, easing: 'easeOut',
      }],
    })
    // 脉冲环：长大的柔光点（源工程是扩散的描边圆，DSL 无描边圆原语 ⇒ 近似）
    push({
      id: `compute-pulse-${i}`, type: 'shape', shape: 'circle', color: 'rgba(182,255,60,0.9)',
      box: rect(node.x - 6, node.y - 6, 12, 12),
      startFrame: from + i * 10, durationInFrames: dur - i * 10, fadeFrames: 0,
      fx: 'blur',
      animate: [{
        startFrame: 0, durationInFrames: 60,
        from: { opacity: 0.6, scale: 1 },
        to: { opacity: 0, scale: 4 },
        easing: 'linear',
      }],
    })
  })

  push({
    id: 'compute-eyebrow', type: 'textCard', variant: 'subtitle', text: EYEBROWS.compute.text,
    box: labelBox(120, 102, EYEBROWS.compute.text, 19).box,
    startFrame: from + EYEBROWS.compute.from, durationInFrames: dur - EYEBROWS.compute.from, fadeFrames: 0,
  })
}

/* ─────────────────────────── S9 · Catalogue ─────────────────────────── */

function buildCatalogue() {
  const from = SHOT_START.catalogue
  const dur = 168

  push({
    id: 'catalogue-glow', type: 'image', src: gen('gen-glow-mid.png'), fit: 'cover', hasAlpha: true,
    startFrame: from, durationInFrames: dur, fadeFrames: 0,
  })
  push({
    id: 'catalogue-img', type: 'image', src: src('textures/live/hi-catalogue.png'), fit: 'cover',
    transform: { perspective: 1900 },
    box: rect((W - 1660) / 2, (H - 782) / 2, 1660, 782),
    startFrame: from, durationInFrames: dur, fadeFrames: 0,
    animate: [
      {
        startFrame: 0, durationInFrames: 36,
        from: { opacity: 0, scale: 0.9, rotateY: -15, rotateX: 7 },
        to: { opacity: 1, scale: 1, rotateY: 0, rotateX: 0 },
        easing: 'easeOut',
      },
      {
        // 保持段：与入场段首尾相接（见 open-wall 的注释：空档会让渲染器取末段终点）
        startFrame: 36, durationInFrames: 50,
        from: { opacity: 1, scale: 1, rotateY: 0, rotateX: 0 },
        to: { opacity: 1, scale: 1, rotateY: 0, rotateX: 0 },
        easing: 'linear',
      },
      {
        startFrame: 86, durationInFrames: 82,
        from: { opacity: 1, scale: 1, rotateY: 0, rotateX: 0 },
        to: { opacity: 1, scale: 1.06, rotateY: 0, rotateX: 0 },
        easing: 'easeInOut',
      },
    ],
  })
  push({
    id: 'catalogue-eyebrow', type: 'textCard', variant: 'subtitle', text: EYEBROWS.catalogue.text,
    box: labelBox(120, 102, EYEBROWS.catalogue.text, 19).box,
    startFrame: from + EYEBROWS.catalogue.from, durationInFrames: dur - EYEBROWS.catalogue.from, fadeFrames: 0,
  })
}

/* ─────────────────────────── S10 · Audience ─────────────────────────── */

function buildAudience() {
  const from = SHOT_START.audience
  const dur = 168

  push({
    id: 'audience-img', type: 'image', src: src('textures/live/hi-aud.png'), fit: 'cover',
    box: rect((W - 1840) / 2, (H - 745) / 2, 1840, 745),
    startFrame: from, durationInFrames: dur, fadeFrames: 0,
    animate: [{
      startFrame: 0, durationInFrames: dur,
      from: { opacity: 0, scale: 0.97 },
      to: { opacity: 1, scale: 1.03 },
      easing: 'easeInOut',
    }],
  })
  push({
    id: 'audience-scrim', type: 'image', src: gen('gen-scrim-top-bottom.png'), fit: 'cover', hasAlpha: true,
    startFrame: from, durationInFrames: dur, fadeFrames: 0,
  })

  AUDIENCE_TICKS.forEach((tick, i) => {
    push({
      id: `audience-tick-${i}`, type: 'shape', shape: 'line', color: tick.color,
      box: rect(tick.x, 872 + 15, 1, 30),
      startFrame: from + tick.at, durationInFrames: dur - tick.at, fadeFrames: 0,
      animate: [{
        startFrame: 0, durationInFrames: 22,
        from: { opacity: 0, scale: 0.2 }, to: { opacity: 1, scale: 1 }, easing: 'easeOut',
      }],
    })
    push({
      id: `audience-label-${i}`, type: 'textCard', variant: 'subtitle', text: tick.label,
      box: labelBox(tick.x - 110, 872 + 30 + 22, tick.label, 19).box,
      startFrame: from + tick.at, durationInFrames: dur - tick.at, fadeFrames: 0,
      animate: [{
        startFrame: 0, durationInFrames: 22,
        from: { opacity: 0 }, to: { opacity: 1 }, easing: 'easeOut',
      }],
    })
  })

  push({
    id: 'audience-eyebrow', type: 'textCard', variant: 'subtitle', text: EYEBROWS.audience.text,
    box: labelBox(120, 102, EYEBROWS.audience.text, 19).box,
    startFrame: from + EYEBROWS.audience.from, durationInFrames: dur - EYEBROWS.audience.from, fadeFrames: 0,
  })
}

/* ─────────────────────────── S12 · Outro ─────────────────────────── */

function buildOutro() {
  const from = SHOT_START.outro
  const dur = 240

  push({
    id: 'outro-dots', type: 'shape', shape: 'dotGrid', color: 'rgba(255,255,255,0.05)', dotSpacing: 30, dotRadius: 1,
    box: rect(0, 0, W, H), startFrame: from, durationInFrames: dur, fadeFrames: 0,
  })
  push({
    id: 'outro-stage', type: 'image', src: gen('gen-stage-light.png'), fit: 'cover', hasAlpha: true,
    startFrame: from, durationInFrames: dur, fadeFrames: 0,
    animate: [{
      startFrame: 126, durationInFrames: 46,
      from: { opacity: 0 }, to: { opacity: 1 }, easing: 'easeOut',
    }],
  })
  push({
    id: 'outro-scrim', type: 'image', src: gen('gen-outro-scrim.png'), fit: 'cover', hasAlpha: true,
    startFrame: from, durationInFrames: dur, fadeFrames: 0,
    animate: [{
      startFrame: 126, durationInFrames: 46,
      from: { opacity: 0 }, to: { opacity: 1 }, easing: 'easeOut',
    }],
  })

  // 合影：椭圆环排布，从画外飞入定格
  const RX = 620
  const RY = 372
  OUTRO_TILES.forEach((tile, i) => {
    const ang = (i / OUTRO_TILES.length) * Math.PI * 2 - Math.PI / 2
    const fromX = 960 + Math.cos(ang) * (RX + 760)
    const fromY = 540 + Math.sin(ang) * (RY + 760)
    const toX = 960 + Math.cos(ang) * RX
    const toY = 540 + Math.sin(ang) * RY
    const size = tile.kind === 'logo' ? 108 : 132
    const dx = ((fromX - toX) / W) * 100
    const dy = ((fromY - toY) / H) * 100
    push({
      id: `outro-tile-${i}`, type: 'group',
      children: [{
        id: `outro-tile-img-${i}`, type: 'image', src: src(tile.src), fit: 'cover',
        box: rect(toX - size / 2, toY - size / 2, size, size),
        startFrame: 0, durationInFrames: dur, fadeFrames: 0,
        animate: [{
          startFrame: Math.max(0, i * 3 - 12), durationInFrames: 46,
          from: { opacity: 0, scale: 1 },
          to: { opacity: 1, scale: 0.92 },
          easing: 'easeOut',
        }],
      }],
      startFrame: from, durationInFrames: dur, fadeFrames: 0,
      animate: [{
        startFrame: Math.max(0, i * 3 - 12), durationInFrames: 46,
        from: { x: 50 + dx, y: 50 + dy },
        to: { x: 50, y: 50 },
        easing: 'easeOut',
      }],
    })
    push({
      id: `outro-tile-frame-${i}`, type: 'image', src: gen('gen-tile-frame.png'), fit: 'contain', hasAlpha: true,
      box: rect(toX - size / 2, toY - size / 2, size, size),
      startFrame: from + Math.max(0, i * 3 - 12), durationInFrames: dur - Math.max(0, i * 3 - 12), fadeFrames: 0,
      animate: [{
        startFrame: 0, durationInFrames: 46,
        from: { opacity: 0, scale: 1 },
        to: { opacity: 0.62, scale: 0.92 },
        easing: 'easeOut',
      }],
    })
  })

  // 白闪
  push({
    id: 'outro-flash', type: 'shape', shape: 'rect', color: '#DCE0FF',
    box: rect(0, 0, W, H),
    startFrame: from + 116, durationInFrames: 9, fadeFrames: 0,
    animate: [{
      startFrame: 0, durationInFrames: 9,
      from: { opacity: 0.5 }, to: { opacity: 0 }, easing: 'easeOut',
    }],
  })

  // 字标
  const wordW = textWidth('PlaysOut', { size: TITLE_PX, letterSpacing: TITLE_LETTER })
  const iconSize = 124
  const gap = 30
  const total = iconSize + gap + wordW
  const left = (W - total) / 2
  push({
    id: 'outro-icon', type: 'image', src: src('brand/playsout-icon.png'), fit: 'contain', hasAlpha: true,
    box: rect(left, 540 - 26 - iconSize / 2, iconSize, iconSize),
    startFrame: from + 118, durationInFrames: dur - 118, fadeFrames: 0,
    animate: [{
      startFrame: 0, durationInFrames: 22,
      from: { opacity: 0, scale: 0.55 }, to: { opacity: 1, scale: 1 }, easing: 'easeOut',
    }],
  })
  push({
    id: 'outro-word', type: 'textCard', variant: 'title', text: 'PlaysOut', fx: 'glow',
    box: textBox(left + iconSize + gap, 540 - 26, wordW),
    startFrame: from + 118, durationInFrames: dur - 118, fadeFrames: 0,
    anim: 'fadeUp', animOptions: { wordDelayFrames: 2, offsetY: 8, blur: 6 },
  })
  push({
    id: 'outro-tag', type: 'textCard', variant: 'subtitle', text: 'The entertainment layer for every super-app.',
    box: labelBox(W / 2 - 260, 540 + 60, 'The entertainment layer for every super-app.', 32).box,
    startFrame: from + 152, durationInFrames: dur - 152, fadeFrames: 0,
    animate: [{
      startFrame: 0, durationInFrames: 24,
      from: { opacity: 0 }, to: { opacity: 1 }, easing: 'easeOut',
    }],
  })

  // 斜向扫光
  push({
    id: 'outro-sweep', type: 'image', src: gen('gen-sweep.png'), fit: 'cover', hasAlpha: true,
    startFrame: from + 182, durationInFrames: 34, fadeFrames: 0,
    animate: [{
      startFrame: 0, durationInFrames: 34,
      from: { x: -27 }, to: { x: 103 }, easing: 'easeInOut',
    }],
  })
}

/* ─────────────────────────── 字幕（放在最后 ⇒ 最上层） ─────────────────────────── */

function buildCaptions() {
  CAPTIONS.forEach((line, i) => {
    const vo = VO[i]
    // 字幕底部的渐变压暗（源工程 `Captions.tsx` 的 260px 渐变条）—— DSL 无径向/定向渐变 ⇒ 预生成 PNG
    push({
      id: `caption-scrim-${i}`, type: 'image', src: gen('gen-scrim-caption.png'), fit: 'cover', hasAlpha: true,
      startFrame: line.from - 4,
      // 末句的 scrim 会超出总时长（1702+100=1802 > 1800）⇒ 校验器报「超出总时长」，
      // 渲染器会裁切，但为了让「校验零错零越界」成立，这里按总时长收口。
      durationInFrames: Math.min(line.to - line.from + 8, CANVAS.total - (line.from - 4)),
      fadeFrames: 0,
    })
    push({
      id: `caption-${i}`, type: 'caption', src: src(vo.src), text: line.text,
      fontSize: 35, widthPercent: 78,
      audioFrames: Math.round(vo.seconds * CANVAS.fps),
      startFrame: line.from, durationInFrames: line.to - line.from, fadeFrames: 0,
    })
  })
}

/* ─────────────────────────── 组装 ─────────────────────────── */

async function main() {
  await initMetrics(STAGE)

  buildOpen()
  for (const card of TITLE_CARDS) buildTitleCard(card)
  buildHero()
  buildMetrics()
  buildSdk()
  buildPrism()
  buildCompute()
  buildCatalogue()
  buildAudience()
  buildOutro()
  buildCaptions()

  const manifest = {
    id: 'playsout-promo-replica',
    meta: {
      title: 'PlaysOut · 60s 产品宣传片（manifest 复刻版）',
      width: CANVAS.width,
      height: CANVAS.height,
      fps: CANVAS.fps,
      durationInFrames: CANVAS.total,
      backgroundColor: C.bg,
    },
    tracks,
    audio: {
      sfx: SFX.map((s) => ({
        src: src(s.src),
        startFrame: s.from,
        gain: s.gain,
      })),
    },
    global: {
      fontFamily: 'NBDisplay',
      fonts: [{ family: 'NBDisplay', weight: 800, src: src('fonts/NewBlackTypeface-ExtraBold.woff2') }],
      theme: 'dark',
    },
  }

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  const childCount = tracks.reduce((n, t) => n + (t.type === 'group' ? t.children.length : 0), 0)
  console.log(`[build] ${tracks.length} 条顶层轨（+${childCount} 条 group 子轨）→ ${OUT}`)
}

main().catch((error) => {
  console.error('[build] 失败：', error)
  process.exitCode = 1
})
