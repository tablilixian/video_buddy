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
  'filenameTail',
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
  // 素材引用（cut_audio：本地资产文件名 / 画布节点引用，同样是「来自别处的真实对象」）
  'audio',
  // CV-271：tts_voiceover 的参考音频（音色克隆源，upload_image 句柄 / @ref 引用）
  'refaudio',
  // 画布节点引用（做成片合成 / 版本取代时用）
  'clipIds',
  'bgmNodeId',
  // S2b（2026-10-28）：compose_video 的多句旁白节点 id —— 与 bgmNodeId 同类（画布
  // 节点句柄，合法值只能来自 tts_voiceover 产物节点）。
  'voiceOverNodeIds',
  'scriptId',
  'replaces',
  'sourceNodeIds',
  'shotRefs',
  // REQ-022（创意先行）：生成图回写故事板的语义引用（shot 语义 id / look）
  'storyboardRef',
  // P1-2（2026-10-26）：add_to_library 的源画布节点 —— 与 clipIds / bgmNodeId 同类，
  // 合法值只能来自画布上真实存在的节点（模型爱写 `node_1` 这类占位）。
  'nodeId',
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
  // CV-271：tts_voiceover 的声音设计指令（模型自撰的自然语言：语言/性别/年龄/语气/情感/语速/方言）
  'instructPrompt',
  // P1-2（2026-10-26）：add_to_library 的资产描述（模型自撰，进详情页给人看）。
  'description',
  'name',
  'summary',
  'question',
  // REQ-022：片名（模型自撰的短文本，同样会整串塞占位词）
  'title',
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
  model: '枚举（h3 / seedance2）',
  provider: '枚举（drama / fal）',
  shotTransition: '枚举（chain / cut / bridge）',
  // irMode 已随 CV-264 从工具入参移除（模式推断唯一事实源在 capabilityOf），分类表同步清账。
  mode: '枚举（shot-breakdown / free）',
  // —— CV-362 inspect_image ——
  filePath: '绝对路径（PNG 文件），存在性/尺寸由 statSync 校验，无文本占位形态',
  threshold: '数值（亮度阈值 0-255），越界由 execute 钳制',
  topN: '数值（主色数量 1-16），越界由 execute 钳制',
  // REQ-035（F-06）：grid 模式的行列数与 bbox 的扫描区。都不指向别处产出的对象。
  cols: '数值（亮度网格列数 4-96），越界由 execute 钳制',
  rows: '数值（亮度网格行数 4-96），越界由 execute 钳制',
  region: '数值矩形（画布百分比中心语义），越界由 execute clamp 到图内',
  // 2026-10-25：sample 模式的逐点取色坐标串（"30,40;50,60"）。越界点由 execute 夹回并标记。
  points: '百分比坐标串（"x,y;x,y"，x/y 中心语义），非法项跳过、越界由 execute 夹回并标记',
  // 2026-10-25：layout_table（项目级布局坐标表，工作台不参与渲染）。
  // `name` 已在「散文串」表里（同名参数跨工具共用一条分类），这里不重复登记，否则三表打架。
  action: '枚举（read / write / clear），取值不合规由 execute 拒收',
  rect: '数值矩形（画布百分比中心语义），w/h ≤ 0 或越出画布由 normalizeLayoutTable 拒收',
  note: '自由文本备注（说明这块是什么 / 量自哪张图），不指向别处产出的对象',
  // 2026-10-25：scaffold_manifest 的视觉主题（展开成颜色值，manifest 不存 themeId）。
  theme: '枚举（cold-tech / ink-press / warm-ember / neon-data），未知值回落缺省并在返回文本里明示',
  // 2026-10-25：片型配方（段序列 + 时间轴 + 素材需求）。
  recipe: '枚举（explainer-cards / product-walkthrough / story-arc），未知值由 execute 显式拒收',
  // —— CV-361 render_composition ——
  manifestPath: '绝对路径（manifest JSON 文件），内容由 JSON.parse + validateManifest + 尾部完整性校验拒收，比通用占位尺子更准',
  // —— 布尔 / 数值：不存在文本占位形态 ——
  includeRetired: '布尔开关',
  autoFixText: '布尔开关',
  generateAudio: '布尔开关',
  colorGrade: '布尔开关',
  allowFreeText: '布尔开关',
  multiSelect: '布尔开关',
  // 2026-10-22：write_storyboard 的收尾笔信号（true ⇒ 本次写完后本回合可交还用户审阅）。
  awaitingLanding: '布尔开关（收尾笔信号：写完后 Host 才会 concludeTurn）',
  // REQ-034（O-11）：该镜是否呈现面部。false ⇒ 质检跳过外貌核对（手部微距不再被判「未呈现面部」）。
  facesVisible: '布尔开关（false ⇒ 质检跳过外貌核对）',
  duration: '数值（秒），非法取值由 clampDuration 钳制',
  start: '数值（秒，cut_audio 裁切起点）——数值无文本占位形态，越界由 cutAudioSegment 校验并给出可用区间',
  end: '数值（秒，cut_audio 裁切终点）——同 start；超源长自动截到末尾并在 warnings 说明',
  filmDuration: '数值（秒）',
  durationMargin: '数值（倍率）',
  budget: '数值（重跑预算）',
  // REQ-034（O-09）：tts_voiceover 的本地后处理参数 —— 后端没有这两个字段，
  // 由宿主用 ffmpeg 确定性实现（atempo 变速不变调 / asetrate 变调不变速）。
  speed: '数值（语速倍率，0.5–2），越界由 clampSpeechOptions 夹取并回 warning',
  pitchSemitones: '数值（音高，±12 半音），越界由 clampSpeechOptions 夹取并回 warning',
  language: '语言代码（zh / en / ja / unknown），合法值天然只有 2–7 个字符，不是占位形态（占位工具组的 TTS/配音参数）',
  // —— 短代码值：整篇级尺子在这里要么无效、要么会误伤合法短值 ——
  // —— 已有专用守卫，中央守卫再接一手会**把更具体的文案挤掉** ——
  script: '已由 write_script 内部的 CV-217 专用守卫处理（那里的文案逐项列出必须覆盖的构成，比通用文案有用）',
  // —— 用户可见的选题标签：「待定 / 暂无」是**合法语义**（「暂不确定」），拦它会把正常点选题拒掉 ——
  options: '用户可见的候选项标签，「待定 / 暂无」在此是合法语义（如「暂不确定」），不能按占位处理',
  // —— REQ-022（CV-293）write_storyboard：**分节 JSON 字符串**容器 ——
  // 它们不是模型自撰的散文，而是结构化 JSON：占位形态（`{}` / 缺键 / 空数组）由该工具
  // 内的 JSON.parse + `validateForSeed` 逐项拒收，比「整篇只是占位词」这把通用尺子更准；
  // 用通用尺子反而会漏（`{}` 不含任何占位词却同样是无效载荷）。
  meta: '结构化 JSON 字符串（题材 / 目标时长 / 画幅），占位形态由 JSON.parse + validateForSeed 拒收',
  creative: '结构化 JSON 字符串（创意理解），占位形态由 JSON.parse + validateForSeed 拒收',
  visual: '结构化 JSON 字符串（5 项 tokens），占位形态同上',
  narration: '结构化 JSON 字符串（逐句旁白），占位形态同上',
  characters: '结构化 JSON 字符串（角色数组，profile 人读 / gen 机读）',
  sound: '结构化 JSON 字符串（BGM 参数 + 音效点），占位形态同上',
  facts: '结构化 JSON 字符串（事实锚点，每条带来源 URL）',
  assets: '结构化 JSON 字符串（素材清单，只存引用）',
  constraints: '结构化 JSON 字符串（硬约束数组，落地后逐次注入）',
  // —— REQ-034（CV-327）render_composition ——
  manifest: '结构化 JSON 字符串（CompositionManifest：meta + tracks），占位形态（`{}` / 缺键）由 JSON.parse + validateManifest 逐项拒收，比「整篇只是占位词」这把通用尺子更准',
  // 三期 W5-2：渲染质量档（draft / standard / high）。枚举值不合规由 schema 拒收，
  // 且它不指向任何「别处产出的真实对象」，没有占位形态可言。
  quality: '枚举（draft / standard / high），取值不合规由 schema 拒收',
  projectId: '项目 id（宿主下发的短标识）—— 非法 / 不存在的项目由 resolveProjectId 拒收，不是素材句柄，不存在「来自别处产出的真实对象」的占位形态',
  // REQ-035（B2-3）：scaffold_manifest 的骨架参数 —— 都是宿主自己算的常量，不指向别处产物。
  durationSeconds: '数值（秒），越界由 execute 钳制（0 < x ≤ 1800）',
  fps: '枚举数值（24/25/30/60），非法值回落 30',
  aspect: '枚举字符串（16:9 / 9:16 / 1:1），非法值回落 16:9',
  // REQ-035（F-05）：探针渲染开关 —— 不落画布节点 / 不抽帧 / 跳过体检。
  probe: '布尔开关（探针渲染：不落画布节点、不抽帧、跳过编排体检）',
  // —— P1-1（2026-10-26）tts_narration ——
  // 这是**对象数组**容器，不是字符串：通用尺子（「整篇只是占位词」）对 `[{...}]` 无从下手。
  // 真正的拦截点前移到 `narration.ts` 的 `requireText`：逐段拒收空串与占位串（
  // 「空台词会被合成成静音还烧一次额度」是这里唯一的实质风险）。
  lines: '对象数组（每段 text / gapSeconds / instructPrompt），逐段的文本由 narration.ts 的 requireText 逐条拒收空串与占位串',
  // 同样是对象容器：内部只有 instructPrompt（散文，已单独归类）与 refaudio（句柄，
  // 由 resolveRefValue 解析失败即报错并用真实错误文案指路）。容器本身没有占位形态。
  voice: '对象容器（instructPrompt / refaudio），内部 refaudio 由 resolveRefValue 解析失败即报错',
  startFrame: '数值（帧号，≥0），非法值由 planVoiceTimeline 夹到 0',
  gapSeconds: '数值（秒，负数 = 有意重叠），非法值按缺省间隔处理',
  // —— P1-2（2026-10-26）资产库工具 ——
  category: '枚举（character / scene / prop / group / voice），取值不合规由 isLibCategory 拒收',
  q: '搜索关键词 —— 合法值可以是任意短串甚至单字（「雨」），整篇级尺子会大面积误伤；填错只是 0 命中，不会作为脏数据贯穿到下游',
  limit: '数值（返回条数上限），越界由 execute 钳制',
  tags: '短词数组（标签）—— 合法值天然就是一个词，整篇级尺子会误伤；错标签只影响检索',
  aliases: '短词数组（别名/别称）—— 同 tags：合法值就是短词，错值只影响检索，不贯穿下游',
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
