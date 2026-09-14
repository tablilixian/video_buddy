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
const DEAD_TOKEN_BASELINE = []

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
 * DD-09 / c：会话头「制作阶段」chip（挂宿主公开槽 conversation.session.header.utilities）。
 *
 * 要拦两类**静默失效**，两类都不报错、不警告：
 *   ① 组件写好了、样式也写了，但 `slots.inject` 那一步漏了 / 槽名写错 —— 页面上
 *      什么都不出。与 R8 的 data-rail 同源（**样式写对了 ≠ 接上了**），而且比 R8
 *      更隐蔽：R8 至少还能看出「收起了但没收窄」，chip 漏接就是彻底没有，很容易
 *      被当成「这个功能还没做」而永远没人发现。
 *   ② 类名两边对不上：styles.ts 有 .csStageChip 而组件写了别的类名（或有类无规则），
 *      胶囊会退化成一段裸文本。双向配对，两个方向都查。
 *
 * 槽名与「list 槽必须给 id」由 host-boundary.test.mjs 的「宿主槽必需项」守卫兜，
 * 这里不重复（那里的判据是宿主契约，这里的判据是本仓的接线与样式）。
 * ------------------------------------------------------------------------- */

const INDEX_SRC = codeOnly(readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8'))
const STAGE_CHIP_SRC = codeOnly(readFileSync(new URL('../src/client/StageChip.tsx', import.meta.url), 'utf8'))

/** chip 用到的类名 —— 组件与样式表必须两边都在。 */
const STAGE_CHIP_CLASSES = [
  'csStageChip',
  'csStageChipDot',
  'csStageChipLabel',
  'csStageChipProgress',
  'csStageChipMode',
  'csStageChipPending',
]

test('DD-09 / c 守卫：会话头阶段 chip 真的接上了宿主槽（样式对了不等于接上了）', () => {
  // ① 注册这一步真的做了，且挂的是 chip 组件本身。
  assert.match(INDEX_SRC, /slots\.inject\(\s*'conversation\.session\.header\.utilities'/,
    'index.ts 必须把 chip 注册进宿主公开槽 conversation.session.header.utilities')
  assert.match(INDEX_SRC, /},\s*StageChip\)/,
    '该槽的 occupant 必须是 StageChip 组件（槽注册了但挂错组件 = 什么都不出）')
  // ② 数据走与 StudioFrame 同一个 store 实例 —— 第二份状态必然两处不一致。
  assert.match(INDEX_SRC, /id:\s*'canvas-studio-stage'/,
    'list 槽的 id 必须固定（缺了运行时会抛；变了会与旧注册撞车）')
  // ③ 未选项目时一个 DOM 都不出：宿主容器是 :empty 折叠的，渲染空壳会留一道空白。
  assert.match(STAGE_CHIP_SRC, /if \(view === null\) return null/,
    'chip 必须在无项目时 return null（渲染空 span 会让宿主 :empty 折叠失效、右侧留白）')
  // ④ 阶段判定只准在纯函数里：组件不得自己读 workflow.state / approvalPending。
  assert.match(STAGE_CHIP_SRC, /deriveStageChipView/,
    'chip 必须用 stage-chip.ts 的判定（第二份判定必然与审批条漂移）')
  assert.doesNotMatch(STAGE_CHIP_SRC, /workflow\.state|approvalPending/,
    'chip 组件里不得直接判 workflow.state / approvalPending —— 那是第二份阶段判定')
})

test('DD-09 / c 守卫：阶段 chip 的类名与样式双向配对（有类无规则 = 裸文本）', () => {
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
