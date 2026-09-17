/**
 * CV-198：把节点内容送进**系统剪贴板**（粘到微信 / 文档 / 聊天窗口）。
 *
 * ## 为什么要单独成模块
 *
 * 需求是「文字和图片节点要能复制出去」。这条链路有三处必须只有**一份实现**：
 *
 * 1. **哪些节点可复制、复制的到底是什么** —— `clipboardPlanOf` 是唯一判定。
 *    视频 / 音频不写剪贴板（几十 MB 的 mp4 塞进剪贴板既慢又不可预测，微信粘贴
 *    视频的路径也完全不同），它们保留原有的「下载资产」。托盘 / 标注类节点没有
 *    可复制的实体载荷。所以菜单项**按计划渲染**，而不是「永远显示、点了报错」。
 * 2. **图片必须先转成 PNG** —— 剪贴板图片只能以 `ClipboardItem({'image/png'})`
 *    交出，而产物可能是 webp / jpeg。方向恒定：非 PNG 一律重编码
 *    （`pngTranscodeNeeded`）。
 * 3. **失败必须说清是哪一步 + 下一步怎么办** —— 剪贴板有三道门（安全上下文 /
 *    用户手势 / 权限），而且失败在浏览器里是**静默**的。所以结果对象带
 *    `failure`/`stage`，文案统一由 `clipboardResultMessage` 生成（图片侧的失败
 *    一律指回「下载资产」这条一定能走通的路）。
 *
 * 浏览器环境是**注入**的（`ClipboardEnv`），纯逻辑因此在 Node 里可直连编译产物
 * 单测（`tests/clipboard-copy.test.mjs`）；唯一实现落在
 * `src/client/canvas/clipboard-env.ts`。这也是本文件放在 `src/` 根而不是
 * `src/client/**` 的原因（Host tsconfig 排除 `src/client/**`，见 `skill-catalog` 注释）。
 *
 * ## 实测依据（`scripts/probe-clipboard.mjs`，2026-09-17）
 *
 * - `file://` 与 `http://127.0.0.1:<port>`（产品真实来源）**都是 secure context**，
 *   `navigator.clipboard` / `write` / `writeText` / `ClipboardItem` 齐全；
 * - `canvas.toBlob('image/png')` 产出真 PNG（magic `89 50 4E 47`）⇒ 转码可依赖；
 * - 无头环境无用户手势时 `writeText` / `write` 会挂住 ⇒ 真机上必须由**真实点击**
 *   触发（因此复制入口只放右键菜单 / 抽屉按钮，不做自动复制）。
 */
import type { StudioCanvasNode, StudioCanvasNodeKind } from './contracts/canvas.js'

/** 能送进剪贴板的载荷：文字节点送正文，图片节点送 PNG。 */
export type ClipboardPayload = 'text' | 'image'

/** 一个节点的复制计划。`null` = 没有可送进剪贴板的载荷（菜单项不渲染）。 */
export interface ClipboardPlan {
  payload: ClipboardPayload
  /** text 载荷的正文；image 载荷恒为空串。 */
  text: string
  /** 菜单项文案。**必须**与画布内的「复制」（就地克隆节点）区分开。 */
  label: string
}

/** 菜单项文案：说清「复制的是什么」，避免和就地克隆节点的「复制」撞名。 */
export const CLIPBOARD_LABELS: Readonly<Record<ClipboardPayload, string>> = {
  text: '复制文字到剪贴板',
  image: '复制图片到剪贴板',
}

/** 成功提示里的名词。 */
export const CLIPBOARD_NOUNS: Readonly<Record<ClipboardPayload, string>> = {
  text: '文字',
  image: '图片',
}

/** 正文就是文字内容的节点类型（画布上的标注类，没有实体产物）。 */
const TEXT_KINDS: ReadonlySet<StudioCanvasNodeKind> = new Set<StudioCanvasNodeKind>(['sticky', 'text', 'prompt'])

/**
 * 文字节点该复制出去的正文。
 *
 * `text` 是主体（保留换行与缩进原样返回，不做 trim —— 复制出去的东西要和画布
 * 上看到的一致）；`text` 全空白时退回标题（只有一个手写标题的便签，复制出去的
 * 不该是空串）；两者都没内容则返回空串，由 `clipboardPlanOf` 判成「没有载荷」。
 */
export function clipboardTextOf(node: StudioCanvasNode): string {
  const body = typeof node.text === 'string' ? node.text : ''
  if (body.trim().length > 0) return body
  const title = typeof node.title === 'string' ? node.title : ''
  return title.trim().length > 0 ? title : ''
}

/**
 * 一个节点的复制计划（唯一判定）。
 *
 * 文字类看正文，图片类看 `url`（没有资产的图片节点复制出去只能是空图，
 * 所以一并判成「没有载荷」）。视频 / 音频 / 托盘 / 其他一律 `null`。
 */
export function clipboardPlanOf(node: StudioCanvasNode): ClipboardPlan | null {
  if (TEXT_KINDS.has(node.kind)) {
    const text = clipboardTextOf(node)
    if (text.length === 0) return null
    return { payload: 'text', text, label: CLIPBOARD_LABELS.text }
  }
  if (node.kind !== 'image') return null
  if (typeof node.url !== 'string' || node.url.length === 0) return null
  return { payload: 'image', text: '', label: CLIPBOARD_LABELS.image }
}

/** 剪贴板只收 PNG：非 PNG（webp / jpeg / 未知类型）一律要重编码。 */
export function pngTranscodeNeeded(blobType: string): boolean {
  return blobType.trim().toLowerCase() !== 'image/png'
}

/** 失败发生在哪一步。 */
export type ClipboardStage = 'plan' | 'load' | 'encode' | 'write'

/**
 * 失败归类。
 *
 * 归类按**阶段**而不是按错误名：同一个 `NotAllowedError` 出现在「取资产」与
 * 「写剪贴板」两步里的意思完全不同，只有阶段能拆开。`NotAllowedError` /
 * `SecurityError` 这两个名字是剪贴板三道门的**标准**错误名（无手势 / 非安全
 * 上下文），单独拎出来给「再点一次」的补救文案。
 */
export type ClipboardFailure = 'empty' | 'no-api' | 'fetch' | 'encode' | 'not-allowed' | 'write'

/** 复制结果。成功只需看 `ok`；失败看 `failure` + `detail`（原始错误留证）。 */
export interface ClipboardResult {
  ok: boolean
  /** 计划里的载荷；`null` 只在「压根没有载荷」时出现。 */
  payload: ClipboardPayload | null
  failure?: ClipboardFailure
  /** 原始错误名 / 信息（文案里括注，用于排障）。 */
  detail?: string
}

/** 浏览器里跟剪贴板打交道的那几件事（唯一实现见 `client/canvas/clipboard-env.ts`）。 */
export interface ClipboardEnv {
  /** 环境是否具备剪贴板能力（非安全上下文下 `navigator.clipboard` 根本不存在）。 */
  available(): boolean
  writeText(text: string): Promise<void>
  /** 写入 PNG 图（`ClipboardItem` + `clipboard.write`）。 */
  writeImage(png: Blob): Promise<void>
  /** 取节点资产（`fetch(node.url)`）。 */
  loadBlob(node: StudioCanvasNode): Promise<Blob>
  /** 重编码成 PNG。 */
  toPng(blob: Blob): Promise<Blob>
}

function errorNameOf(cause: unknown): string {
  if (cause === null || typeof cause !== 'object') return ''
  const name = (cause as { name?: unknown }).name
  return typeof name === 'string' ? name : ''
}

/** 错误的一句话描述（含 DOMException 的 `name`），用于文案括注。 */
export function errorTextOf(cause: unknown): string {
  if (cause instanceof Error) return cause.message.length > 0 ? cause.message : cause.name
  if (typeof cause === 'string') return cause
  if (cause === null || cause === undefined) return 'unknown'
  return String(cause)
}

/** 按阶段 + 错误名归类。 */
export function classifyClipboardFailure(stage: ClipboardStage, cause: unknown): ClipboardFailure {
  if (stage === 'plan') return 'empty'
  if (stage === 'load') return 'fetch'
  if (stage === 'encode') return 'encode'
  const name = errorNameOf(cause)
  if (name === 'NotAllowedError') return 'not-allowed'
  if (name === 'SecurityError') return 'no-api'
  return 'write'
}

function fail(payload: ClipboardPayload | null, failure: ClipboardFailure, cause: unknown): ClipboardResult {
  return { ok: false, payload, failure, detail: errorTextOf(cause) }
}

/**
 * 把节点内容写进系统剪贴板（唯一入口）。
 *
 * 不抛异常：所有失败都变成带类的 `ClipboardResult`（调用方拿它出 toast）。
 * 图片路径分三步，**每步单独 try** —— 「取资产失败」和「写入被拒」的补救办法
 * 不一样，混在一起就没法给用户可执行的下一步。
 */
export async function copyNodeToClipboard(node: StudioCanvasNode, env: ClipboardEnv): Promise<ClipboardResult> {
  const plan = clipboardPlanOf(node)
  if (plan === null) return fail(null, 'empty', undefined)
  if (!env.available()) return fail(plan.payload, 'no-api', undefined)

  if (plan.payload === 'text') {
    try {
      await env.writeText(plan.text)
    } catch (cause) {
      return fail('text', classifyClipboardFailure('write', cause), cause)
    }
    return { ok: true, payload: 'text' }
  }

  let blob: Blob
  try {
    blob = await env.loadBlob(node)
  } catch (cause) {
    return fail('image', classifyClipboardFailure('load', cause), cause)
  }

  let png = blob
  if (pngTranscodeNeeded(blob.type)) {
    try {
      png = await env.toPng(blob)
    } catch (cause) {
      return fail('image', classifyClipboardFailure('encode', cause), cause)
    }
  }

  try {
    await env.writeImage(png)
  } catch (cause) {
    return fail('image', classifyClipboardFailure('write', cause), cause)
  }
  return { ok: true, payload: 'image' }
}

/**
 * 只写一段文字（技能提示词 / @ref 标记 / 抽屉里的提示词）也走同一条口径。
 *
 * 存在的意义是**收口**：此前这三处各自 `navigator.clipboard.writeText(...)`，
 * 失败被 `.catch(() => {})` 吞掉，或干脆是未处理的 rejection（按钮永远不显示
 * 「已复制」，控制台里留一条没人看的报错）。
 */
export async function copyTextToClipboard(text: string, env: ClipboardEnv): Promise<ClipboardResult> {
  if (text.trim().length === 0) return fail(null, 'empty', undefined)
  if (!env.available()) return fail('text', 'no-api', undefined)
  try {
    await env.writeText(text)
  } catch (cause) {
    return fail('text', classifyClipboardFailure('write', cause), cause)
  }
  return { ok: true, payload: 'text' }
}

/**
 * 结果 → 给用户看的一句话（toast）。
 *
 * 失败文案**必须带下一步**：剪贴板失败在浏览器里是静默的，「复制失败」四个字
 * 等于没说。图片侧的每一条都指回「下载资产」——那是本条链路上唯一一定能走通的路。
 */
export function clipboardResultMessage(result: ClipboardResult): string {
  if (result.ok) {
    const noun = result.payload === null ? '内容' : CLIPBOARD_NOUNS[result.payload]
    return `已复制${noun}到剪贴板，可直接粘贴到微信 / 文档里。`
  }
  const detail = result.detail === undefined || result.detail.length === 0 ? '' : `（${result.detail}）`
  switch (result.failure) {
    case 'empty':
      return '这个节点没有可复制的文字或图片。'
    case 'no-api':
      return '当前环境没有可用的剪贴板（需要安全上下文）。图片可改用「下载资产」。'
    case 'not-allowed':
      return '浏览器拒绝了剪贴板写入（缺少用户手势或权限）。请再点一次；仍不行就改用「下载资产」。'
    case 'fetch':
      return `取资产失败${detail}。可改用「下载资产」。`
    case 'encode':
      return `图片转 PNG 失败${detail}。可改用「下载资产」。`
    default:
      return `写入剪贴板失败${detail}。可改用「下载资产」。`
  }
}
