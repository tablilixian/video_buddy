/**
 * Canvas Studio 统一错误处理系统（核心）。
 *
 * 设计目标（对应产品需求）：
 *  1. 受众分层 —— 普通用户看不懂、不会处理的「开发期/诊断类」错误，默认不展示给用户，
 *     只在开发模式落到日志；AI 能自行恢复的错误静默处理、不报用户。
 *  2. 结构化 —— 所有错误都是 `CanvasStudioError`，带 `code / severity / audience /
 *     recoverability / channel`，下游不再靠字符串匹配。
 *  3. 可收敛 —— 错误码在注册表（catalog）集中登记，新增必须显式注册并声明元数据。
 *
 * 该模块不依赖任何项目内模块，可在 Host（Node）与 Client（浏览器）两侧复用。
 * 展示层（D1 对话回显 / D2 节点错误态 / D3 效果测试面板 / D4 toast / D5 日志）的
 * 实际渲染由各端在拿到 `routeError()` 的 `RouteAction` 后自行落实。
 */

// ───────────────────────────────────────────────────────────────────────────
// 1. 枚举与类型
// ───────────────────────────────────────────────────────────────────────────

/** 严重等级。
 * - S1 阻塞/数据风险：任务无法继续，或可能产生错误数据（需立即干预）。
 * - S2 可恢复失败：本次失败但可重试/换路（用户或 AI 按提示处理即可）。
 * - S3 提示/信息：非失败，仅告知（如降级生效、参数被忽略）。
 */
export type ErrorSeverity = 'S1' | 'S2' | 'S3'

/**
 * 受众（可多选）。决定「谁必须知道这条错误」。
 * - user：终端用户必须知情（且能看懂、知道怎么办）。
 * - agent：AI 需知情以自主恢复（不一定展示给用户）。
 * - developer：仅开发/排障有用——用户看不懂也无从下手，生产环境对用户隐藏。
 */
export type ErrorAudience = 'user' | 'agent' | 'developer'

/**
 * 可恢复性。
 * - auto：AI 可自行重试/换路恢复，**绝不展示给用户**（仅开发期记日志）。
 * - guided：需用户或 AI 按 recoveryHint 重试。
 * - fatal：需人工介入（配置缺失 / 权限 / 数据损坏）。
 */
export type ErrorRecoverability = 'auto' | 'guided' | 'fatal'

/**
 * 首选展示面（仅当错误需要被展示时生效）。
 * - conversation：回显到 agent 对话（D1）。
 * - node：画布节点错误态（D2）。
 * - toast：非阻塞浮层（D4，`.csToast-error`）。
 * - effectTest：效果测试面板（D3）。
 * - log：仅日志（D5，开发期）。
 */
export type ErrorChannel = 'conversation' | 'node' | 'toast' | 'effectTest' | 'log'

/** 谁负责恢复。 */
export type RecoverableBy = 'ai' | 'user' | 'none'

/** 错误规格（注册表条目）。`userMessage` / `devMessage` 支持 `{name}` 模板。 */
export interface CanvasErrorSpec {
  /** 唯一错误码，形如 `CS-<MODULE>-<NN>`。 */
  code: string
  /** 所属模块，用于分组与文档。 */
  module: string
  severity: ErrorSeverity
  /** 至少一项。 */
  audience: ErrorAudience[]
  recoverability: ErrorRecoverability
  /** 首选展示面。 */
  channel: ErrorChannel
  /** 脱敏后的用户文案（无 stack / 无内网地址 / 无原始 provider blob）。 */
  userMessage: string
  /** 原始诊断细节（stack、内网地址、provider 原始错误），仅开发期可见。 */
  devMessage?: string | undefined
  /** 恢复指引。 */
  recoveryHint?: string | undefined
  /** 默认按 recoverability 推导；可显式覆盖。 */
  recoverableBy?: RecoverableBy
}

// ───────────────────────────────────────────────────────────────────────────
// 2. 统一错误类
// ───────────────────────────────────────────────────────────────────────────

export class CanvasStudioError extends Error {
  readonly code: string
  readonly severity: ErrorSeverity
  readonly audience: ErrorAudience[]
  readonly recoverability: ErrorRecoverability
  readonly channel: ErrorChannel
  readonly userMessage: string
  readonly devMessage: string | undefined
  readonly recoveryHint: string | undefined
  readonly recoverableBy: RecoverableBy
  readonly params: Readonly<Record<string, unknown>>

  constructor(spec: CanvasErrorSpec, params: Record<string, unknown> = {}) {
    const userMessage = renderTemplate(spec.userMessage, params)
    super(userMessage)
    this.name = 'CanvasStudioError'
    this.code = spec.code
    this.severity = spec.severity
    this.audience = spec.audience
    this.recoverability = spec.recoverability
    this.channel = spec.channel
    this.userMessage = userMessage
    this.devMessage = spec.devMessage ? renderTemplate(spec.devMessage, params) : undefined
    this.recoveryHint = spec.recoveryHint
    this.recoverableBy =
      spec.recoverableBy ?? (spec.recoverability === 'auto' ? 'ai' : spec.recoverability === 'guided' ? 'user' : 'none')
    this.params = params
  }

  /** 跨进程序列化（Host→Client 经 tool/result 或会话事件传递时使用）。 */
  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      severity: this.severity,
      audience: this.audience,
      recoverability: this.recoverability,
      channel: this.channel,
      userMessage: this.userMessage,
      devMessage: this.devMessage,
      recoveryHint: this.recoveryHint,
      recoverableBy: this.recoverableBy,
      params: this.params,
    }
  }

  /** 从 toJSON 结果重建（在另一端恢复为结构化错误）。 */
  static fromJSON(data: Record<string, unknown>): CanvasStudioError {
    const spec: CanvasErrorSpec = {
      code: String(data.code ?? 'CS-UNC-000'),
      module: String(data.module ?? 'unknown'),
      severity: (data.severity as ErrorSeverity) ?? 'S2',
      audience: (data.audience as ErrorAudience[]) ?? ['agent'],
      recoverability: (data.recoverability as ErrorRecoverability) ?? 'guided',
      channel: (data.channel as ErrorChannel) ?? 'conversation',
      userMessage: String(data.userMessage ?? '未知错误'),
      devMessage: typeof data.devMessage === 'string' ? data.devMessage : undefined,
      recoveryHint: typeof data.recoveryHint === 'string' ? data.recoveryHint : undefined,
      recoverableBy: (data.recoverableBy as RecoverableBy) ?? 'none',
    }
    const err = new CanvasStudioError(spec, (data.params as Record<string, unknown>) ?? {})
    return err
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 3. 注册表
// ───────────────────────────────────────────────────────────────────────────

const REGISTRY = new Map<string, CanvasErrorSpec>()

/** 注册一条错误规格。重复码 / 元数据自相矛盾会立即抛错（开发期即可发现）。 */
export function registerError(spec: CanvasErrorSpec): void {
  if (REGISTRY.has(spec.code)) {
    throw new Error(`[error-system] 重复错误码: ${spec.code}`)
  }
  validateSpec(spec)
  REGISTRY.set(spec.code, spec)
}

/** 读取已注册规格。 */
export function getErrorSpec(code: string): CanvasErrorSpec | undefined {
  return REGISTRY.get(code)
}

/** 全部已注册规格（用于文档生成 / 自检）。 */
export function listErrorSpecs(): CanvasErrorSpec[] {
  return [...REGISTRY.values()]
}

/** 规格一致性校验（约束后续开发）。 */
function validateSpec(spec: CanvasErrorSpec): void {
  if (spec.audience.length === 0) {
    throw new Error(`[error-system] ${spec.code}: audience 不能为空`)
  }
  // 自动恢复的错误绝不面向用户展示。
  if (spec.recoverability === 'auto' && spec.audience.includes('user')) {
    throw new Error(`[error-system] ${spec.code}: recoverability=auto 时 audience 不能含 'user'（自动恢复不报用户）`)
  }
  // 面向用户却只走日志面，属矛盾配置。
  if (spec.audience.includes('user') && spec.recoverability !== 'auto' && spec.channel === 'log') {
    throw new Error(`[error-system] ${spec.code}: 面向用户的错误 channel 不能为 'log'`)
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 4. 便捷抛出 / 边界包装
// ───────────────────────────────────────────────────────────────────────────

/** 按已注册码抛出（未注册直接抛开发期错误）。 */
export function throwError(code: string, params: Record<string, unknown> = {}): never {
  const spec = REGISTRY.get(code)
  if (!spec) throw new Error(`[error-system] 未注册的错误码: ${code}`)
  throw new CanvasStudioError(spec, params)
}

/** 把遗留的裸 Error / 未知异常收敛为统一错误（用于在工具边界兜底）。 */
export function asCanvasError(e: unknown): CanvasStudioError {
  if (e instanceof CanvasStudioError) return e
  const original = e instanceof Error ? e.message : String(e)
  const stack = e instanceof Error ? e.stack : undefined
  return new CanvasStudioError(UNCAUGHT_SPEC, { original, stack })
}

const UNCAUGHT_SPEC: CanvasErrorSpec = {
  code: 'CS-UNC-000',
  module: 'uncaught',
  severity: 'S2',
  audience: ['agent', 'developer'],
  recoverability: 'guided',
  channel: 'log',
  userMessage: '操作未完成（内部错误），请重试或联系开发。',
  devMessage: '未收敛的异常：{original}\n{stack}',
  recoveryHint: '检查抛出点是否已接入 error-system；必要时登记具体错误码。',
}

// ───────────────────────────────────────────────────────────────────────────
// 5. 渲染路由（纯函数，可单测）
// ───────────────────────────────────────────────────────────────────────────

export interface RouteEnv {
  /** 开发模式：developer 受众的错误也会显式呈现，且展示文案附 dev 细节。 */
  devMode: boolean
}

export type RouteAction =
  | { kind: 'silent-retry'; spec: CanvasErrorSpec; dev: string }
  | { kind: 'log-only'; spec: CanvasErrorSpec; dev: string }
  | { kind: 'surface'; spec: CanvasErrorSpec; channel: ErrorChannel; message: string; recoveryHint: string | undefined }

/**
 * 决定一条错误的「处置动作」。
 * - auto 恢复：永不报用户；开发期记 dev 细节，否则静默触发重试。
 * - 仅 developer 受众：生产环境对用户完全隐藏，只落日志。
 * - 需展示：按 channel 路由；开发模式文案附带 dev 细节。
 */
export function routeError(err: CanvasStudioError, env: RouteEnv): RouteAction {
  // 1. 自动恢复：绝不报用户。
  if (err.recoverability === 'auto') {
    const dev = err.devMessage ?? err.userMessage
    if (env.devMode) return { kind: 'log-only', spec: getSpec(err), dev }
    return { kind: 'silent-retry', spec: getSpec(err), dev }
  }
  // 2. 非用户受众（agent / developer）：生产环境隐藏，仅日志。
  const isUserFacing = err.audience.includes('user')
  if (!isUserFacing) {
    const dev = err.devMessage ?? err.userMessage
    return { kind: 'log-only', spec: getSpec(err), dev }
  }
  // 3. 需展示给用户 / agent。
  const channel = err.channel
  const message = env.devMode
    ? `${err.userMessage}${err.devMessage ? `\n[dev] ${err.devMessage}` : ''}`
    : err.userMessage
  return { kind: 'surface', spec: getSpec(err), channel, message, recoveryHint: err.recoveryHint }
}

function getSpec(err: CanvasStudioError): CanvasErrorSpec {
  // routeError 接收的是实例，规格可从注册表取（保证是最新登记值）。
  const spec = REGISTRY.get(err.code)
  return spec ?? {
    code: err.code,
    module: 'unknown',
    severity: err.severity,
    audience: err.audience,
    recoverability: err.recoverability,
    channel: err.channel,
    userMessage: err.userMessage,
    devMessage: err.devMessage,
    recoveryHint: err.recoveryHint,
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 6. 开发模式开关 + 文案脱敏
// ───────────────────────────────────────────────────────────────────────────

let devModeFlag = typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production'

/** 设置开发模式（两端入口在启动时调用一次）。 */
export function setDevMode(on: boolean): void {
  devModeFlag = on
}

/** 读取开发模式。 */
export function isDevMode(): boolean {
  return devModeFlag
}

/**
 * 把任意动态字符串脱敏为可展示给用户的文案：
 * 抹掉 IPv4/IPv6、http(s) 地址、绝对路径、stack 痕迹。
 * 用于「把 provider / 系统原始错误透传展示」前的最后一道清洗。
 */
export function sanitizeForUser(raw: string): string {
  return raw
    .replace(/https?:\/\/\S+/gi, '(地址已隐藏)')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '(地址已隐藏)')
    .replace(/\b[0-9a-fA-F:]+:[0-9a-fA-F]{1,4}\b/g, '(地址已隐藏)')
    .replace(/(?:\/[\w.\-]+){3,}/g, '(路径已隐藏)')
    .replace(/\bat [\w./\\-]+:\d+:\d+\b/g, '')
    .replace(/\b\w+\.\w+\.\w+\(.*\)\b/g, '(内部调用)')
    .trim()
}

/** 简单 `{name}` 模板替换。 */
export function renderTemplate(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key]
    if (value === undefined || value === null) return `{${key}}`
    return typeof value === 'string' || typeof value === 'number' ? String(value) : JSON.stringify(value)
  })
}
