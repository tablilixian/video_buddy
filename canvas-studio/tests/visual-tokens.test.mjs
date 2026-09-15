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
import { readFileSync, readdirSync } from 'node:fs'

const readSrc = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')

/**
 * 取某条 CSS 规则的**规则体**（「选择器 {」到下一个行首的右花括号之间）。
 *
 * 为什么不用「非右花括号」那类行内正则：C10 起 styles.ts 里有
 * `height: ${NODE_HEAD_HEIGHT}px`，插值本身自带一个右花括号，会把行内字符类
 * 提前截断 —— 于是「规则里有 cursor: grab 吗」还没读到 cursor 就被判否，
 * 而断言只说「必须可拖拽」，完全指不到真正的原因。踩过一次，故抽成辅助。
 *
 * 另外：本段注释里**不能出现形如 斜杠-星号-斜杠 的序列**（连正则里的
 * 非右花括号写法都会带上它），那会提前结束块注释，后面的中文全变成代码。
 *
 * **选择器必须整条匹配**（2026-09-14 补）：初版写的是 src.indexOf(选择器 + 空格 +
 * 左花括号)，而 indexOf 找的是**子串** —— 查 .csChat 时命中的是更靠前的
 * 「.csFrame[data-mode="lobby"] .csChat {」（lobby 态那条），拿回来的规则体驴唇
 * 不对马嘴，断言报的还是「必须相对定位」这种指不到原因的文本。
 * 同一个坑其实已经踩过两次：C5 的 .csErrorCard 当时靠「不用 ruleBody、改写行内
 * 正则」绕开了 —— 那条绕行本身就是这个坑的第二次现形，绕开不等于修好。
 * 现在要求选择器前面是**行首或逗号**：组选择器里每一项仍能命中，而复合选择器
 * 尾部的同名子串再也命中不了。
 */
const ruleBody = (src, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const found = new RegExp(`(?:^|[,\\n])[ \\t]*${escaped}[ \\t]*\\{`).exec(src)
  if (found === null) return ''
  const body = src.slice(found.index + found[0].length)
  return body.slice(0, body.indexOf('\n}'))
}

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
 * DD-04a：--cs-gold（时间轴参考轨 chip）。
 * DD-06：--cs-accent-deep（欢迎屏底部余晖）、--cs-fs-xl/2xl（首屏字阶）、
 * --cs-shadow-3（欢迎卡）、--cs-space-4..7（首屏间距）。
 * C2：--cs-shell-3 的**唯一**消费点（失效角标的凹陷底色）被角标带的共用材料
 * 取代，于是它变成空转 —— 已按棘轮规则直接从 brand.ts 删除，而不是塞回基线。
 * 新增：--cs-chip-bg / --cs-chip-line / --cs-chip-fg（压在画面上的角标材料）。
 * C10：上述三个 --cs-chip-* **同批删除**。它们的造出理由（「角标压在画面上，
 * 底和字必须自带」）随 C10 把头/脚做成真实布局行而失效 —— 牌面底下已经是节点面，
 * 材料交回宿主的 --dsw-alias-interactive-bg-hover / --cs-accent-soft，明暗两轨的
 * 对比度由宿主保证。同样按棘轮规则删除，不塞回基线。
 *
 * 收敛完成：仅剩的 --cs-canvas-bg-l1 已由 C7 首屏「未开拍的现场」自然消费
 * （.csLobbyHero 的 L1 底色），按棘轮规则从本基线移除 —— 基线清零。
 */
/**
 * 空转基线：`brand.ts` 有定义、`styles.ts` 引用 0 次的令牌白名单。
 *
 * **2026-09-15（CV-181 / E-3）首次非空 —— 四项**：
 * `--cs-accent-deep` / `--cs-fs-2xl` / `--cs-shadow-3` / `--cs-space-7`。
 *
 * 它们不是新令牌，是**消费方被删掉**之后暴露出来的：整屏欢迎卡那六个类
 * （`.csWelcome*`）从没有 JSX 消费方（见文件末尾 E-3 守卫），删掉之后才发现
 * **那张从未渲染过的卡片是这四个令牌唯一的引用点**。也就是说 DD-06 当时在
 * `.csWelcome` 上写「DD-06：accent-soft 主光晕 + accent-deep 底部余晖（顺带接线
 * 空转的 deep）」—— 它以为接上了，实际接的是一张永远不显示的卡片，
 * **accent-deep 的空转状态一天都没被解除过**。这次删除只是把它暴露出来。
 *
 * 为什么不顺手从 brand.ts 删掉：这四个都是**成套尺度的成员**
 * （间距 1~7、阴影 1~3、字阶 xs~2xl，且 accent-deep 在明暗两轨都有定义）。
 * 从一条完整尺度里抽掉一档，代价大于留着它 —— 下一块需要 48px 间距或三级阴影的
 * 面板会原样加回来，中间还得再改一次守卫。保留即「为后续批次预留」。
 *
 * 注意本清单是**双向**的：令牌一旦被接上引用，下面第二条棘轮会要求把它删掉，
 * 免得清单腐化成「谁也不敢删的名单」。
 */
const DEAD_TOKEN_BASELINE = [
  '--cs-accent-deep', // CV-181 / E-3：唯一消费方是已删的 .csWelcome 底部余晖
  '--cs-fs-2xl', // 同上：唯一消费方是已删的 .csWelcomeTitle
  '--cs-shadow-3', // 同上：唯一消费方是已删的 .csWelcomeCard 浮层阴影
  '--cs-space-7', // 同上：唯一消费方是已删的 .csWelcomeCard 内边距
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
 * `csToastIn` / `csLogoPulse` 是 DD-05 之前就存在的两个动画（历史遗留）。
 *
 * 2026-09-12（C1）把这份白名单从**硬编码清单**改成**按前缀派生**：原实现
 * （`KEYFRAMES_ALLOWLIST = ['csDevelop','csToastIn','csLogoPulse']`）比它自己
 * 声明的契约更严 —— 一个名叫 `csAdvancePulse` 的、完全合规的新动画会被拦下，
 * 逼着人来改守卫。而「每次都改守卫」正是守卫被橡皮图章化的开始。按前缀派生保住
 * 了真正的不变量（不许出现无法归类的新动画），同时不再误伤合规命名。
 */
const KEYFRAMES_SEMANTICS = ['Develop', 'Advance', 'Yield']
const KEYFRAMES_LEGACY = ['csToastIn', 'csLogoPulse']

test('DD-03 守卫：@keyframes 只允许三语义（develop / advance / yield）', () => {
  const names = [...STYLES_SRC.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)].map((m) => m[1])
  assert.ok(names.length > 0, 'styles.ts 必须至少有一个 @keyframes（解析失败会到这里）')
  const offContract = names.filter(
    (name) => !KEYFRAMES_LEGACY.includes(name)
      && !KEYFRAMES_SEMANTICS.some((s) => name.startsWith(`cs${s}`)),
  )
  assert.deepEqual(
    offContract, [],
    '新增 @keyframes 必须归入显影/行进/让位三语义之一（csDevelop* / csAdvance* / csYield*）：'
    + `\n  ${offContract.join('\n  ')}`,
  )
})

test('C5 守卫：动效词汇补齐、消费者接线、幽灵动画禁入、降级成对', () => {
  const code = codeOnly(STYLES_SRC)
  const names = [...code.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)].map((m) => m[1])
  // ① 设计稿 6 个动画的消费点全部落地：pulse（阶段点）/ scan（进度条）
  //    由 C1 与 DD-03 既有实现承载，C5 补 rise / pop / clapHit，N1 补节点入场 develop。
  for (const name of ['csYieldRise', 'csYieldPop', 'csDevelopClapHit', 'csDevelopIn']) {
    assert.ok(names.includes(name), `缺少 ${name} @keyframes —— 动效词汇不齐（收口清单 C5 / §8.3-N1）`)
  }
  // ② 消费者真的挂上了动画 —— 写了规则但选择器没接线，是这一批最容易出的静默失败
  //    （页面不报错，只是「看起来没活」）。
  assert.match(ruleBody(STYLES_SRC, '.csWorkflowApproval'), /animation:\s*csYieldRise\b/, '审批条必须挂 rise 入场')
  assert.match(ruleBody(STYLES_SRC, '.csWorkflowClap'), /animation:\s*csDevelopClapHit\b/, '场记板图标必须挂打板')
  assert.match(ruleBody(STYLES_SRC, '.csDetailPanel'), /animation:\s*csYieldPop\b/, '详情面板必须挂 pop')
  assert.match(ruleBody(STYLES_SRC, '.csCanvasLayers'), /animation:\s*csYieldPop\b/, '图层浮层必须挂 pop')
  // 注意：.csErrorCard 不能走 ruleBody —— reduced-motion 汇总块「.csDetailPanel, .csErrorCard {」
  // 在文件里更靠前，indexOf 会命中的是 animation: none 那条而不是正式规则。
  assert.match(STYLES_SRC, /\.csErrorCard\s*\{[^}]*animation:\s*csYieldPop\b/, '错误卡必须挂 pop（C8：浮层词汇一致）')
  // ③ 禁幽灵动画：animation 引用的名字必须是已定义的 @keyframes（拼错 = 静默不动）。
  for (const decl of code.match(/animation:\s*[^;]+/g) ?? []) {
    const name = decl.replace(/^animation:\s*/, '').trim().split(/\s+/)[0]
    if (name === 'none') continue
    assert.ok(names.includes(name), `animation 引用了未定义的 @keyframes：${name}`)
  }
  // ③b N1 真机教训（2026-09-13）：csDevelopIn 必须用独立 scale 属性 —— 节点定位
  //     是 inline transform: translate3d(x,y,0)，keyframes 里写 transform（含
  //     `to { transform: none }`）会被 fill both 永久套用，把所有节点锁死在画布
  //     原点：拖不动、血缘边按数据坐标画 → 箭头全部指向虚空。
  const developIn = code.match(/@keyframes\s+csDevelopIn\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.ok(developIn.length > 0, '缺少 csDevelopIn @keyframes')
  assert.match(developIn, /(^|\s|;)scale:\s*0\.94/, 'csDevelopIn 必须用独立 scale 属性做显影')
  assert.ok(!/\btransform\s*:/.test(developIn), 'csDevelopIn 不得写 transform —— 会覆盖节点的 translate3d 定位（真机事故）')
  // ④ 减弱动态后必须静止且不崩：每个动画消费者都要出现在 prefers-reduced-motion 里。
  const reduced = code
    .split(/(?=@media)/)
    .filter((chunk) => chunk.startsWith('@media (prefers-reduced-motion'))
    .join('\n')
  for (const sel of ['.csNode', '.csNodeProgressBar', '.csWorkflowApproval', '.csWorkflowClap', '.csDetailPanel', '.csCanvasLayers', '.csErrorCard']) {
    assert.ok(reduced.includes(sel), `prefers-reduced-motion 降级必须覆盖 ${sel}`)
  }
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
const FRAME_SRC = readSrc('../src/client/StudioFrame.tsx')
const TIMELINE_SRC = readSrc('../src/client/canvas/CanvasTimeline.tsx')
const STATES_SRC = readSrc('../src/client/brand/States.tsx')
const ASPECT_SRC = readSrc('../src/canvas-aspect.ts')
const STORE_SRC = readSrc('../src/client/project-store.ts')
const GENERATE_SRC = readSrc('../src/generate.ts')
const COMPOSE_SRC = readSrc('../src/compose.ts')
const FRAME_UTIL_SRC = readSrc('../src/video-frames.ts')

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

test('血缘判定不得在客户端内联第二份（2026-09-13 起节点压暗已取消）', () => {
  const all = [[SURFACE_SRC, SURFACE_CODE, 'CanvasSurface.tsx'], [NODE_SRC, NODE_CODE, 'CanvasNode.tsx']]
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
  /**
   * 反向护栏：**取消压暗**是产品拍板（2026-09-13），不是遗漏。
   *
   * 上一版这里断言的是「CanvasSurface 必须 import canvasSpotlight」—— 那条正向
   * 断言把「压暗生效」锁成了契约，于是自动化全绿而用户真机验收持续失败
   * （实测：18 节点项目里选中任意节点都会压暗 9~16 个，「无非血缘关系不压暗」
   * 的保护在真实数据上从不生效）。现在锁的是**相反方向**：画布不得再把 dimmed
   * 传给节点，防止压暗被无意加回来。canvasSpotlight 仍是唯一血缘判定实现，
   * 由 canvas-lineage.test.mjs 继续覆盖。
   */
  assert.ok(
    !/dimmed\s*=/.test(SURFACE_CODE),
    'CanvasSurface 不得再传递 dimmed —— 2026-09-13 产品拍板取消节点压暗',
  )
  // 判定模块本身确实实现了「上游 + 下游」两向。
  assert.match(LINEAGE_SRC, /上游/, 'canvas-lineage.ts 必须注明上游血缘')
  assert.match(LINEAGE_SRC, /下游/, 'canvas-lineage.ts 必须注明下游血缘')
})

/**
 * DD-05 → C1 · 审批条形态与制作轨道。
 *
 * **这条断言的契约在 C1 反转了**：DD-05 当时断言「阶段指示**不可点击**」，理由是
 * 「无阶段模型，行进语义而已」—— 而「能点但没动作」的按钮比不可点更糟。
 * Q1 拍板走路线 i 后有了阶段模型（`src/workflow-stage.ts`），每段都带得出该段的
 * 产物 id，于是「点击」有了真实动作（选中 + 聚焦该段产物）。
 * 所以现在断言的是**相反方向**：可点击 + 必须显式区分可点/不可点 + 判定只有一份
 * 实现（StudioFrame 不得自己维护阶段表）。
 */
test('DD-05 / C1：审批条消费 gold，六段轨道可点击且判定收口到纯函数', () => {
  const approval = STYLES_SRC.match(/\.csWorkflowApproval\s*\{[^}]*\}/)?.[0] ?? ''
  assert.match(approval, /var\(--cs-gold/, '审批条必须消费 --cs-gold（HITL 审批固定功能色）')

  const stages = STYLES_SRC.match(/\.csWorkflowStage\s*\{[^}]*\}/)?.[0] ?? ''
  assert.ok(stages.length > 0, '.csWorkflowStage 规则必须存在（阶段行进指示）')
  assert.match(
    stages, /cursor:\s*pointer/,
    'C1 起阶段段可点击（聚焦该段产物），必须有 pointer 光标',
  )
  assert.match(
    STYLES_SRC, /\.csWorkflowStage:disabled\s*\{[^}]*cursor:\s*default/,
    '无产物的段必须显式回落 default 光标 —— 否则「可点 / 不可点」在视觉上无从区分',
  )
  assert.match(
    STYLES_SRC, /@keyframes\s+csAdvancePulse/,
    '当前段必须有行进语义的脉冲（csAdvance*）',
  )

  // 判定只有一份实现：六段标签与阶段序号的唯一来源是 src/workflow-stage.ts。
  const frame = codeOnly(FRAME_SRC)
  assert.match(
    frame,
    /import \{ deriveWorkflowStage, WORKFLOW_STAGE_LABELS \} from '\.\.\/workflow-stage\.js'/,
    'StudioFrame 必须从 workflow-stage.ts 取六段判定',
  )
  assert.ok(
    !/WORKFLOW_STAGES\s*=/.test(frame),
    'StudioFrame 不得自己维护阶段表 —— 阶段表只能有一份（workflow-stage.ts）',
  )
})

/**
 * C10 · 节点镜头条（头 / 脚两行）。
 *
 * C2 修掉了「四角绝对定位互相压住 / 被 overflow 裁掉」这两个**实测出来**的缺陷，
 * 但角标仍然浮在画面上。C10 把它们收进真实布局行 —— 头（类型 + 标题 + 身份）/
 * 体（画面或正文）/ 脚（读数 + 素材角色）—— 于是「重叠」「被裁」不再是靠规则
 * 避免，而是**结构上不可能**。
 *
 * 守卫方向因此有两条：
 *   ① 不许回到浮动覆盖层（牌面禁止 absolute / 负偏移 / .csNodeBadgeBand）；
 *   ② 头脚高度必须**插值**自 canvas-aspect 的常量 —— 写死字面量就会与
 *      frameSizeOf 漂移，而漂移的表现只是「卡片看着有点挤」，没有任何报错。
 */
test('C10 守卫：头/脚是真实布局行 —— 角标不得回到浮动覆盖层', () => {
  const BADGE_SELECTORS = [
    '.csNodeBadge', '.csNodeBadgeError', '.csNodeBadgeRetry', '.csNodeBadgeLock',
    '.csNodeBadgeVersion', '.csNodeBadgeRetired', '.csNodeShotIdx',
    '.csNodeRefBadge', '.csNodeAudioMix', '.csNodeDuration', '.csNodeMediaDims',
  ]
  const styles = codeOnly(STYLES_SRC)
  for (const selector of BADGE_SELECTORS) {
    const escaped = selector.replace('.', '\\.')
    const rules = [...styles.matchAll(new RegExp(`${escaped}(?![\\w-])(?::[\\w-]+)?\\s*\\{([^}]*)\\}`, 'g'))]
    for (const rule of rules) {
      const body = rule[1]
      assert.ok(
        !/position\s*:\s*absolute/.test(body),
        `${selector} 不得绝对定位 —— 角标必须由 .csNodeBadgeBand 排布，`
        + '自作主张定位 = 同角两枚重叠（lock 被 version 盖住就是这样来的）',
      )
      assert.ok(
        !/\b(?:top|left|right|bottom)\s*:\s*-/.test(body),
        `${selector} 不得用负偏移 —— .csNode 的 overflow: hidden 会把它切掉`,
      )
    }
  }

  // 浮动角标带必须**不存在**（C2 的中间态已随 C10 收进布局行）。
  assert.ok(
    !/\.csNodeBadgeBand/.test(styles),
    '.csNodeBadgeBand 必须已被头/脚两行取代 —— 留着它就是留了一条能浮在画面上的通路',
  )
  assert.equal(
    [...codeOnly(NODE_SRC).matchAll(/csNodeBadgeBand/g)].length, 0,
    'CanvasNode 不得再渲染角标带',
  )

  // 卡片是三段竖列：没有这条，头/脚会与体区并排而不是上下。
  assert.match(styles, /\.csNode\s*\{[^}]*display:\s*flex/, '.csNode 必须是 flex 容器')
  assert.match(styles, /\.csNode\s*\{[^}]*flex-direction:\s*column/, '.csNode 必须是竖列')
  // 头/脚固定高度且不吃剩余空间；体区吃剩余空间。
  assert.match(styles, /\.csNodeHead\s*\{[^}]*flex:\s*0 0 auto/, '头部固定高度')
  assert.match(styles, /\.csNodeFoot\s*\{[^}]*flex:\s*0 0 auto/, '脚部固定高度')
  assert.match(styles, /\.csNodeMediaBox\s*\{[^}]*flex:\s*1 1 auto/, '媒体窗口吃剩余高度')
  assert.match(styles, /\.csNodeAudioBox\s*\{[^}]*flex:\s*1 1 auto/, '音频体区吃剩余高度')
  assert.match(styles, /\.csNodeText\s*\{[^}]*flex:\s*1 1 auto/, '正文体区吃剩余高度')

  // 头部整条是拖拽面（浮动角标时代必须 pointer-events: none 让出起手区，实底之后不必）。
  assert.match(ruleBody(styles, '.csNodeHead'), /cursor:\s*grab/, '头部必须可拖拽')
  // 而可点的失败告警必须是 <button> —— CanvasNode 的 isInteractiveTarget 靠标签名
  // 判定「这一下不是拖拽」，换成 span 会让点击重试变成拖走节点。
  assert.match(codeOnly(NODE_SRC), /<button[\s\S]{0,400}?csNodeHeadAlert/, '失败告警必须是 button')

  // TSX 侧真的渲染了头与脚各一处（且分组卡不渲染头）。
  const heads = [...codeOnly(NODE_SRC).matchAll(/className="csNodeHead"/g)].length
  const feet = [...codeOnly(NODE_SRC).matchAll(/className="csNodeFoot"/g)].length
  assert.equal(heads, 1, 'CanvasNode 必须渲染一处头部')
  assert.equal(feet, 1, 'CanvasNode 必须渲染一处脚部')
  assert.match(codeOnly(NODE_SRC), /!isGroup && \([\s\S]{0,240}?className="csNodeHead"/, '分组卡不得有头部')
})

test('C10 守卫：头/脚高度插值自 canvas-aspect，写死字面量即漂移', () => {
  // 常量本身：chrome 必须是头 + 脚的和，不许另写一个数字（另写就会与 CSS 对不上）。
  const aspect = codeOnly(ASPECT_SRC)
  assert.match(aspect, /export const NODE_HEAD_HEIGHT = \d+/, 'canvas-aspect 必须定义 NODE_HEAD_HEIGHT')
  assert.match(aspect, /export const NODE_FOOT_HEIGHT = \d+/, 'canvas-aspect 必须定义 NODE_FOOT_HEIGHT')
  assert.match(
    aspect, /export const NODE_CHROME_HEIGHT = NODE_HEAD_HEIGHT \+ NODE_FOOT_HEIGHT/,
    'chrome 高度必须是两个高度之和 —— 三个数字各写一遍迟早对不上',
  )
  assert.match(aspect, /height: box\.height \+ NODE_CHROME_HEIGHT/, 'frameSizeOf 必须把 chrome 加到画面上')
  assert.match(
    aspect, /height: Math\.max\(1, frame\.height - NODE_CHROME_HEIGHT\)/,
    'mediaBoxOf 必须把 chrome 从节点框减掉（自然尺寸校正判比例靠它）',
  )
  // 自然尺寸校正必须比**画面区**的比例：比整张卡的比例会让任何卡片都判成「偏了」。
  assert.match(
    codeOnly(FRAME_SRC), /const mediaBox = mediaBoxOf\(target\)/,
    'StudioFrame 的自然尺寸校正必须用 mediaBoxOf 逆算出画面区',
  )

  assert.match(
    STYLES_SRC, /\.csNodeHead\s*\{[^}]*height:\s*\$\{NODE_HEAD_HEIGHT\}px/,
    '头部高度必须插值 NODE_HEAD_HEIGHT —— 写死数字会与 frameSizeOf 静默漂移',
  )
  assert.match(
    STYLES_SRC, /\.csNodeFoot\s*\{[^}]*height:\s*\$\{NODE_FOOT_HEIGHT\}px/,
    '脚部高度必须插值 NODE_FOOT_HEIGHT',
  )
  assert.match(
    STYLES_SRC, /\.csNodeOverlay\s*\{[^}]*top:\s*\$\{NODE_HEAD_HEIGHT\}px/,
    '加载遮罩必须让开头部（正在显影的是画面，标题要一直读得到）',
  )
  assert.match(
    STYLES_SRC, /import \{ NODE_HEAD_HEIGHT, NODE_FOOT_HEIGHT \} from '\.\.\/canvas-aspect\.js'/,
    'styles.ts 必须从 canvas-aspect 取这两个高度',
  )

  // 每一个 ${…} 都必须指向 canvas-aspect 的导出常量。为什么要单独守：预览脚本是
  // **切片**读取 STUDIO_STYLES 文本的（scripts/preview-tokens.mjs 的 readStudioStyles），
  // 名字解析不了时那条声明会以「无效声明」被浏览器丢掉 —— 页面不报错，元素退回 auto
  // 高度（2026-09-12 就是这么量出 22.6px 的头部）。解析器本身对未知名字硬失败，
  // 这条静态守卫让同样的错误在几秒钟内、不启浏览器就能暴露。
  const placeholders = [...new Set([...STYLES_SRC.matchAll(/\$\{([A-Za-z_$][\w$]*)\}/g)].map(m => m[1]))]
  assert.ok(placeholders.length > 0, '头/脚高度是插值，样式里应当至少有一个 ${…}')
  for (const name of placeholders) {
    assert.match(aspect, new RegExp(`export const ${name} = `), `${name} 必须是 canvas-aspect 的导出常量`)
  }

  // 四个默认尺寸出口必须收敛到 DEFAULT_NODE_SIZE，不得再各写一份 260×180。
  for (const [name, src] of [
    ['project-store.ts', STORE_SRC],
    ['generate.ts', GENERATE_SRC],
    ['compose.ts', COMPOSE_SRC],
    ['video-frames.ts', FRAME_UTIL_SRC],
  ]) {
    const code = codeOnly(src)
    assert.ok(
      !/width:\s*260\s*,\s*\n\s*height:\s*180/.test(code),
      `${name} 不得再写死 260×180 节点框 —— 那是画面尺寸，节点框要加镜头条 chrome`,
    )
    assert.match(code, /DEFAULT_NODE_SIZE/, `${name} 必须走 DEFAULT_NODE_SIZE 统一出口`)
  }
  // 画面尺寸 → 节点框只允许经 frameSizeOf（写 previewSizeOf 会少算 48px）。
  assert.match(codeOnly(GENERATE_SRC), /const display = frameSizeOf\(size\)/, '生成路径必须用 frameSizeOf')
  assert.match(
    codeOnly(COMPOSE_SRC), /frameSizeOf\(\{ width: input\.width, height: input\.height \}\)/,
    '合成路径必须用 frameSizeOf',
  )
})

test('C10 守卫：告警牌面只有一份材料，脚部读数顺序有契约', () => {
  const styles = codeOnly(STYLES_SRC)
  // 两处告警（头部占标题格 / 体区整块坏掉时居中）共用同一条牌面规则 ——
  // 分开写就会慢慢长成两种红。
  assert.match(styles, /\.csNodeAlert,\s*\n\.csNodeHeadAlert\s*\{/, '两处告警必须共用一条牌面规则')
  assert.match(styles, /\.csNodeHeadAlert\s*\{[^}]*flex:\s*1 1 auto/, '头部告警必须占住标题那一格')
  // C2 自造的墨底牌面令牌已随浮动角标一起删除：脚部底下是节点面，
  // 材料交回宿主的交互面令牌，明暗两轨的对比度由宿主保证。
  // 只看**代码**：brand.ts 的注释里留着删除记录是刻意的（说明为什么不复活它们），
  // 该被禁的是「还在用」。
  assert.ok(!/--cs-chip-/.test(styles), '--cs-chip-* 已删除，不得再在代码里消费')

  // 牌面底色必须走令牌（写死颜色在另一套主题/预设下会消失）。
  // 范围只覆盖**牌面自己的规则** —— 技能卡 hover 浮层、弹窗遮罩也用了
  // color-mix(#000 …)，那是另一族语义（蒙层），不该被这条守卫牵连。
  const BADGE_SELECTORS = [
    '.csNodeBadge', '.csNodeHeadAlert', '.csNodeRefBadge', '.csNodeAudioMix',
  ]
  for (const selector of BADGE_SELECTORS) {
    const escaped = selector.replace('.', '\\.')
    const rules = [...styles.matchAll(new RegExp(`${escaped}(?![\\w-])(?::[\\w-]+)?\\s*\\{([^}]*)\\}`, 'g'))]
    for (const rule of rules) {
      for (const decl of rule[1].matchAll(/background(?:-color)?\s*:\s*([^;]+)/g)) {
        assert.match(
          decl[1], /var\(--cs-|var\(--dsw-/,
          `${selector} 的底色必须走令牌 —— 牌面在两种主题、四套预设下都要读得清`,
        )
      }
    }
  }

  // 脚部读数顺序 = node-presentation 的 READING_ORDER（跨卡片可扫读的前提）。
  // 用「在 TSX 里的出现位置」当顺序，而不是去解析 JSX —— 够稳，也够红。
  const node = codeOnly(NODE_SRC)
  const positions = ['showAudioMix', 'showDuration', 'showDims', 'declaredReadings.map']
    .map(marker => {
      const index = node.indexOf(marker)
      assert.ok(index >= 0, `脚部读数缺少 ${marker} —— 顺序契约对不上就是少了一类读数`)
      return index
    })
  for (let i = 1; i < positions.length; i += 1) {
    assert.ok(
      positions[i] > positions[i - 1],
      '脚部读数顺序必须与 READING_ORDER 一致（音轨构成 → 时长 → 分辨率 → 卡自带读数）',
    )
  }
})

/**
 * C2 · 镜号口径唯一。
 *
 * 画布卡上的 `#N` 与底部时间轴上的第 N 段必须是**同一个数**，包括用户拖拽重排
 * 之后。所以两处必须吃同一条 `isShotClip`（全仓唯一权威片段口径）+ 同一个
 * `deriveTimelineOrder` 顺序 —— 不允许任何一处再手写一份 `kind === 'video'`
 * 的筛选（CV-160 就是「同一规则三处内联、漏一条」出的事）。
 */
test('C4 守卫：玻璃只给详情面板 + 图层浮层，backdrop-filter 有配额', () => {
  // Q3 拍板：玻璃只给详情面板 + 图层浮层两处；minimap 常驻可见、背后多是空画布，
  // blur 收益最低且是持续合成开销，刻意不给。全表配额 3 = settings 遮罩（宿主
  // --dsw-mask-blur）+ 这两处。要加第四处，先在这里改配额并写明理由 —— 面积红线
  // （方案 §5-5）靠配额守，而不是靠每个人每次自觉。
  // 只数**声明**：@supports 的探测条件（backdrop-filter: blur(2px)）也是这个文本，
  // 先把它摘掉再数，否则配额永远多 1。
  const backdropDecls = codeOnly(STYLES_SRC)
    .replace(/@supports not \(backdrop-filter: blur\(2px\)\)/g, '')
    .match(/backdrop-filter:[^;]+/g) ?? []
  assert.equal(
    backdropDecls.length, 3,
    `backdrop-filter 声明只许 3 处（settings 遮罩 + 详情面板 + 图层浮层），现在 ${backdropDecls.length} 处`,
  )
  for (const decl of backdropDecls) {
    assert.match(decl, /var\(--dsw-mask-blur/, '模糊档位必须走宿主令牌 --dsw-mask-blur，不自造（3px/10px/14px 各写一遍迟早分叉）')
  }
  for (const selector of ['.csDetailPanel', '.csCanvasLayers']) {
    const body = ruleBody(STYLES_SRC, selector)
    assert.match(body, /backdrop-filter:\s*var\(--dsw-mask-blur/, `${selector} 必须用宿主模糊令牌，不自造档位`)
    assert.match(body, /color-mix\(in srgb, var\(--cs-float/, `${selector} 底必须从浮层令牌派生`)
    assert.match(body, /82%,\s*transparent\)/, `${selector} 底色必须半透明 —— 不透明底配 blur 是假玻璃`)
  }
  assert.doesNotMatch(ruleBody(STYLES_SRC, '.csMinimap'), /backdrop-filter/, 'minimap 不玻璃（Q3 拍板）')
  // blur 不可用的环境必须退回不透明底：半透明没模糊比不玻璃更难读。
  const supportsAt = STYLES_SRC.indexOf('@supports not (backdrop-filter')
  assert.ok(supportsAt >= 0, '必须有 blur 不可用时的不透明底兜底')
  const supportsBlock = STYLES_SRC.slice(supportsAt, supportsAt + 400)
  assert.ok(
    supportsBlock.includes('.csDetailPanel') && supportsBlock.includes('.csCanvasLayers'),
    '兜底必须覆盖两块玻璃',
  )
})

test('框选退场守卫：marquee 全链路不得复活（删除而非禁用）', () => {
  // 2026-09-12 拍板：框选整体退役 —— 空白左键=平移、单击空白=清选，按类型
  // 选择收进图层面板。这里守住「删除」语义：四个旧触点（Surface 手势、Node
  // 描边、geometry 判定、样式）任何一个重新出现 marquee 符号都算回归。
  const geometrySrc = readSrc('../src/canvas-geometry.ts')
  for (const [name, src] of [
    ['CanvasSurface.tsx', codeOnly(SURFACE_SRC)],
    ['CanvasNode.tsx', codeOnly(NODE_SRC)],
    ['canvas-geometry.ts', codeOnly(geometrySrc)],
    ['styles.ts', codeOnly(STYLES_SRC)],
  ]) {
    assert.doesNotMatch(src, /marquee|csNodeHit|hitPreview/i, `${name} 不得再出现框选符号`)
  }
})

test('选中态不可被交互态覆盖：伪类规则改描边/光晕必须让位给 .csNodeSelected', () => {
  // 2026-09-13 真机验收（CV-169）两起实测事故，都是**层叠特异度**问题：
  //   `.csNode:hover` (0,2,0) 打赢 `.csNodeSelected` (0,1,0) → 选中后鼠标一进
  //   卡片，紫边掉成灰线（实测 rgb(91,75,214) → rgba(15,17,23,.16)）；
  //   `.csNode:active` (0,2,0) 同理 → Ctrl 加选/拖缩放手把时，选中光晕被换成
  //   `--cs-shadow-2` 普通投影，看起来根本没选中。
  // 判据：任何 `.csNode:<伪类>` 规则里出现 border-color / box-shadow 时，
  // 选择器必须带 `:not(.csNodeSelected)`（背景/光标/filter 不受限）。
  const styles = codeOnly(STYLES_SRC)
  const ruleRe = /(^|\n)([^@\n{}][^{}\n]*)\{([^{}]*)\}/g
  const offenders = []
  let hit
  while ((hit = ruleRe.exec(styles)) !== null) {
    const selector = hit[2].trim().replace(/\s+/g, ' ')
    if (!/\.csNode:(hover|active|focus|focus-visible|focus-within)/.test(selector)) continue
    if (selector.includes(':not(.csNodeSelected)')) continue
    const body = hit[3]
    const steals = /(^|;)\s*(border-color|box-shadow)\s*:/.test(body)
    if (steals) offenders.push(selector)
  }
  assert.deepEqual(
    offenders, [],
    `这些交互态规则会顶掉选中外观，需加 :not(.csNodeSelected)：${offenders.join(' | ')}`,
  )
  // 反向锚点：让位写法必须真的存在（否则上面这条会因为「规则全被删掉」而假绿）。
  assert.match(styles, /\.csNode:hover:not\(\.csNodeSelected\)/, '悬停让位规则必须在')
  assert.match(styles, /\.csNode:active:not\(\.csNodeSelected\)/, '按住让位规则必须在')
})

test('缩放/连接把手几何：不得挂在卡片盒子外（overflow:hidden 会裁掉命中区）', () => {
  // 2026-09-13（CV-169）：把手原先用 -4px 负偏移跨在框上，而 `.csNode` 是
  // overflow:hidden —— 每个把手被裁掉一半，角把手再被 8px 圆角吃一块，
  // 实测 `.csNodeResizeSE` 的盒中心 elementFromPoint 命中的是画布表面：
  // 按右下角 = 「空白按下」→ 清空选区 + 平移。
  const styles = codeOnly(STYLES_SRC)
  const radii = [...styles.matchAll(/\.csNodeResize[A-Z]{1,2}\s*\{([^}]*)\}/g)]
  assert.ok(radii.length >= 8, `应找到 8 个缩放把手规则，实际 ${radii.length}`)
  for (const rule of radii) {
    const body = rule[1]
    for (const prop of ['top', 'right', 'bottom', 'left']) {
      const found = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*(-?[\\d.]+)px`))
      if (found === null) continue
      assert.ok(
        Number(found[1]) >= 0,
        `.csNodeResize* 的 ${prop} 不得为负（${found[1]}px）—— 负偏移会被 overflow:hidden 裁掉`,
      )
    }
  }
  assert.doesNotMatch(styles, /\.csNodeLinkHandle\s*\{[^}]*right:\s*-/, '连接把手也不得为负偏移')
})

test('C2 守卫：镜号与时间轴同源，片段筛选不得再出现手写副本', () => {
  const timeline = codeOnly(TIMELINE_SRC)
  const frame = codeOnly(FRAME_SRC)
  const node = codeOnly(NODE_SRC)
  assert.match(timeline, /import \{ isShotClip \} from '\.\.\/\.\.\/shot-versions\.js'/, '时间轴必须吃 isShotClip')
  assert.match(timeline, /const clips = displayed\.filter\(isShotClip\)/, '时间轴的片段序列必须直接 filter isShotClip')
  assert.ok(
    !/node\.retired !== true && node\.supersededBy === undefined/.test(timeline),
    '时间轴不得再手写片段判定 —— 那是 isShotClip 的第二份副本',
  )
  assert.match(frame, /isShotClip/, 'StudioFrame 必须用 isShotClip 派生镜号表')
  assert.match(frame, /shotIndexOf/, 'StudioFrame 必须派生 shotIndexOf 并注入画布')
  assert.ok(
    !/isShotClip\(/.test(node),
    'CanvasNode 不得自己筛片段算镜号 —— 镜号只允许由 StudioFrame 单点派生后传入',
  )
  assert.match(node, /shotIndex\?: number/, 'CanvasNode 必须通过 shotIndex 入参接收镜号')
})

test('C7 守卫：首屏「未开拍的现场」—— hero 消费 L1 底色，点阵与画布同参数', () => {
  const hero = ruleBody(STYLES_SRC, '.csLobbyHero')
  assert.match(hero, /--cs-canvas-bg-l1/,
    'hero 底色必须消费 --cs-canvas-bg-l1（D3 最后一个空转令牌在此退役；'
    + '若 C7 被重做，请给它找新的自然消费点或从 brand.ts 删除，不许塞回 DEAD_TOKEN_BASELINE）')
  // 双层点阵与 .csCanvasSurface 同款同参数：主格 120、细格 24。lobby 态画布隐藏，
  // hero 是首屏主体 —— 制图台语言必须一致，否则「现场」意象断裂。
  assert.match(hero, /--cs-canvas-grid-major/, 'hero 必须有画布同款主格点阵')
  assert.match(hero, /--cs-canvas-grid(?![\w-])/, 'hero 必须有画布同款细格点阵')
  assert.match(hero, /background-size:[^;]*120px 120px,\s*24px 24px/,
    '点阵尺寸必须与 .csCanvasSurface 同参数（120 主格 / 24 细格）')
  // 光晕层在最上（background-image 首层），且低透明度材料走 --cs-accent-soft。
  assert.match(hero, /background-image:\s*radial-gradient\([^;]*--cs-accent-soft/,
    'accent 光晕必须是 background-image 第一层（光落在点阵上，不是点阵压住光）')
})

test('C8 守卫：错误三级分级走 kind 修饰类，幽灵流水线静态且材料极淡', () => {
  // ① 三级色条各自挂在 kind 修饰类上（accent / gold / 宿主错误色），不允许三卡同貌。
  for (const [sel, token] of [
    ['.csErrorKindRetryable', '--cs-accent'],
    ['.csErrorKindConfig', '--cs-gold'],
  ]) {
    assert.match(ruleBody(STYLES_SRC, sel), new RegExp(`border-left:\\s*3px solid var\\(${token}`),
      `${sel} 必须有 3px 左缘色条（${token}）—— 三级分级靠它一眼可辨`)
  }
  assert.match(ruleBody(STYLES_SRC, '.csErrorKindUnreachable'), /border-left:\s*3px solid var\(--dsw-alias-state-error-primary/,
    '.csErrorKindUnreachable 必须用宿主错误色 —— 服务真挂了，是最严重一档')
  // ② 幽灵流水线：静态预演不挂动画（每次清空画布都闪 = 噪音）；站点虚线、终点 accent 收束。
  const ghost = ruleBody(STYLES_SRC, '.csGhostNode')
  assert.match(ghost, /dashed/, '幽灵站点必须是虚线胶囊（预演感）')
  assert.match(ghost, /--cs-accent-soft/, '幽灵站点底必须用 accent-soft 微光材料')
  assert.match(ruleBody(STYLES_SRC, '.csGhostPipeline'), /display:\s*flex/, '幽灵流水线必须是横向排布')
  assert.ok(!/\.csGhostPipeline[^{]*\{[^}]*animation/.test(STYLES_SRC), '幽灵流水线不得挂动画 —— 预演是常驻舞台指示')
  // ③ 组件侧：kind → 修饰类映射齐全，缺配置时主按钮切「打开设置」。
  assert.match(STATES_SRC, /csErrorKindConfig|csErrorKindUnreachable|csErrorKindRetryable/, '错误卡必须挂 kind 修饰类')
  assert.match(
    STATES_SRC, /className=\{isConfig && onOpenSettings !== undefined \? 'csErrorAction' : 'csErrorAction csErrorActionPrimary'\}/,
    '缺配置时重试必须降为次按钮（主行动是去设置）',
  )
  assert.match(STATES_SRC, /GHOST_PIPELINE_STAGES = \['分镜', '定妆', '镜头', '成片'\]/,
    '幽灵流水线四站必须与 DD-06 一致（分镜 → 定妆 → 镜头 → 成片）')
})

test('C9 守卫：窄窗降级走弹性栅格，不允许写死列宽回归', () => {
  const frame = ruleBody(STYLES_SRC, '.csFrame')
  // ① 三栏必须 minmax 弹性 —— 宿主窗口可拖到 schema 下限（640），写死 280px/480px
  //    会把画布挤成 140px 碎掉。宽窗口行为不变（280 / 1fr / 480 是上下限）。
  assert.match(frame, /grid-template-columns:\s*minmax\(200px,\s*280px\)\s*minmax\(320px,\s*1fr\)\s*minmax\(320px,\s*480px\)/,
    '.csFrame 三栏必须弹性收缩（200/320/320 下限），不得写死列宽')
  // ② 比三栏下限之和（840）更窄时横向滚动兜底 —— 布局不碎、内容不被裁。
  assert.match(frame, /min-width:\s*840px/, '.csFrame 必须有 840px 最小宽兜底（三栏下限之和）')
  assert.match(frame, /overflow-x:\s*auto/, '.csFrame 必须允许横向滚动兜底')
  // ③ 横向最脆弱的两行必须允许换行：审批条（图标/文案/输入/双按钮）与时间轴工具栏。
  assert.match(ruleBody(STYLES_SRC, '.csWorkflowApproval'), /flex-wrap:\s*wrap/, '审批条必须可换行')
  assert.match(ruleBody(STYLES_SRC, '.csTimelineToolbar'), /flex-wrap:\s*wrap/, '时间轴工具栏必须可换行')
})

/* ---------------------------------------------------------------------------
 * DD-08 / R8：`data-*` 驱动的样式分支必须真的挂到 DOM 上。
 *
 * 起因是一次真实事故。styles.ts 里写好了 `.csFrame[data-rail="strip"]` 的 56px
 * 栅格，StudioFrame 却只挂了 `data-mode` —— 于是收起左栏后栅格仍是 280px，
 * RailStrip 的 `width:100%` 撑满整条、40px 色块被 `align-items:center` 居中，
 * 表现为「收起了，但没收窄，左边一大片空白，画布一点没变大」。
 *
 * **渲染台抓不到这条**，这正是它最危险的形态：预览页是手写 HTML，属性是我自己
 * 补上的，32 条 computed-style 断言全绿 —— 样式全对，断的是接线。CSS 断言只能
 * 证明「规则写对了」，证明不了「规则被用上了」。所以补一条读 TSX 源码的静态配对。
 * ------------------------------------------------------------------------- */

const CLIENT_TSX = readdirSync(new URL('../src/client/', import.meta.url), { recursive: true })
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => codeOnly(readFileSync(new URL(`../src/client/${f}`, import.meta.url), 'utf8')))
  .join('\n')

/** 宿主（dsh）写在 html 元素上的属性，不由本仓的 .tsx 写入。 */
const HOST_INJECTED_DATA_ATTRS = new Set(['ds-dark-theme'])

/**
 * styles.ts 里出现的全部属性选择器名（`[data-*` 与 `[aria-*`，已剥注释）。
 * aria 一并纳入：`.csProjectGroupToggle[aria-expanded="false"] svg` 与 data-* 是
 * 同一类风险 —— 属性没写进 DOM，规则就是死的，而且**不报错、不警告、什么都不发生**。
 */
const STYLE_ATTR_SELECTORS = [...new Set(
  [...codeOnly(STYLES_SRC).matchAll(/\[(data-[a-z0-9-]+|aria-[a-z-]+)/g)].map((m) => m[1]),
)].sort()

test('DD-08 守卫：styles.ts 用的每个 [data-*] / [aria-*] 属性都必须真的有 .tsx 写它', () => {
  const missing = STYLE_ATTR_SELECTORS
    .filter((attr) => !HOST_INJECTED_DATA_ATTRS.has(attr))
    .filter((attr) => !CLIENT_TSX.includes(attr))
  assert.deepEqual(missing, [],
    `styles.ts 有属性分支，但没有任何 .tsx 写入该属性（规则永远不生效、且没有任何报错）：${missing.join(', ')}`)
  // 反向自证：属性名表本身非空，否则上面那条会因为「集合为空」而永远绿。
  assert.ok(STYLE_ATTR_SELECTORS.length >= 4, `解析到的属性选择器只有 ${STYLE_ATTR_SELECTORS.length} 个，守卫形同虚设`)
})

test('DD-08 / R8 守卫：收起态左栏走 56px 栅格，不是「撑满 280px 再居中」', () => {
  // ① 属性真的挂在 .csFrame 上（本次事故的根因）。
  assert.match(FRAME_SRC, /data-rail=\{railCollapsed \? 'strip' : 'full'\}/,
    'StudioFrame 的 .csFrame 必须挂 data-rail —— 否则 styles.ts 的条件分支全都是死规则')
  // ② 轨道宽度必须是 56px 的**第一列**：画布变大靠的是栅格收窄，不是内容变窄。
  const strip = ruleBody(STYLES_SRC, '.csFrame[data-rail="strip"]')
  assert.match(strip, /grid-template-columns:\s*56px\s+minmax\(320px,\s*1fr\)\s+minmax\(320px,\s*480px\)/,
    '收起态第一列必须是 56px 轨道（内容居中不改栅格，等于没收起）')
  // ③ min-width 同步下移 —— 否则收起反而多出一截横向滚动条。
  assert.match(strip, /min-width:\s*696px/, '收起态 min-width 必须降到 696px（56 + 320 + 320）')
})

/* ---------------------------------------------------------------------------
 * DD-09 / b：右栏（对话区）收起态。
 *
 * 与 R8 同一个模板 —— 先有事故才有这条：R8 的样式写好了、渲染台 32 条断言全绿，
 * 但 data-rail 根本没挂到 DOM，收起后左栏仍是 280px、色块居中、画布一点没变宽。
 * 右栏照抄一遍同样的检查，另外多两条右栏**特有**的风险：
 *   ① 对话区是一个滚动容器。用 display:none 藏会让浏览器把 scrollTop 归零 ——
 *      用户收起右栏再展开，对话跳回顶部，而收起本来就该是可逆动作。
 *   ② 收起态那条「脱离文档流」依赖 .csChat 当包含块，缺 position: relative 就会
 *      以视口为包含块，把对话区糊到整个窗口上（56px 列里看不出，展开才炸）。
 *
 * 反向验证（2026-09-14）：临时删掉 data-chat 属性 → ① 当场红；
 * 把 visibility 换成 display:none → ④ 当场红。不是假绿。
 * ------------------------------------------------------------------------- */

test('DD-09 / b 守卫：收起态右栏走 56px 栅格，且对话区不得被卸载或丢滚动位置', () => {
  // ① 属性真的挂在 .csFrame 上（R8 事故的根因，右栏同款）。
  assert.match(FRAME_SRC, /data-chat=\{chatCollapsed \? 'strip' : 'full'\}/,
    'StudioFrame 的 .csFrame 必须挂 data-chat —— 否则右栏收起的分支全是死规则')
  // ② 第三列压成 56px 轨道，min-width 同步下移（200 + 320 + 56 = 576）。
  const strip = ruleBody(STYLES_SRC, '.csFrame[data-chat="strip"]')
  assert.match(strip, /grid-template-columns:\s*minmax\(200px,\s*280px\)\s+minmax\(320px,\s*1fr\)\s+56px/,
    '收起态第三列必须是 56px 轨道（只藏内容不改栅格，画布一点没变宽）')
  assert.match(strip, /min-width:\s*576px/, '收起态 min-width 必须降到 576px（200 + 320 + 56）')
  // ③ 两栏同时收起是唯一需要显式写出的组合；lobby 那条必须仍然赢（第三列回 0px）。
  const both = ruleBody(STYLES_SRC, '.csFrame[data-rail="strip"][data-chat="strip"]')
  assert.match(both, /grid-template-columns:\s*56px\s+minmax\(320px,\s*1fr\)\s+56px/,
    '两栏同时收起必须是 56 / 1fr / 56')
  assert.match(both, /min-width:\s*432px/, '两栏同时收起的 min-width 必须降到 432px')
  const bothAt = STYLES_SRC.indexOf('.csFrame[data-rail="strip"][data-chat="strip"] {')
  const lobbyAt = STYLES_SRC.indexOf('.csFrame[data-rail="strip"][data-mode="lobby"]')
  assert.ok(bothAt >= 0 && lobbyAt >= 0 && bothAt < lobbyAt,
    '「两栏收起」规则必须写在「左栏收起 + lobby」之前 —— 两者特异度同为 0,3,0，'
    + '平手靠源码顺序决出，lobby 必须赢（第三列回 0px，否则中栏聊天被挤进 56px 缝里）')
  // ④ 对话区不得被 display:none 藏（滚动位置归零，收起就不可逆了）。
  const conversation = ruleBody(STYLES_SRC, '.csFrame[data-chat="strip"] .csConversation')
  assert.ok(conversation.length > 0, '收起态必须有 .csConversation 的处理规则')
  assert.doesNotMatch(conversation, /display:\s*none/,
    '收起态不得用 display:none 藏对话区 —— 滚动容器一旦离开布局，scrollTop 归零，'
    + '用户收起再展开会跳回对话顶部')
  assert.match(conversation, /position:\s*absolute/, '收起态对话区必须脱离文档流（否则撑破 56px 列）')
  assert.match(conversation, /visibility:\s*hidden/, '收起态对话区必须不可见（但保留布局与滚动位置）')
  assert.match(conversation, /width:\s*480px/,
    '收起态对话区必须写死 480px（右栏上限）—— 尺寸被压扁会让内部布局重排、滚动位置漂移')
  // ⑤ 绝对定位的包含块：.csChat 必须相对定位（缺了会以视口为包含块）。
  assert.match(ruleBody(STYLES_SRC, '.csChat'), /position:\s*relative/,
    '.csChat 必须是 .csConversation 的包含块（相对定位）')
  // ⑥ 收起态确实渲染竖条，且竖条消费了阶段数据（不是一片死白）。
  assert.match(FRAME_SRC, /chatCollapsed && \([\s\S]{0,160}?<ChatStrip/,
    '收起态必须渲染 ChatStrip —— 56px 里没有「点回展开」的落点，收起就成了单向门')
  const chatStrip = codeOnly(readFileSync(new URL('../src/client/ChatStrip.tsx', import.meta.url), 'utf8'))
  assert.match(chatStrip, /WORKFLOW_STAGE_LABELS\.map/,
    'ChatStrip 必须消费六段轨道数据（与审批条同源，不新增阶段模型）')
})

/* ---------------------------------------------------------------------------
 * DD-09 / c：制作阶段胶囊 —— CV-179 起**撤出会话头**、并入输入区读数带。
 *
 * 这一节守的东西与它搬家前不同了，两件事都要守：
 *
 *   ① **它不许回会话头**。撤出的理由是可复算的：宿主 `.headerUtilities` 是
 *      `flex: none`、标题簇是 `flex: 1; min-width: 0`，标题只能被压，且 `.crumb`
 *      硬上限 220px。胶囊占 133px → 标题只剩约 93px（实测只显示三字）。撤走后
 *      标题可用宽度回到 ~234px ≥ 所需 ~202px。谁要是把它加回会话头，渲染台上
 *      「标题不被截」那条断言会红；这里再钉一道源码闸，两道都指得回根因。
 *   ② **它退化成纯展示**。判定已经收口到 `deriveProjectContextView` 一处，胶囊
 *      自己再订阅 store / 再判一次阶段就是第二份判定（本仓老账，必漂移）。
 *
 * 槽名与「list 槽必须给 id」由 host-boundary.test.mjs 的「宿主槽必需项」守卫兜，
 * 这里不重复（那里的判据是宿主契约，这里的判据是本仓的接线与样式）。
 * ------------------------------------------------------------------------- */

const INDEX_SRC = codeOnly(readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8'))
const STAGE_CHIP_SRC = codeOnly(readFileSync(new URL('../src/client/StageChip.tsx', import.meta.url), 'utf8'))

/** 胶囊用到的类名 —— 组件与样式表必须两边都在。 */
const STAGE_CHIP_CLASSES = [
  'csStageChip',
  'csStageChipDot',
  'csStageChipLabel',
  'csStageChipProgress',
  'csStageChipMode',
  'csStageChipPending',
]

test('CV-179 守卫：插件不得再往会话头注册元素（它会挤掉宿主的会话标题）', () => {
  assert.doesNotMatch(
    INDEX_SRC,
    /conversation\.session\.header\.utilities/,
    '会话头 utilities 是 `flex: none`，标题簇是 `flex: 1; min-width: 0` —— 往里塞'
      + '任何元素都是从宿主标题嘴里抢宽度（实测胶囊占 133px 时标题只剩三字）。'
      + '阶段读数请挂在输入区读数带（ProjectContextBar）。',
  )
  assert.doesNotMatch(
    INDEX_SRC,
    /canvas-studio-stage/,
    '旧的会话头注册 id 必须一并消失 —— 留着会让后来者以为那里仍然挂着东西',
  )
})

test('CV-179 守卫：阶段胶囊是纯展示组件（判定只准在纯函数里）', () => {
  // ① 它只收模型：不订阅 store、不声明注入面。
  assert.match(STAGE_CHIP_SRC, /StageChipProps/, '胶囊必须有明确的 props 类型（只剩 view）')
  assert.match(STAGE_CHIP_SRC, /StageChipView/, '胶囊必须消费 stage-chip.ts 的模型类型')
  assert.doesNotMatch(
    STAGE_CHIP_SRC,
    /useStudio|InjectFace|use[A-Z]/,
    '胶囊不得再自己订阅 store —— 模型由 deriveProjectContextView 一处给出',
  )
  // ② 阶段判定只准复用，不许自算。
  assert.doesNotMatch(
    STAGE_CHIP_SRC,
    /deriveStageChipView|workflow\.state|approvalPending/,
    '胶囊里不得出现阶段判定 —— 那是 stage-chip.ts 的事（第二份判定必然与审批条漂移）',
  )
  // ③ 模式短词仍走唯一实现（放手跑 / 逐步确认 这两个词只在一处定义）。
  assert.match(STAGE_CHIP_SRC, /modeShortLabel/, '模式短词必须复用 stage-chip.ts 的实现')
})

test('DD-09 / c 守卫：阶段胶囊的类名与样式双向配对（有类无规则 = 裸文本）', () => {
  const missingRule = STAGE_CHIP_CLASSES.filter((cls) => ruleBody(STYLES_SRC, `.${cls}`) === '')
  assert.deepEqual(missingRule, [], `组件用了这些类名但 styles.ts 没有对应规则：${missingRule.join(', ')}`)
  // 匹配必须**按整词**（两侧不得是 [A-Za-z0-9_-]）：初版写成 src.includes(cls)，
  // 把 csStageChipProgress 改名成 csStageChipProgressX 之后仍然「包含」原串 ——
  // 反向验证时当场是绿的（假绿）。同一形态的坑在这个仓库已出现多次：凡「断言某
  // 名字存在 / 不存在」，都要先想清楚它会不会被更长的名字包含。
  const usesClass = (cls) =>
    new RegExp(`(^|[^A-Za-z0-9_-])${cls}([^A-Za-z0-9_-]|$)`).test(STAGE_CHIP_SRC)
  const unusedClass = STAGE_CHIP_CLASSES.filter((cls) => !usesClass(cls))
  assert.deepEqual(unusedClass, [], `styles.ts 有这些规则但组件从不用：${unusedClass.join(', ')}`)
  // 反向自证：清单非空，否则上面两条会因为「集合为空」而永远绿。
  assert.ok(STAGE_CHIP_CLASSES.length >= 5, '类名清单是空的，守卫形同虚设')
})

/* -------------------------------------------------------------------------
 * DD-09 / d：输入区「项目上下文条」—— 接线守卫
 *
 * 与 c 批同型（同一套理由）：渲染台能证明「产品样式写对了」，证明不了
 * 「这块 UI 真的挂到了宿主槽上、用的是真判定」。槽选型也必须钉住 ——
 * 宿主把两个位置分了工（input.dock = 卡片上方的整行，给换行 / 带正文的内容；
 * composer.dock = 卡片下方的**环境读数**位，自带 stats 行在那），选错不会报错，
 * 只会让读数落在错的地方 —— 这类错误渲染台与类型系统都看不见。
 *
 * CV-179 起这条带子同时承载**阶段胶囊**（原会话头 utilities 那个）。所以本节多守
 * 两件事：胶囊真的被这条带子渲染出来（它撤出会话头后只住这里），以及三个入参
 * 一个不漏（少传 workflow / nodes 的表现是「阶段永远不出现」，静默失效）。
 * ------------------------------------------------------------------------- */

const PROJECT_CONTEXT_BAR_SRC = codeOnly(readFileSync(new URL('../src/client/ProjectContextBar.tsx', import.meta.url), 'utf8'))

/** 上下文条用到的类名 —— 组件与样式表必须两边都在。 */
const PROJECT_CONTEXT_CLASSES = [
  'csContextBar',
  'csContextBarName',
  'csContextBarSpec',
  'csContextBarSep',
]

test('DD-09 / d 守卫：输入区读数带真的接上了宿主槽（样式对了不等于接上了）', () => {
  // ① 注册这一步真的做了，挂的是 composer.dock（**不是** input.dock）且挂对了组件。
  assert.match(INDEX_SRC, /slots\.inject\(\s*'conversation\.composer\.dock'/,
    'index.ts 必须把读数带注册进 conversation.composer.dock（input.dock 是卡片上方的整行，语义不同）')
  assert.doesNotMatch(INDEX_SRC, /slots\.inject\(\s*'conversation\.input\.dock'/,
    'input.dock 是「卡片上方、给会换行 / 带正文的内容」那一格；读数带归 composer.dock')
  assert.match(INDEX_SRC, /},\s*ProjectContextBar\)/,
    '该槽的 occupant 必须是 ProjectContextBar 组件（槽注册了但挂错组件 = 什么都不出）')
  // ② list 槽必须给 id；排位固定（比宿主 stats 行的 order 0 更靠前，紧贴输入卡）。
  assert.match(INDEX_SRC, /id:\s*'canvas-studio-project'/, 'list 槽的 id 必须固定（缺了运行时会抛）')
  assert.match(INDEX_SRC, /order:\s*-10,/, '排位变了会让读数带与 stats 行的上下关系翻转')
  // ③ 数据走与 StudioFrame 同一个 store 实例 —— 第二份状态必然两处不一致。
  assert.match(INDEX_SRC, /inject:\s*\(\)\s*=>\s*\(\{\s*hooks:\s*\{\s*studio:\s*storeInstance\s*\}\s*\}\)/,
    '读数带必须从同一个 storeInstance 取数')
  // ④ 未选项目时一个 DOM 都不出：宿主那条读数带靠空态折叠，渲染空壳会留一道空白。
  assert.match(PROJECT_CONTEXT_BAR_SRC, /if \(view === null\) return null/,
    'context bar 必须在无项目时 return null（空壳会让宿主折叠失效）')
  // ⑤ 判定只准在纯函数里：组件不得自己读 projects / plan 字段做判断。
  assert.match(PROJECT_CONTEXT_BAR_SRC, /deriveProjectContextView/,
    '必须用 project-context.ts 的判定（第二份判定必然与左栏副行漂移）')
  assert.doesNotMatch(PROJECT_CONTEXT_BAR_SRC, /planSummaryOf|suggestShotCount|\.plan\?\./,
    '组件里不得再拼规格摘要 / 建议镜头数 —— 那是 project-context.ts 的事')
  // ⑥ CV-179：阶段胶囊搬进来了 —— 它撤出会话头后的**唯一出口**，漏了就等于
  //    「读数带没有阶段、会话头也没有」，两边都没有却谁都不报错。
  assert.match(PROJECT_CONTEXT_BAR_SRC, /import \{ StageChip \} from '\.\/StageChip\.js'/,
    '读数带必须渲染 StageChip（胶囊撤出会话头后只住在这里）')
  assert.match(PROJECT_CONTEXT_BAR_SRC, /<StageChip view=/,
    '胶囊必须拿到纯函数给的模型，不许自己订阅 store')
  assert.match(PROJECT_CONTEXT_BAR_SRC, /view\.stage === null \? null :/,
    '工作流未载入时不渲染胶囊（不塞空壳）')
  // ⑦ 三个入参一个都不能漏：少传 workflow / nodes 时纯函数不报错，只是阶段永远是
  //    `null` —— 典型的静默失效，所以在这里钉住调用形态本身。
  assert.match(PROJECT_CONTEXT_BAR_SRC, /deriveProjectContextView\(project, workflow, nodes\)/,
    '必须把 workflow 与 nodes 一起交给纯函数 —— 漏传的表现是「阶段胶囊永远不出现」')
})

test('DD-09 / d 守卫：上下文条类名与样式双向配对（有类无规则 = 裸文本）', () => {
  const missingRule = PROJECT_CONTEXT_CLASSES.filter((cls) => ruleBody(STYLES_SRC, `.${cls}`) === '')
  assert.deepEqual(missingRule, [], `组件用了这些类名但 styles.ts 没有对应规则：${missingRule.join(', ')}`)
  // 整词匹配，理由与 c 批完全相同：`csContextBar` 会被 `csContextBarName` 包含，
  // 用 includes 判存在时改名照样是绿的（假绿）。
  const usesClass = (cls) =>
    new RegExp(`(^|[^A-Za-z0-9_-])${cls}([^A-Za-z0-9_-]|$)`).test(PROJECT_CONTEXT_BAR_SRC)
  const unusedClass = PROJECT_CONTEXT_CLASSES.filter((cls) => !usesClass(cls))
  assert.deepEqual(unusedClass, [], `styles.ts 有这些规则但组件从不用：${unusedClass.join(', ')}`)
  assert.ok(PROJECT_CONTEXT_CLASSES.length >= 4, '类名清单是空的，守卫形同虚设')
})

/* ---------------------------------------------------------------------------
 * CV-181 / E-3：整屏欢迎卡的死样式必须保持删除状态 —— 且**只能删到该删的地方**。
 *
 * 桌面验收 E 区报「欢迎卡浮层没看到」。查下来不是没生效，是**从来没接上**：
 * `.csWelcome` / `Card` / `Title` / `NameZh` / `Tagline` / `Positioning` / `Actions`
 * 及 `SampleHint` 只有 styles.ts 定义，全仓没有任何 JSX 消费方 —— DD-06 当时只做了
 * 令牌化（把硬编码换成 --cs-float / --cs-shadow-3），组件层从没渲染过整屏欢迎卡。
 *
 * 注意本条的后半段：`.csWelcomeSample` 是**活的**（LobbyHero.tsx 经 `.csLobbyActions`
 * 作用域在用），它只是恰好和死样式共用前缀。只守「死类不在」会把这条边界漏掉，
 * 下次有人顺手把整族删干净 —— 示例项目按钮当场裸奔。
 * ------------------------------------------------------------------------- */
const DEAD_WELCOME_CLASSES = [
  'csWelcome',
  'csWelcomeCard',
  'csWelcomeTitle',
  'csWelcomeNameZh',
  'csWelcomeTagline',
  'csWelcomePositioning',
  'csWelcomeActions',
  'csWelcomeSampleHint',
]

test('CV-181 / E-3 守卫：整屏欢迎卡的死样式必须保持删除（且不得误删活类 csWelcomeSample）', () => {
  // 整词匹配：`csWelcome` 会被 `csWelcomeSample` 包含，用 includes 判存在/不存在
  // 两边都会误判（这个坑本仓已踩过多次，见 DD-09 / c 批的注释）。
  const wholeWord = (cls) => new RegExp(`(^|[^A-Za-z0-9_-])${cls}([^A-Za-z0-9_-]|$)`)
  const resurrected = DEAD_WELCOME_CLASSES.filter((cls) => wholeWord(cls).test(STYLES_SRC))
  assert.deepEqual(
    resurrected,
    [],
    `这些类没有任何 JSX 消费方，规则留着会让人以为欢迎卡存在：${resurrected.join(', ')}`,
  )

  // 反方向的边界：活类必须还在，且消费方必须真的在用。
  // 断言的是 **`.csLobbyActions` 作用域那条**（唯一存活形态）—— 写 `.csWelcomeSample`
  // 会被它包含，等于没守住「真消费方那条规则」。
  assert.match(
    STYLES_SRC,
    /\.csLobbyActions \.csWelcomeSample\s*\{/,
    'csWelcomeSample 是活类（LobbyHero 经 .csLobbyActions 消费）—— 删了示例项目按钮就裸奔',
  )
  const lobbyHero = readFileSync(new URL('../src/client/LobbyHero.tsx', import.meta.url), 'utf8')
  assert.match(lobbyHero, /csWelcomeSample/, 'LobbyHero 必须仍是 csWelcomeSample 的消费方')
})

/* ===========================================================================
 * CV-182：新建项目对话框精修 + 播放弹窗标题栏复归（DD-10 / A 批）
 *
 * ## 这一批真正的技术内容是一个**回归**
 *
 * 题目报的是「新建页面不够好看」，落地时查出旁边躺着一处更严重的问题：
 * `.csModalHeader` / `.csModalClose` 在提交 df8ad3b2b5 里被写成 `display: none`
 * —— 当时把它们当「legacy 类名」关掉了。可它们不是 legacy：三个播放弹窗
 * （VideoPlayerModal / AudioPlayerModal / ImagePreviewModal）的标题与关闭按钮
 * 全挂在上面。用户看片时既不知道在看哪条（没有标题）、也关不掉（只能点遮罩），
 * 而 VideoPlayerModal 的 max-height 注释还明写「扣除标题栏(49)」——那 49px
 * 一直预留、从来没画出来。新对话框「不想要标题栏」的做法是**关掉一个全局类**，
 * 于是连带关掉了别人。
 *
 * 所以守卫守两件事，缺一不可：
 *   ① 那两个类**不许再被关掉**（正向：必须可见，且必须真有消费方）；
 *   ② 新建对话框**不许再回挂共享类**（反向：它是「第二处消费方」，正是当年
 *      出错的那一步 —— 只守 ① 的话，下次有人重新引入「关全局」，① 会红但
 *      指不到原因；只守 ② 的话，别人先关掉全局类、再给新对话框挂上，仍然全绿）。
 * ======================================================================== */

const PROJECT_LIST_SRC = codeOnly(readFileSync(new URL('../src/client/ProjectList.tsx', import.meta.url), 'utf8'))

/** 播放弹窗（`.csModalHeader` / `.csModalClose` 的真实消费者）。 */
const MEDIA_MODAL_FILES = [
  'canvas/VideoPlayerModal.tsx',
  'canvas/AudioPlayerModal.tsx',
  'canvas/ImagePreviewModal.tsx',
]

test('CV-182 回归守卫：播放弹窗的标题栏与关闭键不得再被 display:none 关掉', () => {
  for (const sel of ['.csModalHeader', '.csModalClose']) {
    const body = ruleBody(STYLES_SRC, sel)
    assert.notEqual(body, '', `${sel} 规则被整条删了 —— 三个播放弹窗的标题/关闭键会一起消失`)
    assert.doesNotMatch(
      body,
      /display:\s*none/,
      `${sel} 又被关成 display:none 了。它不是 legacy：三个播放弹窗都在用`
      + '（df8ad3b2b5 就是这么把弹窗标题一起关掉的）',
    )
  }
  assert.match(ruleBody(STYLES_SRC, '.csModalHeader'), /display:\s*flex/,
    '标题栏必须是真正的布局行（它撑起 VideoPlayerModal 注释里预留了 49px 的那一格）')
  assert.match(ruleBody(STYLES_SRC, '.csModalClose'), /width:\s*28px/,
    '关闭键必须是 28px 的实体按钮 —— 没有它用户只能点遮罩关闭')

  // 光有样式不算：三个弹窗必须**还在消费**这两个类，否则「复归」是空话。
  for (const rel of MEDIA_MODAL_FILES) {
    const src = readFileSync(new URL(`../src/client/${rel}`, import.meta.url), 'utf8')
    assert.match(src, /csModalHeader/, `${rel} 必须仍用 csModalHeader 画标题栏`)
    assert.match(src, /csModalClose/, `${rel} 必须仍用 csModalClose 画关闭键`)
  }
})

test('CV-182 守卫：新建对话框走独立类，不得再回挂共享的 csModalHeader', () => {
  // 反向：这是当年出差错的那一步 —— 「我不想要标题栏」于是去关掉一个全局类。
  assert.doesNotMatch(
    PROJECT_LIST_SRC,
    /csModalHeader/,
    '新建对话框必须用自己的 csCreateHead / csCreateClose（共用类再关一次 = 又关掉三个播放弹窗）',
  )
  assert.match(PROJECT_LIST_SRC, /csCreateHead/, '新建对话框的标题栏必须是 csCreateHead')
  assert.match(PROJECT_LIST_SRC, /csCreateClose/, '新建对话框的关闭键必须是 csCreateClose')
})

test('CV-182 守卫：两个封闭小集合下拉改成 chip 组，选中态读 aria-pressed', () => {
  // ① 画幅 / 目标时长是**封闭小集合**（各 5 枚：画幅 不锁定/16:9/9:16/1:1；
  //    时长 不锁定/15/30/60/自定义）→ 一眼看全 + 一点即选，
  //    不再要求「展开 → 瞄一眼 → 点下来」。
  assert.match(PROJECT_LIST_SRC, /csChoiceRow/, '画幅 / 时长必须是 chip 组，不是原生 select')
  // ② 选中是**语义**：读 aria-pressed 而不是再挂一个 csChoiceActive 类。
  //    类 + 属性两份来源必然漂移（本仓的「状态类 + 同属性 inline = 死代码」同款）。
  assert.match(PROJECT_LIST_SRC, /aria-pressed=/, 'chip 的选中态必须照进 aria-pressed')
  assert.match(ruleBody(STYLES_SRC, ".csChoice[aria-pressed='true']"), /--cs-accent\b/,
    "选中态样式只允许挂在 .csChoice[aria-pressed='true'] 上 —— 挂自定义类会与属性脱钩")
  assert.doesNotMatch(
    STYLES_SRC,
    /\.csChoice(Active|Selected|On)\b/,
    '不得为 chip 选中态另造类名：选中态的唯一来源是 aria-pressed',
  )

  // ③ 分组下拉仍是原生 select（选项数不定，列表语义对），但外观自绘：
  //    原生箭头各平台不同（macOS 那个蓝箭头尤其抢戏），故关掉 appearance 自绘。
  const selectInBox = ruleBody(STYLES_SRC, '.csSelectBox .csFieldSelect')
  assert.match(selectInBox, /appearance:\s*none/, '字段盒里的下拉必须关掉原生外观（箭头自绘）')
  assert.match(PROJECT_LIST_SRC, /csSelectChev/, '关掉 appearance 后必须有自绘箭头，否则看不出是下拉')
  assert.match(PROJECT_LIST_SRC, /csSelectIcon/, '字段盒左侧必须有图标（emoji 换内联 SVG，跨平台字形不再是变量）')
  assert.doesNotMatch(PROJECT_LIST_SRC, /📁|🎬|⚙/, '图标必须内联 SVG，不得回退成 emoji')

  // ④ 「三个字段的盒高一致」靠的是**纵向 padding 对齐**，不是靠巧合：
  //    高度账 = padding×2 + 内容高 + 2px 描边。输入框自己出描边，字段盒由外盒
  //    出描边，所以盒内控件的 padding 必须与输入框**相等**（各 1px 的描边正好
  //    互换）。渲染台实测抓到过一版写成 8px 的：盒比输入框高 2px，三个字段的
  //    右边缘在同一条竖线上错开。
  const inputPad = /padding:\s*([\d.]+)px/.exec(ruleBody(STYLES_SRC, '.csFieldInput'))?.[1]
  const selectPad = /padding:\s*([\d.]+)px/.exec(selectInBox)?.[1]
  assert.ok(inputPad !== undefined && selectPad !== undefined,
    '两处 padding 都要写明 px —— 高度账靠它对齐，不许留给默认值')
  assert.equal(selectPad, inputPad,
    `.csFieldInput 的纵向 padding 是 ${inputPad}px，盒内控件是 ${selectPad}px —— `
    + '不相等时字段盒与输入框差 2px（描边只出一次），三个字段的盒边会对不齐')
})

test('CV-182 守卫：新建对话框的类名与样式双向配对（有类无规则 = 裸文本）', () => {
  // 有自己那条规则的类。`.csCreateForm` 不在其中：它是**作用域**（`.csCreateForm
  // .csFieldLabel` 这一族共用字段材料的收敛点），本身只挂不画 —— 拿它当「必须
  // 有独立规则」来断言会把正确的写法判成错的。它的存在性单独断言在下面。
  const classes = [
    'csCreateModal',
    'csCreateHead',
    'csCreateHeadText',
    'csCreateSub',
    'csCreateClose',
    'csSelectBox',
    'csSelectIcon',
    'csSelectChev',
    'csChoiceRow',
    'csChoice',
    'csChoiceMain',
    'csChoiceSub',
    'csCreateInlineInput',
    'csCreateNote',
  ]
  const wholeWord = (cls) => new RegExp(`(^|[^A-Za-z0-9_-])${cls}([^A-Za-z0-9_-]|$)`)
  const missingRule = classes.filter((cls) => ruleBody(STYLES_SRC, `.${cls}`) === '')
  assert.deepEqual(missingRule, [], `组件用了这些类名但 styles.ts 没有对应规则：${missingRule.join(', ')}`)
  const unused = classes.filter((cls) => !wholeWord(cls).test(PROJECT_LIST_SRC))
  assert.deepEqual(unused, [], `styles.ts 有这些规则但组件从不用：${unused.join(', ')}`)

  // 作用域类：必须真被用作后代前缀（本批的观感调整全部收敛在它之下，不下沉到
  // 与设置弹窗共用的 .csFieldLabel / .csFieldInput —— 那是一片已验收区域）。
  assert.match(STYLES_SRC, /\.csCreateForm \.csField(Label|Input)/,
    '新建对话框的字段材料必须收敛在 .csCreateForm 作用域下，不得直接改共享的 .csField*')
  assert.match(PROJECT_LIST_SRC, /csModalBody csCreateForm/, '表单容器必须同时挂 csCreateForm（作用域前缀）')

  // 立柱：标题栏与输入区读数带（.csContextBar::before）是同一套「场记板」语言，
  // 两处都是 2px / radius 1px。分开写但不许漂成两套。
  assert.match(ruleBody(STYLES_SRC, '.csCreateHead::before'), /width:\s*2px/,
    '标题栏立柱必须是 2px（与 .csContextBar::before 同宽）')
  assert.ok(classes.length >= 14, '类名清单是空的，守卫形同虚设')
})

/* ===========================================================================
 * DD-10：首屏「跟正式画布和谐」（B 批）
 *
 * 题目里的「不和谐」不是宿主那张 hero 头像（`.csLobbyHero` 早就用了画布语言），
 * 而是**我们自己那张对话卡**：`.csChat` 在 lobby / lobby-pending 态是一个
 * 1px 描边的白盒子（--dsw-alias-bg-layer-1），摆在已经铺了点阵、打了 accent
 * 光晕的品牌条下面 —— 同一屏两张材质不同的面，读起来像两个产品。
 *
 * 修法不是「调个颜色」：把卡换成与 `.csLobbyHero` / `.csCanvasSurface` 同一份
 * 配方（L1 底色 + 顶部 accent 光晕 + 120/24 双层点阵）。材质一统一，「制作台
 * 摊开一张画布」的意象才连得上，卡里的输入框也才像是「画布上的第一笔」。
 *
 * 注意底色用的是 --cs-canvas-bg-l1 而不是 --cs-canvas-bg：**画布本体必须是最深
 * 一档**（DD-02 的断言），卡片是「画布的内容面」，得亮一档。
 * ======================================================================== */

test('DD-10 守卫：首屏对话卡走画布材质，参数与 .csLobbyHero / .csCanvasSurface 同源', () => {
  // 两态共用**同一条规则**（组选择器里 lobby 在前、lobby-pending 在后）。
  // 断言要用后面那项取规则体：组选择器里只有**最后一项**紧邻左花括号，
  // ruleBody 对前一项永远取不到（它后面跟的是逗号）—— 这个坑写在这里，别再踩。
  assert.match(
    STYLES_SRC,
    /\.csFrame\[data-mode="lobby"\] \.csChat,\s*\n\s*\.csFrame\[data-mode="lobby-pending"\] \.csChat\s*\{/,
    'lobby 与 lobby-pending 必须共用同一条卡片规则（只改一态 = 另一态退回裸盒子）',
  )
  const body = ruleBody(STYLES_SRC, '.csFrame[data-mode="lobby-pending"] .csChat')
  assert.notEqual(body, '', '对话卡的画布材质规则不见了 —— 卡片会退回 1px 描边的白盒子')
  assert.match(body, /--cs-canvas-bg-l1/, '卡片必须消费 --cs-canvas-bg-l1（比画布本体亮一档）')
  assert.doesNotMatch(body, /--cs-canvas-bg(?![\w-])/,
    '卡片不得直接用最深的画布底色 —— 「画布必须是最深一档」是 DD-02 的硬约束')
  assert.match(body, /--cs-canvas-grid-major/, '卡片必须有画布同款主格点阵')
  assert.match(body, /--cs-canvas-grid(?![\w-])/, '卡片必须有画布同款细格点阵')
  assert.match(body, /background-size:[^;]*120px 120px,\s*24px 24px/,
    '点阵尺寸必须与 .csCanvasSurface / .csLobbyHero 同参数（120 主格 / 24 细格）')
  assert.match(body, /background-image:\s*radial-gradient\([^;]*--cs-accent-soft/,
    '光晕必须是 background-image 第一层（光落在点阵上，不是点阵压住光）')
  assert.match(body, /--cs-line(?![\w-])/, '卡片的描边要走 --cs-line（画布线），不是宿主 border 令牌')
})

test('DD-10 守卫：开拍前条真的接在 lobby-pending 的中栏首行（样式对了不等于接上了）', () => {
  // ① 组件存在且被 import —— 「写了组件但没渲染」是本仓 R8 事故的经典形态。
  assert.match(FRAME_SRC, /import \{ SlateBar \} from '\.\/SlateBar\.js'/,
    'StudioFrame 必须 import SlateBar')
  // ② 挂在**没有对话**的那一支上：lobby-pending 原本 `return null`，
  //    不改这一支的话组件永远不会渲染（而 CSS 与单测都会是绿的）。
  assert.match(
    FRAME_SRC,
    /if \(!hasConversation\) \{\s*return slateView === null \? null : <SlateBar view=\{slateView\} \/>/,
    '开拍前条必须渲染在 !hasConversation（lobby-pending）分支里，且拿到纯函数给的模型',
  )
  // ③ 模型来自与输入区读数带**同一个判定入口**，且三个入参一个不漏
  //    （漏传 workflow / nodes 的表现是「阶段永远不出现」，静默失效）。
  assert.match(FRAME_SRC, /deriveProjectContextView\(slateProject, workflow, nodes\)/,
    '开拍前条必须复用 deriveProjectContextView，并把 workflow / nodes 一起交进去')
  assert.match(FRAME_SRC, /store\.selectedProjectId === null[\s\S]{0,120}?store\.projects\.find/,
    '项目对象要从 store 里**已有的引用**里取（现造对象 = 常驻重渲染）')

  // ④ 组件侧：纯展示，判定一律不在这里（判定留在 .tsx 里就只能靠渲染台测）。
  //    **必须剥注释再断言**：SlateBar.tsx 的头注本身就写着「本文件不读 workflow.state」
  //    —— 不剥注释的话，一条完全正确的注释会让「不得自己判阶段」当场红。
  const slate = readFileSync(new URL('../src/client/SlateBar.tsx', import.meta.url), 'utf8')
  const slateCode = codeOnly(slate)
  assert.doesNotMatch(slateCode, /useStudio|useStore|store\./,
    '开拍前条是纯展示组件，不得自己订阅 store（判定在 project-context.ts）')
  assert.doesNotMatch(slateCode, /workflow\.state|toolName|isShotClip/,
    '开拍前条不得自己判阶段 —— 阶段由 view.stage 给（内部走 stage-chip.ts）')
  assert.match(slateCode, /specPartsOf/, '规格段必须复用 specPartsOf（两处各拼一份必然漂移）')
  assert.match(slateCode, /contextTitleOf/, '悬浮文案必须复用 contextTitleOf')
  assert.match(slateCode, /SLATE_COPY/, '文案（待开拍 / 规格待定）必须走 brand-copy.ts，不得在 JSX 里写死')
  assert.match(slateCode, /import \{ StageChip \} from '\.\/StageChip\.js'/,
    '开拍前条必须渲染 StageChip —— 它是胶囊在首屏的唯一出口')
  assert.match(slateCode, /view\.stage === null \? null :/, '工作流未载入时不渲染胶囊（不塞空壳）')
})

test('DD-10 守卫：开拍前条的类名与样式双向配对', () => {
  const classes = ['csSlateBar', 'csSlateTag', 'csSlateName', 'csSlateSpec', 'csSlateSep', 'csSlateSpacer']
  const slate = codeOnly(readFileSync(new URL('../src/client/SlateBar.tsx', import.meta.url), 'utf8'))
  const wholeWord = (cls) => new RegExp(`(^|[^A-Za-z0-9_-])${cls}([^A-Za-z0-9_-]|$)`)
  const missingRule = classes.filter((cls) => ruleBody(STYLES_SRC, `.${cls}`) === '')
  assert.deepEqual(missingRule, [], `组件用了这些类名但 styles.ts 没有对应规则：${missingRule.join(', ')}`)
  const unused = classes.filter((cls) => !wholeWord(cls).test(slate))
  assert.deepEqual(unused, [], `styles.ts 有这些规则但组件从不用：${unused.join(', ')}`)

  // 材料与输入区读数带同源：L1 底色 + 顶部光晕（两态之间中栏顶部才连续）。
  const bar = ruleBody(STYLES_SRC, '.csSlateBar')
  assert.match(bar, /--cs-canvas-bg-l1/, '开拍前条必须与 .csLobbyHero 用同一档底色')
  assert.match(bar, /radial-gradient\([^;]*--cs-accent-soft/, '开拍前条必须有顶部 accent 光晕（同一套配方）')
  assert.match(bar, /user-select:\s*none/, '纯读数带不得可拖选（与 .csContextBar 同理）')
  // 状态词必须是真的胶囊（比项目名更该先入眼），且用 accent-soft 而非常驻色块
  assert.match(ruleBody(STYLES_SRC, '.csSlateTag'), /--cs-accent-soft/, '「待开拍」胶囊走 --cs-accent-soft')
  // 项目名要能省略：flex 子项默认 min-width:auto 不会缩（CV-181 左栏副行踩过同一个坑）
  assert.match(ruleBody(STYLES_SRC, '.csSlateName'), /min-width:\s*0/, '项目名必须 min-width:0 才能出省略号')
  assert.ok(classes.length >= 6, '类名清单是空的，守卫形同虚设')
})

test('DD-10 守卫：规格拼装只有一份实现 —— 两条带子都走 specPartsOf', () => {
  const slate = codeOnly(readFileSync(new URL('../src/client/SlateBar.tsx', import.meta.url), 'utf8'))
  // 两处消费方都必须复用，且都不许再自己拼「≈N 镜」或点分隔符。
  for (const [name, src] of [['ProjectContextBar', PROJECT_CONTEXT_BAR_SRC], ['SlateBar', slate]]) {
    assert.match(src, /specPartsOf/, `${name} 必须复用 specPartsOf`)
    assert.doesNotMatch(src, /≈/, `${name} 不得自己拼镜数段（第二份必然与另一处漂移）`)
  }
  assert.match(PROJECT_CONTEXT_BAR_SRC, /contextTitleOf/, 'ProjectContextBar 的悬浮文案也必须复用 contextTitleOf')
  // 反向：拼装规则只准住在 project-context.ts 里。
  assert.match(readSrc('../src/project-context.ts'), /export function specPartsOf/,
    'specPartsOf 必须留在 project-context.ts（抽成 .ts 才能被单测直连）')
})

