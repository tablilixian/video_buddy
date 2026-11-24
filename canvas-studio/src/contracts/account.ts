/**
 * 管理面账号只读视图（Host → client 的唯一形状，方案 P3 / CV-358）。
 *
 * 为什么要这一层而不是让 client 直接读 `CreditBalance`：**状态判断全在 Host 做完**
 * —— 启用闸、登录态、403 禁用、TTL、失败留旧值。client 只按字段渲染，不再自己
 * 判断「该不该发请求 / 这个错误码算不算登录问题」，否则两处判断迟早漂移。
 *
 * 契约里**没有总额度字段**：后端 `/v1/credits/balance` 只给 `available_balance` /
 * `frozen_balance` / `currency` / `lots`。UI 不得自造分母（旧的 `0 / 1,000` 占位
 * 是 REQ-030 ③ 时代的前端常量）。
 */
import type { CreditBalance, CreditLedgerEntry } from '../drama-management.js'

/** 一次余额读取的结果（含降级态）。 */
export interface AccountCreditsView {
  /** 管理面是否启用：`businessApiBase` 与 `supabaseUrl` 均非空。false ⇒ UI 不渲染余额卡。 */
  enabled: boolean
  /** Host 是否持有会话缓存（client 已推送且未登出）。false ⇒ 「登录后查看」。 */
  signedIn: boolean
  /** 403：账号被禁用，Host 已停止业务请求（含余额）。 */
  disabled: boolean
  /** 最近一次成功读到的余额；从未读到 = null（**不是 0**）。 */
  balance: CreditBalance | null
  /** 读到 `balance` 的时刻（ISO 8601）；null = 从未读到。 */
  fetchedAt: string | null
  /** 最近一次失败；有 `balance` 时 UI 保留旧值并标灰。 */
  error: { code: string; message: string } | null
}

/** 一条积分流水 + 一页流水：形状由协议层（`drama-management.ts`）定义，这里只转发。 */
export type { CreditLedgerEntry, CreditLedgerPage } from '../drama-management.js'

/**
 * 流水读取的 Host → client 视图（与 {@link AccountCreditsView} 同一套纪律：
 * 启用闸 / 登录态 / 403 / TTL / 失败留旧值全在 Host 判，client 只渲染）。
 */
export interface AccountLedgerView {
  enabled: boolean
  signedIn: boolean
  disabled: boolean
  /** 已加载的条目（最新在前，逐页追加）。从未读到 = `[]`（不是 null）。 */
  entries: readonly CreditLedgerEntry[]
  /** 还有更早的一页（Host 手里有 `next_cursor`）。 */
  hasMore: boolean
  fetchedAt: string | null
  error: { code: string; message: string } | null
}

/**
 * 预估请求（client → Host）：**只描述「要生成什么」**，模型 code / operation /
 * input 一律由 Host 用生成链同一份判据现推（`src/credit-quote.ts`）。
 *
 * 为什么不许 client 自己拼 `{model, operation, input}`：那会成为第二份「参数 →
 * 请求体」的映射，与生成链漂移时**预估的价和实际扣的钱不是同一笔**，而这类
 * 漂移在 UI 上完全看不出来（两个数字都「说得通」）。
 */
export interface CreditQuoteParams {
  readonly kind: 'image' | 'video' | 'audio'
  /** 图片路由判据（含可显示文字 → Qwen）与音频正文；**价格与它无关**。 */
  readonly prompt?: string
  /** music 的歌词（缺省按纯器乐 `[Instrumental]`，与生成链同值）。 */
  readonly lyrics?: string
  /** 生效档位（480p/720p/1080p）；缺省 720P（图片）／720P（视频只有 megapixels 档）。 */
  readonly resolution?: string
  /** 画幅（16:9 / 9:16 / 1:1）；只影响图片面积（1:1 是 1024²）。 */
  readonly aspectRatio?: string
  /** 图片车道带参考图 ⇒ `image2image`（同尺寸 ×1.25）。 */
  readonly hasImages?: boolean
  /**
   * 图片车道的发起工具：角色四视图走 `image2character`（**固定 30**，与面积无关，
   * 请求体空）。不传按 `image_generate` 处理（文生 / 图生按面积）。判错这一维会让
   * 角色卡报出 26.42、实扣 30。
   */
  readonly imageTool?: 'image_generate' | 'image_generate_withtxt' | 'character_generate'
  /** 视频时长（秒）；music 也用它当请求时长。 */
  readonly duration?: number
  /** 视频模式：`fl` = 首尾帧（fl2va）／`omni` = 全能参考（ref2va）。 */
  readonly videoMode?: 'fl' | 'omni'
  /** 音频功能：music（按时长）／voice・design（固定价）。 */
  readonly audioFn?: 'music' | 'voice' | 'design'
  /** 图片节点「高级」手动指定（textRender / krea2）。 */
  readonly modelOverride?: 'textRender' | 'krea2'
}

/**
 * 一次报价的结果。
 *
 * `credits` 为 `null` 表示**这次没报出来**（网络 / 未登录 / 服务端拒），此时 UI
 * 必须显式区分「暂不可用」与「0 积分」——0 是一个真实的价（`release` 之后重报
 * 也可能给 0），`null` 才是「不知道」。
 */
export interface AccountQuoteView {
  /** 报价用的模型 code（UI 可显示「按 image.krea2 计价」；null = 未算出）。 */
  readonly model: string | null
  readonly operation: string | null
  /** 预估积分（服务端 4 位小数原样返回，**不四舍五入**）。 */
  readonly credits: number | null
  readonly fetchedAt: string | null
  readonly error: { code: string; message: string } | null
}

/**
 * 批量实扣视图（`POST /canvas-studio/account/spend`）。
 *
 * 数据源是流水里的 `commit` 条目，**不是**节点上存的数字 —— 节点只存
 * `generationId`，金额每次按需派生（理由见 `contracts/canvas.ts` 该字段注）。
 *
 * 三态纪律：`credits` 里没有这个 id 就是**不知道**（更早的账超出了本地缓存的
 * 200 条 / 不是业务 API 链路生成的节点），不能显示成 0。`pending` 是其中
 * 「确实登记过、只是服务端还没结算」的那部分，UI 可以显示「结算中…」。
 */
export interface GenerationSpendView {
  readonly enabled: boolean
  readonly signedIn: boolean
  /** generation id → 实扣积分（绝对值，4 位小数原样）。 */
  readonly credits: Readonly<Record<string, number>>
  /** 还在对账中的 generation id（服务端 commit 未落库）。 */
  readonly pending: readonly string[]
  readonly fetchedAt: string | null
  readonly error: { code: string; message: string } | null
}
