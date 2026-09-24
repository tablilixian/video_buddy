/**
 * 工具入参的「占位值」守卫（CV-235，Host 侧）。
 *
 * ## 抓的是什么 bug
 *
 * 模型在**一次规划多个工具调用**时，会给「还没算出来的」引用类入参先填一个占位串
 * 顶上，打算回头再补。实测（2026-09-23 的一次真实会话，12 条报错里 7 条源于此）：
 *
 * | 工具 | 模型实际写出的入参 | 一路走到哪里才被拦下 | 报出来的是什么 |
 * | --- | --- | --- | --- |
 * | `upload_image` | `{"imageUrl":"placeholder2"}`（一直到 `placeholder5`） | 下载地址安全校验 | 「下载地址不安全或不在允许范围内」 |
 * | `character_sheet` | `{"filename":"placeholder-will-retry"}` | 后端拒绝 / 超时 | 与真因无关的失败 |
 * | `video_composite` | `{"prompt":"placeholder"}` | H3 预检 / 后端 | 同上 |
 *
 * 共性：**占位串不是「还不错的猜测」，而是伪装成合法取值的脏数据**。它长得像一个
 * 文件名、一个地址，于是每一层校验都放它过去，直到某个跟「这是个占位词」毫无关系
 * 的地方才失败 —— 用户看到文不对题的报错，模型得到误导性的纠正信号（「地址不安全」
 * 会让它去改地址，而真因是「你压根没去取真实值」）。
 *
 * ## 为什么拦在唯一入口，而不是每条工具的 `execute` 里
 *
 * 拦截点只有一个：`wrapStudioToolDefinition`（见 `tool-error-boundary.ts`）。
 * 宿主注册的工具（`createStudioTools` + `createPlaceholderTools`）全部经它包装，所以
 * 这里是**唯一实现**；在每条工具里各写一遍就是「同一规则两份实现」，本仓已有成文规矩
 * 不许这么做（`CS-UNC-000` 那次边界两侧结论相反，就是这种分叉的代价）。
 * —— 这里刻意不写「共 N 条工具」：数字会随增删工具腐烂，而判据（全部经此一个入口）
 * 不会；`tests/param-guard.test.mjs` 以「是否有句柄入参」现算，不依赖任何名单。
 *
 * 拒收发生在 `execute` 之前 ⇒ **零副作用**：不解析项目、不落节点、不发起后端调用。
 *
 * ## 三个必配的部件（缺一件 bug 就以另一种形态回来）
 *
 * 1. **参数分类表**（本文件）：哪些入参要过守卫、哪些豁免、为什么。新参数名必须
 *    显式归类 —— `tests/param-guard.test.mjs` 会遍历全部工具定义的实际参数名，
 *    发现未登记的名字直接判红（「先登记后使用」的同一手法）。
 * 2. **工具层拒收**（`assertNoPlaceholderParams`）：命中的调用直接抛 `CS-PARAM-002`。
 * 3. **事前纪律**（`PLACEHOLDER_PARAM_RULE`）：挂进「有句柄入参的工具」的
 *    description。错误文案只在犯错那一刻出现 —— 模型在**没犯错时**读不到「本工具
 *    不接受占位值」，那它就还会照旧先占位、等报错，白烧一轮。
 *    与 `stubPayloadMessage` 同一手法：描述与错误文案共用**同一份字面量**，
 *    两处措辞永不漂移。
 *
 * ## 口径是被刻意收窄的
 *
 * 判定只用「整篇都是占位词」这一把尺子（`text-guard.ts` 的 `placeholderParamReason`），
 * 且额外要求「必须真剥掉过占位词 + 剥完只剩数字」。理由：入参是**标识符**，
 * 合法值可以极短（节点 id `p1`、语言代码 `zh`），拿长度当判据会误伤一大片；
 * 宁可漏判（回到引入本守卫之前的旧行为），不可误判（拦住合法调用）。
 */

import { placeholderParamReason } from './text-guard.js'
import { throwError } from './error-system.js'

// ⚠️ 这里**不能** `import './errors/catalog.js'`。
//
// 方向必须是单向的：`errors/catalog.ts` → 本模块（它要用 `PLACEHOLDER_PARAM_RULE`
// 拼 `CS-PARAM-002` 的文案）。若本模块也去 import catalog 就成了环 —— 而 ESM 的环
// 在这里会**真的炸**：先加载 param-guard 时，它的 import 语句先求值 ⇒ catalog 先跑
// ⇒ catalog 读参数 guard 里尚未初始化的 `const PLACEHOLDER_PARAM_RULE` ⇒ 模块求值期
// 直接 ReferenceError（不是运行到那行才报，是 import 阶段就挂）。
//
// 注册由既有的入口负责：`index.ts` / `tool-error-boundary.ts` / `host-tools.ts`
// 都 import 了 catalog；本模块的 `throwError('CS-PARAM-002')` 只在工具执行期发生，
// 那时注册早已完成。

/**
 * 参数分类。决定这个入参要不要过占位守卫、用哪把尺子。
 *
 * - `handle`：**素材句柄 / 画布节点引用** —— 占位串的高发地，也是本守卫的主要目标。
 * - `prose`：**模型自撰的自由文本**（提示词 / 剧本表 / 歌词…）。同一个坏习惯在这里
 *   表现为「先写个词占位」，所以一并守；尺子与 handle 相同（标识符形态下更严的那把）。
 * - `exempt`：豁免。**每一个都必须在 `EXEMPT_PARAMS` 里写明原因**。
 */
export type ParamClass = 'handle' | 'prose' | 'exempt'

/**
 * 需要守卫的**句柄类**入参（素材地址 / 后端文件名 / 画布节点 id）。
 *
 * 收录判据：这个值的合法取值来自「别处产出的真实对象」，而不是模型自己编的文本。
 */
const HANDLE_PARAMS: readonly string[] = [
  // 素材句柄与地址（跨进程/跨服务引用，实测占位串的第一高发地）
  'filename',
  'filenames',
  'imageUrl',
  'videoUrl',
  'video',
  'referenceFilename',
  'audioRefs',
  'videoRefs',
  'sourceUrls',
  // 画布节点引用（做成片合成 / 版本取代时用）
  'clipIds',
  'bgmNodeId',
  'scriptId',
  'replaces',
  'sourceNodeIds',
  'shotRefs',
]

/**
 * 需要守卫的**自由文本**入参。
 *
 * 这些是模型自己撰写的正文，合法取值必然很长且形态自由 ⇒ 「整篇只是占位词」这一刀
 * 砍下去不会误伤（真实提示词不可能压缩成 `placeholder`）。
 */
const PROSE_PARAMS: readonly string[] = [
  'prompt',
  'storyboard',
  'lyrics',
  'lockedPrompt',
  'expect',
  'systemPrompt',
  'negativePrompt',
  'text',
  'name',
  'summary',
  'question',
  'keyscale',
]

/**
 * 豁免参数（按名登记 + **原因**）。未登记的参数名会被守卫测试判红。
 *
 * 「豁免」不等于「不重要」—— 每一类都写明为什么本守卫管不了它，而不是笼统略过。
 */
const EXEMPT_PARAMS: Readonly<Record<string, string>> = {
  // —— 枚举：取值由 schema 校验，不存在「占位串」这个形态 ——
  aspectRatio: '枚举（16:9 / 9:16 / 1:1），取值不合规由 schema 拒收',
  resolution: '枚举（档位表派生），取值不合规由 schema 拒收',
  style: '枚举（realistic / anime）',
  model: '枚举（h3 / seedance2）',
  provider: '枚举（drama / fal）',
  shotTransition: '枚举（chain / cut / bridge）',
  irMode: '枚举（T2VA / I2VA / FL2VA / Ref2VA）',
  mode: '枚举（shot-breakdown / free）',
  timesignature: '短代码（2 / 3 / 4 / 6），非自由文本',
  // —— 布尔 / 数值：不存在文本占位形态 ——
  includeRetired: '布尔开关',
  autoFixText: '布尔开关',
  generateAudio: '布尔开关',
  colorGrade: '布尔开关',
  allowFreeText: '布尔开关',
  multiSelect: '布尔开关',
  duration: '数值（秒），非法取值由 clampDuration 钳制',
  bpm: '数值',
  filmDuration: '数值（秒）',
  durationMargin: '数值（倍率）',
  budget: '数值（重跑预算）',
  // —— 短代码值：整篇级尺子在这里要么无效、要么会误伤合法短值 ——
  language: '语言代码（zh / en / ja / unknown），合法值天然只有 2–7 个字符，不是占位形态',
  // —— 已有专用守卫，中央守卫再接一手会**把更具体的文案挤掉** ——
  script: '已由 write_script 内部的 CV-217 专用守卫处理（那里的文案逐项列出必须覆盖的构成，比通用文案有用）',
  screenplay: '已由 write_screenplay 内部的 CV-217 专用守卫处理（同 script）',
  // —— 用户可见的选题标签：「待定 / 暂无」是**合法语义**（「暂不确定」），拦它会把正常点选题拒掉 ——
  options: '用户可见的候选项标签，「待定 / 暂无」在此是合法语义（如「暂不确定」），不能按占位处理',
}

/** 参数 → 分类（未登记返回 `undefined`，由守卫测试判红）。 */
export function paramClassOf(name: string): ParamClass | undefined {
  if (HANDLE_PARAMS.includes(name)) return 'handle'
  if (PROSE_PARAMS.includes(name)) return 'prose'
  if (Object.prototype.hasOwnProperty.call(EXEMPT_PARAMS, name)) return 'exempt'
  return undefined
}

/** 全部已分类的参数名（守卫测试用它做双向对账）。 */
export function classifiedParamNames(): { handle: string[]; prose: string[]; exempt: string[] } {
  return {
    handle: [...HANDLE_PARAMS],
    prose: [...PROSE_PARAMS],
    exempt: Object.keys(EXEMPT_PARAMS),
  }
}

/** 某个豁免参数的原因（守卫测试在失败信息里直接展示，省得再翻源码）。 */
export function exemptReasonOf(name: string): string | undefined {
  return EXEMPT_PARAMS[name]
}

/**
 * 模型可见的纪律句 —— **唯一源**：既挂进工具 description（事前），也拼进被拒收时的
 * 错误文案（事后）。两处必须说同一件事，否则模型会从描述里学到一套、被错误文案教
 * 另一套（与 `STUB_PAYLOAD_RULE` 同一理由）。
 *
 * ⚠️ 措辞里不要出现完整 URL / 绝对路径 / 三连斜杠：这段字面量会进 `userMessage`
 * 模板，而 `error-system-guards.test.mjs` 断言 `userMessage` 过一遍 `sanitizeForUser`
 * 不发生变化（含地址的文案会被判成「泄漏」）。
 */
export const PLACEHOLDER_PARAM_RULE =
  '⚠️ 素材类入参必须是**真实值**：要么用产出该素材的工具返回的真实内容'
  + '（如 upload_image 的 filename、image_generate 产物的 URL），要么用 @ref[节点标题] 引用画布节点。'
  + '不要填 placeholder、占位、待补充、稍后回填 这类占位串 —— 它们不是「先占个位、回头再替换」的合法写法，'
  + '而是伪装成合法取值的脏数据：本系统会**当场拒收**，整次调用都不会执行。'
  + '素材还没准备好就先别调用本工具。'

/** 单次命中的描述（供错误文案与日志使用）。 */
export interface PlaceholderParamHit {
  /** 命中的顶层参数名。 */
  name: string
  /** 该参数的分类（`handle` / `prose`）。 */
  cls: ParamClass
  /** 在入参里的位置，数组元素带下标（`filenames[0]`）。 */
  where: string
  /** 被拒收的原始取值。 */
  value: string
  /** 中文原因（`text-guard` 给出）。 */
  reason: string
}

/** 只报告**第一个**命中：一条准确的报错比一堵墙有用。 */
function checkValue(name: string, cls: ParamClass, value: unknown): PlaceholderParamHit | null {
  if (typeof value === 'string') {
    const reason = placeholderParamReason(value)
    return reason === null ? null : { name, cls, where: name, value, reason }
  }
  if (!Array.isArray(value)) return null
  for (let index = 0; index < value.length; index += 1) {
    const element: unknown = value[index]
    if (typeof element !== 'string') continue
    const reason = placeholderParamReason(element)
    if (reason !== null) return { name, cls, where: `${name}[${index}]`, value: element, reason }
  }
  return null
}

/**
 * 在入参里找出第一个占位值。**只看顶层键与字符串数组元素**：
 * 工具入参是扁平结构，没有深层嵌套；不递归是为了让「扫了哪些键」与参数分类表一一对应
 * （递归扫描会绕过分类表，等于把守卫变成一把没有边界的全局尺子）。
 *
 * 非字符串、`undefined`、空数组一律放行 —— 缺参与空值由各工具自己的必填校验负责，
 * 不是占位判定的事。
 */
export function findPlaceholderParam(args: unknown): PlaceholderParamHit | null {
  if (typeof args !== 'object' || args === null) return null
  for (const [name, value] of Object.entries(args as Record<string, unknown>)) {
    const cls = paramClassOf(name)
    if (cls === undefined || cls === 'exempt') continue
    const hit = checkValue(name, cls, value)
    if (hit !== null) return hit
  }
  return null
}

/** 回显用截断：占位串通常很短，但模型也可能把一整段正文塞进句柄参数。 */
const MAX_ECHO_CHARS = 60
function clipForEcho(value: string): string {
  const trimmed = value.trim()
  return trimmed.length > MAX_ECHO_CHARS ? `${trimmed.slice(0, MAX_ECHO_CHARS)}…` : trimmed
}

/**
 * 断言入参里没有占位值；有则抛 `CS-PARAM-002`。
 *
 * @param toolName 工具名（报错里要指名道姓，否则模型不知道自己哪次调用被拒）。
 * @param args 该次调用的入参。
 */
export function assertNoPlaceholderParams(toolName: string, args: unknown): void {
  const hit = findPlaceholderParam(args)
  if (hit === null) return
  const echo = clipForEcho(hit.value)
  throwError('CS-PARAM-002', {
    tool: toolName,
    param: hit.where,
    value: echo,
    detail: `${toolName}.${hit.where} = ${JSON.stringify(echo)}；${hit.reason}（分类 ${hit.cls}）`,
  })
}

/**
 * 取一个工具**声明的参数名**。两种形态都认：
 *
 * - `defineTool` 归一后的 JSON Schema（`{ type:'object', properties:{…}, required:[…] }`）
 *   —— **这才是生产路径上的实际形态**：`createStudioTools()` 返回的就已经归一过，
 *   `wrapStudioToolDefinition` 拿到的正是它。
 * - 直接写扁平参数表（`{ prompt: {…} }`）—— 兼容手工构造的定义（测试里常见）。
 *
 * ⚠️ 这里踩过一次：最初只认第二种 ⇒ 生产里每条工具的顶层键都是 `type/properties/required`，
 * `paramClassOf` 全部落空 ⇒ **事前纪律一条都没挂上**；而拒收侧看的是**入参**（不是声明），
 * 照常工作 ⇒ 表现为「静默只做了一半」。`tests/param-guard.test.mjs` 的
 * 「挂载情况与『是否有句柄入参』完全一致」那条就是为这个盲区设的。
 */
function declaredParamNames(parameters: unknown): string[] {
  if (typeof parameters !== 'object' || parameters === null) return []
  const properties = (parameters as { properties?: unknown }).properties
  if (typeof properties === 'object' && properties !== null && !Array.isArray(properties)) {
    return Object.keys(properties)
  }
  return Object.keys(parameters)
}

/**
 * 这条工具定义需不需要挂「占位纪律」句 —— 判据是**它自己声明的参数里有没有句柄类**。
 *
 * 从 `parameters` 现算而不是维护一张工具名单：加了句柄参数的新工具自动被覆盖，
 * 不可能出现「工具在名单外，于是描述里没纪律」这种静默漏网。
 */
export function toolNeedsPlaceholderRule(parameters: unknown): boolean {
  return declaredParamNames(parameters).some((name) => paramClassOf(name) === 'handle')
}

/**
 * 给「有句柄入参」的工具描述追加一层占位纪律（没有句柄入参的工具原样返回）。
 *
 * ⚠️ 双向都要成立：有句柄入参却**没有**这句话 → 模型读不到事前约束；没有句柄入参
 * 却多出这句话 → 每条工具描述都白长一段。`tests/param-guard.test.mjs` 两边都断言。
 */
export function withPlaceholderParamRule<T>(definition: T): T {
  const source = definition as unknown as {
    description?: unknown
    parameters?: unknown
  } & Record<string, unknown>
  if (!toolNeedsPlaceholderRule(source.parameters)) return definition
  const description = typeof source.description === 'string' ? source.description : ''
  return { ...source, description: `${description}\n\n${PLACEHOLDER_PARAM_RULE}` } as T
}
