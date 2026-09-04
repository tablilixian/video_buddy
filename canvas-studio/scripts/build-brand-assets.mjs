#!/usr/bin/env node
/**
 * 生成 Canvas Studio 品牌图标资产（CV-096）。
 *
 * 构成 = 「连体框 · Aperture Squircle」（brand-identity-proposal.md §5 场记板隐喻
 * 的定稿方向）：一整块 squircle 实心形，用负空间切出铰链条缝与画布窗，画布窗内
 * 3×2 点阵；顶区两道 45° 斜条纹是场记板的识别锚点。
 *
 * 单一事实来源：
 * - 几何 —— 本文件（64 网格，与 1024 呈 16 倍关系；SVG 矢量无损缩放，不重复画一套）；
 * - 配色 —— `src/brand.ts` 的 `BRAND_PRESETS`（本文件解析，不复制色值，避免漂移）。
 *
 * 用法：
 *   node scripts/build-brand-assets.mjs
 * PNG 需要可选依赖 `@resvg/resvg-js`；未装时只产出 SVG 并提示如何补装：
 *   NODE_PATH=<含 resvg 的 node_modules> node scripts/build-brand-assets.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'assets', 'brand')
const pngDir = join(outDir, 'png')

// ---------- 几何（64 网格，4px 基准） ----------

/** 外轮廓：完整 squircle（x/y 4..60，rx 16）—— 方形外框对图标遮罩最友好。 */
const SQUIRCLE =
  'M20 4 H44 A16 16 0 0 1 60 20 V44 A16 16 0 0 1 44 60 H20 A16 16 0 0 1 4 44 V20 A16 16 0 0 1 20 4 Z'
/**
 * 铰链条缝（负空间）：**左侧留 8 单位铰链，右侧开口到边** —— 缝若贯穿整宽会把
 * mark 切成上下两块（16px 时变成两根悬浮条，反而最不稳）；留铰链才是真「连体」，
 * 且右侧开口顺带给了「板将合未合」的动势。
 */
const SLIT = 'M12 26 H60 V31 H12 Z'
/** 画布窗（负空间，32×16）。 */
const WINDOW = 'M22 38 H42 A6 6 0 0 1 48 44 V48 A6 6 0 0 1 42 54 H22 A6 6 0 0 1 16 48 V44 A6 6 0 0 1 22 38 Z'
/**
 * 顶区两道斜条纹（场记板识别锚点，37° 而非 45°）。
 *
 * 不用 45° 是几何所迫：rx=16 的 squircle 在 y=8 处只有 39.5 单位宽、y=24 处有 56
 * 单位宽，45° 条纹的右上端必然捅出轮廓（而 Ardot / SVG 节点不支持 clipPath 兜底）。
 * 现参数两条纹均完整落在直线段内，上下留白大致均衡。
 */
const STRIPES = ['M10 24 L20 24 L30 8 L20 8 Z', 'M26 24 L36 24 L46 8 L36 8 Z']
/** 画布点阵（3 列 × 2 行）。 */
const DOTS = [
  [23, 43], [32, 43], [41, 43],
  [23, 49], [32, 49], [41, 49],
]

// 32 网格简化形（favicon / 单色版）：丢掉画布窗与点阵——32px 下点阵 r≈1.3px 只会糊成噪点。
const FAV_SQUIRCLE =
  'M10 2 H22 A8 8 0 0 1 30 10 V22 A8 8 0 0 1 22 30 H10 A8 8 0 0 1 2 22 V10 A8 8 0 0 1 10 2 Z'
// 缝同样留左侧铰链（4 单位）—— 16px 下若贯穿，上半块会变成孤立浮条。
const FAV_SLIT = 'M8 13 H30 V17 H8 Z'
// 条纹收窄到 4 单位、间距 5：原 6 单位宽条纹在 32px 下几乎吃空整条板。
const FAV_STRIPES = ['M9 11 L13 11 L16 4 L12 4 Z', 'M18 11 L22 11 L25 4 L21 4 Z']

// ---------- SVG 构造 ----------

const svgDoc = (viewBox, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="none">\n  ${body}\n</svg>\n`

/** 主 mark（品牌色；点阵按 showDots 开关，供小尺寸降级）。 */
function markBody(accent, deep, { window: withWindow = true, dots = true } = {}) {
  const holes = [SLIT, ...(withWindow ? [WINDOW] : [])].join(' ')
  const dotGroup = dots && withWindow
    ? `\n  <g fill="${accent}">${DOTS.map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="2.6"/>`).join('')}</g>`
    : ''
  return `<path fill-rule="evenodd" d="${SQUIRCLE} ${holes}" fill="${accent}"/>`
    + `\n  <g fill="${deep}">${STRIPES.map((d) => `<path d="${d}"/>`).join('')}</g>`
    + dotGroup
}

/** 单色版：条纹改负空间挖空（不叠第二色），可在任意底色上用。 */
const monoBody = (fill) =>
  `<path fill-rule="evenodd" d="${SQUIRCLE} ${SLIT} ${STRIPES.join(' ')}" fill="${fill}"/>`

/** 简化形（favicon 源，32 网格）：方形 squircle + 铰链缝（负空间）+ 两道正片 deep 条纹。 */
const faviconBody = (accent, deep) =>
  `<path fill-rule="evenodd" d="${FAV_SQUIRCLE} ${FAV_SLIT}" fill="${accent}"/>`
  + `\n  <g fill="${deep}">${FAV_STRIPES.map((d) => `<path d="${d}"/>`).join('')}</g>`

/** 应用图标（1024 全出血深底 + mark 居中占 78%）。macOS/iOS 由系统遮罩裁圆角。 */
function appIconDoc(accent, deep) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" fill="none">\n`
    + `  <defs><linearGradient id="csIconBg" x1="0" y1="0" x2="1" y2="1">`
    + `<stop offset="0" stop-color="#1A1D29"/><stop offset="1" stop-color="#0F1117"/></linearGradient></defs>\n`
    + `  <rect width="1024" height="1024" fill="url(#csIconBg)"/>\n`
    + `  <g transform="translate(112 112) scale(12.5)">${markBody(accent, deep)}</g>\n`
    + `</svg>\n`
}

/** 横版 lockup（mark + Canvas Studio 字标 + 创意工厂）。 */
function lockupDoc(accent, deep, color, subColor) {
  return svgDoc(
    '0 0 260 64',
    `<g transform="translate(0 4) scale(0.875)">${markBody(accent, deep)}</g>\n  `
      + `<text x="72" y="33" font-family="Inter, 'Helvetica Neue', Arial, system-ui, sans-serif" font-size="24" font-weight="600" letter-spacing="-0.4" fill="${color}">Canvas Studio</text>\n  `
      + `<text x="73" y="52" font-family="'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', system-ui, sans-serif" font-size="13" font-weight="400" letter-spacing="1.4" fill="${subColor}">创意工厂</text>`,
  )
}

// ---------- 配色（解析 src/brand.ts，不复制） ----------

const PRESET_IDS = ['cinema-violet', 'ocean-blue', 'ember-violet', 'amber-creative']

function readPresets() {
  const source = readFileSync(join(root, 'src', 'brand.ts'), 'utf8')
  const presets = {}
  for (const id of PRESET_IDS) {
    const matched = new RegExp(
      `'${id}':\\s*\\{[\\s\\S]*?accent:\\s*'(#[0-9A-Fa-f]{6})'[\\s\\S]*?accentDeep:\\s*'(#[0-9A-Fa-f]{6})'`,
    ).exec(source)
    if (matched === null) throw new Error(`src/brand.ts 里解析不到预设 ${id} 的 accent / accentDeep`)
    presets[id] = { accent: matched[1], deep: matched[2] }
  }
  return presets
}

// ---------- 产出 ----------

const presets = readPresets()
const main = presets['cinema-violet']

mkdirSync(pngDir, { recursive: true })

const files = {
  // 主 mark：透明底，暗底通用（accent 主色）
  'logo.svg': svgDoc('0 0 64 64', markBody(main.accent, main.deep)),
  // 浅底专用：accent 换 deep，浅色背景上不会发飘
  'logo-on-light.svg': svgDoc('0 0 64 64', markBody(main.deep, main.deep)),
  // 单色版：currentColor，供内联 DOM 使用（侧边栏 / 模板位）
  'logo-mono.svg': svgDoc('0 0 64 64', monoBody('currentColor')),
  // 四套 preset 变色版：切换配色时直接替换 logo.svg
  'logo-ocean-blue.svg': svgDoc('0 0 64 64', markBody(presets['ocean-blue'].accent, presets['ocean-blue'].deep)),
  'logo-ember-violet.svg': svgDoc('0 0 64 64', markBody(presets['ember-violet'].accent, presets['ember-violet'].deep)),
  'logo-amber-creative.svg': svgDoc('0 0 64 64', markBody(presets['amber-creative'].accent, presets['amber-creative'].deep)),
  // 应用图标（透明底单色，macOS 模板 / 托盘位）
  'icon-mono.svg': svgDoc('0 0 64 64', monoBody('#FFFFFF')),
  // 应用图标（1024 全出血）
  'icon.svg': appIconDoc(main.accent, main.deep),
  // favicon（32 网格简化形，正片条纹）
  'favicon.svg': svgDoc('0 0 32 32', faviconBody(main.accent, main.deep)),
  // 横版 lockup
  'lockup.svg': lockupDoc(main.accent, main.deep, '#F5F6FA', 'rgba(245, 246, 250, 0.55)'),
  'lockup-mono.svg': lockupDoc(main.accent, main.deep, '#F5F6FA', 'rgba(245, 246, 250, 0.55)'),
  'lockup-on-light.svg': lockupDoc(main.deep, main.deep, '#181A20', 'rgba(24, 26, 32, 0.6)'),
}

for (const [name, content] of Object.entries(files)) {
  writeFileSync(join(outDir, name), content, 'utf8')
}

const svgCount = Object.keys(files).length

// ---------- PNG（可选依赖 @resvg/resvg-js） ----------

// 先按 ESM 解析（包装进项目依赖时走这条）；再退回 createRequire —— 后者遵守
// NODE_PATH，允许不装进本项目、从外部 node_modules 借用（避免动 yarn.lock）。
const resvgModule = await import('@resvg/resvg-js').catch(async () => {
  try {
    return createRequire(import.meta.url)('@resvg/resvg-js')
  } catch {
    return null
  }
})

function render(svgText, size) {
  const renderer = new resvgModule.Resvg(svgText, {
    fitTo: { mode: 'width', value: size },
    // 1024 以下用 2x 超采样再降采样，斜条纹与小圆点边缘不糊
    background: undefined,
  })
  return renderer.render().asPng()
}

const PNG_SIZES = [16, 32, 64, 128, 256, 512, 1024]
let pngCount = 0

if (resvgModule === null) {
  console.warn('[brand] 未找到 @resvg/resvg-js —— 只产出 SVG，跳过 PNG。')
  console.warn('[brand] 补装后重跑：NODE_PATH=<含 resvg 的 node_modules> node scripts/build-brand-assets.mjs')
} else {
  for (const size of PNG_SIZES) {
    writeFileSync(join(pngDir, `logo-${size}.png`), render(files['logo.svg'], size))
    writeFileSync(join(pngDir, `icon-${size}.png`), render(files['icon.svg'], size))
    pngCount += 2
  }
  for (const size of [16, 32]) {
    writeFileSync(join(pngDir, `favicon-${size}.png`), render(files['favicon.svg'], size))
    pngCount += 1
  }
  for (const id of PRESET_IDS) {
    writeFileSync(join(pngDir, `preset-${id}.png`), render(files[`logo-${id}.svg`] ?? files['logo.svg'], 256))
    pngCount += 1
  }
  // favicon.ico：16/32/48 三档 PNG 直接塞进 ICO 容器（PNG 型 ICO，IE9+ 全支持）
  const entries = [16, 32, 48].map((size) => ({
    size,
    png: render(files['favicon.svg'], size),
  }))
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)
  const directory = Buffer.alloc(16 * entries.length)
  let offset = 6 + directory.length
  entries.forEach((entry, index) => {
    const at = index * 16
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at)
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 1)
    directory.writeUInt16LE(1, at + 4) // 颜色数（PNG 型填 1）
    directory.writeUInt16LE(32, at + 6) // 位深
    directory.writeUInt32LE(entry.png.length, at + 8)
    directory.writeUInt32LE(offset, at + 12)
    offset += entry.png.length
  })
  writeFileSync(join(outDir, 'favicon.ico'), Buffer.concat([header, directory, ...entries.map((e) => e.png)]))
  pngCount += 1
}

console.log(`[brand] 已写入 ${svgCount} 个 SVG + ${pngCount} 个 PNG/ICO → assets/brand/`)
