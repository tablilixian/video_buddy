/**
 * REQ-008：对话流工具行的**唯一文案口径**（三档表 + 摘要 + 耗时 + 状态）。
 *
 * 为什么单独成模块：对话行（client/ToolCallRow.tsx）与资产历史面板
 * （asset-history.ts 的 labelOfTool）过去各持一份映射，注定漂移。本模块是
 * Host / Client 共用的**纯模块**——不 import fs、不碰 Node API，两端 tsconfig
 * 都能编进去（client 侧按 tsconfig.client.json 的 include 白名单显式列入）。
 *
 * 三档语义（产品口径，表可改不改码）：
 * - A 展示级：用户要看的成果（生成图像 / 视频生成 / 审批提交…），大字 + 动态摘要；
 * - B 流程级：看得见但不抢戏（写剧本 / 读取镜头表 / 镜头质检…），一行弱化；
 * - C 内部级：宿主内置工具（read / bash / grep…），极简灰字、默认可点开详情。
 *
 * 注册侧（client/index.ts）对 `tool.call.toolview`（keyed 槽）逐 key 以
 * **priority -1** 注册本表的全部键：上游 keyed 条目全部缺省 priority 0
 * （ui-slots 升序排序、最小者胜出），-1 可安全接管上游 12 个内置键而不抛
 * 「already has an entry」（该错误只在同 key 同 priority 时抛）。
 * 排除键：`cordis_define`（ui-cordis 的插件定义卡语义自成一体）、
 * `todo_write`（上游 TodoRow 已良好）。
 */

/** 三档：A 展示级 / B 流程级 / C 内部级。 */
export type ToolTier = 'A' | 'B' | 'C'

/** 单个工具的展示口径。 */
export interface ToolPresentation {
  tier: ToolTier
  /** 中文标题（A/B 大字或一行；C 极简灰字）。 */
  title: string
  /** 行首图标字符（1~2 个全角字符，纯文案不引图标资源）。 */
  icon: string
  /**
   * C 档路径参数键：该参数的值是可打开的文件路径
   * （展开详情与行内摘要可经 owner.openFile 打开）。
   */
  pathKey?: 'path' | 'file_path'
}

/**
 * 三档文案表（唯一事实源）。历史别名（compose / upload / image2image /
 * txt2image / character）也在表内：老会话的块按 call.name 原样分发，注册后
 * 历史对话同样本地化；上游没有这些 key，priority -1 无冲突。
 */
export const TOOL_PRESENTATION: Record<string, ToolPresentation> = {
  // ===== A 展示级（15）=====
  image_generate: { tier: 'A', title: '生成图像', icon: '图' },
  image_generate_withtxt: { tier: 'A', title: '生成文字图', icon: '字' },
  image_fix: { tier: 'A', title: '图内文字修复', icon: '修' },
  character_generate: { tier: 'A', title: '生成角色立绘', icon: '角' },
  character_sheet: { tier: 'A', title: '生成角色四视图', icon: '角' },
  look_card: { tier: 'A', title: '生成 Look 卡', icon: '卡' },
  video_generate: { tier: 'A', title: '视频生成', icon: '▶' },
  // C-9（2026-10-03）：与 compose_video 撞名「成片合成」会让用户把多参考视频生成
  // 误读为最终成片步骤——改名区分；compose_video 保持「成片合成」。
  video_composite: { tier: 'A', title: '多参考生成视频', icon: '▶' },
  compose_video: { tier: 'A', title: '成片合成', icon: '合' },
  music_generation: { tier: 'A', title: '音乐生成', icon: '乐' },
  // CV-271：占位升真，从 B 档占位位迁入 A 档真实工具位。
  tts_voiceover: { tier: 'A', title: '生成配音', icon: '音' },
  ask_user_choice: { tier: 'A', title: '向你提问', icon: '?' },
  submit_screenplay_for_approval: { tier: 'A', title: '提交剧本审批', icon: '批' },
  submit_storyboard_for_approval: { tier: 'A', title: '提交分镜审批', icon: '批' },
  submit_keyframes_for_approval: { tier: 'A', title: '提交关键帧确认', icon: '批' },

  // ===== B 流程级（10 真实 + 1 占位 + 5 历史别名）=====
  write_screenplay: { tier: 'B', title: '写剧本', icon: '写' },
  write_script: { tier: 'B', title: '写文案', icon: '写' },
  list_shots: { tier: 'B', title: '读取镜头表', icon: '读' },
  list_references: { tier: 'B', title: '读取素材参考', icon: '读' },
  upload_image: { tier: 'B', title: '上传素材', icon: '传' },
  extract_last_frame: { tier: 'B', title: '抽取末帧', icon: '帧' },
  cut_audio: { tier: 'B', title: '音频裁切', icon: '切' },
  qc_shot: { tier: 'B', title: '镜头质检', icon: '检' },
  image2vl: { tier: 'B', title: '画面分析', icon: '析' },
  video2vl: { tier: 'B', title: '视频理解', icon: '析' },
  subtitle_burn: { tier: 'B', title: '字幕（暂未开放）', icon: '字' },
  // 历史别名（仅老会话块会出现这些 wire 名）。
  compose: { tier: 'B', title: '成片合成', icon: '合' },
  upload: { tier: 'B', title: '上传文件', icon: '传' },
  image2image: { tier: 'B', title: '图像生成', icon: '图' },
  txt2image: { tier: 'B', title: '图像生成', icon: '图' },
  character: { tier: 'B', title: '角色四视图', icon: '角' },

  // ===== C 内部级（宿主内置；接管上游 keyed 行）=====
  read: { tier: 'C', title: '读取文件', icon: '读', pathKey: 'path' },
  write: { tier: 'C', title: '写入文件', icon: '写', pathKey: 'file_path' },
  edit: { tier: 'C', title: '修改文件', icon: '改', pathKey: 'file_path' },
  bash: { tier: 'C', title: '执行命令', icon: '$' },
  pwsh: { tier: 'C', title: '执行命令', icon: '$' },
  grep: { tier: 'C', title: '搜索内容', icon: '搜' },
  glob: { tier: 'C', title: '匹配文件', icon: '搜' },
  web_search: { tier: 'C', title: '搜索网络', icon: '网' },
  web_fetch: { tier: 'C', title: '打开网页', icon: '网' },
  skill: { tier: 'C', title: '加载技能', icon: '技' },
  run_code: { tier: 'C', title: '运行代码', icon: '码' },
  cordis_run: { tier: 'C', title: '运行插件', icon: '插' },
  cordis_stop: { tier: 'C', title: '停止插件', icon: '插' },
  cordis_undefine: { tier: 'C', title: '移除插件', icon: '插' },
  cordis_package_inspect: { tier: 'C', title: '检查插件', icon: '插' },
  cordis_runtime_inspect: { tier: 'C', title: '检查插件', icon: '插' },
}

/** 明确不注册的键（presence 会与上游撞车或上游行已足够好）。 */
export const TOOLVIEW_EXCLUDED = new Set(['cordis_define', 'todo_write'])

/** 全部待注册键（表序去重；client/index.ts 逐 key 注册即遍历此表）。 */
export const TOOLVIEW_KEYS: readonly string[] = Object.keys(TOOL_PRESENTATION)

/** 查一个工具的展示口径；表外工具 undefined（keyed 未命中回落上游通用行）。 */
export function presentationOf(tool: string): ToolPresentation | undefined {
  return TOOL_PRESENTATION[tool]
}

// ===== 摘要提取 =====

/** A 档逐工具摘要器：入参对象 → 摘要片段；返回 undefined 落通用链。 */
type Summarizer = (args: Record<string, unknown>) => string | undefined

const clip = (text: string, max: number): string => {
  const trimmed = text.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed
}

const str = (args: Record<string, unknown>, key: string): string | undefined => {
  const value = args[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** filenames / filename 参数里的参考张数片段（「· N 张参考」）。 */
const referenceSuffix = (args: Record<string, unknown>): string | undefined => {
  const list = args.filenames
  if (Array.isArray(list) && list.length > 0) return `· ${list.length} 张参考`
  return str(args, 'filename') !== undefined ? '· 1 张参考' : undefined
}

/** A 档动态摘要规则（与 docs/plans/REQ-008 方案 §3 表一一对应）。 */
const SUMMARIZERS: Record<string, Summarizer> = {
  image_generate: (args) => {
    const base = str(args, 'prompt')
    if (base === undefined) return undefined
    return [clip(base, 40), referenceSuffix(args)].filter(Boolean).join(' ')
  },
  image_generate_withtxt: (args) => {
    const base = str(args, 'prompt')
    return base === undefined ? undefined : clip(base, 40)
  },
  image_fix: (args) => {
    const base = str(args, 'prompt')
    return base === undefined ? undefined : clip(base, 30)
  },
  video_generate: (args) => {
    const base = str(args, 'prompt')
    if (base === undefined) return undefined
    const duration = typeof args.duration === 'number' ? ` · ${args.duration}s` : ''
    return `${clip(base, 30)}${duration}`
  },
  video_composite: (args) => referenceSuffix(args),
  compose_video: (args) => referenceSuffix(args),
  music_generation: (args) => {
    const base = str(args, 'prompt')
    return base === undefined ? undefined : clip(base, 30)
  },
  tts_voiceover: (args) => {
    const base = str(args, 'text')
    return base === undefined ? undefined : clip(base, 30)
  },
  image2vl: (args) => {
    const base = str(args, 'prompt')
    return base === undefined ? undefined : clip(base, 30)
  },
  video2vl: (args) => {
    const mode = str(args, 'mode')
    const base = str(args, 'prompt')
    const body = base === undefined ? undefined : clip(base, 30)
    return mode === undefined ? body : [mode, body].filter(Boolean).join(' · ')
  },
  ask_user_choice: (args) => {
    const base = str(args, 'question')
    return base === undefined ? undefined : clip(base, 40)
  },
  qc_shot: (args) => {
    const expect = str(args, 'expect')
    return expect === undefined ? undefined : clip(expect, 30)
  },
  bash: (args) => {
    const command = str(args, 'command')
    return command === undefined ? undefined : clip(command, 40)
  },
  pwsh: (args) => {
    const command = str(args, 'command')
    return command === undefined ? undefined : clip(command, 40)
  },
  read: (args) => {
    const path = str(args, 'path') ?? str(args, 'file_path')
    return path === undefined ? undefined : path.split('/').pop()
  },
  write: (args) => {
    const path = str(args, 'path') ?? str(args, 'file_path')
    return path === undefined ? undefined : path.split('/').pop()
  },
  edit: (args) => {
    const path = str(args, 'path') ?? str(args, 'file_path')
    return path === undefined ? undefined : path.split('/').pop()
  },
  grep: (args) => {
    const pattern = str(args, 'pattern')
    return pattern === undefined ? undefined : clip(pattern, 40)
  },
  glob: (args) => {
    const pattern = str(args, 'pattern')
    return pattern === undefined ? undefined : clip(pattern, 40)
  },
  web_search: (args) => {
    const query = str(args, 'query')
    return query === undefined ? undefined : clip(query, 40)
  },
  web_fetch: (args) => {
    const url = str(args, 'url')
    if (url === undefined) return undefined
    try { return new URL(url).host } catch { return clip(url, 40) }
  },
  skill: (args) => {
    const name = str(args, 'name') ?? str(args, 'skill')
    return name === undefined ? undefined : clip(name, 30)
  },
}

/** 通用摘要字段链（per-tool 摘要器都未命中时的兜底顺序）。 */
const GENERIC_KEYS = ['prompt', 'command', 'path', 'file_path', 'pattern', 'query', 'url', 'name', 'question', 'id'] as const

/**
 * 入参 → 一行摘要。`argsRaw` 解析容错：坏 JSON / 空串 → null（行组件留空）。
 * 这是 B/C 档与 A 档兜底的唯一提取点。
 */
export function summaryOf(tool: string, argsRaw: string): string | null {
  if (argsRaw === '') return null
  let args: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(argsRaw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    args = parsed as Record<string, unknown>
  } catch {
    return null
  }
  const custom = SUMMARIZERS[tool]?.(args)
  if (custom !== undefined && custom !== '') return custom
  for (const key of GENERIC_KEYS) {
    const value = str(args, key)
    if (value !== undefined) return clip(value, 40)
  }
  return null
}

// ===== 块状态 / 耗时 / 结果文本 =====

/** 行状态四态（对齐上游 ToolRowState：取消是中性 stopped，不是错误）。 */
export type ToolRowState = 'running' | 'ok' | 'error' | 'stopped'

/** 判定块所处状态。running 判据与上游 tool-call-model 一致：!('kind' in block)。 */
export function stateOfBlock(block: object): ToolRowState {
  if (!('kind' in block)) return 'running'
  const settled = block as { error?: { code?: string }; isError?: boolean }
  if (settled.error?.code === 'interrupted') return 'stopped'
  return settled.isError ? 'error' : 'ok'
}

/** settled 块的入参原文（call 被 history 截断时为 null）；running 块直接带 argsRaw。 */
export function argsRawOfBlock(block: object): string | null {
  if (!('kind' in block)) {
    const running = block as { argsRaw?: string }
    return typeof running.argsRaw === 'string' ? running.argsRaw : null
  }
  const settled = block as { call?: { argsRaw?: string } | null }
  return typeof settled.call?.argsRaw === 'string' ? settled.call.argsRaw : null
}

/** settled 块的 call 名（history 截断时 null）；running 块直接带 name。 */
export function nameOfBlock(block: object, fallback: string): string {
  if (!('kind' in block)) {
    const running = block as { name?: string }
    return typeof running.name === 'string' ? running.name : fallback
  }
  const settled = block as { call?: { name?: string } | null }
  return typeof settled.call?.name === 'string' ? settled.call.name : fallback
}

/**
 * 耗时秒（time - callTime，0.1s 精度）。running 块无终态时间、settled 块可能因
 * history 截断缺 callTime —— 两种情况都返回 null（不显示徽标）。
 * 注意：视频类工具的该值**含 Drama/ComfyUI 排队等待**（特性记录，验收不算 bug）。
 */
export function durationSeconds(block: object): number | null {
  if (!('kind' in block)) return null
  const settled = block as { time?: number; callTime?: number | null }
  if (typeof settled.time !== 'number' || typeof settled.callTime !== 'number') return null
  const seconds = (settled.time - settled.callTime) / 1000
  if (!Number.isFinite(seconds) || seconds < 0) return null
  return Math.round(seconds * 10) / 10
}

/** 耗时徽标文案：「21.4s」；可整除时省一位小数。 */
export function formatDuration(seconds: number): string {
  return Number.isInteger(seconds) ? `${seconds}s` : `${seconds.toFixed(1)}s`
}

/** settled 块结果文本：text 块原样、其他块 pretty JSON；空 content 回落 error 名码。 */
export function outputTextOf(block: object): string | null {
  if (!('kind' in block)) return null
  const settled = block as {
    content?: readonly { type?: string; text?: string }[]
    error?: { name?: string; code?: string }
  }
  const parts: string[] = []
  for (const blockItem of settled.content ?? []) {
    if (blockItem.type === 'text' && typeof blockItem.text === 'string') parts.push(blockItem.text)
    else parts.push(JSON.stringify(blockItem, null, 2))
  }
  if (parts.length === 0 && settled.error !== undefined) {
    parts.push(`${settled.error.name ?? 'error'}: ${settled.error.code ?? 'unknown'}`)
  }
  return parts.length > 0 ? parts.join('\n') : null
}

/** 错误首行：优先从可 JSON.parse 的 {error|message} 取人话字段，否则取首行原文。 */
export function errorSummaryOf(block: object): string | null {
  const output = outputTextOf(block)
  if (output === null) return null
  const firstLine = output.indexOf('\n') === -1 ? output : output.slice(0, output.indexOf('\n'))
  const trimmed = firstLine.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as { error?: unknown; message?: unknown }
      if (typeof parsed.error === 'string' && parsed.error !== '') return clip(parsed.error, 80)
      if (typeof parsed.message === 'string' && parsed.message !== '') return clip(parsed.message, 80)
    } catch { /* 非 JSON，走首行 */ }
  }
  return clip(trimmed, 80)
}

// ===== 资产历史口径（唯一映射点，tests/asset-history.test.mjs 契约）=====

/**
 * 工具名 → 资产历史面板标题。这张表是 asset-history 面板的**既有产品口径**
 * （部分值与对话行标题刻意不同：面板叫「图像生成」、对话行叫「生成图像」），
 * 从 asset-history.ts 迁来统一维护；未知工具兜底展示原名。契约断言不可破：
 * video_generate=视频生成、compose=成片合成、cut_audio=音频裁切、
 * image_fix=图内文字修复、upload=上传文件、未知=原名。
 */
const ASSET_HISTORY_LABELS: Record<string, string> = {
  upload: '上传文件',
  video_generate: '视频生成',
  image_generate: '图像生成',
  image_generate_withtxt: '文字生图',
  image2image: '图像生成',
  txt2image: '图像生成',
  image_fix: '图内文字修复',
  character: '角色四视图',
  music_generation: '音乐生成',
  tts_voiceover: '配音生成',
  compose: '成片合成',
  video_composite: '多参考生成视频',
  cut_audio: '音频裁切',
}

/** 资产历史面板标题（唯一映射点；新工具漏登记时兜底展示原 tool 名）。 */
export function labelOfTool(tool: string): string {
  return ASSET_HISTORY_LABELS[tool] ?? tool
}
