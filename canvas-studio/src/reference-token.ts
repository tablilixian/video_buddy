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
import { throwError } from './error-system.js'
import './errors/catalog.js'

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
    throwError('CS-REF-004')
  }
  return `@ref[${handle}]`
}

/**
 * 匹配用的节点视图：id 必有，标题与资产 url 可选 —— 后者参与兜底判据
 * （CV-376：模型常把工具返回的资产文件名当句柄，`<uuid>.mp4` 既不是节点 id
 * 也不等于标题）。
 */
export type RefLookupNode = Pick<StudioCanvasNode, 'id' | 'title' | 'url'>

/** 标题尾部省略号（`promptSummary` 的 `前 12 字…`；历史数据里也有 `...` 写法）。 */
const TITLE_ELLIPSIS_RE = /(?:…|\.\.\.)+$/u

/** 分镜卡标题的分段符（`分镜 1 · S1-Sh1 · 缓慢推进`）。 */
const TITLE_SEPARATOR = '·'

/**
 * 前缀匹配的最短长度：少于 4 个字（`@ref[分镜]`、`@ref[a]`）不参与前缀匹配，
 * 否则一个短词能同时前缀命中几十张卡，「取首个」就等于乱指。
 */
const MIN_PREFIX_LENGTH = 4

/** 资产名比较的最短 stem：`a.png` 这种过短的名字不参与，避免 `a` 命中一大批。 */
const MIN_ASSET_STEM_LENGTH = 4

/** 去掉尾部省略号后 trim（`写实摄影，正面半身人像…` → 标题原文）。 */
function stripTitleEllipsis(value: string): string {
  return value.trim().replace(TITLE_ELLIPSIS_RE, '').trim()
}

/** 标题按 `·` 切段，供「分段全等」判据（`分镜 1`、`S1-Sh1` 各是一段）。 */
function titleSegments(title: string): string[] {
  return title.split(TITLE_SEPARATOR).map((part) => part.trim()).filter((part) => part.length > 0)
}

/** 文件名去扩展名（`a.b.png` → `a.b`；无扩展名原样）。与 `uniqueTitle` 的 stem 同口径。 */
function stemOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

/** 资产 url 的末段文件名（`/canvas-studio/assets/<id>/a.png` → `a.png`）；取不到返回 null。 */
function assetNameOf(url: string | undefined): string | null {
  if (url === undefined || url === '') return null
  const noHash = url.split('#')[0] ?? url
  const noQuery = noHash.split('?')[0] ?? noHash
  const last = noQuery.split(/[/\\]/u).pop() ?? ''
  return last === '' ? null : last
}

/** 标题前缀（双向、去省略号后、较短一方 ≥4）。相等不吃这一档（前面已有精确档）。 */
function isTitlePrefix(token: string, title: string): boolean {
  if (token === '' || title === '' || token === title) return false
  const shorter = token.length <= title.length ? token : title
  if (shorter.length < MIN_PREFIX_LENGTH) return false
  return token.startsWith(title) || title.startsWith(token)
}

/**
 * 句柄匹配强度：`0` = 不命中，数值越小证据越强。
 *
 * 判据阶梯（CV-376，顺序即优先级，任何一档命中都停在该档）：
 * 1. 节点 id 全等 —— CV-114 的稳定句柄；
 * 2. 标题全等 —— 历史/手输兼容；
 * 3. 标题去尾部省略号后全等 —— 模型把被截断的标题连同 `…` 一起抄回来；
 * 4. 资产文件名 —— token 等于 url 末段，或与末段去扩展名后全等（`<uuid>.mp4`）；
 * 5. 标题分段全等 —— `分镜 1` 命中 `分镜 1 · S1-Sh1 · 缓慢推进`；
 * 6. 标题前缀（较短一方 ≥4）—— 模型只抄了标题的一半。
 *
 * 为什么要有 4/5/6：2026-10-28 转录实测里 18 次 `CS-USER-001` 全部是这三种写法，
 * 而客户端 `findAssetByChipText`（`reference-handle.ts`）早就有等价兜底 ——
 * 症状是「hover 有缩略图、一发出去就报找不到」。
 */
function refMatchTier(node: RefLookupNode, token: string): number {
  if (node.id === token) return 1
  const title = (node.title ?? '').trim()
  if (title !== '' && title === token) return 2
  const bareToken = stripTitleEllipsis(token)
  const bareTitle = stripTitleEllipsis(title)
  if (bareTitle !== '' && bareTitle === bareToken) return 3
  const assetName = assetNameOf(node.url)
  if (assetName !== null) {
    if (assetName === token) return 4
    const tokenStem = stemOf(token)
    if (tokenStem.length >= MIN_ASSET_STEM_LENGTH && stemOf(assetName) === tokenStem) return 4
  }
  if (bareToken !== '' && titleSegments(title).includes(bareToken)) return 5
  if (isTitlePrefix(bareToken, bareTitle)) return 6
  return 0
}

/** 取强度最高的一档；同档取数组首个（数组顺序 = 创建顺序），不猜。 */
function bestRefMatch<T extends RefLookupNode>(
  nodes: readonly T[],
  token: string,
): { node: T; tier: number } | undefined {
  const trimmed = token.trim()
  if (trimmed === '') return undefined
  let best: { node: T; tier: number } | undefined
  for (const node of nodes) {
    const tier = refMatchTier(node, trimmed)
    if (tier === 0) continue
    if (best === undefined || tier < best.tier) best = { node, tier }
    if (tier === 1) break // id 全等是终点，没有更强的证据
  }
  return best
}

/**
 * 引用句柄 → 节点：**id 精确优先**，其后按 `refMatchTier` 的阶梯兜底
 * （标题 / 去省略号 / 资产名 / 分段 / 前缀）。
 *
 * 全不命中返回 undefined，由调用方给可操作报错（`suggestRefCandidates` 提供候选）。
 */
export function findNodeByRef<T extends RefLookupNode>(nodes: readonly T[], token: string): T | undefined {
  return bestRefMatch(nodes, token)?.node
}

/**
 * 候选建议的相似度地板（低于它不进提示；这是**建议**不是判据，宁可少给不误导）。
 *
 * 0.5 配合下面的「重叠系数」：短 token（`分镜 9`）与长标题（`分镜 1 · S1-Sh1 · 缓慢推进`）
 * 也能过线 —— 那正是最该给候选的场景（镜号写错一位）。
 */
const SUGGESTION_SIMILARITY_FLOOR = 0.5

/**
 * 重叠系数（Szymkiewicz–Simpson）：`|A∩B| / min(|A|,|B|)`，0–1。
 *
 * 为什么不用 Dice：标题长、token 短时 Dice 被长标题稀释（`分镜 9` vs 12 字的标题只有
 * 0.375），而「镜号打错一位」恰恰是最需要提示候选的错法。重叠系数对短 token 不惩罚。
 */
function overlapSimilarity(left: string, right: string): number {
  if (left === '' || right === '') return 0
  const a = new Set([...left])
  const b = new Set([...right])
  let shared = 0
  for (const ch of a) if (b.has(ch)) shared += 1
  return shared / Math.min(a.size, b.size)
}

/**
 * 报错用候选：**按相似度**（不是按命中阶梯）挑最接近的 3 个标题。
 *
 * 为什么不用命中阶梯：任何能过阶梯的节点就已经命中了，走到这里必然是「阶梯全灭」。
 * 所以候选只能用更松的度量 —— 字符集合重叠。它**只进文案**（模型照着改写法），
 * 绝不参与匹配判定，因此松一点没有正确性风险。
 */
export function suggestRefCandidates(
  nodes: readonly RefLookupNode[],
  token: string,
  limit = 3,
): string[] {
  const trimmed = stripTitleEllipsis(token)
  if (trimmed === '' || limit <= 0) return []
  const scored = nodes
    .map((node, index) => {
      const title = (node.title ?? '').trim()
      const assetName = assetNameOf(node.url)
      const score = Math.max(
        overlapSimilarity(trimmed, stripTitleEllipsis(title)),
        assetName === null ? 0 : overlapSimilarity(trimmed, assetName),
      )
      return { title, index, score }
    })
    .filter((entry) => entry.score >= SUGGESTION_SIMILARITY_FLOOR)
    .sort((a, b) => (a.score === b.score ? a.index - b.index : b.score - a.score))
  const out: string[] = []
  for (const entry of scored) {
    if (entry.title === '' || out.includes(entry.title)) continue
    out.push(entry.title)
    if (out.length >= limit) break
  }
  return out
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
