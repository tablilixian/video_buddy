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
import { ProjectRegistry } from './projects.js'
import { AssetLibrary } from './asset-library.js'
import { registerStudioRoutes } from './routes.js'
import { createStudioTools } from './host-tools.js'
import { registerMinimaxSkills } from './skills/minimax-skills.js'
import { createPlaceholderTools } from './skills/placeholder-tools.js'
import { registerSkillRoutingPrompt } from './skills/routing-prompt.js'
import { registerProjectPlanPrompt } from './plan-prompt.js'
import { registerAssetLibraryPrompt } from './asset-library-prompt.js'
import { registerStoryboardDisciplinePrompt } from './storyboard-discipline-prompt.js'
import { registerActiveSkillsPrompt } from './active-skills-prompt.js'
import { setRuntimeConfig } from './generate.js'
// P2：Drama 鉴权闸开关（supabaseUrl 联动，见下方 syncDramaAuthRequired）。
import { setDramaAuthRequired } from './auth-session.js'
// 统一错误系统：Host 入口是「注册一次即全局生效」的唯一登记点（设计文档 §9）。
import { resolveDevModeFromProcess, setDevMode, setErrorVisibility } from './error-system.js'
import { registerStudioToolErrorBoundary, wrapStudioToolDefinition } from './tool-error-boundary.js'
import './errors/catalog.js'
import {
  CanvasStudioConfig,
  type CanvasStudioConfigValue,
  DEFAULT_DRAMA_API_BASE,
  DEFAULT_DRAMA_API_KEY_REF,
  DEFAULT_FAL_API_KEY_REF,
  DEFAULT_SUPABASE_PUBLISHABLE_KEY,
  DEFAULT_SUPABASE_URL,
} from './host-config.js'
import { DEFAULT_BRAND_PRESET } from './brand.js'
import { DEFAULT_RESOLUTION } from './config.js'
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
    defaultVideoResolution: '480p',
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
  registerStudioToolErrorBoundary(ctx)
  ctx.effect(() => {
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
}