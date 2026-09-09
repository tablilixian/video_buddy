/**
 * CV-114：画布素材接入聊天输入框的引用管线。
 *
 * 两件事，都只碰**公开服务名**（运行时 `ctx.get` 惰性取，不写进 `inject`——
 * 声明 `conversation` 会让依赖图成环，见 client/index.ts 顶部注释）：
 *
 * 1. `registerCanvasAssetSource`：向上游 `@` 触发管线注册「画布素材」候选源，
 *    于是在输入框打 `@` 能搜到画布素材并选中插入 chip；
 * 2. `insertAssetChip`：右键 / 参考托盘 / 详情面板的「引用到对话」直接插入
 *    **同一种 chip**（走 `conversation.input.shell(id).insertReference`），
 *    与打 `@` 选中产生的东西完全一致。
 *
 * 上游类型面刻意不引入依赖，只本地收窄成最小结构（runtime facade）：
 * 拿不到服务或签名漂移时静默失败，调用方降级回纯文本注入，行为不退化。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { AssetHandle } from '../reference-handle.js'
import { filterAssetHandles, truncateLabel } from '../reference-handle.js'
import { formatRefToken } from '../reference-token.js'

/**
 * 触发源名字（occurrence 的 source，也是提交时序列化器的路由键）。
 * 改名会让已插入但未发送的 chip 失去 owner → 渲染成 invalid，勿动。
 */
export const CANVAS_ASSET_SOURCE = 'canvas-asset'

/** 候选分组标题（与上游「文件 / 会话」区分）。 */
const ASSET_SECTION = '画布素材'

/** 输入框 DOM 查询（与 StudioFrame 现有注入路径同一选择器）。 */
const COMPOSER_INPUT_SELECTOR =
  '.csConversation textarea, .csConversation [contenteditable="true"], .csConversation input[type="text"]'

// --- 上游服务面的本地最小收窄（不 import 上游包，避免打包第二份实例） ---

interface MenuCandidate {
  readonly name: string
  readonly description?: string
  readonly hint?: string
  readonly section?: string
  readonly value?: string
}

interface CandidateRequestLike {
  readonly query: string
  readonly signal: AbortSignal
}

interface InputTriggerSourceLike {
  readonly trigger: '@'
  readonly name: string
  readonly order?: number
  readonly showGroupTitle?: boolean
  candidates(session: { readonly sessionId: string }, req: CandidateRequestLike): Promise<readonly MenuCandidate[]>
  onPick(pick: { readonly candidate: MenuCandidate }): unknown
  readonly codec: {
    clipboardText(ref: string): string
    serialize(ref: string, signal: AbortSignal): Promise<string>
  }
}

interface InputTriggersServiceLike {
  registerSource(src: InputTriggerSourceLike): () => void
}

interface InputStateLike {
  readonly draft: string
  readonly draftRev: number
}

interface SessionInputShellLike {
  readonly state: { getSnapshot(): InputStateLike }
  insertReference(reference: unknown, span: { readonly start: number; readonly end: number; readonly draftRev: number }): boolean
}

interface ConversationInputLike {
  shell(id: string): SessionInputShellLike | undefined
}

/** 当前会话 id 的解析（由 apply 世界注入，避免本模块依赖 sessions 服务）。 */
export interface CanvasAssetSourceDeps {
  /** 当前项目可引用素材（每次调用读最新快照）。 */
  assets(): readonly AssetHandle[]
  /** 当前会话 id；无会话时返回 undefined。 */
  sessionId(): string | undefined
}

/**
 * 注册 `@` 画布素材源。
 * @returns disposer；上游服务不可用时返回 null（调用方照旧，不注册）。
 */
export function registerCanvasAssetSource(
  ctx: ClientContext,
  deps: CanvasAssetSourceDeps,
): (() => void) | null {
  const service = ctx.get('inputTriggers') as unknown as InputTriggersServiceLike | undefined
  if (service === undefined || typeof service.registerSource !== 'function') return null
  const source: InputTriggerSourceLike = {
    trigger: '@',
    name: CANVAS_ASSET_SOURCE,
    // 排在工作区文件源之前：画布素材才是本场景的主角。
    order: -1,
    // 不渲染 source 名当组标题（它是内部 id，原文显示很难看），改由候选项
    // 自带 section 行——菜单里呈现为「画布素材」小标题 + 候选。
    showGroupTitle: false,
    async candidates(_session, { query }) {
      return filterAssetHandles(deps.assets(), query).map((asset): MenuCandidate => {
        const description = asset.title === '' ? undefined : truncateLabel(asset.title, 24)
        return {
          name: asset.handle,
          hint: asset.kind === 'video' ? '视频' : '图片',
          section: ASSET_SECTION,
          value: asset.nodeId,
          // exactOptionalPropertyTypes：无标题时整体不挂该字段，不写 undefined。
          ...(description === undefined ? {} : { description }),
        }
      })
    },
    onPick({ candidate }) {
      const nodeId = candidate.value
      if (nodeId === undefined) return undefined
      const asset = deps.assets().find((item) => item.nodeId === nodeId)
      return {
        insert: {
          source: CANVAS_ASSET_SOURCE,
          ref: nodeId,
          // chip 显示短句柄；模型收到的是 codec 序列化的 `@ref[nodeId]`。
          label: asset?.handle ?? candidate.name,
          appearance: 'file',
          clipboardText: formatRefToken(nodeId),
        },
      }
    },
    codec: {
      clipboardText: (ref) => formatRefToken(ref),
      serialize: (ref) => Promise.resolve(formatRefToken(ref)),
    },
  }
  try {
    return service.registerSource(source)
  } catch {
    // 同名重复注册（HMR / 重复 apply）不致命：放弃注册，画布引用仍走纯文本降级。
    return null
  }
}

/** 注册诊断日志前缀（桌面 devtools 控制台可查）。 */
const LOG = '[canvas-studio] @ 画布素材源'

/**
 * 等服务就绪后注册 `@` 画布素材源（调用方唯一入口）。
 *
 * 为什么不能直接在 apply 里 `ctx.get('inputTriggers')`：服务读取要求提供方的
 * fiber 已 ACTIVE，而 canvas-studio 的 client apply 常常跑在 ui-input-trigger
 * 之前（roster 顺序 + 我们没声明该依赖）→ 那一刻 get 恒为 undefined，注册被
 * 静默跳过，@ 菜单里自然没有画布素材分组。上游 ui-reference 就是靠静态声明
 * `inject: ['inputTriggers']` 规避的，这里用等价的运行时写法 `ctx.inject`，
 * 服务一到就注册；再加一次延时兜底，任何一环失灵都能在控制台看到原因。
 */
export function registerCanvasAssetSourceWhenReady(
  ctx: ClientContext,
  deps: CanvasAssetSourceDeps,
): void {
  let disposed = false
  let off: (() => void) | null = null
  let attempts = 0
  const attempt = (scope: ClientContext): boolean => {
    attempts += 1
    const next = registerCanvasAssetSource(scope, deps)
    if (next === null) {
      console.info(`${LOG}: inputTriggers 不可用（第 ${attempts} 次尝试）`)
      return false
    }
    off = next
    console.info(`${LOG}: 注册成功（第 ${attempts} 次尝试）`)
    return true
  }
  ctx.inject(['inputTriggers'], (scope: ClientContext) => {
    if (disposed || off !== null) return
    attempt(scope)
  })
  // 兜底：`ctx.inject` 理论上足够，但桌面冷启动 roster 长、服务重挂载都可能让它
  // 落在空档里，这里短轮询几次；全部失败就在控制台留痕，不再静默跳过。
  let tries = 0
  const timer = setInterval(() => {
    if (disposed || off !== null) {
      clearInterval(timer)
      return
    }
    tries += 1
    if (attempt(ctx) || tries >= 8) {
      clearInterval(timer)
      if (off === null) console.info(`${LOG}: 注册失败 —— @ 菜单不会出现「${ASSET_SECTION}」分组`)
    }
  }, 800)
  ctx.effect(() => () => {
    disposed = true
    clearInterval(timer)
    off?.()
  }, 'canvas-studio: @ 画布素材源')
}

/** 读取作曲框光标（草稿坐标）；拿不到时返回 null，由调用方追加到末尾。 */
function composerCaret(): number | null {
  const input = document.querySelector(COMPOSER_INPUT_SELECTOR)
  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
    return input.selectionStart
  }
  return null
}

/**
 * 把一个画布素材作为**真 chip** 插入当前会话的输入框。
 *
 * 走 `conversation.input.shell(id).insertReference`：与用户在输入框打 `@`
 * 选中候选走的是同一条通路，因此产物（occurrence chip）完全一致。
 * 上游服务缺失 / 会话未绑定 / draftRev CAS 失败 → 返回 false，调用方降级。
 */
export function insertAssetChip(
  ctx: ClientContext,
  sessionId: string | undefined,
  asset: AssetHandle,
): boolean {
  if (sessionId === undefined) return false
  try {
    const conversation = ctx.get('conversation') as unknown as { input?: ConversationInputLike } | undefined
    const shell = conversation?.input?.shell?.(sessionId)
    if (shell === undefined) return false
    const state = shell.state.getSnapshot()
    const caret = composerCaret()
    const at = caret === null ? state.draft.length : Math.min(Math.max(caret, 0), state.draft.length)
    return shell.insertReference(
      {
        source: CANVAS_ASSET_SOURCE,
        ref: asset.nodeId,
        label: asset.handle,
        appearance: 'file',
        clipboardText: formatRefToken(asset.nodeId),
      },
      { start: at, end: at, draftRev: state.draftRev },
    ) === true
  } catch {
    return false
  }
}
