/**
 * Canvas Studio host half: the project registry (durable records under
 * `$DSH_HOME/canvas-studio/`) and its webServer HTTP face. The media tools
 * and asset serving land in P3.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { createRequire } from 'node:module'
import { isDeepStrictEqual } from 'node:util'
import { ProjectRegistry } from './projects.js'
import { AssetLibrary } from './asset-library.js'
import { registerStudioRoutes } from './routes.js'
import { createStudioTools, resolveProjectId } from './host-tools.js'
import { registerMinimaxSkills } from './skills/minimax-skills.js'
import { createPlaceholderTools } from './skills/placeholder-tools.js'
import { registerSkillRoutingPrompt } from './skills/routing-prompt.js'
import { registerTemplateChannelPrompt } from './skills/template-channel-prompt.js'
import { registerProjectPlanPrompt } from './plan-prompt.js'
import { registerAssetLibraryPrompt } from './asset-library-prompt.js'
import { registerStoryboardDisciplinePrompt } from './storyboard-discipline-prompt.js'
import { registerWorkflowModePrompt } from './workflow-mode-prompt.js'
import { registerActiveSkillsPrompt } from './active-skills-prompt.js'
import { setRuntimeConfig } from './generate.js'
// P2：Drama 鉴权闸开关（supabaseUrl 联动，见下方 syncDramaAuthRequired）。
import { setDramaAuthRequired } from './auth-session.js'
// 管理面（方案 P1/P2/P4，CV-355/356/357）：设备身份 + 账号编排 + 模型网关。
import { DeviceRegistry } from './device-registry.js'
import { installAccountState, markCreditsStale } from './account-state.js'
import { installBillingState } from './billing-state.js'
import type { CatalogModel } from './drama-management.js'
import { setGenerationSettledHook } from './generate-queue.js'
import {
  gatewayFingerprint, gatewayProfile, gatewayProviderOf, gatewayRow,
  publishGatewayCredential, readGatewayCatalog,
  writeGatewayCatalog, GATEWAY_ROUTE_NAME, GATEWAY_SETTINGS_NS,
  type CredentialsSink, type GatewayRow,
} from './gateway.js'
// 统一错误系统：Host 入口是「注册一次即全局生效」的唯一登记点（设计文档 §9）。
import { resolveDevModeFromProcess, setDevMode, setErrorVisibility } from './error-system.js'
import { registerStudioToolErrorBoundary, wrapStudioToolDefinition } from './tool-error-boundary.js'
// 骨架优先出片（2026-11-05）：里程碑时钟 —— 「故事板落地后 20 分钟内必须有一条成片」
// 的可见性来源。每次 canvas 工具返回都会带一行 T+ / 剩余分钟 / 当前最佳版本。
import { normalizeWorkflow } from './contracts/project.js'
import { setSpecGateAutoResolver } from './tool-error-boundary.js'
import { formatMilestoneClock, readAnchorState } from './render-anchor.js'
// P2-1（2026-11-05）：max-tokens 兜底 —— 宿主观察落 build/NEXT.md + 下一轮一次性提醒。
import { budgetGuardLine, renderBudgetNote, writeBudgetNote } from './budget-note.js'
import { emptyGuardCounters, guardNote, noteGuardCall, type GuardCounters } from './milestone-guard.js'
import './errors/catalog.js'
import {
  CanvasStudioConfig,
  type CanvasStudioConfigValue,
  DEFAULT_BUSINESS_API_BASE,
  DEFAULT_DRAMA_API_BASE,
  DEFAULT_DRAMA_API_KEY_REF,
  DEFAULT_FAL_API_KEY_REF,
  DEFAULT_SUPABASE_PUBLISHABLE_KEY,
  DEFAULT_SUPABASE_URL,
} from './host-config.js'
import { DEFAULT_BRAND_PRESET } from './brand.js'
import { DEFAULT_RESOLUTION } from './config.js'
import { DEFAULT_VIDEO_RESOLUTION_ID } from './resolution-tiers.js'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Stable Cordis plugin name matching the bundle patch row. */
export const name = 'canvas-studio'

/** Services required by the host plugin. */
export const inject = ['webServer', 'tools', 'skills', 'settings', 'systemPrompt']

/**
 * Plugin Config schema（0.2.1）：Loader 读取本命名导出，在装载/变更时校验并注入
 * `apply` 的第二参；运行时值经 `config.get()` 读取。
 */
export const Config = CanvasStudioConfig

/** Host plugin body: the project registry, its routes, the media tools, and the creation skill. */
export function apply(ctx: Context, config: CanvasStudioConfigValue): void {
  // 开发模式显式声明一次（设计文档 §8）：默认关闭——打包后的应用不设 NODE_ENV，
  // 若沿用「非 production 即开发」会让 `[dev]` 细节随错误文案露给用户。
  setDevMode(resolveDevModeFromProcess())
  // 设置外置（块 2）：注册 namespace + 用 base 作默认层 + onChange 刷新 source。
  // dramaApiKey 以 credential-ref 形式存储，不落明文；运行时经 resolveDramaApiKey 解析。
  const base: CanvasStudioConfig = {
    dramaApiBase: DEFAULT_DRAMA_API_BASE,
    businessApiBase: DEFAULT_BUSINESS_API_BASE,
    dramaApiKey: DEFAULT_DRAMA_API_KEY_REF,
    falApiKey: DEFAULT_FAL_API_KEY_REF,
    // P1 登录闭环：Supabase 项目沿用 reelsbuddy-auth（默认值即生效，无需用户配置）。
    supabaseUrl: DEFAULT_SUPABASE_URL,
    supabasePublishableKey: DEFAULT_SUPABASE_PUBLISHABLE_KEY,
    maxVideoSeconds: 15,
    defaultAspectRatio: '16:9',
    defaultVideoProvider: 'drama',
    // CV-187：与 host-config schema 的 default 同源（不写重复字面量）。
    defaultImageResolution: DEFAULT_RESOLUTION,
    defaultVideoResolution: DEFAULT_VIDEO_RESOLUTION_ID,
    exportFormat: 'mp4',
    exportDir: '',
    videoQuality: 'standard',
    workflowMode: 'confirm',
    hitlStoryboard: true,
    hitlKeyframe: false,
    autoRetry: true,
    maxParallel: 2,
    assetDir: '',
    autoSave: true,
    autoSaveInterval: 30,
    brandPreset: DEFAULT_BRAND_PRESET,
    // CV-234：诊断开关的默认值 = 生产行为（与引入这个字段之前一致）。
    errorVisibility: 'audience',
    // REQ-021：自动测试入口默认关闭（开关只控制可见性，无定时/自动触发）。
    testMode: false,
  }
  // 0.2.1：配置由 Loader 经 Config schema 注入；字段为对象级 volatile，`get()` 读当前值。
  // base 仅作 schema 未解析出值时的兜底（正常路径下 schema default 已填满全部字段）。
  const source = (): CanvasStudioConfig => config.get() ?? base
  // CV-234：把设置里的「错误可见性」同步到 error-system 的**进程级**标志 ——
  // 受众路由（routeError）与「要不要画红标」（codeIsUserFacing）读的都是它。
  // 读 live source ⇒ 设置页一改就生效，不需要重启。
  const syncErrorVisibility = (): void => {
    setErrorVisibility(source().errorVisibility === 'all' ? 'all' : 'audience')
  }
  const resolveDramaApiKey = async (): Promise<string> => {
    const ref = source().dramaApiKey
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(credentialRef(ref))
      // CR-033：命中但值为空串 = 未配置（不把空 key 当有效）；有值才返回。
      if (hit !== undefined && typeof hit.value === 'string' && hit.value.length > 0) return hit.value
    }
    // CR-033：未配置时返回空串而非 fail-fast 抛错——后端当前无鉴权（docs §5-3），
    // 且仅本地/画布合成等不依赖 Drama 的场景不应因「未配置凭证」报错。调用方按
    // 需决定是否附加 Authorization 头（空 key 即不附加）。
    return ''
  }
  // fal（阶段 4）：解析形态与 Drama 相同（credential-ref → 真实 key，空串 = 未配置）。
  // fal 与 Drama 不同点：key 是**必需**的——空串由 fal adapter 在 submit 前抛出
  // 中文错误（「请在设置中填写」），而非静默放行（fal 强制鉴权，放行必 401）。
  const resolveFalApiKey = async (): Promise<string> => {
    const ref = source().falApiKey
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(credentialRef(ref))
      if (hit !== undefined && typeof hit.value === 'string' && hit.value.length > 0) return hit.value
    }
    return ''
  }
  // 资产库根目录：每次取最新 source().assetDir（live 读取，留空=走桌面默认）。
  // ProjectRegistry 内部按 root 缓存项目列表，root 切换后下个 list() 触发重读。
  const assetsRoot = (): string => source().assetDir || dshHomePath('canvas-studio')
  // R1（缺口 C）：把设置页「默认执行模式」传给 registry——新建项目的工作流
  // 初始 mode 取自该设置（live 读取），设置开关不再只是装饰。
  const registry = new ProjectRegistry(assetsRoot, () => source().workflowMode)
  // REQ-001 全局资产库：与 registry 同源 root（同一 provider，设置切换同步生效）。
  const library = new AssetLibrary(assetsRoot)
  ctx.effect(() => registerStudioRoutes(ctx, registry, library), 'canvas-studio: project routes')

  // 2026-10-04：「资产库位置」运行期变更 → 失效**按路径缓存**的实例状态。
  //
  // root 是 live provider，所以「读」会自动落到新根；坏在**缓存了旧路径的字段**
  // （`activeDraft`）与**已经建好的推导物**（首页 draft 落点 workspace / 会话 cwd）：
  // 切根后落点重建会把首页绑回旧根 → 认领被归属校验 400 拒 → 用户「点发送没反应」，
  // 且不重启不会恢复。客户端侧由 settingsScope 订阅补齐（见 client/index.ts）。
  //
  // 接线顺序：**必须在 registry 之后** —— setSource / onChange 在 attach 期就会被
  // 回调，早接会撞 `registry` 的 TDZ。
  // 首个快照只记录、不触发：装载期 `source` 还是 composition entry（assetDir 为空
  // = 默认根），attach 后立刻就是「默认根 → 用户配置根」的跳变 —— 那不是用户改设置，
  // 误报一次「已变更」会让日志每次启动都刷一行假事件。
  let lastAssetsRoot: string | null = null
  const onStorageRootMaybeChanged = (): void => {
    const next = assetsRoot()
    if (lastAssetsRoot === null) { lastAssetsRoot = next; return }
    if (next === lastAssetsRoot) return
    lastAssetsRoot = next
    registry.invalidateRootScoped()
    ctx.logger.info(`[canvas-studio] 资产库位置已变更 → 按新根重建索引与首页落点（旧根文件不迁移）：${next}`)
  }
  // P2：Drama 鉴权闸与 Supabase 配置联动（live 读取）—— 配置了 Supabase（默认
  // 即配置）= 消耗型 Drama 请求要求登录；清空 supabaseUrl = 回到免登录旧行为。
  // 实现见 auth-session.ts（generate.ts 的 requireDramaAuth 读同一开关）。
  // 声明必须先于下面注册 volatile 更新监听（回调可能在装载/更新期同步触发）。
  const syncDramaAuthRequired = (): void => {
    setDramaAuthRequired(source().supabaseUrl.trim() !== '')
  }
  // 0.2.1 设置页策略：Canvas 有自定义客户端设置页（SettingsModal），故关闭自动生成页，
  // 避免与自定义页重复。`auto` 默认 true。
  ctx.effect(
    () => ctx.settings.configure({ auto: false }, ctx.fiber),
    'canvas-studio: settings page policy',
  )
  // 0.2.1：Config 为对象级 volatile ⇒ 设置写入走 Loader 的 volatile-only 快照提交
  // （`updateVolatile` 原地更新，**不重启本插件**）。因此不能靠重装回调刷新派生状态，
  // 需监听 `loader/volatile-update` 手动同步：错误可见性、Drama 鉴权闸、资产库根失效。
  ctx.on('loader/volatile-update', () => {
    syncErrorVisibility()
    syncDramaAuthRequired()
    onStorageRootMaybeChanged()
  })
  // 无条件首次同步一次：监听回调**是否在装载期被调用属框架内部行为**，不能当
  // 依赖 —— 否则「设置里明明是 all、启动后却是默认值」这类偏差会静默存在。
  syncErrorVisibility()
  syncDramaAuthRequired()

  // ── DramaServer 管理面 + 模型网关（方案 P2/P4，CV-356/357）────────────────
  // 登录后：auth/sync（用户 + 设备登记）→ /v1/models 拉目录 → 写 llm-pi-ai 网关行
  // （configEditor，与 Models 页同一条写路径，热生效）+ 凭据随会话推送轮换。
  const studioHome = dshHomePath('canvas-studio')
  const appVersionOf = (): string => {
    try {
      return (createRequire(import.meta.url)('../package.json') as { version?: string }).version ?? '0.0.0'
    } catch {
      return '0.0.0'
    }
  }
  const deviceRegistry = new DeviceRegistry(studioHome, appVersionOf())
  const credentialsSink = (): CredentialsSink | undefined => ctx.get('credentials') as CredentialsSink | undefined

  // 网关行 reconcile：走 `settings.mutate`（与桌面「模型」页同一条写路径——
  // llm-pi-ai 命名空间的用户层 volatile 写，volatile-update 即热重注册，**不做
  // 全量 profile 重放**，不依赖其它 entry 的激活状态）。指纹无变化不写；串行
  // 队列防并发写；只动自己的行。
  let currentGateway: GatewayRow | null = gatewayRow(readGatewayCatalog(studioHome))
  let reconcileQueue: Promise<unknown> = Promise.resolve()
  const applyGatewayConfig = async (row: GatewayRow | null): Promise<'applied' | 'unchanged' | 'unavailable'> => {
    const settings = ctx.get('settings')
    if (settings === undefined) return 'unavailable'
    let revision: number
    let existing: unknown
    try {
      const descriptor = settings.describe().find((candidate) => candidate.ns === GATEWAY_SETTINGS_NS)
      if (descriptor === undefined) return 'unavailable'
      revision = descriptor.revision
      existing = gatewayProviderOf(descriptor.value as Record<string, unknown> | undefined)
    } catch {
      return 'unavailable'
    }
    const profile = row === null ? null : gatewayProfile(row)
    if (profile === null ? existing === undefined : isDeepStrictEqual(existing, profile)) return 'unchanged'
    await settings.mutate(
      GATEWAY_SETTINGS_NS,
      profile === null
        ? [{ op: 'unset', path: ['providers', GATEWAY_ROUTE_NAME] }]
        : [{ op: 'set', path: ['providers', GATEWAY_ROUTE_NAME], value: profile }],
      revision,
    )
    return 'applied'
  }
  const reconcileGateway = (catalog: { apiBaseUrl: string; models: CatalogModel[] }): Promise<{ changed: boolean; models: number; unavailable?: boolean }> => {
    const run = async (): Promise<{ changed: boolean; models: number; unavailable?: boolean }> => {
      const written = writeGatewayCatalog(studioHome, catalog)
      const next = gatewayRow(written)
      if (gatewayFingerprint(next) === gatewayFingerprint(currentGateway)) {
        return { changed: false, models: next?.models.length ?? 0 }
      }
      const state = await applyGatewayConfig(next)
      // unavailable 时不推进 currentGateway（指纹保持旧值，下次 reconcile 会重试）。
      if (state === 'unavailable') {
        return { changed: false, models: next?.models.length ?? 0, unavailable: true }
      }
      currentGateway = next
      return { changed: state === 'applied', models: next?.models.length ?? 0 }
    }
    const queued = reconcileQueue.then(run, run)
    reconcileQueue = queued.then(() => undefined, () => undefined)
    return queued
  }

  installAccountState({
    enabled: () => source().businessApiBase.trim() !== '' && source().supabaseUrl.trim() !== '',    businessApiBase: () => source().businessApiBase,
    device: deviceRegistry,
    log: ctx.logger,
    // 凭据发布与目录 reconcile 都不抛给编排层：失败只进日志（不阻塞登录闭环）。
    onSessionToken: (token) => {
      void publishGatewayCredential(credentialsSink(), (name) => credentialRef(name), token)
        .then((published) => {
          if (!published) ctx.logger.warn('[canvas-studio] 网关凭据未写入：凭据服务不可用或 token 为空')
        })
        .catch((cause: unknown) => {
          ctx.logger.warn(`[canvas-studio] 网关凭据写入失败：${cause instanceof Error ? cause.message : String(cause)}`)
        })
    },
    onCatalogChanged: async (models, apiBaseUrl) => {
      const result = await reconcileGateway({ apiBaseUrl, models })
      if (result.unavailable) {
        ctx.logger.warn('[canvas-studio] 网关行未写入：当前 DSH 运行时没有 configEditor')
        return
      }
      if (result.changed) {
        ctx.logger.info(`[canvas-studio] 模型网关已${models.length === 0 ? '清空' : '更新'}：${result.models} 个模型（热生效）`)
      }
    },
  })

  // 订阅与积分（方案 20261102 P2）：同一套启用闸与设备三元组；token 由
  // billing-state 自己从 auth-session 取（不在这里传，避免多存一份会过期的副本）。
  installBillingState({
    enabled: () => source().businessApiBase.trim() !== '' && source().supabaseUrl.trim() !== '',
    businessApiBase: () => source().businessApiBase,
    device: deviceRegistry,
    log: ctx.logger,
  })

  // 生成一结束就把余额标记陈旧（CV-358）：Host 不知道后端何时结清，但至少能保证
  // 「下一次读余额」不吃扣费前的缓存 —— 否则生成完 30s 内切项目/重开窗口会看到
  // 旧数字。客户端在队列彻底空闲时还会再强刷一次，两条互补。
  setGenerationSettledHook(() => { markCreditsStale() })

  // 启动期从目录缓存恢复网关行（重启/未重登录场景；登录推送会覆盖为网络新目录）。
  // **必须延后且兜 catch**：settings.mutate 底层走 ConfigEditor 的 profile 重放，
  // 在装载早期触发会把启动期激活校验的失败放大成 unhandled rejection
  // （2026-10-22 实测 = `fatal load failure` 整个应用起不来）。延迟 5s 让 loader
  // 完成首场激活后再试；失败只进日志，绝不致命。
  const recoverGatewayFromCache = async (): Promise<void> => {
    if (currentGateway === null) return
    const state = await applyGatewayConfig(currentGateway)
    if (state === 'applied') {
      ctx.logger.info(`[canvas-studio] 网关行已从目录缓存恢复：${currentGateway.models.length} 个模型`)
    }
  }
  ctx.effect(() => {
    const timer = setTimeout(() => {
      void recoverGatewayFromCache().catch((cause: unknown) => {
        ctx.logger.warn(`[canvas-studio] 网关行缓存恢复失败（不影响启动）：${cause instanceof Error ? cause.message : String(cause)}`)
      })
    }, 5000)
    return () => { clearTimeout(timer) }
  }, 'canvas-studio: gateway cache recovery')

  // 运行时配置：透传给 generate.ts（模块级 current），供 Drama 调用读取基址/时长/密钥
  // 与设置页扩展字段（画幅比例已接入；其余待管线消费）。
  const cfg = {
    dramaApiBase: () => source().dramaApiBase,
    maxVideoSeconds: () => source().maxVideoSeconds,
    resolveDramaApiKey,
    resolveFalApiKey,
    defaultVideoProvider: () => source().defaultVideoProvider,
    defaultAspectRatio: () => source().defaultAspectRatio,
    defaultImageResolution: () => source().defaultImageResolution,
    defaultVideoResolution: () => source().defaultVideoResolution,
    workflowMode: () => source().workflowMode,
    hitlStoryboard: () => source().hitlStoryboard,
    hitlKeyframe: () => source().hitlKeyframe,
    autoRetry: () => source().autoRetry,
    maxParallel: () => source().maxParallel,
    assetDir: () => source().assetDir,
    autoSave: () => source().autoSave,
    autoSaveInterval: () => source().autoSaveInterval,
  }
  setRuntimeConfig(cfg)

  // Media generation tools register on the Host (the `tools` service is
  // Host-only); each tool resolves its project from the session workspace.
  //
  // 统一错误系统（设计文档 §9）：每条工具定义先过 wrapStudioToolDefinition ——
  // 裸异常在此收敛为 CanvasStudioError 并暂存错误码；registerStudioToolErrorBoundary
  // 再经 `tools/execute` 中间件把码写进结果，使其能穿过 tool/result 抵达客户端。
  // 里程碑时钟 + 空转告警（骨架优先出片，2026-11-05）：一次算好一行，挂在工具返回上。
  // 5 秒缓存 + cwd 维度：同一轮连续调用不必反复读 registry 与锚点文件；换了会话/项目重算。
  // 失败一律静默（返回 null）—— 时钟是辅助设施，不能让工具结果陪葬。
  //
  // 空转告警（P1-2 / P2-3）**对每个工具都计**：`tools/execute` 对所有工具触发，
  // bash 250 次 / 渲染 0 次这种事只有在这里才看得见。计数只在「已落地」之后推进 ——
  // 落地前的素材准备是正常前置工作，不该被算成空转（M1 的时钟也是从落地那刻起算的）。
  let clockCache: { at: number; cwd: string; landed: boolean; line: string | null } | undefined
  const guards = new Map<string, GuardCounters>()
  // P2-1（2026-11-05）：max-tokens 兜底的状态 —— 按 cwd 记「本轮工具调用数 / 被掐断次数 /
  // 待消费的一次性提醒」。全部内存态：它只服务「这一轮死了、下一轮别再死」，不跨进程。
  const turnCalls = new Map<string, number>()
  const strikes = new Map<string, number>()
  const budgetNotes = new Map<string, string>()
  registerStudioToolErrorBoundary(ctx, async ({ name, cwd, args, studio, isError }) => {
    const key = cwd ?? ''
    const now = Date.now()
    // 本轮调用数：turn/end 时读它判「这一步是不是一步没落地就死了」。
    turnCalls.set(key, (turnCalls.get(key) ?? 0) + 1)

    // ① 落地状态与时钟行：5 秒缓存（bash 风暴下不能每次都读注册表）。
    let entry = clockCache
    if (entry === undefined || entry.cwd !== key || now - entry.at >= 5000) {
      let landed = false
      let line: string | null = null
      try {
        const projectId = await resolveProjectId(registry, cwd)
        const workflow = normalizeWorkflow((await registry.getProject(projectId))?.workflow)
        landed = workflow.landedAt !== undefined
        if (workflow.landedAt !== undefined) {
          const best = readAnchorState(registry.projectDir(projectId)).versions.at(-1)
          const text = formatMilestoneClock({
            landedAt: workflow.landedAt,
            ...(workflow.firstDraftAt === undefined ? {} : { firstDraftAt: workflow.firstDraftAt }),
            now,
            ...(best === undefined ? {} : { best }),
          })
          line = text === '' ? null : text
        }
      } catch {
        landed = false
        line = null
      }
      entry = { at: now, cwd: key, landed, line }
      clockCache = entry
    }

    // ② 空转计数：每次调用都推进（不受 5 秒缓存影响 —— 它是逐次累加的）。
    //    「探针 / 快验不算成片」的判定在 `noteGuardCall` 内部（单一事实源）。
    let note: string | null = null
    if (entry.landed) {
      const counted = noteGuardCall(guards.get(key) ?? emptyGuardCounters(), { name, arguments: args, isError })
      const judged = guardNote(counted)
      guards.set(key, judged.state)
      note = judged.text
      // 上限 8 个 cwd：会话/项目切换不该让这张表无限长；超出丢最早入表的。
      if (guards.size > 8) {
        const oldest = guards.keys().next()
        if (!oldest.done && oldest.value !== key) guards.delete(oldest.value)
      }
    }

    // ③ 组装：时钟只给本插件工具（bash 返回里贴进度条纯属噪声），告警任何工具都给。
    //    P2-1 的「上一轮被掐断」提醒读一次即消费 —— 每轮只提一次，不能变成常驻横幅。
    const budget = budgetNotes.get(key)
    if (budget !== undefined) budgetNotes.delete(key)
    const lines = [studio ? entry.line : null, note, budget ?? null]
      .filter((text): text is string => text !== null && text !== '')
    return lines.length === 0 ? null : lines.join('\n')
  })
  // P2-1（2026-11-05）：max-tokens 兜底（降级版，不 steer）。
  //
  // 事故形状：11-05 第 2、3 个 turn 的 `turn/end.reason.kind` 都是 max-tokens 且该轮
  // 0 次工具调用 —— 预算全烧在思考里，一步没落地。这里做两件确定的事：
  //   ① 落 `build/NEXT.md`（磁盘事实，压缩不会丢）；
  //   ② 下一轮第一次工具返回挂一行提醒（模型一定会读到的地方）。
  // 为什么不 steer：计划在模型脑子里，宿主逼它写会改变 turn 语义，且只能真机验、失败没法回滚。
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/end') return
    const key = session.header.cwd ?? ''
    const calls = turnCalls.get(key) ?? 0
    turnCalls.delete(key)
    if (event.data.reason.kind !== 'max-tokens') return
    const count = (strikes.get(key) ?? 0) + 1
    strikes.set(key, count)
    budgetNotes.set(key, budgetGuardLine({ toolCalls: calls, strikes: count }))
    // 落盘要读注册表（异步），失败静默：turn 已经在收尾，不该再抛一个错误出来。
    void (async () => {
      try {
        const projectId = await resolveProjectId(registry, key)
        const projectDir = registry.projectDir(projectId)
        const workflow = normalizeWorkflow((await registry.getProject(projectId))?.workflow)
        const best = readAnchorState(projectDir).versions.at(-1)
        writeBudgetNote(projectDir, renderBudgetNote({
          now: Date.now(),
          landedAt: workflow.landedAt,
          ...(best === undefined
            ? {}
            : { best: { version: best.version, durationSec: best.durationSec, trackCount: best.trackCount } }),
          toolCalls: calls,
          strikes: count,
        }))
      } catch {
        // 首页态 / 非本项目 cwd 时 resolveProjectId 会抛 —— 属正常路径，不记错。
      }
    })()
  })
  ctx.effect(() => {
    // RQ-R8/E1：放手跑判定器注入 —— 顺序闸（write_storyboard / render_composition 的
    // intent 缺项）在 auto 模式下自动登记默认意图卡放行；confirm 模式维持拒收（用户核对
    // 是本意）。首页态 / 非项目 cwd 时 resolveProjectId 会抛 → fail-safe 回拒收路径。
    setSpecGateAutoResolver(async (exec) => {
      const cwd = (exec as { agent?: { session?: { header?: { cwd?: unknown } } } } | null)?.agent?.session?.header?.cwd
      if (typeof cwd !== 'string' || cwd === '') return false
      const project = await registry.getProject(await resolveProjectId(registry, cwd))
      return normalizeWorkflow(project?.workflow).mode === 'auto'
    })
    const disposers = createStudioTools(registry, () => ctx.webServer.port, cfg, library)
      .map((definition) => wrapStudioToolDefinition(definition))
      .map((definition) => ctx.tools.register(definition))
    return () => { for (const dispose of disposers) dispose() }
  }, 'canvas-studio: media generation tools')

  // AR-13：预热 undici 的**全局 dispatcher**，消掉「进程第一条请求」的时序假设。
  //
  // `long-request.ts` 从 `Symbol.for('undici.globalDispatcher.1')` 借构造器造请求级
  // dispatcher（把传输层上限从默认 300s 抬到 1800s）。而该 symbol **要等首次请求
  // 之后才存在**（文件头注实测：全新进程里发请求前是 undefined）—— 于是「进程第一条
  // 请求就需要长超时」的调用点会**静默退回 300s**，表现为长视频被提前掐断且报错误导。
  //
  // 现状靠「现有长请求调用点都排在进行过探活/上传之后」这个时序假设兜着（成立但脆弱：
  // 只要将来新增一条冷路径就直接踩）。这里在装配期发一条**本机 loopback** 的廉价请求，
  // 把假设换成事实。
  //
  // 边界：**失败静默**（预热只影响传输层上限，不该影响启动）；若此刻 webServer 尚未
  // listen，本次预热 no-op，原来的时序假设仍作为兜底（`long-request.ts` 也保留了「取不到
  // 就告警一次并退回默认」的防御）。
  setTimeout(() => {
    void fetch(`http://127.0.0.1:${String(ctx.webServer.port)}/canvas-studio/projects`)
      .catch(() => undefined)
  }, 0)
  // MiniMax upstream skill 占位工具：覆盖原版流程中 canvas 缺失的能力
  // （TTS/硬字幕；BGM 生成已于 CV-125 转正为 music_generation 真实工具），
  // 返回可操作降级路径而非报错。
  ctx.effect(() => {
    const disposers = createPlaceholderTools()
      .map((definition) => wrapStudioToolDefinition(definition))
      .map((definition) => ctx.tools.register(definition))
    return () => { for (const dispose of disposers) dispose() }
  }, 'canvas-studio: upstream placeholder tools')
  // Skill bodies live in this package's `skills/` directory — the single
  // hand-maintained source (imported once from MiniMax-H3 on 2026-08-15 and
  // owned here since; spec: docs/skill-expansion-spec.md). registerMinimaxSkills
  // below scans that directory and registers every bundle it finds as a runtime
  // skill, so the model can load the full workflow on demand via the skill tool.
  ctx.effect(() => registerMinimaxSkills(ctx), 'canvas-studio: skills registration')
  // SK-01：创作任务路由硬指令——注册在 system prompt 而非只写在总纲的
  // description 里。CV-094 改 description 后模型会先加载总纲，但那依赖模型
  // 主动读 catalog 摘要；常驻小节让「先加载再澄清」在每一轮都可见，且不占
  // description 的长度配额（该配额留给负向路由语）。
  ctx.effect(() => registerSkillRoutingPrompt(ctx), 'canvas-studio: skill routing prompt')
  // 模板通道临时下线：关闭态注入覆盖指令，开启态不注册任何小节（一行恢复）。
  ctx.effect(() => registerTemplateChannelPrompt(ctx), 'canvas-studio: template channel prompt')
  // CV-099：项目预置小节——创建项目时锁定的画幅/目标总时长注入 system prompt，
  // 让澄清阶段跳过已预置要素（`agent/created` 预热缓存，首轮即可见）。
  ctx.effect(() => registerProjectPlanPrompt(ctx, registry), 'canvas-studio: project plan prompt')
  // REQ-001：资产库清单小节（order 152）——自然语言名/别名 → `@ref[lib:<id>]` 的
  // 事前指引；与 plan 小节同款「模块级缓存 + agent/created 预热」同步 text。
  ctx.effect(() => registerAssetLibraryPrompt(ctx, library), 'canvas-studio: asset library prompt')
  // REQ-022：拍摄定稿纪律小节（order 153）—— 已落地的故事版把 §00 创意前提 /
  // §02 视觉规范 / §08 硬约束注入 system prompt；未落地时缓存为空、不注入。
  ctx.effect(() => registerStoryboardDisciplinePrompt(ctx, registry), 'canvas-studio: storyboard discipline prompt')
  // CV-323：激活集小节（order 154）——把用户在画布顶条为项目选定的技能清单注入
  // system prompt。装载此前是纯 UI 状态（`skills.json` + chips），模型完全看不到，
  // 用户勾选形同虚设。写入侧（`POST /canvas-studio/active-skills`）负责失效缓存。
  ctx.effect(() => registerActiveSkillsPrompt(ctx, registry), 'canvas-studio: active skills prompt')
  // 会话效率优化（2026-10-26）：执行模式 + 项目记录路径小节（order 155）——
  // workflow.mode（confirm/auto 语义）与 projects.json 绝对路径注入 system prompt，
  // 模型不再翻源码 / 猜目录确认执行模式（单会话实测浪费 ~5 min）。setMode 写路径
  // 经 invalidateWorkflowModeCache 失效缓存。
  ctx.effect(() => registerWorkflowModePrompt(ctx, registry), 'canvas-studio: workflow mode prompt')
}