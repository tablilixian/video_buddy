/**
 * 视觉升维地板守卫（visual-direction-plan.md / -execution-plan.md）。
 *
 * 每条断言都对应一个**真实发生过的**问题，不是假想的：
 *
 * 1. 反引号守卫 —— styles.ts 的样式表装在模板字面量里。注释里写一个反引号就会
 *    把模板字符串撕裂，词法解析直接炸（tsdown PARSE_ERROR: Cannot assign to
 *    this expression）。2026-09-12 实测踩过，DD-03 又踩了一次（同一条守卫当场
 *    拦下，说明它值这个钱）。
 * 2. 幽灵令牌守卫 —— styles.ts 引用了 brand.ts 从未定义的 --cs-* 令牌。
 *    2026-09-12 实测抓到 4 个（--cs-text / --cs-text-muted / --cs-border /
 *    --cs-surface-raised），共 7 处引用，一直靠硬编码 fallback 撑着；其中
 *    #e8eaed 这类近白色文字在浅色主题下直接不可见。
 * 3. 空转令牌棘轮 —— brand.ts 定义了但 styles.ts 从不引用的令牌。DD-01 清点：
 *    44 个定义里 25 个空转。做成棘轮（只准减少、不准增加）而不是硬闸：基线
 *    非零，一步写「零空转」会当场挂，改不动任何东西。DD-03 已收窄到 11 个。
 * 4. 动效三语义白名单（DD-03 建）—— @keyframes 只能叫 develop/advance/yield。
 * 5. 不透明度唯一出口（DD-03 建）—— 状态不得自己写 opacity，只能写乘数。
 * 6. 血缘聚光 / 成片判定只有一份实现（DD-03 建）—— 客户端不得内联第二份。
 *
 * 4~6 是**读源码文本**的静态检查，不依赖 DOM，也不需要先 build；1~3 同理。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const readSrc = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const BRAND_SRC = readSrc('../src/brand.ts')
const STYLES_SRC = readSrc('../src/client/styles.ts')

/** styles.ts 里出现的全部 --cs-* 引用（var() 内）。 */
const referencedTokens = [...new Set(
  [...STYLES_SRC.matchAll(/var\(\s*(--cs-[a-z0-9-]+)/g)].map((m) => m[1]),
)].sort()

/** brand.ts 里定义的 --cs-* 令牌（字符串字面量，含 NON_COLOR_TOKENS 与两套 surface）。 */
const definedTokens = [...new Set(
  [...BRAND_SRC.matchAll(/'(--cs-[a-z0-9-]+)'/g)].map((m) => m[1]),
)].sort()

/** 某令牌是否被 styles.ts 以 var() 形式引用（负向先行断言防止前缀互相污染）。 */
const isReferenced = (token) =>
  new RegExp('var\\(\\s*' + token + '(?![\\w-])').test(STYLES_SRC)

/**
 * 已知空转令牌基线 —— 冻结于 2026-09-12（DD-01 落地时），DD-03 收窄一次。
 *
 * 性质：**棘轮**。往 brand.ts 加令牌时必须同批在 styles.ts 接上引用，否则下条
 * 断言会把该令牌报成「新增空转」并失败。修复某个空转项后，请顺手从这里删掉，
 * 保持清单与现实一致（清单只会变短）。
 *
 * DD-03 已接上 14 个（从清单删除）：--cs-fs-xs/sm/md/lg（节点卡字阶）、
 * --cs-space-1/2/3（节点内间距）、--cs-radius-pill（版本 chip）、
 * --cs-node-hi（悬停面）、--cs-dim（血缘聚光）、--cs-glow-accent（选中光晕）、
 * --cs-duration-fast/base（节点状态过渡）、--cs-teal（成片节点描边）、
 * --cs-shell-3（失效角标的凹陷底色）。
 *
 * 收敛计划：space-4..7 / fs-xl/2xl / accent-deep / canvas-bg-l1 由 DD-05（叙事）
 * 与 DD-06（首屏）接管；gold 由 DD-05 的审批条接管。
 */
const DEAD_TOKEN_BASELINE = [
  '--cs-accent-deep',
  '--cs-canvas-bg-l1',
  '--cs-fs-2xl',
  '--cs-fs-xl',
  '--cs-gold',
  '--cs-shadow-3',
  '--cs-space-4',
  '--cs-space-5',
  '--cs-space-6',
  '--cs-space-7',
]

test('守卫：styles.ts 不得含反引号（模板字面量会被撕裂）', () => {
  const ticks = [...STYLES_SRC.matchAll(/`/g)].length
  const lines = STYLES_SRC.split('\n')
  const offenders = lines
    .map((line, i) => ({ line: line.trim(), no: i + 1 }))
    .filter(({ line }) => line.includes('`'))
    .map(({ line, no }) => `${no}: ${line}`)
  assert.equal(
    ticks, 2,
    `styles.ts 只应有 2 个反引号（模板字面量的开闭定界符），实测 ${ticks} 个。`
    + `越界行：\n${offenders.join('\n')}`,
  )
})

test('守卫：styles.ts 引用的每个 --cs-* 都必须在 brand.ts 有定义（禁幽灵令牌）', () => {
  const ghosts = referencedTokens.filter((token) => !definedTokens.includes(token))
  assert.deepEqual(
    ghosts, [],
    '以下令牌在 styles.ts 被引用，但 brand.ts 从未定义 —— 它们会永远退回硬编码'
    + ` fallback（浅色主题下往往是错色）：${ghosts.join(', ')}`,
  )
})

test('DD-01 棘轮：brand.ts 新增令牌不得空转（空转集 ⊆ 基线）', () => {
  const dead = definedTokens.filter((token) => !isReferenced(token))
  const newlyDead = dead.filter((token) => !DEAD_TOKEN_BASELINE.includes(token))
  assert.deepEqual(
    newlyDead, [],
    '以下令牌在 brand.ts 定义但 styles.ts 从未引用。请同批在 styles.ts 接上引用，'
    + `或从 brand.ts 移除；若确为后续批次预留，请加入 DEAD_TOKEN_BASELINE 并注明批次：`
    + `\n  ${newlyDead.join('\n  ')}`,
  )
})

test('DD-01 棘轮：已接上引用的令牌应从基线移除（清单需与现实一致）', () => {
  const stale = DEAD_TOKEN_BASELINE.filter(
    (token) => definedTokens.includes(token) && isReferenced(token),
  )
  assert.deepEqual(
    stale, [],
    `这些令牌已接上引用，请从 DEAD_TOKEN_BASELINE 删除以免清单腐化：${stale.join(', ')}`,
  )
})

/**
 * DD-03 · 动效三语义契约（visual-direction-execution-plan.md §DD-05 提前到本批建立）。
 *
 * 全仓只允许三类动效：**显影**（新内容出现，csDevelop*）/ **行进**（阶段推进，
 * csAdvance*）/ **让位**（旧内容退出，csYield*）。命名即契约：新增 @keyframes
 * 必须能一眼归入其一，否则守卫在这里拦下。
 *
 * `csToastIn` / `csLogoPulse` 是 DD-05 之前就存在的两个动画（历史遗留），列在
 * 白名单里锁死 —— 既防止再冒出第四个自由命名，也把「DD-05 归位」这件事记在案。
 */
const KEYFRAMES_ALLOWLIST = ['csDevelop', 'csToastIn', 'csLogoPulse']
const KEYFRAMES_SEMANTICS = ['Develop', 'Advance', 'Yield']

test('DD-03 守卫：@keyframes 只允许三语义（develop / advance / yield）', () => {
  const names = [...STYLES_SRC.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)].map((m) => m[1])
  assert.ok(names.length > 0, 'styles.ts 必须至少有一个 @keyframes（解析失败会到这里）')
  const unknown = names.filter((name) => !KEYFRAMES_ALLOWLIST.includes(name))
  assert.deepEqual(
    unknown, [],
    `新增 @keyframes 必须归入显影/行进/让位三语义之一（csDevelop* / csAdvance* / csYield*）：`
    + `\n  ${unknown.join('\n  ')}`,
  )
  // 白名单里的名字本身也要合规（除历史遗留两项外）。
  const legacy = ['csToastIn', 'csLogoPulse']
  const offContract = names.filter(
    (name) => !legacy.includes(name) && !KEYFRAMES_SEMANTICS.some((s) => name.startsWith(`cs${s}`)),
  )
  assert.deepEqual(offContract, [], `以下动画名不符合三语义命名契约：${offContract.join(', ')}`)
})

/**
 * DD-03 · 不透明度唯一出口。
 *
 * CanvasNode 曾经把 node.opacity 直接写成 inline `opacity`，inline 永远赢 →
 * `.csNodeLocked`(0.75) / `.csNodeRetired`(0.45) 的 opacity 是**死代码**：
 * CV-108 号称「失效版本灰显」，实际只有 grayscale 生效。修法是三层各写乘数、
 * 由 .csNode 的 calc 统一算。这条守卫防止有人再往节点状态上直接写 opacity。
 */
test('DD-03 守卫：节点不透明度只走 --cs-node-opacity 乘法链', () => {
  assert.match(
    STYLES_SRC,
    /\.csNode\s*\{[^}]*opacity:\s*calc\(var\(--cs-node-opacity/,
    '.csNode 的 opacity 必须是 var(--cs-node-opacity, …) 的乘法链',
  )
  for (const selector of ['.csNodeLocked', '.csNodeRetired']) {
    const rule = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{[^}]*\\}`)
    const body = STYLES_SRC.match(rule)?.[0] ?? ''
    assert.ok(body.length > 0, `${selector} 规则不存在（解析失败或已被删）`)
    assert.ok(
      !/\bopacity:/.test(body),
      `${selector} 不得直接写 opacity（会被 inline 的 --cs-node-opacity 语义割裂）；`
      + '请写 --cs-node-state 乘数',
    )
  }
})

/**
 * DD-03 · 血缘聚光的判定只有一份实现。
 *
 * 判定口径在 src/canvas-lineage.ts（纯函数、可单测）。客户端组件只允许 import，
 * 不允许自己遍历 sourceIds —— CV-160 的教训（同一规则三处内联，漏一条就出错）
 * 已经证明「看起来只有几行」的重复也会出人命。
 */
const LINEAGE_SRC = readSrc('../src/canvas-lineage.ts')
const SURFACE_SRC = readSrc('../src/client/canvas/CanvasSurface.tsx')
const NODE_SRC = readSrc('../src/client/canvas/CanvasNode.tsx')

/**
 * 比对**代码**而不是注释：这几条守卫用的字面量（`toolName === 'compose'`、
 * `sourceIds.some`）恰好就是注释里最容易出现的写法（"不要在这里重写
 * toolName === 'compose'"）—— 不剥注释的话，守卫会因为一句正确的注释而误报，
 * 然后被人删掉。只剥块注释与整行注释，不做行内剥除：`https://` 这类字符串里
 * 的 `//` 会长在行中间，行内剥除会把真代码一起吃掉，反而漏报。
 */
const codeOnly = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')

const SURFACE_CODE = codeOnly(SURFACE_SRC)
const NODE_CODE = codeOnly(NODE_SRC)

test('DD-03 守卫：血缘聚光判定不得在客户端内联第二份', () => {
  const all = [[SURFACE_SRC, SURFACE_CODE, 'CanvasSurface.tsx'], [NODE_SRC, NODE_CODE, 'CanvasNode.tsx']]
  assert.match(SURFACE_CODE, /import \{ canvasSpotlight \} from '\.\.\/\.\.\/canvas-lineage\.js'/)
  assert.match(NODE_CODE, /import \{ isComposeProduct \} from '\.\.\/\.\.\/shot-versions\.js'/)
  for (const [, code, name] of all) {
    assert.ok(
      !/sourceIds\s*\.\s*(some|filter|includes|forEach)/.test(code),
      `${name} 不得自行遍历 sourceIds 算血缘 —— 请调用 canvas-lineage 的 canvasSpotlight`,
    )
    assert.ok(
      !/toolName\s*===\s*'compose'/.test(code),
      `${name} 不得内联判成片 —— 请调用 shot-versions 的 isComposeProduct`,
    )
  }
  // 反向护栏（正向）：判定模块本身确实实现了「上游 + 下游」两向。
  assert.match(LINEAGE_SRC, /上游/, 'canvas-lineage.ts 必须注明上游血缘')
  assert.match(LINEAGE_SRC, /下游/, 'canvas-lineage.ts 必须注明下游血缘')
})
