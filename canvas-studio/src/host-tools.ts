/**
 * Canvas Studio P3 媒体生成工具（Host 侧）。
 *
 * `ctx.tools` 是 Host 服务，因此工具定义必须注册在 Host（浏览器客户端没有
 * `tools` 服务，之前在客户端注册正是桌面闪退的根因）。每个工具的 `execute`
 * 从会话工作区解析绑定的项目（`exec.agent.session.header.cwd`，即项目拥有的
 * 目录），再调用 Host 的 `generateAsset` —— 外部 API 调用与落盘都在 Host 完成，
 * 既规避浏览器 CORS，也避免跨进程 HTTP 往返。
 */
import { randomUUID } from 'node:crypto'
import { sep } from 'node:path'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ProjectRegistry } from './projects.js'
import { normalizeWorkflow } from './contracts/project.js'
import type { StudioCanvasNode } from './contracts/canvas.js'
import { BRIEF_NODE_TOOL } from './contracts/canvas.js'
import { parseRefTokens } from './reference-token.js'
import { newAssetId } from './config.js'
import { generateAsset, uploadImage, enhancePrompt, analyzeImage, splitStoryboard, setRuntimeConfig, deriveNodePlacement, type GenerateParams, type GenerateResult } from './generate.js'
import { composeStudioVideo, appendComposedVideoNode } from './compose.js'

/** 产物结果 schema（工具返回给模型的结构）。 */
const resultSchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    url: { type: 'string' as const, description: '产物托管 URL，可在画布中直接引用' },
    width: { type: 'integer' as const, description: '宽度（像素）' },
    height: { type: 'integer' as const, description: '高度（像素）' },
    duration: { type: 'number' as const, description: '视频时长（秒）；图片无此项' },
    filename: { type: 'string' as const, description: 'Drama Backend 服务器文件名（图片类产物；供下游 image_generate / video_generate / video_composite / storyboard_split 以 filename 链式引用）' },
    warnings: { type: 'array' as const, items: { type: 'string' as const }, description: '占坑参数提示（可选）：本次请求中暂未接入后端的参数（model/resolution/generateAudio）说明' },
  },
}

/** 把产物结果渲染成模型可读的文本块。 */
function renderResult(_args: unknown, value: unknown): ContentBlock[] {
  const result = value as GenerateResult
  const duration = result.duration !== undefined ? `, ${result.duration}s` : ''
  const name = result.filename !== undefined ? `, Drama 文件名: ${result.filename}` : ''
  const warnings = result.warnings !== undefined && result.warnings.length > 0 ? `；注意: ${result.warnings.join('；')}` : ''
  return [{ type: 'text', text: `已生成产物: ${result.url} (${result.width}x${result.height}${duration}${name})${warnings}` }]
}

/** 把上传结果渲染成模型可读的文本块。 */
function renderUploadResult(_args: unknown, value: unknown): ContentBlock[] {
  const v = value as { filename: string }
  return [{ type: 'text', text: `已上传到 Drama Backend: ${v.filename}` }]
}

/** 把文本结果渲染成模型可读的文本块。 */
function renderTextResult(_args: unknown, value: unknown): ContentBlock[] {
  const v = value as { text: string }
  return [{ type: 'text', text: v.text }]
}

/**
 * CR-001：compose_video 缺省选片——只取「逐镜视频片段」并按生成顺序排序，
 * 排除成片节点（toolName='compose'）。否则二次合成会把上一版成片当片段再拼
 * 一次，递归叠加。纯函数便于单测；显式传 clipIds 时不经过此逻辑。
 */
export function defaultComposeClips(nodes: readonly StudioCanvasNode[]): string[] {
  return nodes
    .filter(node => node.kind === 'video' && node.toolName !== 'compose')
    .sort((left, right) => left.createdAt - right.createdAt)
    .map(node => node.id)
}

/**
 * 暂不可用（disabled）的工具集合。这些工具仍注册（避免上游 skill 流程因
 * "tool not found" 中断），但调用时抛「暂不可用」错误，提示模型改用替代路径。
 * 后端端点与 generate.ts 的分支代码全部保留，恢复时只需把工具名移出本集合。
 */
const DISABLED_TOOLS = new Set(['style_transfer', 'inpaint'])

/** 工具「暂不可用」时的统一守卫：命中即抛错，否则放行。 */
function guardDisabledTool(name: string): void {
  if (DISABLED_TOOLS.has(name)) {
    throw new Error(`工具 ${name} 当前暂不可用（功能保留、待后续接入）。请改用替代方案：inpaint 的图像编辑需求暂缓；style_transfer 的风格统一改用 image_generate 传参考图或 character_generate。`)
  }
}

/**
 * 单条画布文本节点的截断上限（字符）。write_script 文案可能上千字且对白需要
 * 被逐字引用，400 会砍掉关键信息；2000 能完整容纳绝大多数便签/文案/分镜表，
 * 同时防止粘贴的超长文本节点撑爆工具结果。截断时显式标注剩余长度。
 */
const NOTE_TEXT_LIMIT = 2000
/** 最多返回的画布文本节点条数（按创建时间倒序取最新）。 */
const MAX_NOTES_RETURNED = 10

interface CanvasNote {
  title: string
  source: string
  text: string
}

function clipNoteText(text: string): string {
  return text.length > NOTE_TEXT_LIMIT
    ? `${text.slice(0, NOTE_TEXT_LIMIT)}…（已截断，全文 ${text.length} 字符）`
    : text
}

/** 把参考图列表与画布文本节点渲染成模型可读的文本块。 */
function renderReferenceList(_args: unknown, value: unknown): ContentBlock[] {
  const v = value as {
    references: Array<{ title: string; role: string; strength: number; filename: string | null }>
    notes: CanvasNote[]
  }
  const parts: string[] = []
  if (v.references.length === 0) {
    parts.push('当前项目没有标记为参考图的素材。可先用上传图片功能添加参考，或生成一张图后它默认成为参考。')
  } else {
    const lines = v.references.map((r, i) => {
      const name = r.filename !== null ? `filename=${r.filename}` : '需先 upload_image(url) 取文件名'
      return `${i + 1}. [${r.role}] ${r.title}（强度 ${r.strength}，${name}）`
    })
    parts.push(`可用参考图（${v.references.length}）：\n${lines.join('\n')}`)
  }
  if (v.notes.length > 0) {
    const lines = v.notes.map((n, i) => `${i + 1}. 【${n.source}】${n.title}：${n.text}`)
    parts.push(`画布文本节点（${v.notes.length}）：\n${lines.join('\n')}`)
  }
  return [{ type: 'text', text: parts.join('\n\n') }]
}

/**
 * 从会话工作区目录解析绑定的 Canvas Studio 项目 id。
 * 项目的工作区目录即 `project.dir`；精确匹配优先，否则取最长前缀匹配
 * （会话 cwd 落在项目目录内的子路径时也能命中）。
 */
async function resolveProjectId(registry: ProjectRegistry, cwd: string | undefined): Promise<string> {
  if (!cwd) {
    throw new Error('当前会话未绑定工作区，请先在左侧打开或创建一个 Canvas Studio 项目')
  }
  const projects = await registry.list()
  let match: string | null = null
  let bestLength = -1
  for (const project of projects) {
    const dir = project.dir
    if (dir === cwd || cwd.startsWith(dir + sep)) {
      if (dir.length > bestLength) {
        bestLength = dir.length
        match = project.id
      }
    }
  }
  if (match === null) {
    throw new Error('当前会话工作区未绑定任何 Canvas Studio 项目，请先在左侧打开或创建一个项目')
  }
  return match
}

/**
 * 把 `@ref[显示名]` token 解析成对应的 Drama Backend 文件名。
 * 找不到参考节点、或该参考尚未 upload_image（缺 filename）时给出可操作报错。
 */
async function resolveRefFilenames(registry: ProjectRegistry, projectId: string, tokens: string[]): Promise<string[]> {
  if (tokens.length === 0) return []
  const nodes = (await registry.readCanvas(projectId)).nodes.filter((node) => node.isReference === true)
  const byTitle = new Map(nodes.map((node) => [node.title ?? '', node] as const))
  const out: string[] = []
  for (const token of tokens) {
    const node = byTitle.get(token)
    if (node === undefined) {
      throw new Error(`参考图 @ref[${token}] 在当前项目参考托盘中未找到。请先确认该素材已上传并在节点详情面板点「标记为参考」（或用 list_references 查看可用参考）。`)
    }
    if (node.filename === undefined || node.filename === null || node.filename.length === 0) {
      throw new Error(`参考图 @ref[${token}] 尚未上传到 Drama Backend（缺少 filename）。请先调 upload_image(url="${node.url ?? ''}") 取得文件名，或直接在参数里粘贴该文件名。`)
    }
    out.push(node.filename)
  }
  return out
}

/** 解析单个 filename 参数：含 @ref token 时解析为 Drama 文件名，否则原样返回。 */
async function resolveRefValue(registry: ProjectRegistry, projectId: string, value: string): Promise<string> {
  const tokens = parseRefTokens(value)
  if (tokens.length === 0) return value
  // CR-031：单值参数内出现多个 @ref 是歧义（一个 filename 只能解析一个参考），
  // 显式报错而非静默取第一个（此前 resolved[0] 会静默丢弃其余 token）。
  if (tokens.length > 1) {
    throw new Error(`参数 "${value}" 包含多个 @ref 引用（${tokens.join('、')}）；单个 filename 参数只能引用一个参考，请拆分后分别传入。`)
  }
  const resolved = await resolveRefFilenames(registry, projectId, tokens)
  return resolved[0] as string
}

/** 解析 filenames 数组参数：逐元素尝试 @ref 解析。 */
async function resolveRefValues(registry: ProjectRegistry, projectId: string, values: string[]): Promise<string[]> {
  return Promise.all(values.map((value) => resolveRefValue(registry, projectId, value)))
}

/** 解析项目后调用 Host 的 generateAsset 执行一次生成。 */
function runGeneration(
  registry: ProjectRegistry,
  tool: string,
  params: GenerateParams,
  signal: AbortSignal,
  cwd: string | undefined,
): Promise<GenerateResult> {
  return resolveProjectId(registry, cwd).then(async (projectId) => {
    // P7 硬门禁：逐步确认模式下，分镜/视频生成必须先经 submit_storyboard_for_approval
    // 获得用户批准（state=executing）。放手跑模式（auto）不受限。门禁只约束 agent 的
    // 工具调用；画布上用户手动发起的节点重试走 /generate 路由，不经此处。
    const workflow = normalizeWorkflow((await registry.getProject(projectId))?.workflow)
    if (GATED_TOOLS.has(tool) && workflow.mode === 'confirm' && workflow.state !== 'executing') {
      if (workflow.state === 'keyframe_review') {
        throw new Error('关键帧正在等待用户确认（画布上方确认条）。请停止视频生成，等待用户点击「确认关键帧」；用户可能在画布上二次编辑关键帧，编辑完成后仍需再次确认。确认后用户会发送「继续」恢复流程，不要自行重试。')
      }
      throw new Error(workflow.state === 'awaiting_approval'
        ? '分镜表正在等待用户批准（画布上方审批条）。请停止生成，等待用户点击「批准」并在对话中发送「继续」后再执行；不要自行重试。'
        : '当前项目为「逐步确认」模式：请先与用户确认需求（时长/画幅/风格/节奏/受众），再用 submit_storyboard_for_approval 提交分镜表；用户批准前不能调用分镜/视频生成工具（概念图 image_generate 允许）。')
    }
    if (tool === 'storyboard_split') {
      const sp = params as GenerateParams & { filename?: string; gridnum?: number; sourceUrls?: string[] }
      return splitStoryboard(registry, projectId, {
        filename: sp.filename ?? '',
        ...(sp.gridnum !== undefined ? { gridnum: sp.gridnum } : {}),
        ...(sp.sourceUrls !== undefined ? { sourceUrls: sp.sourceUrls } : {}),
      }, signal)
    }
    return generateAsset(registry, tool, projectId, params, signal)
  })
}

/** P7 门禁覆盖的生成类工具：正式流程的入口动作。 */
const GATED_TOOLS = new Set(['storyboard_generate', 'video_generate', 'video_composite', 'storyboard_split'])

/** renderResult 在无真实分辨率时的兜底尺寸（成片探测失败时）。 */
const COMPOSED_FALLBACK = { width: 1280, height: 720 }

/**
 * ask_user_choice 的等待上限（毫秒）：比最长视频超时更宽，到点按推荐项继续。
 */
const QUESTION_WAIT_MS = 600_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/**
 * 解析分镜表 markdown 表格为逐镜单元格行。容错策略：
 * - 只认含 `|` 的行；行首尾 `|` 可省略；
 * - 丢弃分隔行（`---`）与表头行（首列为「镜号」）；少于 3 列的行丢弃；
 * - 解析不出任何数据行时返回空数组（调用方回退整表单节点落盘）。
 */
export function parseStoryboardShots(storyboard: string): string[][] {
  const rows = storyboard
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes('|'))
  const dataRows = rows
    .map((line) => line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 3)
    .filter((cells) => !cells.every((cell) => cell.length === 0 || /^:?-+:?$/.test(cell)))
    .filter((cells) => cells[0] !== '镜号')
  return dataRows
}

/** 把一行分镜单元格格式化为逐镜卡片正文（缺失列自动跳过）。 */
export function formatStoryboardShot(cells: string[]): { title: string; text: string } {
  const [no = '', scene = '', move = '', duration = ''] = cells
  const rest = cells.slice(4)
  const sound = rest.length >= 2 ? rest[rest.length - 1]! : ''
  const visual = rest.length >= 2 ? rest.slice(0, -1).join(' | ') : (rest[0] ?? '')
  const meta = [scene, move, duration].filter((part) => part.length > 0).join(' · ')
  const title = `分镜 ${no || '?'}${scene.length > 0 ? ` · ${scene}` : ''}`
  const lines = [
    `【镜 ${no || '?'}】${meta}`,
    ...(visual.length > 0 ? [`画面：${visual}`] : []),
    ...(sound.length > 0 ? [`声音：${sound}`] : []),
  ]
  return { title, text: lines.filter((line) => line.trim().length > 0).join('\n') }
}

/** CV-026/027：构建逐镜卡片节点（血缘指向 sourceIds，每行 3 卡横向排列）。 */
function buildShotCards(
  existing: readonly StudioCanvasNode[],
  sourceIds: readonly string[],
  shots: readonly string[][],
): StudioCanvasNode[] {
  const base = deriveNodePlacement(existing, sourceIds, 360, 220)
  const createdAt = Date.now()
  return shots.map((cells, index) => {
    const shot = formatStoryboardShot(cells)
    const column = index % 3
    const row = Math.floor(index / 3)
    return {
      id: newAssetId(),
      kind: 'text' as const,
      title: shot.title,
      text: shot.text,
      x: base.x + column * (360 + 40),
      y: base.y + row * (220 + 40),
      width: 360,
      height: 220,
      createdAt: createdAt + index,
      toolName: 'submit_storyboard_for_approval',
      origin: 'agent' as const,
      sourceIds: [...sourceIds],
      operationType: 'storyboard' as const,
    }
  })
}

/** 给模型看的分镜卡清单（标题 + id），随 submit 工具结果回流供 shotRefs 引用。 */
function describeShotCards(cards: readonly StudioCanvasNode[]): string {
  return cards.map((node) => `${node.title}（id=${node.id}）`).join('、')
}

/**
 * CV-027：解析 shotRefs 为分镜卡节点 id。接受三种写法：节点 id 精确匹配、
 * 卡片标题精确匹配（如「分镜 1 · 特写」）、镜号简写（如「分镜 1」——按标题
 * 前缀匹配该镜号，不会误命中「分镜 10」）。找不到时抛可操作报错，模型可
 * 依据提示修正后重试。
 */
async function resolveShotRefs(
  registry: ProjectRegistry,
  projectId: string,
  refs: readonly unknown[],
): Promise<string[]> {
  const cards = (await registry.readCanvas(projectId)).nodes
    .filter((node) => node.toolName === 'submit_storyboard_for_approval')
  const out: string[] = []
  for (const ref of refs) {
    const raw = String(ref).trim()
    if (raw.length === 0) continue
    const byNumber = /^分镜\s*(\d+)$/.exec(raw)
    const hit = cards.find((node) => node.id === raw)
      ?? cards.find((node) => node.title === raw)
      ?? (byNumber !== null
        ? cards.find((node) => new RegExp(`^分镜 ${byNumber[1]}(?:\\s|·|$)`).test(node.title ?? ''))
        : undefined)
    if (hit === undefined) {
      throw new Error(`分镜卡「${raw}」未找到：请用提交分镜后工具结果里列出的卡片标题（如「分镜 1 · 特写」）或节点 id 作为 shotRefs`)
    }
    if (!out.includes(hit.id)) out.push(hit.id)
  }
  return out
}

/**
 * CV-031b：upload_image 上传的是画布资产 URL 时，把 Drama 新 filename 回写
 * 到对应节点。生成产物落盘自带初始 filename，但模型按 skill 第 7 步重新
 * upload 拿到的是新名字——不回写的话，下游 video_generate 用新 filename
 * 反查不中关键帧，视频就会只连分镜卡、漏连关键帧（VideoOut 项目实测）。
 * 按资产 URL 末段文件名精确匹配节点 url；非画布资产（外部图）不处理。
 */
async function backfillUploadFilename(
  registry: ProjectRegistry,
  projectId: string,
  imageUrl: string,
  filename: string,
): Promise<void> {
  const file = imageUrl.split('/').pop()
  if (!file) return
  const doc = await registry.readCanvas(projectId)
  const target = doc.nodes.find((node) => node.url !== undefined && node.url.split('/').pop() === file)
  if (target === undefined || target.filename === filename) return
  await registry.writeCanvas(projectId, doc.nodes.map((node) => (node.id === target.id ? { ...node, filename } : node)))
}

/**
 * 创建 P3 媒体生成工具集（供 Host 的 `ctx.tools.register` 逐条注册）。
 * @param registry - 项目注册表。
 * @returns 画布视频创作所需的 `defineTool` 定义：image_generate（写实/卡通 style）, character_generate（角色立绘三视图）, inpaint（图像修复/编辑）, upload_image, video_generate, video_composite, prompt_enhance, image2vl, style_transfer, storyboard_generate, P7 的 submit_storyboard_for_approval（分镜表审批门禁）与 ask_user_choice（点选式提问）。
 */
/** 运行时配置：Host 把 settings 解析后的 Drama 基址 / 时长 / 密钥解析器透传给生成闭包。 */
export interface StudioRuntimeConfig {
  /** 返回当前 Drama Backend API 基址。 */
  dramaApiBase: () => string
  /** 返回当前单段视频时长上限（秒）。 */
  maxVideoSeconds: () => number
  /** 解析 dramaApiKey 凭据引用为真实密钥（未配置时抛错）。 */
  resolveDramaApiKey: () => Promise<string>

  // —— 设置页扩展字段（画幅比例已接入 generate.ts；其余待管线消费）——
  /** 返回默认画幅比例（agent 未指定 aspectRatio 时兜底）。 */
  defaultAspectRatio: () => '16:9' | '9:16' | '1:1'
  /** 返回默认执行模式（confirm/auto）。 */
  workflowMode: () => 'confirm' | 'auto'
  /** 分镜 HITL 门禁开关。 */
  hitlStoryboard: () => boolean
  /** 关键帧 HITL 门禁开关。 */
  hitlKeyframe: () => boolean
  /** 生成失败自动重试开关。 */
  autoRetry: () => boolean
  /** 最大并行生成数。 */
  maxParallel: () => number
  /** 资产库位置（留空 = 项目默认）。 */
  assetDir: () => string
  /** 画布自动保存开关。 */
  autoSave: () => boolean
  /** 自动保存间隔（秒）。 */
  autoSaveInterval: () => number
}

export function createStudioTools(registry: ProjectRegistry, port: number, cfg?: StudioRuntimeConfig) {
  // 运行时配置写入 generate.ts 模块级 current，供 Drama 调用读取；未提供时
  // 不写入（测试直连场景由 generate.ts 的编译期默认值兜底）。
  if (cfg !== undefined) setRuntimeConfig(cfg)
  return [
    defineTool({
      name: 'image_generate',
      description:
        '根据提示词生成一张图片。可传 filename（单参考图生图）或 filenames（最多 3 张参考图，多参考融合图生图），两者都来自 upload_image 拿到的 Drama Backend 文件名；都不传则为纯文生图。返回图片的托管 URL 与尺寸。画风由 style 控制：realistic=写实（默认，走 txt2image 文生 / image2image 图生），anime=卡通/日式动漫（走 txt2imageanime，仅纯文生图；若同时传了参考图则回退写实图生图）。参考图也可来自画布参考托盘：对话里用 @ref[参考图显示名] 直接引用（取其 Drama filename），或先调 list_references 列出当前项目可用参考及其 filename/role。若 filename/filenames 直接传 @ref[显示名]，Host 会自动解析为对应 Drama 文件名，无需手动 upload_image。',
      parameters: {
        prompt: { type: 'string' as const, required: true, description: '生成提示词' },
        aspectRatio: { type: 'string' as const, enum: ['16:9', '9:16', '1:1'], description: '宽高比，默认 16:9' },
        style: { type: 'string' as const, enum: ['realistic', 'anime'], description: '画风模式：realistic=写实（默认），anime=卡通/日式动漫（仅纯文生图）' },
        filename: { type: 'string' as const, description: '可选单参考图：已上传的 Drama Backend 文件名（来自 upload_image 工具，用于图生图）' },
        filenames: { type: 'array' as const, description: '可选多参考图（最多 3 张，来自 upload_image 工具）；与 filename 二选一，多参考融合图生图' },
        negativePrompt: { type: 'string' as const, description: '反向提示词' },
        sourceUrls: { type: 'array' as const, description: '本图参考的画布产物 URL 数组（此前工具结果里的 url），用于在画布上画出流程箭头；没有参考图可省略' },
        shotRefs: { type: 'array' as const, description: '可选：要关联的分镜卡（「分镜 N · 景别」标题、「分镜 N」镜号或节点 id，来自提交分镜的工具结果）。画布会把本图连到对应分镜卡并排在其右侧' },
      },
      output: { schema: resultSchema, render: renderResult },
      async execute(args, exec) {
        const a = args as { prompt: string; aspectRatio?: string; style?: 'realistic' | 'anime'; filename?: string; filenames?: string[]; negativePrompt?: string; sourceUrls?: string[]; shotRefs?: unknown[] }
        const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd)
        const params: GenerateParams = { prompt: a.prompt }
        if (a.aspectRatio !== undefined) params.aspectRatio = a.aspectRatio
        if (a.style !== undefined) params.style = a.style
        if (a.filename !== undefined) params.filename = await resolveRefValue(registry, projectId, a.filename)
        if (Array.isArray(a.filenames) && a.filenames.length > 0) params.filenames = await resolveRefValues(registry, projectId, a.filenames)
        if (a.negativePrompt !== undefined) params.negativePrompt = a.negativePrompt
        if (a.sourceUrls !== undefined) params.sourceUrls = a.sourceUrls
        if (Array.isArray(a.shotRefs) && a.shotRefs.length > 0) params.shotNodeIds = await resolveShotRefs(registry, projectId, a.shotRefs)
        return runGeneration(registry, 'image_generate', params, exec.signal, exec.agent?.session.header.cwd)
      },
    }),
    defineTool({
      name: 'character_generate',
      description:
        '基于一张角色设计图生成角色立绘图（多视角 / 三视图）。必须提供 filename（角色设计图，来自 upload_image 工具返回的 Drama Backend 文件名）。返回角色立绘的托管 URL 与尺寸。设计图也可来自画布参考托盘：对话里用 @ref[显示名] 引用，或先调 list_references 列出（role=character 的参考即角色设计图）。filename 也可直接传 @ref[显示名]，Host 会自动解析为对应 Drama 文件名。',
      parameters: {
        filename: { type: 'string' as const, required: true, description: '角色设计图：已上传的 Drama Backend 文件名（来自 upload_image 工具）' },
        aspectRatio: { type: 'string' as const, enum: ['16:9', '9:16', '1:1'], description: '宽高比，默认 16:9' },
        sourceUrls: { type: 'array' as const, description: '设计图对应的画布产物 URL 数组（此前工具结果里的 url），用于画布流程箭头' },
        shotRefs: { type: 'array' as const, description: '可选：要关联的分镜卡（「分镜 N · 景别」标题、「分镜 N」镜号或节点 id，来自提交分镜的工具结果）' },
      },
      output: { schema: resultSchema, render: renderResult },
      async execute(args, exec) {
        const a = args as { filename: string; aspectRatio?: string; sourceUrls?: string[]; shotRefs?: unknown[] }
        const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd)
        const params: GenerateParams = { prompt: '', filename: await resolveRefValue(registry, projectId, a.filename) }
        if (a.aspectRatio !== undefined) params.aspectRatio = a.aspectRatio
        if (a.sourceUrls !== undefined) params.sourceUrls = a.sourceUrls
        if (Array.isArray(a.shotRefs) && a.shotRefs.length > 0) params.shotNodeIds = await resolveShotRefs(registry, projectId, a.shotRefs)
        return runGeneration(registry, 'character_generate', params, exec.signal, exec.agent?.session.header.cwd)
      },
    }),
    defineTool({
      name: 'inpaint',
      description:
        '【暂不可用】图像修复 / 编辑（Inpainting）：按 prompt 描述移除不需要的元素、智能填充背景，或添加新元素。当前功能保留但未开放，调用会返回「暂不可用」错误，请勿调用；图像编辑需求请暂缓或改用 image_generate 传参考图。',
      parameters: {
        prompt: { type: 'string' as const, required: true, description: '修复/编辑描述（描述需要移除或添加的内容）' },
        filename: { type: 'string' as const, required: true, description: '要修复的图像：已上传的 Drama Backend 文件名（来自 upload_image 工具）' },
        aspectRatio: { type: 'string' as const, enum: ['16:9', '9:16', '1:1'], description: '宽高比，默认 16:9' },
        sourceUrls: { type: 'array' as const, description: '原图对应的画布产物 URL 数组（此前工具结果里的 url），用于画布流程箭头' },
        shotRefs: { type: 'array' as const, description: '可选：要关联的分镜卡（「分镜 N · 景别」标题、「分镜 N」镜号或节点 id，来自提交分镜的工具结果）' },
      },
      output: { schema: resultSchema, render: renderResult },
      async execute(args, exec) {
        guardDisabledTool('inpaint')
        const a = args as { prompt: string; filename: string; aspectRatio?: string; sourceUrls?: string[]; shotRefs?: unknown[] }
        const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd)
        const params: GenerateParams = { prompt: a.prompt, filename: await resolveRefValue(registry, projectId, a.filename) }
        if (a.aspectRatio !== undefined) params.aspectRatio = a.aspectRatio
        if (a.sourceUrls !== undefined) params.sourceUrls = a.sourceUrls
        if (Array.isArray(a.shotRefs) && a.shotRefs.length > 0) params.shotNodeIds = await resolveShotRefs(registry, projectId, a.shotRefs)
        return runGeneration(registry, 'inpaint', params, exec.signal, exec.agent?.session.header.cwd)
      },
    }),
    defineTool({
      name: 'upload_image',
      description:
        '将图片上传到 Drama Backend 服务器，返回服务器上的文件名。该文件名可直接用于其他工具的 filename 或 filenames 参数。所有需要图片作为输入的工具都必须先使用本工具上传图片，拿到服务器文件名后再传入。',
      parameters: {
        imageUrl: { type: 'string' as const, required: true, description: '图片 URL（通常是 image_generate 的产物 URL）' },
      },
      output: {
        schema: {
          type: 'object' as const,
          additionalProperties: false,
          properties: {
            filename: { type: 'string' as const, description: 'Drama Backend 服务器上的文件名' },
          },
        },
        render: renderUploadResult,
      },
      async execute(args, exec) {
        const a = args as { imageUrl: string }
        const filename = await uploadImage(a.imageUrl, exec.signal, port, registry)
        // CV-031b：画布资产重上传后回写 filename，保住 filename→节点 的血缘反查。
        const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd)
        await backfillUploadFilename(registry, projectId, a.imageUrl, filename)
        return { filename }
      },
    }),
    defineTool({
      name: 'list_references',
      description:
        '列出当前项目可复用的参考图（画布上标记为参考的素材节点）。每项含 title（显示名）、url（同源托管地址）、filename（Drama Backend 文件名，为空时需先调 upload_image(url) 取文件名）、role（image/character/style/frame）、strength（0–1 参考强度）。同时返回画布上的文本类节点 notes（参考视频上传后的风格归纳便签、write_script 文案、已提交的分镜表），供读取既有创作上下文。当用户要「用参考图/角色图/风格图生成」却没给具体文件名时，调本工具拿可用参考，再按 role 选对应工具：character→image_generate(filename)、style→style_transfer(styleFilename)、frame→video_generate(filename 首帧)、image→通用参考；项目里上传过参考视频时，先用 notes 读风格归纳便签，再定风格策略。',
      parameters: {},
      output: {
        schema: {
          type: 'object' as const,
          additionalProperties: false,
          properties: {
            references: { type: 'array' as const, description: '当前项目可用的参考图列表' },
            notes: { type: 'array' as const, description: '画布文本类节点列表（风格归纳便签/文案/分镜表）' },
          },
        },
        render: renderReferenceList,
      },
      async execute(_args, exec) {
        const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd)
        const nodes = (await registry.readCanvas(projectId)).nodes
        const refs = nodes
          .filter((node) => node.isReference === true && node.kind === 'image')
          .map((node) => ({
            title: node.title ?? node.url ?? '',
            url: node.url ?? '',
            filename: node.filename ?? null,
            role: node.referenceRole ?? 'image',
            strength: node.referenceStrength ?? 1,
          }))
        // 画布文本节点（风格归纳便签 / write_script 文案 / 分镜表）：Agent 唯一
        // 的读回通道。只取最新 MAX_NOTES_RETURNED 条并逐条截断，防止撑爆结果。
        const notes = nodes
          .filter((node) => (node.kind === 'text' || node.kind === 'sticky' || node.kind === 'prompt')
            && typeof node.text === 'string' && node.text.trim().length > 0)
          .sort((left, right) => right.createdAt - left.createdAt)
          .slice(0, MAX_NOTES_RETURNED)
          .map((node) => ({
            title: node.title ?? '文本',
            source: node.toolName ?? node.kind,
            text: clipNoteText(node.text!.trim()),
          }))
        return { references: refs, notes }
      },
    }),
    defineTool({
      name: 'video_generate',
      description:
        '根据提示词生成视频，统一走 FL2VA 接口，支持两种模式：不传 filename 时为纯文生视频；传入 filename（upload_image 返回的 Drama Backend 文件名）时为「首帧」图生视频。返回视频的托管 URL、尺寸与时长。首帧参考图也可来自画布参考托盘：对话里用 @ref[显示名] 引用，或先调 list_references 列出（role=frame 的参考即首帧图）。若 filename 直接传 @ref[显示名]，Host 会自动解析为对应 Drama 文件名。',
      parameters: {
        prompt: { type: 'string' as const, required: true, description: '生成提示词' },
        filename: { type: 'string' as const, description: '可选：已上传的 Drama Backend 文件名（来自 upload_image 工具），用作视频首帧；不传则为纯文生视频' },
        aspectRatio: { type: 'string' as const, enum: ['16:9', '9:16', '1:1'], description: '宽高比，默认 16:9' },
        duration: { type: 'number' as const, description: '视频时长（秒），默认 5；上限 15，建议 8–10（更长请拆多段）' },
        model: { type: 'string' as const, enum: ['h3', 'seedance2'], description: '【占坑·待接入】视频模型选择：默认 h3（当前后端统一走 FL2VA，即 H3 技术路线）；seedance2 尚未接入，传了会收到提示并按 h3 生成' },
        resolution: { type: 'string' as const, enum: ['768p', '1080p', '720p', '2k'], description: '【占坑·待接入】分辨率指定（768P/1080P/2K/720P）：后端暂不支持，传入会被忽略（以 aspectRatio 与后端默认分辨率输出）' },
        generateAudio: { type: 'boolean' as const, description: '【占坑·待接入】是否生成原生音频轨（对应上游 skill 的 generate_audio=true）：当前后端版本未启用原生音频，传 true 会收到提示且成片无音频' },
        sourceUrls: { type: 'array' as const, description: '首帧图对应的画布产物 URL（此前工具结果里的 url），用于画布流程箭头' },
        shotRefs: { type: 'array' as const, description: '可选：要关联的分镜卡（「分镜 N · 景别」标题、「分镜 N」镜号或节点 id，来自提交分镜的工具结果）。画布会把本段视频连到对应分镜卡并排在其右侧' },
      },
      output: { schema: resultSchema, render: renderResult },
      async execute(args, exec) {
        const a = args as { prompt: string; filename?: string; aspectRatio?: string; duration?: number; model?: 'h3' | 'seedance2'; resolution?: '768p' | '1080p' | '720p' | '2k'; generateAudio?: boolean; sourceUrls?: string[]; shotRefs?: unknown[] }
        const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd)
        const filename = a.filename !== undefined ? await resolveRefValue(registry, projectId, a.filename) : undefined
        const params: GenerateParams = { prompt: a.prompt, ...(filename !== undefined ? { filename } : {}) }
        if (a.aspectRatio !== undefined) params.aspectRatio = a.aspectRatio
        if (a.duration !== undefined) params.duration = a.duration
        if (a.model !== undefined) params.model = a.model
        if (a.resolution !== undefined) params.resolution = a.resolution
        if (a.generateAudio !== undefined) params.generateAudio = a.generateAudio
        if (a.sourceUrls !== undefined) params.sourceUrls = a.sourceUrls
        if (Array.isArray(a.shotRefs) && a.shotRefs.length > 0) params.shotNodeIds = await resolveShotRefs(registry, projectId, a.shotRefs)
        return runGeneration(registry, 'video_generate', params, exec.signal, exec.agent?.session.header.cwd)
      },
    }),
    defineTool({
      name: 'video_composite',
      description:
        '将多张参考图合成一段视频。两张图走首尾帧插值（FL2VA，image1 首帧 + image2 尾帧）；三张及以上走多参考图合成（REF2VA，最多 6 张，后端自动排布保持角色/场景一致性）。必须提供 filenames（upload_image 返回的 Drama Backend 文件名数组）。返回合成视频的托管 URL、尺寸与时长。参考图也可来自画布参考托盘：先调 list_references 列出（role=character/image 的参考即可用），再取其 filename 填入 filenames。filenames 也可直接传 @ref[显示名]，Host 会自动解析为对应 Drama 文件名。',
      parameters: {
        prompt: { type: 'string' as const, required: true, description: '生成提示词' },
        filenames: { type: 'array' as const, required: true, description: '已上传的 Drama Backend 文件名数组（来自 upload_image 工具，最多 6 张，超出自动采样）' },
        aspectRatio: { type: 'string' as const, enum: ['16:9', '9:16', '1:1'], description: '宽高比，默认 16:9' },
        duration: { type: 'number' as const, description: '视频时长（秒），默认 10；上限 15。两张图走首尾帧插值（fl2va），三张及以上走多参考图合成（ref2va）' },
        model: { type: 'string' as const, enum: ['h3', 'seedance2'], description: '【占坑·待接入】视频模型选择：默认 h3（当前后端统一走 FL2VA/REF2VA，即 H3 技术路线）；seedance2 尚未接入，传了会收到提示并按 h3 生成' },
        resolution: { type: 'string' as const, enum: ['768p', '1080p', '720p', '2k'], description: '【占坑·待接入】分辨率指定（768P/1080P/2K/720P）：后端暂不支持，传入会被忽略（以 aspectRatio 与后端默认分辨率输出）' },
        generateAudio: { type: 'boolean' as const, description: '【占坑·待接入】是否生成原生音频轨（对应上游 skill 的 generate_audio=true）：当前后端版本未启用原生音频，传 true 会收到提示且成片无音频' },
        sourceUrls: { type: 'array' as const, description: '输入图对应的画布产物 URL 数组（按 filenames 同序），用于画布流程箭头' },
        shotRefs: { type: 'array' as const, description: '可选：要关联的分镜卡（「分镜 N · 景别」标题、「分镜 N」镜号或节点 id，来自提交分镜的工具结果）。画布会把本段视频连到对应分镜卡并排在其右侧' },
      },
      output: { schema: resultSchema, render: renderResult },
      async execute(args, exec) {
        const a = args as { prompt: string; filenames: string[]; aspectRatio?: string; duration?: number; model?: 'h3' | 'seedance2'; resolution?: '768p' | '1080p' | '720p' | '2k'; generateAudio?: boolean; sourceUrls?: string[]; shotRefs?: unknown[] }
        const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd)
        const params: GenerateParams = { prompt: a.prompt, filenames: await resolveRefValues(registry, projectId, a.filenames) }
        if (a.aspectRatio !== undefined) params.aspectRatio = a.aspectRatio
        if (a.duration !== undefined) params.duration = a.duration
        if (a.model !== undefined) params.model = a.model
        if (a.resolution !== undefined) params.resolution = a.resolution
        if (a.generateAudio !== undefined) params.generateAudio = a.generateAudio
        if (a.sourceUrls !== undefined) params.sourceUrls = a.sourceUrls
        if (Array.isArray(a.shotRefs) && a.shotRefs.length > 0) params.shotNodeIds = await resolveShotRefs(registry, projectId, a.shotRefs)
        return runGeneration(registry, 'video_composite', params, exec.signal, exec.agent?.session.header.cwd)
      },
    }),
    defineTool({
      name: 'prompt_enhance',
      description:
        '增强提示词，使生成的图像/视频质量更高。输入原始提示词，返回更丰富、更详细的描述。',
      parameters: {
        prompt: { type: 'string' as const, required: true, description: '原始提示词' },
      },
      output: {
        schema: {
          type: 'object' as const,
          additionalProperties: false,
          properties: {
            text: { type: 'string' as const, description: '增强后的提示词' },
          },
        },
        render: renderTextResult,
      },
      async execute(args, exec) {
        const a = args as { prompt: string }
        const text = await enhancePrompt(a.prompt, exec.signal)
        return { text }
      },
    }),
    defineTool({
      name: 'image2vl',
      description:
        '分析一张图片的内容，返回详细的画面描述。必须提供 filename（upload_image 返回的 Drama Backend 文件名）。可用于分析已生成的图片，为后续视频生成提供参考。注意：你是文本模型，无法直接查看图片——不要尝试读取本地图片文件路径（file_path）、不要直接把图片 URL 当参数传入（会报 model does not declare image input）；想分析任何图片必须先调 upload_image(imageUrl=…) 拿到 filename 再传本工具。',
      parameters: {
        filename: { type: 'string' as const, required: true, description: '已上传的 Drama Backend 文件名（来自 upload_image 工具）' },
        prompt: { type: 'string' as const, required: true, description: '分析提示词，描述需要分析的内容' },
        systemPrompt: { type: 'string' as const, description: '系统提示词，设定分析角色和风格' },
      },
      output: {
        schema: {
          type: 'object' as const,
          additionalProperties: false,
          properties: {
            text: { type: 'string' as const, description: '画面分析结果' },
          },
        },
        render: renderTextResult,
      },
      async execute(args, exec) {
        const a = args as { filename: string; prompt: string; systemPrompt?: string }
        const text = await analyzeImage(a.filename, a.prompt, a.systemPrompt ?? '你是一个专业的影视镜头分析师。请从电影摄影的角度分析这张画面。', exec.signal)
        return { text }
      },
    }),
    defineTool({
      name: 'style_transfer',
      description:
        '【暂不可用】将一张图片的风格迁移到另一张图片上。当前功能保留但未开放，调用会返回「暂不可用」错误，请勿调用；风格统一请改用 image_generate 传参考图（图生图）或 character_generate。',
      parameters: {
        filename: { type: 'string' as const, required: true, description: '目标图：已上传的 Drama Backend 文件名（需要改变风格的图片）' },
        styleFilename: { type: 'string' as const, required: true, description: '风格参考图：已上传的 Drama Backend 文件名（提供风格参考的图片）' },
        prompt: { type: 'string' as const, description: '增强提示词，描述期望的风格效果' },
        enhance: { type: 'boolean' as const, description: '是否增强风格迁移效果' },
        aspectRatio: { type: 'string' as const, enum: ['16:9', '9:16', '1:1'], description: '宽高比，默认 16:9' },
      },
      output: { schema: resultSchema, render: renderResult },
      async execute(args, exec) {
        guardDisabledTool('style_transfer')
        const a = args as { filename: string; styleFilename: string; prompt?: string; enhance?: boolean; aspectRatio?: string }
        const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd)
        const params: GenerateParams = {
          prompt: a.prompt ?? '',
          filename: await resolveRefValue(registry, projectId, a.filename),
          styleFilename: await resolveRefValue(registry, projectId, a.styleFilename),
        }
        if (a.enhance !== undefined) params.enhance = a.enhance
        if (a.aspectRatio !== undefined) params.aspectRatio = a.aspectRatio
        return runGeneration(registry, 'style_transfer', params, exec.signal, exec.agent?.session.header.cwd)
      },
    }),
    defineTool({
      name: 'storyboard_generate',
      description:
        '根据文本描述生成分镜图像（格子分镜）。每行描述一个分镜场景。可传入 filename（upload_image 返回的 Drama Backend 文件名）作为参考图。返回图片的托管 URL 与尺寸。',
      parameters: {
        prompt: { type: 'string' as const, required: true, description: '场景描述，每行描述一个分镜场景' },
        gridnum: { type: 'number' as const, description: '分镜格子数量，默认 4' },
        filename: { type: 'string' as const, description: '可选参考图：已上传的 Drama Backend 文件名（来自 upload_image 工具）' },
        aspectRatio: { type: 'string' as const, enum: ['16:9', '9:16', '1:1'], description: '宽高比，默认 16:9' },
      },
      output: { schema: resultSchema, render: renderResult },
      async execute(args, exec) {
        const a = args as { prompt: string; gridnum?: number; filename?: string; aspectRatio?: string }
        const params: GenerateParams = { prompt: a.prompt }
        if (a.gridnum !== undefined) params.gridnum = a.gridnum
        if (a.filename !== undefined) params.filename = a.filename
        if (a.aspectRatio !== undefined) params.aspectRatio = a.aspectRatio
        return runGeneration(registry, 'storyboard_generate', params, exec.signal, exec.agent?.session.header.cwd)
      },
    }),
    defineTool({
      name: 'storyboard_split',
      description:
        '将一张格子分镜图拆分为若干单镜（每个镜头一张独立图）。传入 storyboard_generate 返回的 filename（Drama Backend 文件名）作为分镜网格图，按 gridnum 推导行列（4→2×2、6→2×3、9→3×3）调用 image2splitegrid。拆分后的每张单镜会作为独立 image 节点落到画布，并画出指向原分镜网格节点的血缘箭头。返回首张单镜的 URL 与单镜总数。',
      parameters: {
        filename: { type: 'string' as const, required: true, description: '分镜网格图：storyboard_generate 返回的 Drama Backend 文件名（filename 字段）' },
        gridnum: { type: 'number' as const, description: '格子数量（决定行列拆分），默认 4，仅支持 4 / 6 / 9' },
        sourceUrls: { type: 'array' as const, description: '分镜网格图对应的画布产物 URL（storyboard_generate 结果里的 url），用于画血缘箭头指向该网格节点' },
      },
      output: { schema: resultSchema, render: renderResult },
      async execute(args, exec) {
        const a = args as { filename: string; gridnum?: number; sourceUrls?: string[] }
        const params: GenerateParams = { prompt: '', filename: a.filename }
        if (a.gridnum !== undefined) params.gridnum = a.gridnum
        if (a.sourceUrls !== undefined) params.sourceUrls = a.sourceUrls
        return runGeneration(registry, 'storyboard_split', params, exec.signal, exec.agent?.session.header.cwd)
      },
    }),
    defineTool({
      name: 'submit_storyboard_for_approval',
      description:
        '把分镜表提交给用户确认。「逐步确认」模式下必须在调用 storyboard_generate / video_generate / video_composite 之前使用：提交后本回合结束，等待用户在画布上方点击「批准」。返回文本会说明下一步；收到批准放行的回复后再开始正式生成。',
      parameters: {
        storyboard: { type: 'string' as const, required: true, description: '完整分镜表 markdown 文本（镜号/景别/镜头运动/时长/画面描述/声音）' },
        summary: { type: 'string' as const, description: '一句话概述（如「8 镜 · 竖屏 · 治愈系」），展示在审批提示里' },
      },
      output: {
        schema: {
          type: 'object' as const,
          additionalProperties: false,
          properties: {
            text: { type: 'string' as const, description: '提交结果与下一步指引' },
          },
        },
        render: renderTextResult,
      },
      async execute(args, exec) {
        const a = args as { storyboard: string; summary?: string }
        const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd)
        const workflow = normalizeWorkflow((await registry.getProject(projectId))?.workflow)
        // 分镜表落为画布节点（CV-026/027）：能解析出逐镜表格时按镜拆分为独立
        // 节点（每镜一张卡，血缘指向创意，按行排列便于逐镜对照生成）；解析不
        // 出表格时回退整表单节点。两种模式都落卡（放手跑也需要卡片供 shotRefs
        // 连边），工具结果列出卡片标题 + id 供模型逐镜引用。
        const existing = (await registry.readCanvas(projectId)).nodes
        const brief = existing.find((node) => node.toolName === BRIEF_NODE_TOOL)
        const sourceIds = brief !== undefined ? [brief.id] : []
        const shots = parseStoryboardShots(a.storyboard)
        if (workflow.mode === 'auto') {
          if (workflow.state !== 'executing') await registry.updateWorkflow(projectId, { state: 'executing' })
          if (shots.length === 0) {
            return { text: '放手跑模式：分镜表未按逐镜表格返回，未落画布卡片。直接开始执行生成流程；逐镜出图/出视频时用 shotRefs 关联分镜卡（本次无卡可关联）。' }
          }
          const cards = buildShotCards(existing, sourceIds, shots)
          await registry.writeCanvas(projectId, [...existing, ...cards])
          return { text: `放手跑模式：分镜表已按 ${shots.length} 镜拆卡落画布：${describeShotCards(cards)}。逐镜出图/出视频时把 shotRefs 设为对应分镜卡标题，画布会把产物连到该分镜卡并排在其右侧。直接开始执行生成流程。` }
        }
        await registry.updateWorkflow(projectId, { state: 'awaiting_approval' })
        if (shots.length === 0) {
          const placement = deriveNodePlacement(existing, sourceIds, 360, 280)
          const node: StudioCanvasNode = {
            id: newAssetId(),
            kind: 'text',
            title: a.summary ?? '分镜表（待确认）',
            text: a.storyboard,
            x: placement.x,
            y: placement.y,
            width: 360,
            height: 280,
            createdAt: Date.now(),
            toolName: 'submit_storyboard_for_approval',
            origin: 'agent',
            sourceIds,
            operationType: 'storyboard',
          }
          await registry.appendCanvasNode(projectId, node)
          return { text: '分镜表已落到画布（未识别出逐镜表格，已按整表单节点落盘），本回合到此结束。请等待用户在画布上方点击「批准」并在对话中发送「继续」；未获批准前不要调用任何分镜/视频生成工具。' }
        }
        const cards = buildShotCards(existing, sourceIds, shots)
        await registry.writeCanvas(projectId, [...existing, ...cards])
        return { text: `分镜表已按 ${shots.length} 个镜头拆分落到画布：${describeShotCards(cards)}。逐镜出图/出视频时把 shotRefs 设为对应分镜卡标题，画布会把产物连到该分镜卡并排在其右侧。本回合到此结束，请等待用户在画布上方点击「批准」并在对话中发送「继续」；未获批准前不要调用任何分镜/视频生成工具。` }
      },
    }),
    defineTool({
      name: 'submit_keyframes_for_approval',
      description:
        '把全部关键帧生成结果提交给用户确认。「逐步确认」模式下在逐镜出图（image_generate 生成关键帧）完成后必须调用：提交后本回合结束，等待用户在画布上方点击「确认关键帧」；用户可能直接在画布上对关键帧二次编辑（右键重试/修改提示词），此时需等用户再次点击确认后才继续。放手跑模式（auto）直接放行，本工具是空操作。',
      parameters: {
        summary: { type: 'string' as const, description: '一句话概述关键帧完成情况（如「8 镜关键帧已出齐」），展示在确认提示里' },
      },
      output: {
        schema: {
          type: 'object' as const,
          additionalProperties: false,
          properties: {
            text: { type: 'string' as const, description: '提交结果与下一步指引' },
          },
        },
        render: renderTextResult,
      },
      async execute(args, exec) {
        const a = args as { summary?: string }
        const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd)
        const workflow = normalizeWorkflow((await registry.getProject(projectId))?.workflow)
        if (workflow.mode === 'auto') {
          if (workflow.state !== 'executing') await registry.updateWorkflow(projectId, { state: 'executing' })
          return { text: '放手跑模式：关键帧确认已放行，继续执行后续流程（文案 / 逐镜视频 / 成片合成）。' }
        }
        await registry.updateWorkflow(projectId, { state: 'keyframe_review' })
        const summary = a.summary !== undefined && a.summary.trim().length > 0 ? `（${a.summary.trim()}）` : ''
        return { text: `关键帧已全部生成并落到画布${summary}，本回合到此结束。请等待用户在画布上方点击「确认关键帧」；用户可能先对关键帧做二次编辑（右键重试/修改提示词），编辑完成后仍需再次点击确认。未确认前不要调用 video_generate / video_composite / compose_video。` }
      },
    }),
    defineTool({
      name: 'ask_user_choice',
      description:
        '向用户提出一道点选题：选项卡片会内联显示在对话区（本工具调用卡片下方），用户点击后选择自动作为本工具结果返回（无需用户打字）。需求澄清阶段必须用本工具逐项提问（一次一个问题），不要用文本列表提问。列举类问题（如「需要调整哪些视觉细节？」）传 multiSelect=true 让用户勾选多项，答案以「、」拼接返回。问题会阻塞到用户作答或超时；超时返回提示时，采用带「推荐」标记的选项继续。',
      parameters: {
        question: { type: 'string' as const, required: true, description: '问题文本（简短一句话）' },
        options: {
          type: 'array' as const,
          required: true,
          description: '候选项数组（2–6 个短标签）；推荐的选项末尾加「（推荐）」',
        },
        allowFreeText: { type: 'boolean' as const, description: '自由输入框开关，缺省开启（卡片自带「或输入自定义答案」输入框）；仅想隐藏输入框的纯封闭单选题才显式传 false' },
        multiSelect: { type: 'boolean' as const, description: 'true 时为多选题：选项可勾选多项，确认后答案以「、」拼接为单个字符串返回（适合「需要调整哪些…」类列举问题）' },
      },
      output: {
        schema: {
          type: 'object' as const,
          additionalProperties: false,
          properties: {
            text: { type: 'string' as const, description: '用户的选择 / 超时或取消说明' },
          },
        },
        render: renderTextResult,
      },
      async execute(args, exec) {
        const a = args as { question: string; options: string[]; allowFreeText?: boolean; multiSelect?: boolean }
        const options = Array.isArray(a.options) ? a.options.map(String).filter((option) => option.length > 0) : []
        if (a.question.trim().length === 0) throw new Error('question 不能为空')
        if (options.length < 2) throw new Error('options 至少需要两个候选项')
        const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd)
        const pending = {
          id: randomUUID(),
          question: a.question.trim(),
          options,
          ...(a.allowFreeText === false ? { allowFreeText: false } : {}),
          ...(a.multiSelect === true ? { multiSelect: true } : {}),
        }
        await registry.setPendingQuestion(projectId, pending)
        try {
          const deadline = Date.now() + QUESTION_WAIT_MS
          while (Date.now() < deadline) {
            if (exec.signal.aborted) throw exec.signal.reason ?? new DOMException('aborted', 'AbortError')
            const current = normalizeWorkflow((await registry.getProject(projectId))?.workflow).pendingQuestion
            if (current === null || current === undefined) {
              return { text: '问题已被清除（用户跳过）。请采用推荐项继续，并在回复中说明该要素采用了默认假设。' }
            }
            if (current.id === pending.id && typeof current.answer === 'string') {
              await registry.setPendingQuestion(projectId, null)
              return { text: `用户的选择：${current.answer}` }
            }
            await sleep(1500)
          }
          return { text: `用户暂未回答（超过等待上限）。请采用推荐项继续：「${options.find((option) => option.includes('推荐')) ?? options[0]}」，并在回复中说明这是默认假设。` }
        } catch (cause) {
          // 打断 / 出错都要把挂起的问题清掉，避免卡片残留。
          await registry.setPendingQuestion(projectId, null).catch(() => {})
          throw cause
        }
      },
    }),
    defineTool({
      name: 'write_script',
      description:
        '把成片文案落为画布节点（标题「文案」，kind=text），文案须覆盖：广告词、对白、背景音乐（BGM 说明）、音效（SFX）、字幕等。先写文案，再用其中的对白/BGM/音效去驱动各镜头的 H3 视频提示词（对白→<d>[语言]…</d>，BGM→non_diegetic_music:，音效→overall_soundscape:）；合成成片时把本节点 id 作为 scriptId 传入 compose_video，成片详情即展示该文案。返回节点 id 供后续引用。',
      parameters: {
        script: { type: 'string' as const, required: true, description: '完整文案：广告词 / 对白 / 背景音乐 / 音效 / 字幕等（可分段标题）' },
      },
      output: {
        schema: {
          type: 'object' as const,
          additionalProperties: false,
          properties: {
            text: { type: 'string' as const, description: '落盘结果说明（含节点 id）' },
          },
        },
        render: renderTextResult,
      },
      async execute(args, exec) {
        const a = args as { script: string }
        const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd)
        const existing = (await registry.readCanvas(projectId)).nodes
        // CV-025：文案同样挂接创意血缘（创意 → 文案），并排在创意右侧。
        const brief = existing.find((node) => node.toolName === BRIEF_NODE_TOOL)
        const sourceIds = brief !== undefined ? [brief.id] : []
        const placement = deriveNodePlacement(existing, sourceIds, 360, 280)
        const node: StudioCanvasNode = {
          id: newAssetId(),
          kind: 'text',
          title: '文案',
          text: a.script,
          x: placement.x,
          y: placement.y,
          width: 360,
          height: 280,
          createdAt: Date.now(),
          toolName: 'write_script',
          origin: 'agent',
          sourceIds,
        }
        await registry.appendCanvasNode(projectId, node)
        return { text: `文案已落到画布（节点 id=${node.id}），合成成片时可作为 scriptId 传入 compose_video。` }
      },
    }),
    defineTool({
      name: 'compose_video',
      description:
        '把画布上已有的视频片段拼接成最终成片（Host 侧 ffmpeg concat，可选混 BGM）。这是「成片合成」步骤——严禁再用 video_generate / video_composite 从图片关键帧重新生成视频。clipIds 缺省取时间轴上全部视频片段（按生成顺序）；bgmNodeId 指定 BGM 视频/音频节点；scriptId 指定 write_script 写的「文案」节点，成片详情里展示广告词/对白/字幕。成片会作为 video-composite 节点落到画布（血缘指向各源片段）。返回成片 url / 时长 / 分辨率。',
      parameters: {
        clipIds: { type: 'array' as const, description: '可选：参与拼接的视频片段节点 id；缺省取时间轴全部视频（≥2 段）' },
        bgmNodeId: { type: 'string' as const, description: '可选：BGM 节点 id（视频/音频文件）' },
        scriptId: { type: 'string' as const, description: '可选：文案节点 id（write_script 产物），成片详情展示广告词/对白/字幕' },
      },
      output: { schema: resultSchema, render: renderResult },
      async execute(args, exec) {
        const a = args as { clipIds?: string[]; bgmNodeId?: string; scriptId?: string }
        const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd)
        const doc = await registry.readCanvas(projectId)
        // CR-001：缺省选片只取「逐镜视频片段」，排除成片节点（toolName='compose'）。
        const clipIds = Array.isArray(a.clipIds) && a.clipIds.length > 0
          ? a.clipIds
          : defaultComposeClips(doc.nodes)
        if (clipIds.length < 2) {
          throw new Error('至少需要 2 个视频片段才能合成成片；请先用 video_generate / video_composite 生成逐镜视频片段（不要再回头用图片重新生成）。')
        }
        const script = a.scriptId !== undefined
          ? doc.nodes.find(node => node.id === a.scriptId)?.text
          : undefined
        const result = await composeStudioVideo(registry, projectId, clipIds, a.bgmNodeId, {}, exec.signal)
        await appendComposedVideoNode(registry, projectId, {
          url: result.url,
          duration: result.duration,
          ...(result.width !== undefined ? { width: result.width } : {}),
          ...(result.height !== undefined ? { height: result.height } : {}),
          sourceIds: clipIds,
          ...(script !== undefined ? { script } : {}),
        })
        return { url: result.url, width: result.width ?? COMPOSED_FALLBACK.width, height: result.height ?? COMPOSED_FALLBACK.height, duration: result.duration }
      },
    }),
  ]
}
