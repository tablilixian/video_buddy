/**
 * @ref 引用标记工具（Host/Client 共用，纯函数，无副作用）。
 *
 * 画布素材用 `@ref[句柄]` 作为对话内引用句柄：用户在节点右键/详情面板/参考
 * 托盘点「引用到对话」会插入一个 chip，Host 侧生成工具（image_generate /
 * video_generate / character_sheet / video_composite）把 `@ref[句柄]` 解析成
 * 对应的 Drama Backend 文件名，免去手动 upload_image。
 *
 * CV-114：句柄语义由「显示名」升级为**节点 id**，标题退化为兜底——
 * 标题会重名（uniqueTitle 只能去重批次内的）、会被用户改名，两者都会让引用
 * 指错对象或失效；id 是节点唯一稳定标识。旧教材/手输的 `@ref[标题]` 仍可用。
 *
 * 这与 Midjourney 的 `--cref` / `--sref` token、Runway 的参考区思路一致：
 * 一个稳定的引用句柄，跨「画布 ↔ 聊天」复用素材。
 */

import type { StudioCanvasNode } from './contracts/canvas.js'

/** 单条消息内最多解析的 @ref token 数（防超长/恶意输入消耗 CPU）。 */
const MAX_REF_TOKENS = 64

/** 把上传文件的原始名清洗成合法节点标题：空名兜底 + 去除 [ ]（CR-031）。 */
export function sanitizeTitle(raw: string, fallback = '本地素材'): string {
  return (raw.trim() === '' ? fallback : raw).replace(/[[\]]/gu, '')
}

/**
 * 在已占用标题集合内生成不重名的节点标题：重名时在扩展名前追加序号
 * （`image.png` → `image 2.png`）。剪贴板粘贴的 File.name 恒为 image.png，
 * 多张重名会让 @ref[token] 无法区分——parseRefTokens 按名去重，同消息里
 * 第二条同名引用会被静默丢弃，agent 拿到的参考就缺图了。生成的新标题会
 * 回写进 used，供同批次后续文件继续去重。
 */
export function uniqueTitle(raw: string, used: Set<string>, fallback = '本地素材'): string {
  const base = sanitizeTitle(raw, fallback)
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot) : ''
  for (let i = 2; ; i += 1) {
    const candidate = `${stem} ${i}${ext}`
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
}

/**
 * 把引用句柄（优先节点 id）格式化为对话内引用标记。
 *
 * CV-114 起传 node.id；仍兼容任意句柄字符串（旧的 `@ref[标题]`）。
 */
export function formatRefToken(handle: string): string {
  // CR-031：句柄含 `[` / `]` 时无法用 `@ref[handle]` 无损表达（parseRefTokens 按
  // 最末 `]` 截断，解析出的句柄错配 → 参考图解析失败/错连）。
  // 直接拒绝并给可操作提示，比生成一个坏 token 更安全。
  if (/[[\]]/u.test(handle)) {
    throw new Error('引用句柄包含 [ 或 ]，无法生成 @ref 引用标记，请先重命名该节点')
  }
  return `@ref[${handle}]`
}

/**
 * 引用句柄 → 节点：**id 精确优先**，其次标题兜底（历史/手输兼容）。
 *
 * 两者都不命中返回 undefined，由调用方给可操作报错。同标题多节点时取首个
 * （数组顺序 = 创建顺序），不做猜测。
 */
export function findNodeByRef<T extends Pick<StudioCanvasNode, 'id' | 'title'>>(
  nodes: readonly T[],
  token: string,
): T | undefined {
  const trimmed = token.trim()
  if (trimmed === '') return undefined
  const byId = nodes.find((node) => node.id === trimmed)
  if (byId !== undefined) return byId
  return nodes.find((node) => (node.title ?? '').trim() === trimmed)
}

/**
 * 从一段文本里抽取所有 `@ref[显示名]` 标记，返回显示名数组（去重保持首次出现顺序）。
 * 用于 Host 侧在工具参数里识别 `@ref[...]` 并解析成 Drama 文件名。
 */
export function parseRefTokens(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const re = /@ref\[([^\]]+)\]/g
  let m: RegExpExecArray | null
  // CR-031：token 数量上限，防超长输入触发大量正则回溯。
  while ((m = re.exec(text)) !== null && out.length < MAX_REF_TOKENS) {
    const name = m[1] as string
    if (!seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }
  return out
}
