/**
 * REQ-001：把全局资产库清单注入 system prompt，让 agent 能把自然语言里的
 * 「女主」「雨夜巷弄」翻译成逐字可用的 `@ref[lib:<id>]`（验收②b 的事前指引通道；
 * 截断 / 需要检索时走 `list_references` 的 `library` 字段兜底）。
 *
 * 实现要点与 `plan-prompt.ts` 同模板（§8-H）：
 * - 小节 text **必须同步返回 string**（上游 `PromptSection.text` 不允许 Promise），
 *   而库读取（`AssetLibrary.list`）是异步的 → 模块级缓存桥接；
 * - 预热点 `agent/created`（会话发布早于首轮 assemble）；provider 内每次 assemble
 *   顺带触发一次异步刷新（库在会话中增删改后，下一轮即见新清单）；
 * - 库为空 → 返回空串，小节自动不注入（不给模型看空标题）。
 *
 * 注意：文本中不得出现 `{{variable}}`——renderPrompt 对未知引用直接抛错，
 * 因此名称/别名/描述等用户输入要先过 `safePromptText` 去花括号。
 */
import type { AssetLibrary } from './asset-library.js'
import type { LibraryAsset } from './contracts/asset-library.js'
import { LIB_CATEGORIES, LIB_CATEGORY_LABELS } from './contracts/asset-library.js'

/** system prompt 小节名（命名空间化防冲突；重名注册会抛错）。 */
export const ASSET_LIBRARY_SECTION_NAME = 'canvas-studio:asset-library'

/**
 * 小节顺序。约定 100–199 为工具使用指引带：150 skill 路由 / 151 项目预置已占，
 * 本段是其下游（先路由、再预置、再看可引用资产），取 152（§8-H）。
 */
export const ASSET_LIBRARY_SECTION_ORDER = 152

/** 注入上限：防清单撑爆上下文（超出部分由 list_references 兜底查询）。 */
export const MAX_LIBRARY_PROMPT_ENTRIES = 200

/** 缓存小节文本；null = 尚未预热（provider 首轮返回空串并触发刷新）。 */
let cached: string | null = null

/** 丢弃花括号序列：renderPrompt 把 `{{x}}` 当变量引用解析，未知引用直接抛错。 */
function safePromptText(text: string): string {
  return text.replace(/\{\{/gu, '｛｛').replace(/\}\}/gu, '｝｝')
}

/**
 * 由库清单生成小节正文（纯函数，可单测）。
 * @returns 空串表示库为空（调用方跳过注入）。
 */
export function librarySectionText(assets: readonly LibraryAsset[]): string {
  if (assets.length === 0) return ''
  // 稳定序：先按四分类枚举序（不是对象键序/时间序），分类内按 updatedAt 倒序
  //（与资产库页列表同序，两边读到的顺序一致）。
  const ordered = LIB_CATEGORIES.flatMap((category) =>
    assets.filter((asset) => asset.category === category)
      .sort((left, right) => right.updatedAt - left.updatedAt))
  const visible = ordered.slice(0, MAX_LIBRARY_PROMPT_ENTRIES)
  const lines = visible.map((asset) => {
    const aliases = asset.aliases.length > 0 ? `（别名：${asset.aliases.map(safePromptText).join('、')}）` : ''
    const description = asset.description !== '' ? ` — ${safePromptText(asset.description)}` : ''
    const media = asset.media.length === 0 ? '（无媒体，不能作文件引用）' : ''
    return `- [${LIB_CATEGORY_LABELS[asset.category]}] ${safePromptText(asset.name)}${aliases} id=lib:${asset.id}${description}${media}`
  })
  const truncation = assets.length > visible.length
    ? `\n（共 ${assets.length} 条，仅列前 ${visible.length} 条；其余用 list_references 查询 library 字段。）`
    : ''
  return `## 全局资产库（跨项目）

用户提到下列角色/场景/物件/群像（含别名）并需要作画面参考时，**逐字使用** \`@ref[lib:<id>]\` 填进 filename / ref 类参数（裸 \`lib:<id>\` 也认），不得改写、翻译或截断 id——Host 会自动把该资产的媒体物化到当前项目。也可先调 list_references 拿 library 字段（含全部别名与描述）再引用。

${lines.join('\n')}${truncation}`
}

/**
 * 刷新缓存（每次 agent 启动与库变更后的 assemble 都会路过）。
 * @returns 是否存在非空小节文本。
 */
export async function refreshAssetLibraryPromptCache(library: AssetLibrary): Promise<boolean> {
  try {
    const text = librarySectionText(await library.list())
    cached = text
    return text !== ''
  } catch {
    // 读库失败（文档损坏等）保留旧缓存：提示词降级为旧清单，比空串/抛错安全。
    return false
  }
}

/** 读取缓存文本（未预热返回空串；库为空缓存即空串）。 */
export function cachedAssetLibrarySectionText(): string {
  return cached ?? ''
}

/**
 * 注册资产库小节 + `agent/created` 缓存预热。
 * @returns 联合 disposer（同时移除小节与事件监听）。
 */
export function registerAssetLibraryPrompt(ctx: {
  systemPrompt: { section(section: { name: string; order: number; text: string | ((context: unknown) => string) }): () => void }
  on(event: 'agent/created', listener: (payload: { agent?: { session?: { header?: { cwd?: string } } } }) => void): () => void
}, library: AssetLibrary): () => void {
  const disposeSection = ctx.systemPrompt.section({
    name: ASSET_LIBRARY_SECTION_NAME,
    order: ASSET_LIBRARY_SECTION_ORDER,
    text: () => {
      // 每次 assemble 顺带异步刷新：会话中入库/改名后下一轮即见（本轮用缓存）。
      void refreshAssetLibraryPromptCache(library)
      return cached ?? ''
    },
  })
  const disposeListener = ctx.on('agent/created', () => {
    void refreshAssetLibraryPromptCache(library)
  })
  return () => { disposeSection(); disposeListener() }
}
