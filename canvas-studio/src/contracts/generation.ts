/**
 * DramaServer 生成面业务 API 契约（api(12).md §6，2026-11-22 迁移方案 B1）。
 *
 * 本文件是**协议层的唯一事实源**：类型 + 形状守卫 + 纯函数校验，全部可单测、
 * 无 IO。三条硬约束写进护栏（都来自 API 文档，违规会被服务端 4xx 打回）：
 *
 * 1. **未知字段一律拒收**（§6.5「请求体和嵌套 input 不接受未知字段」）——所以
 *    input 组装必须过白名单裁剪（{@link buildGenerationInput}），不许透传任意对象。
 * 2. **终态只认 `terminal`**（§6.9.3「finalizing 不是终态」；`cancel_requested`
 *    也只是等待收敛）——轮询推进与台账落账只看 {@link isTerminalGenerationStatus}
 *    / 快照的 `terminal` 字段，不许按 status 字符串自行判断。
 * 3. **轮询游标只认 `version`**（§6.9.2「不能把 progress 或时间戳当游标」）——
 *    长轮询 `after_version` 永远取上一帧快照的 `version`。
 *
 * 状态机与 operation 矩阵见 api(12).md §6.4/§6.9.3；素材角色规则见 §6.5
 * （`inputs[]` 每项只允许 asset_id/role/ordinal；同 role ordinal 从 1 连续唯一；
 * 同一 asset 不得重复）。
 */

// ── 操作矩阵 ─────────────────────────────────────────────────────────────────

/** 生成操作全集（api(12).md §6.4 矩阵的 10 个 operation）。 */
export const GENERATION_OPERATIONS = [
  'txt2image',
  'image2image',
  'image2character',
  'image2vl',
  'video2vl',
  'image2videofl2va',
  'image2videoref2va',
  'asr2txt',
  'txt2audio',
  'txt2speech',
] as const

export type GenerationOperation = (typeof GENERATION_OPERATIONS)[number]

export function isGenerationOperation(value: unknown): value is GenerationOperation {
  return (GENERATION_OPERATIONS as readonly string[]).includes(value as string)
}

/** 素材角色（`inputs[].role`；asr2txt 的 role 必须与素材 MIME 类型一致）。 */
export type AssetRole = 'image' | 'video' | 'audio'

export function isAssetRole(value: unknown): value is AssetRole {
  return value === 'image' || value === 'video' || value === 'audio'
}

/** 素材上传类型（presign 的 `type`，与 role 同集合）。 */
export type AssetType = AssetRole

/** 每个 operation 允许的 `input` 字段白名单（服务端拒未知字段，本地同口径裁剪）。 */
export const OPERATION_INPUT_FIELDS: Record<GenerationOperation, readonly string[]> = {
  txt2image: ['prompt', 'width', 'height'],
  image2image: ['prompt', 'width', 'height'],
  // 文档 §6.5：「image2character 不接受多个素材，也不要求 input.prompt」——prompt
  // 仍是合法字段，只是不必填；白名单保守放行，由调用方决定传不传。
  image2character: ['prompt'],
  image2vl: ['prompt', 'system_prompt'],
  video2vl: ['prompt', 'system_prompt'],
  // 视频 operation 不接受 width/height/system_prompt/音乐字段（§6.5）。
  image2videofl2va: ['prompt', 'aspect', 'megapixels', 'duration'],
  image2videoref2va: ['prompt', 'aspect', 'megapixels', 'duration'],
  // asr2txt 不传 input（§6.4/§6.8.2）。
  asr2txt: [],
  txt2audio: ['prompt', 'lyrics', 'duration', 'bpm', 'key_scale', 'language', 'time_signature'],
  txt2speech: ['prompt', 'system_prompt'],
}

/**
 * 每个 operation 的素材（inputs）数量规格。`total` 是跨角色总数上限
 * （ref2va：图≤9 + 视频≤3 + 音频≤3，总计≤15，§6.5）；asr2txt 是
 * 「audio 或 video 恰好一个」→ 两个角色各 0..1、total 恰 1。
 */
export interface OperationAssetSpec {
  readonly image?: { readonly min: number; readonly max: number }
  readonly video?: { readonly min: number; readonly max: number }
  readonly audio?: { readonly min: number; readonly max: number }
  readonly total: { readonly min: number; readonly max: number }
}

export const OPERATION_ASSET_SPECS: Record<GenerationOperation, OperationAssetSpec> = {
  txt2image: { total: { min: 0, max: 0 } },
  image2image: { image: { min: 1, max: 4 }, total: { min: 1, max: 4 } },
  image2character: { image: { min: 1, max: 1 }, total: { min: 1, max: 1 } },
  image2vl: { image: { min: 1, max: 1 }, total: { min: 1, max: 1 } },
  video2vl: { video: { min: 1, max: 1 }, total: { min: 1, max: 1 } },
  // fl2va：0-2 张 image，ordinal 1=首帧 2=尾帧（§6.5）；纯文生视频不传。
  image2videofl2va: { image: { min: 0, max: 2 }, total: { min: 0, max: 2 } },
  image2videoref2va: {
    image: { min: 0, max: 9 },
    video: { min: 0, max: 3 },
    audio: { min: 0, max: 3 },
    total: { min: 0, max: 15 },
  },
  asr2txt: {
    audio: { min: 0, max: 1 },
    video: { min: 0, max: 1 },
    total: { min: 1, max: 1 },
  },
  txt2audio: { total: { min: 0, max: 0 } },
  txt2speech: { audio: { min: 0, max: 1 }, total: { min: 0, max: 1 } },
}

// ── 请求体组装与校验（纯函数） ───────────────────────────────────────────────

/**
 * 按 operation 白名单裁剪 `input`。未知字段**静默剔除**（本地先挡掉服务端必然
 * 400 的字段，调用方无需各自记得擦）；`undefined` 值同样剔除
 * （exactOptionalPropertyTypes 下不允许显式 undefined 进 JSON）。
 */
export function buildGenerationInput(
  operation: GenerationOperation,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const allowed = OPERATION_INPUT_FIELDS[operation]
  const result: Record<string, unknown> = {}
  for (const key of allowed) {
    const value = raw[key]
    if (value !== undefined) result[key] = value
  }
  return result
}

/** 字符串按 UTF-8 字节计长（服务端 prompt/lyrics 上限是字节口径，§6.5）。 */
function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

const IMAGE_PROMPT_MAX_BYTES = 8000
const AUDIO_PROMPT_MAX_BYTES = 20000
const SYSTEM_PROMPT_MAX_CHARS = 2000
const LYRICS_MAX_BYTES = 100000

/** 视频/图片 `aspect` 合法取值（§6.5：只能是三个枚举，1:1 已官方支持）。 */
export const GENERATION_ASPECTS = ['16:9', '9:16', '1:1'] as const

/**
 * 校验已裁剪的 `input` 是否落在文档 §6.5 的数值/长度范围内。
 * 返回问题清单（空数组 = 合法）；只做**机械范围**检查，不做业务语义
 * （prompt 写得好不好不在协议层管）。
 */
export function validateGenerationInput(
  operation: GenerationOperation,
  input: Record<string, unknown>,
): string[] {
  const issues: string[] = []
  const numberField = (key: string, min: number, max: number): void => {
    const value = input[key]
    if (value === undefined) return
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      issues.push(`${key} 必须是 ${min}..${max} 的数字`)
    }
  }
  const stringField = (key: string, maxBytes: number): void => {
    const value = input[key]
    if (value === undefined) return
    if (typeof value !== 'string' || byteLength(value) > maxBytes) {
      issues.push(`${key} 必须是不超过 ${maxBytes} 字节的字符串`)
    }
  }

  // prompt：图片/理解/视频 8000 字节；txt2audio/txt2speech 20000 字节（§6.5）。
  const promptMax = operation === 'txt2audio' || operation === 'txt2speech'
    ? AUDIO_PROMPT_MAX_BYTES
    : IMAGE_PROMPT_MAX_BYTES
  stringField('prompt', promptMax)
  stringField('lyrics', LYRICS_MAX_BYTES)
  // system_prompt 上限按字符计（2000 字符，§6.5）——与字节口径不同，单独判。
  const systemPrompt = input['system_prompt']
  if (systemPrompt !== undefined) {
    if (typeof systemPrompt !== 'string' || systemPrompt.length > SYSTEM_PROMPT_MAX_CHARS) {
      issues.push(`system_prompt 必须是不超过 ${SYSTEM_PROMPT_MAX_CHARS} 字符的字符串`)
    }
  }
  for (const key of ['key_scale', 'language', 'time_signature'] as const) {
    const value = input[key]
    if (value === undefined) continue
    if (typeof value !== 'string' || byteLength(value) > 80) issues.push(`${key} 最长 80 字符`)
  }

  if (operation === 'txt2image' || operation === 'image2image') {
    numberField('width', 1, 8192)
    numberField('height', 1, 8192)
  }
  if (operation === 'image2videofl2va' || operation === 'image2videoref2va') {
    const aspect = input['aspect']
    if (aspect !== undefined && !(GENERATION_ASPECTS as readonly string[]).includes(aspect as string)) {
      issues.push(`aspect 只允许 ${GENERATION_ASPECTS.join('/')}`)
    }
    numberField('megapixels', 0.01, 16)
    numberField('duration', 1, 60)
  }
  if (operation === 'txt2audio') {
    numberField('duration', 1, 600)
    numberField('bpm', 1, 400)
  }
  return issues
}

/** 单条素材引用（创建请求 `inputs[]` 的一项；只允许这三个字段）。 */
export interface GenerationInputRef {
  readonly asset_id: string
  readonly role: AssetRole
  readonly ordinal: number
}

/**
 * 按角色分组、依给定顺序分配 ordinal（同 role 从 1 连续）。
 * asset 重复时返回 null（不猜——调用方先去重）。
 */
export function buildInputRefs(
  entries: ReadonlyArray<{ assetId: string; role: AssetRole }>,
): GenerationInputRef[] | null {
  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.assetId)) return null
    seen.add(entry.assetId)
  }
  const counters: Record<AssetRole, number> = { image: 0, video: 0, audio: 0 }
  return entries.map((entry) => {
    counters[entry.role] += 1
    return { asset_id: entry.assetId, role: entry.role, ordinal: counters[entry.role]! }
  })
}

/**
 * 校验 `inputs[]` 是否满足该 operation 的角色数量与 ordinal 规则
 * （同 role ordinal 从 1 连续唯一；同一 asset 不得重复，§6.5）。
 * 返回问题清单（空数组 = 合法）。
 */
export function validateInputRefs(
  operation: GenerationOperation,
  refs: ReadonlyArray<GenerationInputRef>,
): string[] {
  const issues: string[] = []
  const spec = OPERATION_ASSET_SPECS[operation]
  const counts: Record<AssetRole, number> = { image: 0, video: 0, audio: 0 }
  const seenAssets = new Set<string>()
  const ordinals: Record<AssetRole, Set<number>> = { image: new Set(), video: new Set(), audio: new Set() }
  for (const ref of refs) {
    if (!isAssetRole(ref.role)) {
      issues.push(`未知素材角色: ${String(ref.role)}`)
      continue
    }
    counts[ref.role] += 1
    if (seenAssets.has(ref.asset_id)) issues.push(`同一素材重复引用: ${ref.asset_id}`)
    seenAssets.add(ref.asset_id)
    if (!ordinals[ref.role].has(ref.ordinal)) ordinals[ref.role].add(ref.ordinal)
    else issues.push(`${ref.role} 的 ordinal ${ref.ordinal} 重复`)
  }
  for (const role of ['image', 'video', 'audio'] as const) {
    const range = spec[role]
    if (range === undefined) {
      if (counts[role] > 0) issues.push(`${operation} 不接受 ${role} 素材`)
      continue
    }
    if (counts[role] < range.min || counts[role] > range.max) {
      issues.push(`${operation} 的 ${role} 素材数量须为 ${range.min}..${range.max}，收到 ${counts[role]}`)
    }
    for (let i = 1; i <= counts[role]; i += 1) {
      if (!ordinals[role].has(i)) issues.push(`${role} 的 ordinal 必须从 1 连续，缺少 ${i}`)
    }
  }
  const total = counts.image + counts.video + counts.audio
  if (total < spec.total.min || total > spec.total.max) {
    issues.push(`${operation} 素材总数须为 ${spec.total.min}..${spec.total.max}，收到 ${total}`)
  }
  return issues
}

// ── 任务快照与状态机 ─────────────────────────────────────────────────────────

/** 任务状态全集（§6.9.3）。 */
export const GENERATION_STATUSES = [
  'created',
  'credit_held',
  'queued',
  'submitted',
  'running',
  'finalizing',
  'succeeded',
  'failed',
  'cancel_requested',
  'canceled',
  'timeout',
] as const

export type GenerationStatus = (typeof GENERATION_STATUSES)[number]

export function isGenerationStatus(value: unknown): value is GenerationStatus {
  return (GENERATION_STATUSES as readonly string[]).includes(value as string)
}

/** 服务端终态集合（`terminal === true` 的四个状态；§6.9.3）。 */
export const TERMINAL_GENERATION_STATUSES
  = ['succeeded', 'failed', 'canceled', 'timeout'] as const satisfies readonly GenerationStatus[]

export function isTerminalGenerationStatus(status: GenerationStatus): boolean {
  return (TERMINAL_GENERATION_STATUSES as readonly string[]).includes(status)
}

/** 计费状态（§6.9.3）。 */
export type GenerationBillingStatus = 'none' | 'held' | 'committed' | 'released'

/** 输出类型（§6.10：image/video/audio 走 content 端点；text/json 内联在快照里）。 */
export type GenerationOutputType = 'image' | 'video' | 'audio' | 'text' | 'json'

/** 单条输出。二进制输出只有 `content_url`（受保护相对路径，不是 CDN/Provider URL）。 */
export interface GenerationOutput {
  readonly ordinal: number
  readonly type: GenerationOutputType
  readonly mime_type: string
  /** 二进制输出才有；Host 侧按 ordinal 去 content 端点取字节。 */
  readonly content_url?: string
  /** 文本理解（image2vl/video2vl）内联文本。 */
  readonly text?: string
  /** ASR 结构化输出（字段名与旧后端一致，asr-transcript.ts 适配不变）。 */
  readonly txt?: string
  readonly txt_word?: string
  readonly txt_segment?: string
  readonly width?: number
  readonly height?: number
}

/** 任务错误（`error` 非 null 时的形状）。 */
export interface GenerationError {
  readonly code: string
  readonly message: string
}

/**
 * 任务快照（创建 202 响应与 poll 响应同构，§6.8/§6.9.2）。
 * `version` 是单调递增轮询游标；`terminal` 是唯一终态判据。
 */
export interface GenerationSnapshot {
  readonly id: string
  readonly model_id?: string
  readonly operation: GenerationOperation
  readonly status: GenerationStatus
  readonly version: number
  readonly progress: number
  readonly billing_status: GenerationBillingStatus
  readonly terminal: boolean
  readonly poll_after_ms?: number
  readonly outputs: readonly GenerationOutput[]
  readonly error: GenerationError | null
  readonly created_at?: string
  readonly updated_at?: string
}

/** 从服务端 payload 解析快照；形状不对返回 null（不猜，宁可当一次坏帧处理）。 */
export function parseGenerationSnapshot(payload: unknown): GenerationSnapshot | null {
  if (typeof payload !== 'object' || payload === null) return null
  const raw = payload as Record<string, unknown>
  if (typeof raw['id'] !== 'string' || raw['id'].length === 0) return null
  if (!isGenerationOperation(raw['operation'])) return null
  if (!isGenerationStatus(raw['status'])) return null
  if (typeof raw['version'] !== 'number' || !Number.isInteger(raw['version']) || raw['version'] < 0) return null
  if (typeof raw['terminal'] !== 'boolean') return null
  const outputs = Array.isArray(raw['outputs']) ? parseGenerationOutputs(raw['outputs']) : null
  if (outputs === null) return null
  const billing = raw['billing_status']
  const billingStatus = billing === 'none' || billing === 'held' || billing === 'committed' || billing === 'released'
    ? billing
    : 'none'
  const error = parseGenerationError(raw['error'])
  const snapshot: {
    id: string
    operation: GenerationOperation
    status: GenerationStatus
    version: number
    progress: number
    billing_status: GenerationBillingStatus
    terminal: boolean
    outputs: GenerationOutput[]
    error: GenerationError | null
    model_id?: string
    poll_after_ms?: number
    created_at?: string
    updated_at?: string
  } = {
    id: raw['id'],
    operation: raw['operation'],
    status: raw['status'],
    version: raw['version'],
    progress: typeof raw['progress'] === 'number' && Number.isFinite(raw['progress'])
      ? Math.min(100, Math.max(0, raw['progress']))
      : 0,
    billing_status: billingStatus,
    terminal: raw['terminal'],
    outputs,
    error,
  }
  if (typeof raw['model_id'] === 'string') snapshot.model_id = raw['model_id']
  if (typeof raw['poll_after_ms'] === 'number' && Number.isFinite(raw['poll_after_ms'])) {
    snapshot.poll_after_ms = raw['poll_after_ms']
  }
  if (typeof raw['created_at'] === 'string') snapshot.created_at = raw['created_at']
  if (typeof raw['updated_at'] === 'string') snapshot.updated_at = raw['updated_at']
  return snapshot
}

function parseGenerationError(payload: unknown): GenerationError | null {
  if (payload === null || payload === undefined) return null
  if (typeof payload !== 'object') return null
  const raw = payload as Record<string, unknown>
  if (typeof raw['code'] !== 'string' || typeof raw['message'] !== 'string') return null
  return { code: raw['code'], message: raw['message'] }
}

/** 解析 outputs 数组；任何一项形状不对整体返回 null（契约坏了不该静默丢输出）。 */
export function parseGenerationOutputs(payload: unknown): GenerationOutput[] | null {
  if (!Array.isArray(payload)) return null
  const outputs: GenerationOutput[] = []
  for (const item of payload) {
    const parsed = parseGenerationOutput(item)
    if (parsed === null) return null
    outputs.push(parsed)
  }
  return outputs
}

function parseGenerationOutput(payload: unknown): GenerationOutput | null {
  if (typeof payload !== 'object' || payload === null) return null
  const raw = payload as Record<string, unknown>
  const ordinal = raw['ordinal']
  if (typeof ordinal !== 'number' || !Number.isInteger(ordinal) || ordinal < 0) return null
  const type = raw['type']
  if (type !== 'image' && type !== 'video' && type !== 'audio' && type !== 'text' && type !== 'json') return null
  if (typeof raw['mime_type'] !== 'string') return null
  const output: {
    ordinal: number
    type: GenerationOutputType
    mime_type: string
    content_url?: string
    text?: string
    txt?: string
    txt_word?: string
    txt_segment?: string
    width?: number
    height?: number
  } = { ordinal, type, mime_type: raw['mime_type'] }
  if (typeof raw['content_url'] === 'string') output.content_url = raw['content_url']
  if (typeof raw['text'] === 'string') output.text = raw['text']
  if (typeof raw['txt'] === 'string') output.txt = raw['txt']
  if (typeof raw['txt_word'] === 'string') output.txt_word = raw['txt_word']
  if (typeof raw['txt_segment'] === 'string') output.txt_segment = raw['txt_segment']
  if (typeof raw['width'] === 'number' && Number.isFinite(raw['width'])) output.width = raw['width']
  if (typeof raw['height'] === 'number' && Number.isFinite(raw['height'])) output.height = raw['height']
  return output
}

// ── 报价 ─────────────────────────────────────────────────────────────────────

/** 报价响应（§3.7；最多四位小数，最终冻结以创建响应为准）。 */
export interface GenerationQuote {
  readonly estimated_credits: number
}

/** 解析报价响应；缺失/非有限值/负数一律 null（调用方 fail-open 不阻断提交）。 */
export function parseGenerationQuote(payload: unknown): GenerationQuote | null {
  if (typeof payload !== 'object' || payload === null) return null
  const value = (payload as Record<string, unknown>)['estimated_credits']
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return { estimated_credits: value }
}

// ── 素材三段式上传 ───────────────────────────────────────────────────────────

/** presign 请求体（§6.6.1；`type` 只允许 image/video/audio）。 */
export interface AssetPresignRequest {
  readonly type: AssetType
  readonly filename: string
  readonly content_type: string
  readonly size_bytes: number
}

/** asset 记录摘要（presign/complete 都返回）。 */
export interface AssetSummary {
  readonly id: string
  readonly type: AssetType
  readonly status: string
  readonly mime_type?: string
  readonly expires_at?: string
  readonly created_at?: string
  readonly updated_at?: string
}

/** presign 响应（§6.6.1）。`upload_url` 必须过 {@link isSafeAssetUploadUrl} 才能发 PUT。 */
export interface AssetPresignResponse {
  readonly asset: AssetSummary
  readonly upload_url: string
  /** PUT 时必须**原样**携带的请求头（通常只有 content-type）。 */
  readonly headers: Record<string, string>
  readonly expires_at?: string
}

/** complete 请求体（§6.6.3；checksum 是原始字节 SHA-256 的十六进制）。 */
export interface AssetCompleteRequest {
  readonly asset_id: string
  readonly checksum_sha256: string
  readonly size_bytes: number
}

/** SHA-256 十六进制校验（小写；大写也接受——服务端两种都收，本地归一小写）。 */
export function normalizeChecksumHex(value: string): string | null {
  if (!/^[0-9a-fA-F]{64}$/.test(value)) return null
  return value.toLowerCase()
}

/** 解析 presign 响应；asset.id / upload_url / headers 任一缺失返回 null。 */
export function parseAssetPresignResponse(payload: unknown): AssetPresignResponse | null {
  if (typeof payload !== 'object' || payload === null) return null
  const raw = payload as Record<string, unknown>
  const assetRaw = raw['asset']
  if (typeof assetRaw !== 'object' || assetRaw === null) return null
  const asset = assetRaw as Record<string, unknown>
  if (!isUuid(asset['id'])) return null
  if (!isAssetRole(asset['type'])) return null
  if (typeof raw['upload_url'] !== 'string' || raw['upload_url'].length === 0) return null
  const headersRaw = raw['headers']
  const headers: Record<string, string> = {}
  if (headersRaw !== undefined && headersRaw !== null && typeof headersRaw === 'object') {
    for (const [key, value] of Object.entries(headersRaw as Record<string, unknown>)) {
      if (typeof value === 'string') headers[key] = value
    }
  }
  const summary: {
    id: string
    type: AssetType
    status: string
    mime_type?: string
    expires_at?: string
    created_at?: string
    updated_at?: string
  } = { id: asset['id'], type: asset['type'], status: typeof asset['status'] === 'string' ? asset['status'] : '' }
  if (typeof asset['mime_type'] === 'string') summary.mime_type = asset['mime_type']
  if (typeof asset['expires_at'] === 'string') summary.expires_at = asset['expires_at']
  if (typeof asset['created_at'] === 'string') summary.created_at = asset['created_at']
  if (typeof asset['updated_at'] === 'string') summary.updated_at = asset['updated_at']
  const response: {
    asset: AssetSummary
    upload_url: string
    headers: Record<string, string>
    expires_at?: string
  } = { asset: summary, upload_url: raw['upload_url'], headers }
  if (typeof raw['expires_at'] === 'string') response.expires_at = raw['expires_at']
  return response
}

/** 解析 complete 响应；`status` 不是 ready / id 非 UUID 返回 null（§6.6.3：ready 才可用）。 */
export function parseAssetCompleteResponse(payload: unknown): AssetSummary | null {
  if (typeof payload !== 'object' || payload === null) return null
  const raw = payload as Record<string, unknown>
  if (!isUuid(raw['id'])) return null
  if (!isAssetRole(raw['type'])) return null
  if (raw['status'] !== 'ready') return null
  const summary: {
    id: string
    type: AssetType
    status: string
    mime_type?: string
    expires_at?: string
    created_at?: string
    updated_at?: string
  } = { id: raw['id'], type: raw['type'], status: raw['status'] }
  if (typeof raw['mime_type'] === 'string') summary.mime_type = raw['mime_type']
  if (typeof raw['expires_at'] === 'string') summary.expires_at = raw['expires_at']
  if (typeof raw['created_at'] === 'string') summary.created_at = raw['created_at']
  if (typeof raw['updated_at'] === 'string') summary.updated_at = raw['updated_at']
  return summary
}

// ── 轮询与查询参数 ───────────────────────────────────────────────────────────

/**
 * 长轮询 `wait` 参数格式化：服务端/Host 都限制 0..25 秒（§6.9.2），超界钳制，
 * 输出 `25s` 形态的字符串。
 */
export function formatPollWait(seconds: number): string {
  const clamped = Math.min(25, Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0)))
  return `${clamped}s`
}

/**
 * 创建请求的幂等键约束（§6.8：trim 后 1-200 字节、可打印 ASCII）——与计费
 * checkout 的 `isValidIdempotencyKey` 同一规则，这里给出生成面自己的引用名，
 * 避免两处 import 语义漂移。
 */
export function isValidGenerationIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && /^[\x21-\x7e]{1,200}$/.test(value)
}

/** UUID 传输前校验（路径拼接防注入：只允许 UUID 形态）。 */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)
}

/** generation UUID 的传输前校验（路径拼接防注入：只允许 UUID 形态）。 */
export function isGenerationId(value: unknown): value is string {
  return isUuid(value)
}

/** 任务列表查询参数（§6.9.4；limit Host 收 1-200 默认 50）。 */
export interface GenerationListQuery {
  readonly limit?: number
  readonly status?: GenerationStatus
  readonly cursor?: string
}

/** 组装列表查询串（不带头问号；非法参数直接忽略——列表是恢复兜底，宁缺勿错）。 */
export function buildGenerationListQuery(query: GenerationListQuery): string {
  const params = new URLSearchParams()
  if (query.limit !== undefined && Number.isInteger(query.limit) && query.limit >= 1 && query.limit <= 200) {
    params.set('limit', String(query.limit))
  }
  if (query.status !== undefined && isGenerationStatus(query.status)) params.set('status', query.status)
  if (query.cursor !== undefined && query.cursor !== '') params.set('cursor', query.cursor)
  const text = params.toString()
  return text === '' ? '' : `?${text}`
}

// ── 目录（/v1/models 媒体侧消费辅助） ────────────────────────────────────────

/**
 * 读模型声明的 operations（`capabilities.operations`，§6.4）。
 * 目录未声明时返回 null——调用方按「无法确认」处理，不许当空集（那会把
 * 「目录没配」与「模型不支持」混淆）。
 */
export function modelOperations(capabilities: Record<string, unknown>): string[] | null {
  const operations = capabilities['operations']
  if (!Array.isArray(operations)) return null
  const list = operations.filter((item): item is string => typeof item === 'string')
  return list.length === operations.length && list.length > 0 ? list : null
}
