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

/**
 * UI 三级处置（三态错误卡的按钮/文案分级）。
 *
 * 定义在这里而不是 `error-kind.ts`：它是**错误规格的一部分**（登记时就声明好），
 * 而 `error-kind.ts` 只是它的消费者 —— 定义放那边会形成 error-system → error-kind
 * 的循环依赖。
 *
 * - `retryable`：重试即可（默认；拿不准就归这里，不误导用户去改配置）。
 * - `config`：缺配置，主行动是「去设置」而不是重试（重试必然复发）。
 * - `unreachable`：服务不可达，提示先检查后端。
 */
export type ErrorUiKind = 'retryable' | 'config' | 'unreachable'

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
  /**
   * UI 三级处置（三态错误卡）。**省略即 `retryable`** —— 只有在「重试必然复发」
   * 或「服务确实连不上」时才需要显式声明，避免每条错误都被迫填一遍。
   */
  uiKind?: ErrorUiKind
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

/**
 * 错误码命名空间：`CS-<MODULE>-<后缀>`（模块名首字符必须是字母，其后可含数字 ——
 * `H3IR` 就是这种；后缀允许字母或数字）。
 *
 * 后缀惯例是两位序号（`CS-NET-009`），但**通用兜底码**（`CS-USER-ERR` /
 * `CS-DEV-ERR` / `CS-CLIENT-ERR`）刻意用字母后缀：它们不是「第 N 条错误」，
 * 而是覆盖大量同类校验的收口码（见 catalog 注释「通用三码」），编成号码反而
 * 暗示存在一份不存在的编号体系。故后缀允许字母或数字。
 */
const CODE_PATTERN = /^CS-[A-Z][A-Z0-9]*-[A-Z0-9]+$/

/** 是否是本系统的错误码（其它框架码如 `TOOL_ABORTED` 一律不是）。 */
export function isStudioErrorCode(code: unknown): code is string {
  return typeof code === 'string' && CODE_PATTERN.test(code)
}

/**
 * 这个码是否**必须让用户知情**（生产环境也要展示）。
 *
 * 与 `routeError` 第 1–2 步同源，供「已经拿到渲染好的文案、只需要露面结论」的
 * 消费方复用（如客户端拿到跨进程传过来的 `{ code, message }` 后决定要不要画节点
 * 错误标）。规则只有一处定义，改这里即同时改两端。
 *
 * 未登记的码按「展示」处理：宁可多显示一条不该显示的，也不要静默吞掉真错误。
 */
export function codeIsUserFacing(code: string): boolean {
  // 诊断模式（CV-234）：一切错误都当作用户可见。必须放在最前面 —— 否则「被隐藏」
  // 的那些码在画布上永远不画红标，开关也就管不到这条读取路径。
  if (visibilityFlag === 'all') return true
  const spec = REGISTRY.get(code)
  if (spec === undefined) return true
  if (spec.recoverability === 'auto') return false
  return spec.audience.includes('user')
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
  // UI 三级处置只服务于「会被渲染成三态错误卡」的错误；没人看得见的错误声明分级
  // 是永远读不到的死配置（客户端永远走不到它的渲染分支）。
  if (spec.uiKind !== undefined && !spec.audience.includes('user')) {
    throw new Error(`[error-system] ${spec.code}: uiKind 只对含 'user' 受众的错误有意义`)
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

/**
 * 按已注册码**构造**统一错误（不抛出）——供「决定要抛什么」与「真正 throw」分离的
 * 调用点使用（如 executor / generate-queue 的取消路径：先构造，由调用方 throw）。
 * 未注册的码返回带说明的普通 Error（不静默）。
 */
export function makeCanvasError(code: string, params: Record<string, unknown> = {}): Error {
  const spec = REGISTRY.get(code)
  if (!spec) return new Error(`[error-system] 未注册的错误码: ${code}`)
  return new CanvasStudioError(spec, params)
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

// 兜底规格必须**登记进注册表**，否则 `codeIsUserFacing('CS-UNC-000')` 会走
// 「未登记码按展示处理」的 fail-open 分支返回 true，而实例侧的 `routeError`
// 读的是规格本身、判出 log-only —— 同一个码在边界两侧结论相反，未收敛的内部
// 异常就会在客户端画出红标（Host 却认为它只该进日志）。
// 在 error-system 内自注册（而不是放进 catalog）：`asCanvasError` 的调用方
// 未必 import 过 catalog，自注册才能保证这个码在任何入口下都可查。
registerError(UNCAUGHT_SPEC)

// ───────────────────────────────────────────────────────────────────────────
// 5. 渲染路由（可单测；除 env 外还读进程级的 `visibilityFlag`，见 `routeError`）
// ───────────────────────────────────────────────────────────────────────────

export interface RouteEnv {
  /**
   * 开发模式：**只影响「需展示」错误的文案**——会在 userMessage 后附加 `[dev]` 细节。
   * 它**不**改变受众判定：developer 受众的错误在生产与开发环境下都是 `log-only`
   * （见 `routeError` 第 2 步），开发期靠日志看细节，不靠弹给用户。
   *
   * ⚠️ 别与「错误可见性」混：可见性（`setErrorVisibility`，CV-234）是**进程级标志**、
   * 由设置页的「诊断」开关驱动，**它才**能改变受众判定（`all` 时一切可见）；
   * 本字段只负责往文案后加细节。
   */
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
 *
 * ⚠️ 本函数**不是纯的**：除 `env` 外还读进程级的 `visibilityFlag`（诊断开关）。
 * 默认值 `'audience'` 就是生产行为，所以「不调 `setErrorVisibility`」= 老行为，
 * 测试不必为它传参。
 */
export function routeError(err: CanvasStudioError, env: RouteEnv): RouteAction {
  // 诊断模式（CV-234）：绕过下面两条隐藏规则，一律走「需展示」。
  const revealAll = visibilityFlag === 'all'
  // 1. 自动恢复：绝不报用户。
  if (err.recoverability === 'auto' && !revealAll) {
    const dev = err.devMessage ?? err.userMessage
    if (env.devMode) return { kind: 'log-only', spec: getSpec(err), dev }
    return { kind: 'silent-retry', spec: getSpec(err), dev }
  }
  // 2. 非用户受众（agent / developer）：生产环境隐藏，仅日志。
  const isUserFacing = revealAll || err.audience.includes('user')
  if (!isUserFacing) {
    const dev = err.devMessage ?? err.userMessage
    return { kind: 'log-only', spec: getSpec(err), dev }
  }
  // 3. 需展示给用户 / agent。
  // 诊断模式下把 `log` 面改走对话：`log` 没有渲染实现（D5 只落日志），照搬会得到
  // 「判定说已展示、屏幕上什么都没有」的假绿 —— 那正好把开关的用途废掉。
  const channel = revealAll && err.channel === 'log' ? 'conversation' : err.channel
  // 诊断模式下也附 dev 细节：这个开关的用途就是「看清到底发生了什么」。
  const message = env.devMode || revealAll
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
// 4.1 仅记录（不抛出）
// ───────────────────────────────────────────────────────────────────────────

/**
 * 仅记录一条已注册错误、不向上抛出——用于「告警但继续」的场景（如 long-request 的
 * undici dispatcher 警告）。记录内容由 `routeError` 决定：developer 受众在生产环境
 * 只落日志（用户无感），需要展示的错误按 devMode 附带 dev 细节。
 */
export function reportError(code: string, params: Record<string, unknown> = {}): void {
  const spec = REGISTRY.get(code)
  if (spec === undefined) {
    console.warn(`[error-system] 未注册的错误码: ${code}`)
    return
  }
  const err = new CanvasStudioError(spec, params)
  const action = routeError(err, { devMode: isDevMode() })
  if (action.kind === 'surface') {
    console.warn(`[canvas-studio][${code}] ${action.message}`)
  } else {
    console.warn(`[canvas-studio][${code}] ${action.dev}`)
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 6. 开发模式开关 + 文案脱敏
// ───────────────────────────────────────────────────────────────────────────

/**
 * 从环境变量推导开发模式。
 *
 * **默认安全**：只有显式声明为开发环境才返回 `true`。早先的实现是
 * `NODE_ENV !== 'production'`，而桌面端（`dsh-plugin-desktop`）**从不设置
 * `NODE_ENV`** ⇒ 打包后的应用里该表达式为 `true`，`[dev]` 细节会随「需展示」
 * 的文案一起露给用户。改为白名单后，漏设环境变量的后果是「少看细节」而不是
 * 「泄漏内部信息」。
 *
 * - `CANVAS_STUDIO_DEV_MODE=1`：本插件专用开关，优先级最高（跨平台可用，
 *   不需要改 `NODE_ENV` 而扰动词或其它包的 dev 行为）。
 * - `NODE_ENV=development`：常规约定。
 */
export function resolveDevModeFromEnv(env: Record<string, string | undefined> | undefined): boolean {
  if (env === undefined) return false
  if (env.CANVAS_STUDIO_DEV_MODE === '1') return true
  return env.NODE_ENV === 'development'
}

/** 读取当前进程环境（浏览器端无 `process` 时为 undefined ⇒ 生产行为）。 */
function processEnv(): Record<string, string | undefined> | undefined {
  return typeof process !== 'undefined' ? process.env : undefined
}

/**
 * 按**当前进程环境**推导开发模式 —— Host / Client 入口各调一次：
 * `setDevMode(resolveDevModeFromProcess())`。
 */
export function resolveDevModeFromProcess(): boolean {
  return resolveDevModeFromEnv(processEnv())
}

let devModeFlag = resolveDevModeFromProcess()

/** 设置开发模式（两端入口在启动时调用一次）。 */
export function setDevMode(on: boolean): void {
  devModeFlag = on
}

/** 读取开发模式。 */
export function isDevMode(): boolean {
  return devModeFlag
}

/**
 * 错误可见性（「诊断开关」，CV-234）。
 *
 * - `audience`（默认）：按受众判定 —— 只有「含 `user` 受众 **且** 非 `auto`」的错误
 *   会被展示，其余落日志或静默重试。这就是生产行为。
 * - `all`：**诊断模式** —— 绕过上面两条隐藏规则，所有错误一律当作「需展示」。
 *
 * ## 为什么需要一个开关
 *
 * 默认行为是「把一部分错误藏起来」，而**藏起来的东西没有可观察的迹象**：验收时无法
 * 区分「这条错误被正确隐藏了」与「这条错误根本没触发」。打开本开关就能看到全部，
 * 从而把「隐藏」这条规则本身变成可验证的。
 *
 * ## 为什么放设置里，而不是只用环境变量
 *
 * 值与其余设置项一样存在 `canvas-studio` 命名空间
 * （`CanvasStudioConfig.errorVisibility`）。Host 与 Client 是**两个独立的 JS 运行时**，
 * 各自在读到设置后调用 `setErrorVisibility()` 同步**自己进程内**的这个模块级标志 ——
 * 标志不共享，共享的是设置值。
 */
export type ErrorVisibility = 'audience' | 'all'

let visibilityFlag: ErrorVisibility = 'audience'

/** 设置错误可见性（Host / Client 各在读取设置后调用；默认 `'audience'`）。 */
export function setErrorVisibility(visibility: ErrorVisibility): void {
  visibilityFlag = visibility
}

/** 读取错误可见性。 */
export function getErrorVisibility(): ErrorVisibility {
  return visibilityFlag
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
