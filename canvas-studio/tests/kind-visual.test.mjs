/**
 * CV-197 节点类型色彩身份：**接线守卫**（行为验证在 `scripts/preview-kind.mjs`）。
 *
 * 分成两层是有原因的：
 *
 * - **行为层只能真跑** —— 「三色在浏览器里解析成三种颜色」「类挂上了但被更下面的
 *   基础规则压过」这类失效，源码里一行都不差。它们在验收台里用 `getComputedStyle`
 *   断言（含一组对照帧：不带身份类的文本帧必须与三色都不同）。
 * - **接线层必须静态守** —— 「五处表面里的某一处忘了接」「新增 kind 忘了配色」
 *   「三个类里有人抄了一遍 HEX」这三类问题是纯代码形状问题，静态断言既便宜又准。
 *
 * ⚠️ 读源码前**必须剥注释**：这些文件的注释里大量出现类名与令牌名（本仓的注释就是
 * 设计文档），不剥的话「注释里提过」会被当成「代码里接了」—— 这正是 CV-194
 * 逮到过一回的空绿。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/** 剥块注释与整行注释（与 approval-gate / studio-defaults 同一理由）。 */
function readSource(rel) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

const LABELS_SRC = readSource('../src/client/canvas/labels.ts')
const STYLES_SRC = readSource('../src/client/styles.ts')
const BRAND_SRC = readSource('../src/brand.ts')

/** 取某个 CSS 规则/TS 对象字面量的 body：从 `head` 之后的第一个 `{` 配到同层 `}`。 */
function bodyOf(source, head) {
  const start = source.indexOf(head)
  if (start < 0) return null
  const open = source.indexOf('{', start)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open + 1, i)
    }
  }
  return null
}

/** 取 KIND_ACCENT / KIND_LABEL 里的键集合（用于「两处键必须一致」这条守卫）。 */
function keysOf(source, name) {
  const body = bodyOf(source, `${name}`)
  if (body === null) return []
  return [...body.matchAll(/(?:^|\n)\s*'?([a-z][\w-]*)'?\s*:/g)].map((m) => m[1])
}

const SURFACES = [
  '../src/client/canvas/CanvasNode.tsx',
  '../src/client/canvas/LayerPanel.tsx',
  '../src/client/canvas/CanvasTimeline.tsx',
  '../src/client/canvas/ReferenceTray.tsx',
  '../src/client/canvas/NodeDetailDrawer.tsx',
]

// ── 一、判据唯一 ─────────────────────────────────────────────────────────────

test('KIND_ACCENT 覆盖每一个节点类型，且与 KIND_LABEL 的键集合完全一致', () => {
  const labelKeys = keysOf(LABELS_SRC, 'KIND_LABEL').sort()
  const accentKeys = keysOf(LABELS_SRC, 'KIND_ACCENT').sort()
  assert.ok(labelKeys.length >= 7, `KIND_LABEL 解析出 ${labelKeys.length} 个键，看起来解析坏了`)
  assert.deepEqual(
    accentKeys, labelKeys,
    '新增节点类型时必须同时在 KIND_LABEL 与 KIND_ACCENT 各加一行 —— 只加一处会表现为「新类型没有色彩身份」（静默）',
  )
})

test('媒体三类映射到三个身份类；非媒体（文本 / 便签 / 提示 / 分组）必须是空串', () => {
  assert.match(LABELS_SRC, /image:\s*'csKindImage'/, 'image 必须映射 csKindImage')
  assert.match(LABELS_SRC, /video:\s*'csKindVideo'/, 'video 必须映射 csKindVideo')
  assert.match(LABELS_SRC, /audio:\s*'csKindAudio'/, 'audio 必须映射 csKindAudio')
  // 「有彩边 = 有画面」这条扫读规则靠这里守住：给没有画面的卡也染色会把它污染掉。
  for (const kind of ['sticky', 'text', 'prompt', 'group']) {
    assert.match(
      LABELS_SRC, new RegExp(`${kind}:\\s*''`),
      `${kind} 必须是无色彩身份（空串）—— 非媒体节点不该有彩边`,
    )
  }
})

test('kindAccentOf 是唯一出口：五处表面都必须真的调它', () => {
  assert.match(LABELS_SRC, /export function kindAccentOf/, 'kindAccentOf 必须存在且导出')
  for (const rel of SURFACES) {
    const code = readSource(rel)
    assert.ok(
      /kindAccentOf\(/.test(code),
      `${rel} 没有调用 kindAccentOf —— 五处表面共用一份判据是这批改动的全部意义，漏一处就开始分叉`,
    )
  }
})

test('画布卡片、图层面板、时间轴、托盘、抽屉各自把类拼进 className（不是只 import）', () => {
  const cases = [
    ['../src/client/canvas/CanvasNode.tsx', /kindAccentOf\(node\.kind\)/],
    ['../src/client/canvas/LayerPanel.tsx', /kindAccentOf\(node\.kind\)/],
    ['../src/client/canvas/CanvasTimeline.tsx', /kindAccentOf\(node\.kind\)/],
    ['../src/client/canvas/ReferenceTray.tsx', /kindAccentOf\(node\.kind\)/],
    ['../src/client/canvas/NodeDetailDrawer.tsx', /kindAccentOf\(node\.kind\)/],
  ]
  for (const [rel, pattern] of cases) {
    assert.match(readSource(rel), pattern, `${rel} 里 kindAccentOf 的结果必须真的传进 className`)
  }
})

// ── 二、色值只有一份定义 ─────────────────────────────────────────────────────

test('brand.ts 定义 --cs-kind / --cs-kind-soft，且值是对令牌的引用而不是抄一遍色值', () => {
  assert.match(BRAND_SRC, /\['--cs-kind',\s*'var\(--cs-accent\)'\]/,
    '--cs-kind 的默认值必须写成 var(--cs-accent)（引用是惰性的，明暗两轨与四个预设自动跟随）')
  assert.match(BRAND_SRC, /\['--cs-kind-soft',\s*'var\(--cs-accent-soft\)'\]/,
    '--cs-kind-soft 的默认值必须写成 var(--cs-accent-soft)')
})

test('三个身份类的 --cs-kind 各指向对应令牌，且不许出现 HEX', () => {
  const map = [
    ['csKindImage', '--cs-accent'],
    ['csKindVideo', '--cs-teal'],
    ['csKindAudio', '--cs-gold'],
  ]
  for (const [cls, token] of map) {
    const body = bodyOf(STYLES_SRC, `.${cls} {`)
    assert.ok(body !== null, `styles.ts 必须定义 .${cls}`)
    assert.match(body, new RegExp(`--cs-kind:\\s*var\\(${token}\\)`),
      `.${cls} 的 --cs-kind 必须指向 ${token}`)
    assert.ok(
      !/#[0-9a-fA-F]{3,8}/.test(body),
      `.${cls} 里不许出现 HEX —— 抄一遍色值就会在换预设 / 换主题时用错色（DD-03 的老账）`,
    )
  }
})

// ── 三、五处表面真的都画了 ───────────────────────────────────────────────────

test('五处表面的规则都在，且全部要求「祖先带身份类」（不许外溢到非媒体）', () => {
  // 列表类表面走 inset 左缘条；卡片走染色描边；牌面三处共用一套规则。
  const required = [
    ['.csNode.csKindImage:not(.csNodeFilm)', '卡片：染色描边'],
    ['.csNode.csKindImage:not(.csNodeFilm):hover:not(.csNodeSelected)', '卡片：hover 必须跟着身份走'],
    ['.csLayerRow.csKindImage', '图层面板行：左缘色条'],
    ['.csTlRefChip.csKindImage', '时间轴 chip：左缘色条'],
    ['.csReferenceItem.csKindImage', '参考托盘项：左缘色条'],
    ['.csKindImage.csNode .csNodeHeadKind', '卡片类型牌'],
    ['.csKindImage.csLayerRow .csLayerThumbKind', '图层缩略块牌面'],
    ['.csKindImage.csDetailDrawer .csDetailDrawerKind', '详情抽屉牌'],
  ]
  for (const [needle, what] of required) {
    assert.ok(STYLES_SRC.includes(needle), `styles.ts 缺少 ${what} 的规则：${needle}`)
  }
  // 牌面规则若写成无类前缀的 `.csNode .csNodeHeadKind`，非媒体节点会被一起染色。
  assert.ok(
    !/^\s*\.csNode \.csNodeHeadKind,\s*$/m.test(STYLES_SRC),
    '牌面规则必须要求祖先带身份类，否则对照帧（文本）会被一起染色',
  )
})

test('左缘色条只走 box-shadow：任何一条身份规则的 body 里都不许改盒模型属性', () => {
  const stripHeads = [
    '.csLayerRow.csKindImage,\n.csLayerRow.csKindVideo,',
    '.csTlRefChip.csKindImage,',
    '.csReferenceItem.csKindImage,',
  ]
  for (const head of stripHeads) {
    const start = STYLES_SRC.indexOf(head)
    assert.ok(start >= 0, `找不到左缘条规则：${head}`)
    const body = STYLES_SRC.slice(start, STYLES_SRC.indexOf('}', start))
    assert.match(body, /box-shadow:\s*inset 3px 0 0 var\(--cs-kind\)/, '左缘条必须是 inset 内阴影')
    for (const forbidden of ['padding', 'border-left', 'width:', 'margin']) {
      assert.ok(!body.includes(forbidden),
        `左缘条不许动盒模型（发现 ${forbidden}）—— 行高 / 缩略块宽度会被顶开`)
    }
  }
})

test('时间轴 chip 的两个信号正交：身份规则不许碰 background', () => {
  const start = STYLES_SRC.indexOf('.csTlRefChip.csKindImage,')
  const body = STYLES_SRC.slice(start, STYLES_SRC.indexOf('}', start))
  assert.ok(
    !body.includes('background'),
    '金底是「参考·产物轨」的轨道身份，不能被类型色顶掉 —— 两个信号必须正交',
  )
  // 基础金底仍在（守「没被顺手删掉」）。
  const base = bodyOf(STYLES_SRC, '.csTlRefChip {')
  assert.match(base, /var\(--cs-gold[,)]/, '.csTlRefChip 的基础金底必须保留')
})

// ── 四、形态标记与几何账 ─────────────────────────────────────────────────────

test('视频常驻 ▶ 标记只在 video 帧渲染（静止时也分得出图片 / 视频）', () => {
  const node = readSource('../src/client/canvas/CanvasNode.tsx')
  assert.match(node, /node\.kind === 'video' && <span className="csNodeHeadKindMark"/,
    '▶ 标记必须由 node.kind === \'video\' 守住，否则会出现在所有卡片上')
  assert.match(STYLES_SRC, /\.csNodeHeadKindMark \{/, 'styles.ts 必须有 .csNodeHeadKindMark 的样式')
})

test('几何账：身份类不得写死尺寸 —— 卡片与行的规则里不许出现 width / height', () => {
  for (const cls of ['csKindImage', 'csKindVideo', 'csKindAudio']) {
    const body = bodyOf(STYLES_SRC, `.${cls} {`)
    for (const forbidden of ['width', 'height', 'padding', 'border-width']) {
      assert.ok(!body.includes(forbidden),
        `.${cls} 只该定义两个变量，不许碰几何（发现 ${forbidden}）`)
    }
  }
})
