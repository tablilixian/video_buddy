/**
 * 预览脚本共享助手 —— 把「真实令牌」喂给 `preview-*.mjs`。
 *
 * ## 为什么需要它
 *
 * `preview-*` 的定位是「不开桌面就能肉眼验收」（自 CV-064 起）：
 * 从 `src/client/styles.ts` 抽出 `STUDIO_STYLES`，配一份最小令牌表和骨架 DOM，
 * 输出单文件 HTML。问题出在**令牌表是手抄的**：
 *
 * - `brand.ts` 每加一批令牌，手抄表就落后一批。2026-09-12（DD-01~DD-06 落地后）
 *   实测三个脚本**各自都缺 16 个关键令牌** —— `--cs-shell` / `--cs-node(-hi)` /
 *   `--cs-float` / `--cs-line(-hi)` / `--cs-fs-*` / `--cs-dim` / `--cs-gate` /
 *   `--cs-scrim` / `--cs-glow-accent` / `--cs-gold` / `--cs-teal` /
 *   `--cs-canvas-grid(-major)` / `--cs-space-*`（`--cs-gold`/`--cs-teal`/网格
 *   其实早就缺了，不是那一批才坏的）。
 * - 于是预览会**安静地显示残缺效果**：四层同色、无片门、无字阶、无金青、无点阵
 *   —— 最坏的结果是有人据此**误判成「批次没生效」并报假 bug**。
 *
 * 所以本文件把令牌改成**派生**：色值一律来自 `lib/brand.js` 的 `brandCssText()`
 * （产品里注入的就是它，同一份产出），手抄表不再存在，漂移无从发生。
 * 宿主（`--dsw-*`）令牌是宿主契约、插件无权重写，仍由各脚本自己提供，
 * 但本文件提供 `missingHostTokens()` 让「漏了哪些」变成**吵闹的告警**而不是静默的残缺。
 *
 * ## 两个约定
 *
 * 1. **`lib/` 必须已构建**。`brandCssText()` 只在构建产物里。拿不到就**硬失败**
 *    （宁可报错，也不产出一份看起来正常、实际没令牌的预览）。
 * 2. **主题开关的锚点由调用方给**。产品的真实锚点是 `body[data-cs-brand]` +
 *    `body[data-ds-dark-theme]`；既有预览用的是 `:root` + `html[data-light]`。
 *    为了不动既有脚本的主题开关，`brandTokensCss()` 支持把两块的选择器重写掉。
 */

import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/** 宿主令牌的语义名（与 `dsh` 主题契约同名，插件只读不改）。 */
export const HOST_TOKEN_NAMES = [
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-hover',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-layer-3',
  '--dsw-alias-bg-mask-1',
  '--dsw-alias-border-l2',
  '--dsw-alias-border-l3',
  '--dsw-alias-brand',
  '--dsw-alias-interactive-bg-active',
  '--dsw-alias-interactive-bg-hover',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-scrollbar-bg-l2',
  '--dsw-alias-scrollbar-hover-l2',
  '--dsw-alias-state-error-border',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-success-bg',
  '--dsw-alias-state-success-primary',
  '--dsw-mask-blur',
  '--dsw-shadow-lv3',
  '--dsw-status-warning-fg',
]

/** 暗色宿主表（预览默认态；与既有 preview-lobby 的取值对齐，便于对照）。 */
export const HOST_TOKENS_DARK = {
  '--dsw-alias-bg-base': '#14151a',
  '--dsw-alias-bg-hover': '#1d1f26',
  '--dsw-alias-bg-layer-1': '#1b1d24',
  '--dsw-alias-bg-layer-2': '#23252e',
  '--dsw-alias-bg-layer-3': '#2c2f3a',
  '--dsw-alias-bg-mask-1': 'rgba(0, 0, 0, 0.55)',
  '--dsw-alias-border-l2': '#34363f',
  '--dsw-alias-border-l3': '#454855',
  '--dsw-alias-brand': '#7C6CFF',
  '--dsw-alias-interactive-bg-active': '#30333f',
  '--dsw-alias-interactive-bg-hover': '#262933',
  '--dsw-alias-label-primary': '#e8e9ee',
  '--dsw-alias-label-secondary': '#a2a5b4',
  '--dsw-alias-label-tertiary': '#777b8c',
  '--dsw-alias-scrollbar-bg-l2': '#2a2c34',
  '--dsw-alias-scrollbar-hover-l2': '#3a3d48',
  '--dsw-alias-state-error-border': '#7f2f33',
  '--dsw-alias-state-error-primary': '#e5484d',
  '--dsw-alias-state-success-bg': 'rgba(53, 194, 166, 0.14)',
  '--dsw-alias-state-success-primary': '#35C2A6',
  '--dsw-mask-blur': 'blur(12px)',
  '--dsw-shadow-lv3': '0 12px 32px rgba(0, 0, 0, 0.5)',
  '--dsw-status-warning-fg': '#E8B45A',
}

/** 浅色宿主表。 */
export const HOST_TOKENS_LIGHT = {
  '--dsw-alias-bg-base': '#ffffff',
  '--dsw-alias-bg-hover': '#f2f3f7',
  '--dsw-alias-bg-layer-1': '#ffffff',
  '--dsw-alias-bg-layer-2': '#fafafc',
  '--dsw-alias-bg-layer-3': '#f2f3f7',
  '--dsw-alias-bg-mask-1': 'rgba(15, 17, 23, 0.35)',
  '--dsw-alias-border-l2': '#e4e5ec',
  '--dsw-alias-border-l3': '#d3d5e0',
  '--dsw-alias-brand': '#5B4BD6',
  '--dsw-alias-interactive-bg-active': '#e8e9f2',
  '--dsw-alias-interactive-bg-hover': '#f2f3f7',
  '--dsw-alias-label-primary': '#1a1c24',
  '--dsw-alias-label-secondary': '#5a5f70',
  '--dsw-alias-label-tertiary': '#8b90a1',
  '--dsw-alias-scrollbar-bg-l2': '#e8e9ee',
  '--dsw-alias-scrollbar-hover-l2': '#d3d5e0',
  '--dsw-alias-state-error-border': '#f0b4b6',
  '--dsw-alias-state-error-primary': '#c62a2f',
  '--dsw-alias-state-success-bg': 'rgba(15, 110, 86, 0.10)',
  '--dsw-alias-state-success-primary': '#0f6e56',
  '--dsw-mask-blur': 'blur(12px)',
  '--dsw-shadow-lv3': '0 12px 32px rgba(15, 17, 23, 0.14)',
  '--dsw-status-warning-fg': '#854F0B',
}

/** 把令牌对象渲染成 CSS 声明文本（每行缩进两格，便于嵌进模板字面量）。 */
export function renderTokenBlock(tokens) {
  return Object.entries(tokens).map(([name, value]) => `  ${name}: ${value};`).join('\n')
}

/**
 * 加载 `lib/canvas-aspect.js`，把里面的**数值常量**取出来。
 *
 * 只给 `readStudioStyles()` 解析样式里的 `${…}` 插值用（见下）。拿不到就硬失败，
 * 理由与 `loadBrandModule()` 同理：宁可脚本报错，也不要产出一份「样式少了几条声明、
 * 但看起来正常」的预览。
 */
export async function loadAspectConstants() {
  const url = pathToFileURL(join(root, 'lib', 'canvas-aspect.js')).href
  let mod
  try {
    mod = await import(url)
  } catch {
    throw new Error(
      'lib/canvas-aspect.js 不存在或不可加载 —— 预览脚本要用它解析样式里的常量插值。\n'
      + '先在 canvas-studio/ 下跑：npx tsdown  （或 npx tsc -p tsconfig.json）',
    )
  }
  const constants = {}
  for (const [name, value] of Object.entries(mod)) {
    if (typeof value === 'number' && Number.isFinite(value)) constants[name] = value
  }
  const [srcStat, libStat] = await Promise.all([
    stat(join(root, 'src', 'canvas-aspect.ts')),
    stat(join(root, 'lib', 'canvas-aspect.js')),
  ])
  if (srcStat.mtimeMs > libStat.mtimeMs + 1000) {
    console.warn('⚠️  src/canvas-aspect.ts 比 lib/canvas-aspect.js 新 —— 预览用的是旧常量，请先重新构建 lib/')
  }
  return constants
}

/** 样式正文里的 `${ 常量名 }` 插值（构建时会被解析成数字）。 */
const STYLE_PLACEHOLDER_RE = /\$\{([A-Za-z_$][\w$]*)\}/g

/**
 * 抽出 `src/client/styles.ts` 里的 `STUDIO_STYLES` 模板字面量正文，并**解析插值**。
 *
 * 抽的是**产品正在用的那一份**，所以预览与产品不会分叉。
 * （`styles.ts` 有一条守卫禁止文件内出现反引号，正是为了让这个抽取安全。）
 *
 * ## 为什么必须解析 `${…}`（2026-09-12 踩过，值得留着）
 *
 * 抽取是**切片**，不是导入 —— 切出来的是模板字面量的**源码文本**，而构建（tsdown）
 * 才会把 `${NODE_HEAD_HEIGHT}` 换成 `26`。不解析的话，浏览器收到的是
 * `height: ${NODE_HEAD_HEIGHT}px`，CSS 解析器当**无效声明**丢掉，头部退回 auto 高度。
 *
 * 失败模式是**完全静默**的：页面不报错、控制台干净、卡片看起来「只是有点挤」，
 * 量出来头部 22.6px（其实是标题的行高）。当时的症状是验收台里两条几何断言变红，
 * 第一反应会去怀疑 `box-sizing` / 边框吃高度 —— 而真凶在这里。
 *
 * 所以：解析，并且**未知占位符硬失败**。将来样式里加了新的 `${…}`，
 * 这里会立刻报错，而不是安静地少一条声明。
 */
export async function readStudioStyles() {
  const source = await readFile(join(root, 'src', 'client', 'styles.ts'), 'utf8')
  const marker = 'const STUDIO_STYLES = `'
  const start = source.indexOf(marker)
  if (start < 0) throw new Error('找不到 STUDIO_STYLES')
  const from = start + marker.length
  const end = source.indexOf('\n`\n', from)
  if (end < 0) throw new Error('找不到 STUDIO_STYLES 结尾')
  const body = source.slice(from, end)

  if (!body.includes('${')) return body
  const constants = await loadAspectConstants()
  return body.replace(STYLE_PLACEHOLDER_RE, (whole, name) => {
    const value = constants[name]
    if (value === undefined) {
      throw new Error(
        `STUDIO_STYLES 里的 ${whole} 无法解析 —— lib/canvas-aspect.js 没有导出常量 ${name}。\n`
        + '样式里的插值必须来自 src/canvas-aspect.ts 的数值导出（那里是几何的唯一出处）；'
        + '否则预览会带着一条无效声明渲染，且不报错。',
      )
    }
    return String(value)
  })
}

/** `styles.ts` 实际引用到的宿主令牌名（用来把「漏了哪些」变成告警）。 */
export async function hostTokensReferenced() {
  const source = await readFile(join(root, 'src', 'client', 'styles.ts'), 'utf8')
  const names = new Set()
  for (const match of source.matchAll(/var\(--((?:dsw|dsh)-[a-z0-9-]+)/g)) names.add(`--${match[1]}`)
  return [...names].sort()
}

/** 给定宿主表，返回它**没覆盖**、但 `styles.ts` 引用了的令牌名。 */
export async function missingHostTokens(tokens) {
  const referenced = await hostTokensReferenced()
  return referenced.filter(name => !(name in tokens))
}

/**
 * 加载 `lib/brand.js`。
 *
 * 拿不到就**硬失败**：预览一旦在缺令牌的情况下渲染，就会被误读成产品的问题，
 * 这比脚本报错贵得多。顺带检查构建产物是否比源码旧（同样是「安静的错误」来源）。
 */
export async function loadBrandModule() {
  const url = pathToFileURL(join(root, 'lib', 'brand.js')).href
  let mod
  try {
    mod = await import(url)
  } catch (err) {
    // 不能只说「不可加载」：瞬态的半写入文件、依赖里的语法错误，症状都一样，
    // 把原始报错带上才能当场分辨（2026-09-12 实测出过一次不可复现的加载失败）。
    throw new Error(
      'lib/brand.js 不存在或不可加载 —— 预览脚本依赖构建产物。\n'
      + '先在 canvas-studio/ 下跑：npx tsdown  （或 npx tsc -p tsconfig.json）\n'
      + `原始错误：${err instanceof Error ? err.message : String(err)}`,
    )
  }
  if (typeof mod.brandCssText !== 'function') throw new Error('lib/brand.js 未导出 brandCssText')

  // 产物比源码旧 = 预览显示的可能是上一版令牌，同样属于「安静的错误」。
  const [srcStat, libStat] = await Promise.all([
    stat(join(root, 'src', 'brand.ts')),
    stat(join(root, 'lib', 'brand.js')),
  ])
  if (srcStat.mtimeMs > libStat.mtimeMs + 1000) {
    console.warn('⚠️  src/brand.ts 比 lib/brand.js 新 —— 预览用的是旧令牌，请先重新构建 lib/')
  }
  return mod
}

/** 品牌预设 id 列表（预览的预设切换用）。 */
export async function brandPresetIds() {
  const mod = await loadBrandModule()
  return mod.BRAND_PRESET_IDS
}

/** 产品的默认品牌预设 id（预览写 `data-cs-preset` 属性用，与 `brandTokensCss()` 同源）。 */
export async function defaultPresetId() {
  const mod = await loadBrandModule()
  return mod.DEFAULT_BRAND_PRESET
}

/** 预设展示名（`{ id: label }`），给预览的切换控件写文案。 */
export async function brandPresetLabels() {
  const mod = await loadBrandModule()
  return Object.fromEntries(mod.BRAND_PRESET_IDS.map(id => [id, mod.BRAND_PRESETS[id].label]))
}

/**
 * 把 `brandCssText()` 的两块改锚到调用方给的选择器上。
 *
 * ⚠️ **两块不是「浅色块 / 深色块」**，这一点极易搞错（2026-09-12 踩过）：
 *
 * - 第 1 块 `body[data-cs-brand="<id>"]` 是**基块** —— 明暗两轨都命中。它装着
 *   `--cs-gold` / `--cs-teal` / `--cs-dim` / `--cs-fs-*` / `--cs-space-*` /
 *   `--cs-shadow-*` / `--cs-ease` 以及浅色面上的值。暗色下它**仍然生效**，
 *   只是被第 2 块覆盖同名的那些。
 * - 第 2 块 `body[data-ds-dark-theme][data-cs-brand="<id>"]` 是**暗色覆盖层**。
 *
 * 所以 `baseSelector` 必须选一个「明暗都命中」的锚点，`darkSelector` 必须带
 * 「仅暗色」的限定。若把基块错锚成仅浅色（例如 `html[data-light]`），暗色下
 * 金/青/字阶/间距/阴影/缓动会**整批消失**，而 `styles.ts` 里大量
 * `var(--cs-teal, #35C2A6)` 兜底值会让界面看起来「差不多对」—— 静默失败。
 *
 * 产品的真实锚点是 `body[data-cs-brand="<id>"]` + `body[data-ds-dark-theme][data-cs-brand="<id>"]`；
 * 既有预览用 `html[data-light]` 做主题开关，故默认锚点为
 * `html[data-cs-preset="<id>"]`（基）+ `html:not([data-light])[data-cs-preset="<id>"]`（暗）。
 * `:not([data-light])` 的额外属性选择器让暗色块的特异性高于基块，覆盖顺序正确。
 */
export function rewriteBrandSelectors(css, { baseSelector, darkSelector }) {
  const lines = css.split('\n')
  const out = lines.map(line => {
    if (/^body\[data-cs-brand="[^"]+"\] \{$/.test(line)) return `${baseSelector} {`
    if (/^body\[data-ds-dark-theme\]\[data-cs-brand="[^"]+"\] \{$/.test(line)) return `${darkSelector} {`
    return line
  })
  const rewritten = out.filter((line, i) => line !== lines[i]).length
  if (rewritten !== 2) {
    throw new Error(`brandCssText 的选择器结构变了（只重写了 ${rewritten}/2 块）—— 请同步 preview-tokens.mjs`)
  }
  return out.join('\n')
}

/** 默认锚点：基块命中明暗两轨，暗色覆盖层仅暗色。 */
export const DEFAULT_BASE_SELECTOR = 'html[data-cs-preset]'
export const DEFAULT_DARK_SELECTOR = 'html:not([data-light])[data-cs-preset]'

/**
 * 生成可直接嵌进 `<style>` 的真实 `--cs-*` 令牌文本。
 *
 * @param {object} opts
 * @param {string} [opts.presetId]      品牌预设（默认取产品的默认预设）
 * @param {string} [opts.baseSelector]  基块选择器（明暗都命中；默认 `html[data-cs-preset]`）
 * @param {string} [opts.darkSelector]  暗色覆盖块选择器（默认 `html:not([data-light])[data-cs-preset]`）
 * @param {string} [opts.productAnchors] 传 true 则保持产品原锚点（body[data-cs-brand] 系）
 */
export async function brandTokensCss(opts = {}) {
  const mod = await loadBrandModule()
  const presetId = opts.presetId ?? mod.DEFAULT_BRAND_PRESET
  const raw = mod.brandCssText(presetId)
  if (opts.productAnchors === true) return raw
  return rewriteBrandSelectors(raw, {
    baseSelector: opts.baseSelector ?? DEFAULT_BASE_SELECTOR,
    darkSelector: opts.darkSelector ?? DEFAULT_DARK_SELECTOR,
  })
}

/**
 * 通用令牌探针 —— 断言关键 `--cs-*` 在**浏览器里真的解析出了值**。
 *
 * ## 为什么不能只做静态检查
 *
 * 「令牌在 CSS 文本里存在」和「令牌在页面上生效」是两件事。选择器锚点写错时
 * （例如把明暗双轨的**基块**错锚成「仅浅色」），全部声明仍然一字不差地躺在文件里，
 * 静态扫描一路绿，但暗色下一条都不命中 —— 页面靠 `styles.ts` 里
 * `var(--cs-teal, #35C2A6)` 这类兜底值「看着差不多对」。2026-09-12 正是栽在这一步：
 * 静态检查完全看不出来，只有 `getComputedStyle` 能把「安静的错误」变成红的。
 *
 * 用法：把返回值插到 `</body>` 之前，再用 `scripts/verify-previews.mjs` 无头读取
 * `#pvVerdict` 与 `html[data-pv-fail]`。
 */
export function tokenProbe() {
  const names = [
    '--cs-shell', '--cs-canvas-bg', '--cs-node', '--cs-node-hi', '--cs-float',
    '--cs-line', '--cs-line-hi', '--cs-accent', '--cs-accent-soft', '--cs-gold',
    '--cs-teal', '--cs-gate', '--cs-dim', '--cs-glow-accent', '--cs-scrim',
    '--cs-canvas-grid', '--cs-canvas-grid-major', '--cs-fs-xs', '--cs-fs-2xl',
    '--cs-space-4', '--cs-shadow-2', '--cs-shadow-3', '--cs-ease',
  ]
  return `<pre id="pvVerdict"></pre>
<script>
(function () {
  var NAMES = ${JSON.stringify(names)}
  var fail = 0
  var emptyCount = 0
  var detail = ''
  try {
    var cs = getComputedStyle(document.body)
    var empty = NAMES.filter(function (n) { return !cs.getPropertyValue(n).trim() })
    if (empty.length > 0) {
      fail = 1
      emptyCount = empty.length
      detail = '  → 空值 ' + empty.length + ' 个：' + empty.join(' ')
    }
  } catch (err) {
    fail = 1
    emptyCount = NAMES.length
    detail = '  → THROW ' + (err && err.message ? err.message : 'unknown')
  }
  var text = (fail === 0 ? '\\u2705 ' : '\\u274c ')
    + (NAMES.length - emptyCount) + ' / ' + NAMES.length + ' 关键令牌在浏览器里可解析' + detail
  var pre = document.getElementById('pvVerdict')
  if (pre) pre.textContent = text
  document.documentElement.setAttribute('data-pv-fail', String(fail))
})()
</script>`
}

/**
 * 预览脚本统一的收尾自检：打印令牌覆盖情况。
 *
 * - `--cs-*` 期望**零缺失**（色值全部派生，缺失只可能是抽取逻辑坏了）→ 缺失即抛错。
 * - 宿主 `--dsw-*` 缺失只**告警**：宿主契约不在插件手里，仍应看见缺了哪些。
 */
export async function reportTokenCoverage(label, brandCss, hostTokens) {
  const styles = await readStudioStyles()
  const referencedBrand = [...new Set(
    [...styles.matchAll(/var\((--cs-[a-z0-9-]+)/g)].map(m => m[1]),
  )].sort()
  const definedBrand = new Set([...brandCss.matchAll(/(--cs-[a-z0-9-]+)\s*:/g)].map(m => m[1]))
  const missingBrand = referencedBrand.filter(name => !definedBrand.has(name))
  if (missingBrand.length > 0) {
    throw new Error(`${label}: --cs-* 令牌缺失 ${missingBrand.length} 个 —— ${missingBrand.join(' ')}`)
  }

  const missingHost = await missingHostTokens(hostTokens)
  const suffix = missingHost.length === 0
    ? '宿主令牌齐全'
    : `⚠️ 宿主令牌缺 ${missingHost.length} 个（该处会退回浏览器默认值）：${missingHost.join(' ')}`
  console.log(`  ${label}: --cs-* ${referencedBrand.length}/${referencedBrand.length} ✓ · ${suffix}`)
  return { missingBrand, missingHost }
}
