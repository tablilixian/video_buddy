/**
 * REQ-005 v1.4 / CV-261：首页（lobby）「暂存素材」的**文件侧**——登记、分类把关、
 * 取出落盘。展示事实（kind/name/size/objectUrl）在 store 的 `lobbyStash` 里，
 * `File` 本体在这里的模块级表里，两边用同一个 `id` 关联。
 *
 * ## 为什么文件不进 store
 *
 * `File` 是不可序列化对象，而 store 快照会被订阅层与日志层读取。这与 index.ts 把
 * 待落 brief 放进模块级 `pendingBriefs` 是同一个手法：store 存**事实**，模块级表存
 * **句柄**。
 *
 * ## 为什么要有「暂存」这一态（而不是直接上传）
 *
 * 首页 = 还没有项目（`selectedProjectId === null`），而 `/canvas-studio/upload*`
 * 三兄弟全都要求 projectId —— 首页根本没有落盘的目标目录。所以首页的文件只能先
 * 停在内存里，等用户第一句话触发 draft 目录**认领**成项目之后再逐个落盘。
 * 这也正是用户的诉求原话：「不上传后台，显示出来即可，等点击开始对话后，再直接
 * 落到画布上…可以理解为是暂存并展示」。
 *
 * ## 为什么限额在这里就把（而不是等落盘失败）
 *
 * 落盘失败发生在我们已经认领项目、已经把消息发出去之后 —— 那时首页的暂存条已经
 * 卸载（进了项目），失败提示没有出口，用户只会看到「素材没上去」。四类限额
 * （`MEDIA_UPLOAD_LIMITS`）是纯数据、本地就能判，所以拖入的那一刻就判掉，并让调用方
 * （StudioFrame 有 toast 出口）当场告诉用户是哪一类超限。
 */
import type { MediaKind } from '../media-extension.js'
import { MEDIA_KIND_LABEL, MEDIA_UPLOAD_LIMITS, classifyFile, mediaAcceptAttribute } from '../media-extension.js'
import type { LobbyStashItem } from './project-store.js'

/**
 * 本模块要的那两个动作（**已绑定 draft 的形状**）。
 *
 * 刻意不写 `Pick<ProjectStoreActions, …>`：那是 reducer 的形状（第一个参数是 draft），
 * 而 store 暴露的 `actions` 是 `BakedActions`（draft 由 defineStore 内部注入）。
 * 两个形状长得像但换不过去，写死 reducer 形状只会在调用点报「ProjectStoreState 不能
 * 赋给 string」这种看不懂的错。这里按**调用方真实持有的形状**声明，结构兼容即可。
 */
interface LobbyStashActions {
  stashLobbyFiles: (items: readonly LobbyStashItem[]) => void
  dismissLobbyStash: (id: string) => void
}

/**
 * 条目 id → 文件本体。
 *
 * 用 Map 而不是普通对象：Map 没有原型链上的 `constructor`/`toString` 之类可被文件
 * id 撞上的键，语义也更直白。
 */
const files = new Map<string, File>()

/** 暂存条目的 id（与 StudioFrame 的 `newUploadId` 同一形态，前缀区分用途）。 */
const newStashId = (): string =>
  `stash-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`

/** 分类把关的结论：两类"不收"，调用方须各自给出用户可见的提示（绝不静默）。 */
export interface LobbyStashResult {
  /** 真正登记进暂存的条目数（0 表示这一批一件都没收）。 */
  accepted: number
  /** 扩展名不在四类白名单内（与 `classifyFile` 同一判据）。 */
  unknown: readonly string[]
  /** 在白名单内但超过该类限额（已带上「哪一类、上限多少」）。 */
  oversized: readonly string[]
}

/**
 * 把一批文件登记进暂存。**只登记，不上传**。
 *
 * @param fileList - 用户拖入 / 选择的文件（顺序即 chip 顺序）。
 * @param actions - store 动作面（登记条目；文件本体留在本模块）。
 * @returns 收了几件、哪几件没收（调用方负责提示）。
 */
export function stashLobbyFiles(
  fileList: readonly File[],
  actions: LobbyStashActions,
): LobbyStashResult {
  const unknown: string[] = []
  const oversized: string[] = []
  const accepted: LobbyStashItem[] = []
  for (const file of fileList) {
    const kind = classifyFile(file.name)
    if (kind === null) {
      unknown.push(file.name)
      continue
    }
    if (file.size > MEDIA_UPLOAD_LIMITS[kind]) {
      oversized.push(`${file.name}（${MEDIA_KIND_LABEL[kind]}上限 ${formatLimit(kind)}）`)
      continue
    }
    const id = newStashId()
    files.set(id, file)
    accepted.push({
      id,
      kind,
      name: file.name,
      size: file.size,
      // 预览 URL 只给有画面的两类：audio/text 的 chip 用扩展名徽标，不需要字节。
      ...(kind === 'image' || kind === 'video' ? { objectUrl: URL.createObjectURL(file) } : {}),
    })
  }
  if (accepted.length > 0) actions.stashLobbyFiles(accepted)
  return { accepted: accepted.length, unknown, oversized }
}

/** 摘掉一条暂存：丢掉文件句柄 + 落 store（预览 URL 由 `releaseLobbyStash` 统一回收）。 */
export function dismissLobbyStashItem(
  id: string,
  actions: LobbyStashActions,
): void {
  files.delete(id)
  actions.dismissLobbyStash(id)
}

/**
 * 取出全部待落盘的 (条目, 文件) 对。
 *
 * **只看 store 里的清单**：条目在 store 里但文件不在（理论上不该发生）时跳过 ——
 * 宁可少落一件，也不能让落盘链路拿到 undefined 再炸在半路。
 */
export function takeLobbyStashFiles(
  items: readonly LobbyStashItem[],
): readonly { item: LobbyStashItem; file: File }[] {
  const pairs: { item: LobbyStashItem; file: File }[] = []
  for (const item of items) {
    const file = files.get(item.id)
    if (file !== undefined) pairs.push({ item, file })
  }
  return pairs
}

/**
 * 消费收尾：丢掉文件句柄 + 回收预览 URL。
 *
 * 与 `dismissLobbyStashItem` 分开：那个是用户摘掉一条（条目也从 store 里去掉），
 * 这个是整批落盘之后的收尾（store 清单的清空由调用方显式做 —— 落卡失败时清单要
 * 保留，见 index.ts 的落盘分支）。
 */
export function releaseLobbyStash(items: readonly LobbyStashItem[]): void {
  for (const item of items) {
    files.delete(item.id)
    if (item.objectUrl !== undefined) URL.revokeObjectURL(item.objectUrl)
  }
}

/**
 * 文件选择器的 `accept`（四类并集）。
 *
 * 与工具栏共用 `mediaAcceptAttribute()` 同一份拼装；放在这里是为了让 LobbyHero
 * 不必再 import 一个只会用一次的工具函数（白名单的唯一来源仍是 media-extension）。
 */
export const LOBBY_STASH_ACCEPT = mediaAcceptAttribute()

/* ------------------------------------------------------------------ *
 * REQ-028：首页入口 → StudioFrame 的两个跨树事件
 * ------------------------------------------------------------------ *
 *
 * REQ-028 把首页素材入口改造成「参考内容」方框（LobbyStashBar，dock 行）：
 * 「本地文件」「资产库」两个来源项都发生在 dock 组件里，而**登记 + 拒收提示**
 * （`handleStashedFiles`：分类限额 + toast）与**资产库浮层的开关**都归
 * StudioFrame 所有 —— dock 组件经 index.ts 注册，与 StudioFrame 分属两棵树，
 * 没有可传递 props 的路径。这里用两条 window 自定义事件连起来（仓库先例：
 * StudioFrame 自己就 dispatch window 'dragend'）：
 *
 * - `LOBBY_STASH_FILES_EVENT`（detail: File[]）→ StudioFrame 走既有暂存链路
 *   （分类 / 限额 / 拒收 toast 一处不拆）；
 * - `LOBBY_OPEN_LIBRARY_EVENT` → StudioFrame 打开资产库浮层并刷新清单。
 *
 * StudioFrame 侧只在 lobby 态挂监听（见该文件 REQ-028 effect）；组件侧只发事件
 * 不做任何登记 —— 拒收提示、限额判定仍只有一份实现。
 */

/** 「本地文件」来源项选中 → File[] 交给 StudioFrame 的暂存链路。 */
export const LOBBY_STASH_FILES_EVENT = 'cs-lobby-stash-files'

/** 「资产库」来源项选中 → StudioFrame 打开资产库浮层。 */
export const LOBBY_OPEN_LIBRARY_EVENT = 'cs-lobby-open-library'

/** 人类可读的限额（MB / KB；超限文案用）。 */
function formatLimit(kind: MediaKind): string {
  const bytes = MEDIA_UPLOAD_LIMITS[kind]
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${String(Math.round(mb))} MB` : `${String(Math.round(bytes / 1024))} KB`
}
