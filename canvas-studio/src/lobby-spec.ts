/**
 * REQ-028：首页 Agent 项目创建框的**规格草稿域**（纯数据 + 纯函数，无 React）。
 *
 * 放在 src/ 根而不是 client/ 里，有两个原因：
 * 1. 它要被**两侧**同时消费 —— client 组件（LobbySpecRow 弹出框）读写草稿，
 *    发送拦截分支（index.ts 的 lobby 认领）在组件树之外读同一份去 buildLobbyPlan；
 *    放 client/ 会让 Host 侧的 node:test 只能靠读源码文本守卫（lobby-stash 同款
 *    妥协），而这里的分辨率展示 ↔ 真值映射是拍板钉死的口径（720P→736p、
 *    1080P→2k），值得一条**真 import** 的测试（tests/lobby-spec.test.mjs 从
 *    lib/ 直连本模块）。
 * 2. 纯 TS 无依赖（VideoResolution 只 import type），client 打包时被 tsdown
 *    内联进 client.js，Host 侧走 lib/lobby-spec.js，一份实现两处消费。
 *
 * ## 演示口径（2026-10-06 拍板，1:1 复刻 video-agent-inputbox.html）
 *
 * - 分辨率**展示**跟演示：480P / 720P / 1080P（倍数 0.4× / 推荐 / 2.0×）；
 *   **内部映射真值档位** 480p / 736p / 2k —— 展示名与真值不同名（720P ≠ 736p），
 *   所以这张表是本模块存在的第一理由。不新增 1080P 实体档位（2k 已有）。
 * - 模型三选：MiniMax H3（推荐）/ SeedDance 2.0 / SeedDance 2.5。目前视频生成
 *   路由只有 H3（REQ-025 的路由决策点），SeedDance 是预留位 —— 选中值只活在本
 *   草稿里，**不落 plan**（StudioProjectPlan 无此字段，路由消费属后续 CV）。
 * - 画幅只有 16:9 / 9:16 两档（演示的合并入口没有 1:1 与「不锁定」画幅）；
 *   1:1 仅图片工具支持的提示随选项一起退出首页入口。
 * - 时长三态互不锁定：预设（10/15/30/60） / 自定义（1–600 键入，落 plan 时
 *   仍受 MAX_TARGET_DURATION=300 夹取 —— 5 分钟分镜预算是既有约束，演示的 600
 *   不跟进）/ 不锁定（AI 确定）。
 */

import type { VideoResolution } from './providers/types.js'
import type { StudioPlanAspectRatio, StudioProjectPlan, StudioWorkflowMode } from './contracts/project.js'
import { MAX_TARGET_DURATION } from './contracts/project.js'

/* ------------------------------------------------------------------ *
 * 分辨率：展示口径 ↔ 真值档位
 * ------------------------------------------------------------------ */

/** 分辨率的演示展示口径（label/meta 逐字取自演示 HTML 的三项菜单）。 */
export interface ResolutionDisplay {
  /** 内部真值档位（video_generate 等工具的 resolution 枚举）。 */
  readonly value: VideoResolution
  /** chip / 菜单里展示的演示口径名。 */
  readonly label: string
  /** 菜单右侧 meta（耗时倍数，以 720P 为 1× 基准；推荐档写「推荐」）。 */
  readonly meta: string
}

/**
 * 展示口径 → 真值档位映射（REQ-028 拍板②的唯一权威表）。
 *
 * 顺序即弹出框菜单顺序：480P（0.4×）→ 720P（推荐）→ 1080P（2.0×）。
 */
export const RESOLUTION_DISPLAY: readonly ResolutionDisplay[] = [
  { value: '480p', label: '480P', meta: '0.4×' },
  { value: '736p', label: '720P', meta: '推荐' },
  { value: '2k', label: '1080P', meta: '2.0×' },
]

/** 首页默认档位 = 演示默认（720P），映射到真值 736p（与 DEFAULT_RESOLUTION 同值）。 */
export const DEFAULT_LOBBY_RESOLUTION: VideoResolution = '736p'

/** 真值档位 → 展示口径（未知值回落默认档，防脏数据把 chip 渲染成 undefined）。 */
export function resolutionDisplay(value: VideoResolution | string | undefined): ResolutionDisplay {
  return RESOLUTION_DISPLAY.find((item) => item.value === value)
    ?? (RESOLUTION_DISPLAY.find((item) => item.value === DEFAULT_LOBBY_RESOLUTION) as ResolutionDisplay)
}

/* ------------------------------------------------------------------ *
 * 画幅：演示的两档大卡
 * ------------------------------------------------------------------ */

/** 首页画幅取值（演示合并入口上段的两张比例卡；1:1 / 不锁定不在首页入口里）。 */
export type LobbyAspect = Extract<StudioPlanAspectRatio, '16:9' | '9:16'>

/** 画幅候选（value 即 plan 字段值；label 是大卡副行）。 */
export const LOBBY_ASPECTS: readonly { value: LobbyAspect; label: string }[] = [
  { value: '16:9', label: '横屏' },
  { value: '9:16', label: '竖屏' },
]

/* ------------------------------------------------------------------ *
 * 模型三选
 * ------------------------------------------------------------------ */

/** 首页可选的生成模型 id（稳定机器名；展示名走 label）。'h3' 刻意不用
 * 「厂商名 + 型号」拼机器名 —— 那串拼写是 skills 守卫的上游禁用名（见
 * skills-single-source.test.mjs 的 FORBIDDEN 表），家族短名即可消歧。 */
export type LobbyModelId = 'h3' | 'seeddance-2.0' | 'seeddance-2.5'

export interface LobbyModelOption {
  readonly id: LobbyModelId
  readonly label: string
  /** 菜单右侧 meta；推荐档写「推荐」，其余省略。 */
  readonly meta?: string
}

/** 模型三选（演示顺序与 meta 逐字对齐）。 */
export const LOBBY_MODELS: readonly LobbyModelOption[] = [
  { id: 'h3', label: 'MiniMax H3', meta: '推荐' },
  { id: 'seeddance-2.0', label: 'SeedDance 2.0' },
  { id: 'seeddance-2.5', label: 'SeedDance 2.5' },
]

export const DEFAULT_LOBBY_MODEL: LobbyModelId = 'h3'

/** 模型 id → 展示名（未知 id 回落默认，防脏数据把 chip 渲染成 undefined）。 */
export function lobbyModelLabel(id: string | undefined): string {
  return LOBBY_MODELS.find((model) => model.id === id)?.label
    ?? (LOBBY_MODELS.find((model) => model.id === DEFAULT_LOBBY_MODEL)?.label as string)
}

/* ------------------------------------------------------------------ *
 * 时长三态（预设 / 自定义 / 不锁定，互不锁定）
 * ------------------------------------------------------------------ */

/** 时长预设档位（演示 10/15/30/60；原 15/30/60 基础上补 10s 短档）。 */
export const LOBBY_DURATION_PRESETS: readonly number[] = [10, 15, 30, 60]

/** 时长的「自定义」哨兵值（选中后该行才激活数字输入框）。 */
export const LOBBY_DURATION_CUSTOM = 'custom'

/** 自定义秒数下限（演示 1–600；上限仍受 MAX_TARGET_DURATION 夹取）。 */
export const MIN_LOBBY_DURATION = 1

/* ------------------------------------------------------------------ *
 * 草稿类型
 * ------------------------------------------------------------------ */

/**
 * 首页输入框的规格草稿（store.lobbySpec）。
 *
 * 与 v1.3 的 ProjectSpecDraft 相比的三处形状变化（REQ-028 重塑）：
 * - `aspect` 收窄为 `'16:9' | '9:16'`（合并入口常显真值，不再有「不锁定画幅」）；
 * - 新增 `resolution`（真值档位，常显）与 `model`（三选，暂不落 plan）；
 * - 时长仍走 `duration`（`''` = 不锁定）+ `durationCustom` 两字段，语义不变。
 */
export interface LobbySpecDraft {
  /** 画幅（合并入口上段两卡之一；常显真值，无空串档）。 */
  readonly aspect: LobbyAspect
  /** 输出分辨率（真值档位；chip 展示名经 resolutionDisplay 映射）。 */
  readonly resolution: VideoResolution
  /** 目标时长：`''` = 不锁定、数字串 = 秒、`'custom'` = 读 durationCustom。 */
  readonly duration: string
  /** duration === 'custom' 时的秒数草稿（未填 / 非法则该项被丢弃）。 */
  readonly durationCustom: string
  readonly mode: StudioWorkflowMode
  /** 生成模型（三选；路由消费属后续 CV，暂不落 plan）。 */
  readonly model: LobbyModelId
  /**
   * 用户是否动过执行模式。false 时首页规格行挂载会按设置页「默认执行模式」
   * 对齐一次（CV-196 口径）；动过就不再覆盖用户的选择。
   */
  readonly modeDirty?: boolean
}

/** 首页草稿默认值（演示的初始态：16:9 · 720P · 15s · MiniMax H3 · 自动执行）。 */
export function defaultLobbySpec(mode: StudioWorkflowMode): LobbySpecDraft {
  return {
    aspect: '16:9',
    resolution: DEFAULT_LOBBY_RESOLUTION,
    duration: '15',
    durationCustom: '',
    mode,
    model: DEFAULT_LOBBY_MODEL,
  }
}

/* ------------------------------------------------------------------ *
 * 组装与读数
 * ------------------------------------------------------------------ */

/**
 * 把草稿组装成项目预置规格（lobby 认领分支 → createStudioProjectClaimDir）。
 *
 * 画幅**恒写**（草稿没有空串档）；自定义秒数非法（非数字 / 低于下限）时该项
 * 被丢弃而不是让创建失败 —— 规格是伴随参数，不该拦住开工。超上限仍按
 * MAX_TARGET_DURATION 夹取（contracts 的既有纪律，演示的 600 不改变分镜预算）。
 * 分辨率与模型暂不落 plan（StudioProjectPlan 无字段；见文件头「模型三选」）。
 */
export function buildLobbyPlan(spec: LobbySpecDraft): StudioProjectPlan | undefined {
  const plan: StudioProjectPlan = {}
  plan.aspectRatio = spec.aspect
  const seconds = Number.parseInt(spec.duration === LOBBY_DURATION_CUSTOM ? spec.durationCustom : spec.duration, 10)
  if (Number.isFinite(seconds) && seconds > 0) plan.targetDuration = Math.min(MAX_TARGET_DURATION, seconds)
  return plan.aspectRatio === undefined && plan.targetDuration === undefined ? undefined : plan
}

/**
 * 时长 chip 的收起态读数（三态随动，演示逐字口径）：
 * 预设 → `15s`；自定义 → `自定义 45s`（秒数未填时只写「自定义」）；不锁定 → `不锁定`。
 */
export function durationChipLabel(spec: Pick<LobbySpecDraft, 'duration' | 'durationCustom'>): string {
  if (spec.duration === '') return '不锁定'
  if (spec.duration === LOBBY_DURATION_CUSTOM) {
    const seconds = Number.parseInt(spec.durationCustom, 10)
    return Number.isFinite(seconds) && seconds > 0 ? `自定义 ${String(seconds)}s` : '自定义'
  }
  return `${spec.duration}s`
}

/** 画幅·分辨率 chip 的收起态读数（演示口径：`16:9 · 720P`）。 */
export function formatChipLabel(spec: Pick<LobbySpecDraft, 'aspect' | 'resolution'>): string {
  return `${spec.aspect} · ${resolutionDisplay(spec.resolution).label}`
}

/* ------------------------------------------------------------------ *
 * 执行模式：演示命名与诚实脚注
 * ------------------------------------------------------------------ */

/**
 * 首页执行模式的展示口径。
 *
 * 演示把两项命名为「自动执行 / 询问执行」（绿点 / 琥珀点读模式），与画布顶部分段
 * 的「放手跑 / 逐步确认」（ModeSwitch 的 MODE_COPY）是**同一对模式**的两个名字：
 * `auto` / `confirm` 字段值与认领链路完全不变，只有首页这张脸按演示呈现。
 *
 * 脚注与 hover 气泡**刻意没有照抄**演示的「先出分镜表，确认后才渲染」—— 那句
 * 描述的是 REQ-022 两阶段语义（仅设计、未立项）；今天的 `auto` 是「不再询问，
 * 直接跑到成片」，照抄等于把没做的功能说成已有。文案取自 MODE_COPY.switchTo
 * 的同源语义，等 REQ-022 立项后再对齐演示原句。
 */
export const LOBBY_MODE_COPY: Readonly<Record<StudioWorkflowMode, {
  /** chip 主文案（演示菜单只写模式名，不带副标题）。 */
  readonly name: string
  /** hover 气泡：`当前：${name}（${reason}）`。 */
  readonly reason: string
  /** 面板底部脚注（差异写脚注，不写进菜单行）。 */
  readonly foot: string
}>> = {
  auto: {
    name: '自动执行',
    reason: '不再询问，按默认规格直接跑到成片',
    foot: '自动执行不再询问，按默认规格直接跑到成片。',
  },
  confirm: {
    name: '询问执行',
    reason: '每完成一步（剧本 / 分镜 / 关键帧）停下来等你确认',
    foot: '询问执行每完成一步（剧本 / 分镜 / 关键帧）停下来等你确认。',
  },
}
