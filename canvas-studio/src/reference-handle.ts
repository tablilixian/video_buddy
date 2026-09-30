/**
 * 画布素材的短引用句柄（纯函数，无副作用）。
 *
 * CV-114：chip 上要显示「短、好认」的名字，而节点标题多是中文长句
 * （`Cinematic portrait 主角特写 01`），直接塞进对话框 chip 会挤爆一行，
 * 截断了又互相认不出。因此派生一套**类型前缀 + 同类型序号**的短句柄：
 *
 *   img-01  img-02  …   vid-01  vid-02  …   aud-01  aud-02  …
 *
 * 设计取舍：
 * - 短：`≤6` 字符，chip 只承担「这是第几张图/哪个视频」；
 * - 可认：完整标题 + 缩略图由 hover 浮层与 tooltip 兜住（reference-preview），
 *   这是真正「好认」的地方，不指望 chip 文案；
 * - 不落盘：序号按当前项目节点顺序派生，零迁移、零新字段。删除节点会让后续
 *   序号漂移，但 chip 显示的是**插入时刻的 label 快照**，模型侧拿的是
 *   （永不漂移的）node id —— 漂移只影响人类读新 chip，不影响正确性。
 */
import type { StudioCanvasNode } from './contracts/canvas.js'
import type { LibraryAsset, LibMedia } from './contracts/asset-library.js'
import { LIB_CATEGORY_LABELS, libraryMediaUrl } from './contracts/asset-library.js'

/** 一个可引用素材（图片 / 视频 / 音频）的短句柄视图。 */
export interface AssetHandle {
  /** 节点 id —— 引用句柄与模型侧 token 的真实身份（稳定）。 */
  readonly nodeId: string
  /** 短句柄，如 `img-01` / `vid-02` / `aud-01`（仅用于人读与展示）。 */
  readonly handle: string
  readonly kind: 'image' | 'video' | 'audio'
  /** 完整节点标题（hover 卡片 / 候选项描述用）。 */
  readonly title: string
  /** 素材 URL（缩略图 src；缺省时空浮层降级为纯文本卡）。 */
  readonly url: string | null
  /** 视频 / 音频时长（秒）；图片与未知时长为 undefined（卡片只出不显示）。 */
  readonly duration?: number
}

/** 句柄前缀（按类型分道编号，图片/视频/音频序号互不干扰）。 */
const HANDLE_PREFIX = { image: 'img', video: 'vid', audio: 'aud' } as const

/**
 * kind → 中文标签：`@` 候选的 hint 与搜索匹配共用同一份，避免两处各写一份
 * 然后漂移（`filterAssetHandles` 里搜「音频」要能命中，光靠英文 kind 不够）。
 */
export const ASSET_KIND_LABEL: Readonly<Record<AssetHandle['kind'], string>> = {
  image: '图片',
  video: '视频',
  audio: '音频',
}

/** 完整标题的展示截断长度（hover 卡片标题行用）。 */
const LABEL_MAX = 16

/** 超出上限的标题截断成 `前 N 字…`（按 Unicode 码点切，避免切坏 emoji/汉字）。 */
export function truncateLabel(text: string, max: number = LABEL_MAX): string {
  const chars = [...text]
  if (chars.length <= max) return text
  return `${chars.slice(0, max - 1).join('')}…`
}

/**
 * 为当前项目的可引用素材派生短句柄（按节点数组顺序 = 创建顺序编号）。
 * 只有 image / video / audio 节点可引用（文本便利贴等没有素材语义）。
 *
 * 音频（CV-128 起独立成类）此前被这道闸挡在 chip 管线之外 —— 于是右键
 * 「引用到对话」必然掉进纯文本降级，`@` 菜单也搜不到它（宿主侧 `@ref`
 * 解析其实一直通）。补进来后三处入口（chip / `@` 候选 / hover 卡）齐活。
 */
export function buildAssetHandles(nodes: readonly StudioCanvasNode[]): AssetHandle[] {
  const counters = { image: 0, video: 0, audio: 0 }
  const out: AssetHandle[] = []
  for (const node of nodes) {
    const kind = node.kind
    if (kind !== 'image' && kind !== 'video' && kind !== 'audio') continue
    counters[kind] += 1
    out.push({
      nodeId: node.id,
      handle: `${HANDLE_PREFIX[kind]}-${String(counters[kind]).padStart(2, '0')}`,
      kind,
      title: node.title ?? '',
      url: node.url ?? null,
      ...(typeof node.duration === 'number' ? { duration: node.duration } : {}),
    })
  }
  return out
}

/** 按短句柄反查（hover 浮层从 chip 文案回找素材；大小写不敏感）。 */
export function findAssetByHandle(
  handles: readonly AssetHandle[],
  handle: string,
): AssetHandle | undefined {
  const key = handle.trim().replace(/^@/u, '').toLowerCase()
  if (key === '') return undefined
  return handles.find((item) => item.handle.toLowerCase() === key)
}

/**
 * 从 chip 上的文本反查素材（hover 浮层用）。
 *
 * chip 文案有四种来源，逐个兜：
 * 1. 我们自己的短句柄 `img-01`（右键插入 / 画布素材源选中）；
 * 2. node id（`@ref[<id>]` 被原样贴进输入框时）；
 * 3. 节点标题（上游 `@` 文件源选中后 label 是文件名，恰好与画布标题同名）；
 * 4. 文件 basename（上游文件源的 label 形如 `d73ea812.png`，与节点 url 末段一致）。
 *
 * 上游文件源（ui-reference）产生的 chip 走的正是 3/4：它不认识画布节点，
 * 但只要这个名字在画布上存在同名素材，就照样能出缩略图。
 */
export function findAssetByChipText(
  handles: readonly AssetHandle[],
  text: string,
): AssetHandle | undefined {
  // 0. `@ref[<id>]` —— 已发送气泡里的 chip 把前导 @ 剥掉当显示名（上游
  // projectUserText 的做法），所以这里 @ 可选。
  for (const match of text.matchAll(/@?ref\[([^\]]+)\]/giu)) {
    const id = (match[1] ?? '').trim().toLowerCase()
    if (id === '') continue
    const hit = handles.find((item) => item.nodeId.toLowerCase() === id)
    if (hit !== undefined) return hit
  }
  const raw = text.trim().toLowerCase()
  if (raw === '') return undefined
  const key = raw.replace(/^@/u, '')
  // 只取路径末段：`@a/b/c.png` 与 `c.png` 应命中同一个素材。
  const base = key.slice(Math.max(key.lastIndexOf('/'), key.lastIndexOf('\\')) + 1)
  const stem = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base
  // url 末段的「全名」与「去扩展名」两个形态：`镜头一.mp4` 与 `镜头一` 都能命中。
  const urlNames = (url: string): readonly string[] => {
    const path = url.split(/[?#]/u)[0] ?? url
    const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
    return name.includes('.') ? [name, name.slice(0, name.lastIndexOf('.'))] : [name]
  }
  const titleKey = (title: string): string => title.trim().toLowerCase()
  return handles.find((item) => item.handle.toLowerCase() === key)
    ?? handles.find((item) => item.nodeId.toLowerCase() === key)
    ?? handles.find((item) => titleKey(item.title) === key || titleKey(item.title) === base)
    ?? handles.find((item) => item.url !== null && urlNames(item.url).includes(base))
    ?? handles.find((item) => item.url !== null && urlNames(item.url).includes(stem))
}

/** 按 query 过滤候选（句柄 / 标题 / 类型（中英文）都参与匹配，空 query 返回全部）。 */
export function filterAssetHandles(
  handles: readonly AssetHandle[],
  query: string,
): AssetHandle[] {
  const key = query.trim().toLowerCase()
  if (key === '') return [...handles]
  return handles.filter((item) => {
    if (item.handle.toLowerCase().includes(key)) return true
    if (item.title.toLowerCase().includes(key)) return true
    // 中文类型也认：`kind` 是英文（audio），只搜英文的话「音频」搜不出来。
    if (item.kind.toLowerCase().includes(key)) return true
    return ASSET_KIND_LABEL[item.kind].toLowerCase().includes(key)
  })
}

// ── REQ-001 全局资产库（`lib:` 句柄视图） ────────────────────────────────────

/**
 * 库条目 → `AssetHandle` 视图（`@` 候选、hover 浮层、chip 反查共用）。
 *
 * - `nodeId` = `lib:<id>`：与画布节点 id 同一字段承载引用身份，`findAssetByChipText`
 *   的 `@ref[...]` 正则与裸文本 nodeId 匹配**零改动**即可命中（`lib:` 分支即此）；
 * - `handle` = 资产名（chip / 候选显示名），`title` = 资产名（hover 卡标题）；
 * - `kind` 只承载 image/video：无 image/video 媒体的条目（纯元数据 / 纯音频）
 *   **不进这张表**，不出 hover 卡（`@` 菜单仍可用 `filterLibraryAssets` 搜到，
 *   文件引用会由解析侧明确报错）。画布上的音频节点走另一条 `buildAssetHandles`，
 *   不受此限。
 */
export function buildLibraryAssetHandles(assets: readonly LibraryAsset[]): AssetHandle[] {
  const out: AssetHandle[] = []
  for (const asset of assets) {
    // 库条目只承载 image/video（纯音频条目不出 hover 卡，§8-I 的取舍保留）。
    const previewable = asset.media.filter(
      (entry): entry is LibMedia & { kind: 'image' | 'video' } =>
        entry.kind === 'image' || entry.kind === 'video',
    )
    // 封面优先：coverFile 指向的 image/video 才作预览；否则首张 image，再退 video。
    const media = previewable.find((entry) => entry.file === asset.coverFile) ?? previewable[0]
    if (media === undefined) continue
    out.push({
      nodeId: `lib:${asset.id}`,
      handle: asset.name === '' ? asset.id : asset.name,
      kind: media.kind,
      title: asset.name,
      url: libraryMediaUrl(asset.id, media.file),
    })
  }
  return out
}

/**
 * 按 query 过滤库条目（`@` 资产库候选取数；空 query 返回全部）。
 * 名称 / 别名 / 标签 / 描述 / 分类中文名都参与匹配——自然语言里怎么叫，菜单里
 * 就该搜得到（纯函数，host 侧可单测）。
 */
export function filterLibraryAssets(
  assets: readonly LibraryAsset[],
  query: string,
): LibraryAsset[] {
  const key = query.trim().toLowerCase()
  if (key === '') return [...assets]
  return assets.filter((asset) =>
    asset.name.toLowerCase().includes(key)
    || asset.aliases.some((entry) => entry.toLowerCase().includes(key))
    || asset.tags.some((entry) => entry.toLowerCase().includes(key))
    || asset.description.toLowerCase().includes(key)
    || LIB_CATEGORY_LABELS[asset.category].includes(key))
}
