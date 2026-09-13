/**
 * C10：节点「镜头条」的**文字派生** —— 头部标题 + 脚部读数。
 *
 * ## 为什么值得单独一个模块
 *
 * 头部要写「剧本 / 分镜 / 关键帧 / 角色 …」，标题又已经叫「分镜 3 · 关键帧」，
 * 直接把两者摞在一起就是同一句话说两遍。去重规则一旦散在 JSX 里，节点卡、
 * 详情面板、预览骨架三处迟早各写一份，然后各自漂移（CV-160 的教训：同一规则
 * 多处各写一份，最终成片被当成片段重复计入时长）。
 *
 * 所以这里只做三件事，全是纯函数、无 DOM、无 React：
 * 1. `headTitleOf` —— 从 `node.title` 里摘掉「类型」那一段，剩下的才是名字。
 * 2. `declaredReadingsOf` —— 还没有真实产物时，脚部能显示的**声明值**。
 * 3. 脚部读数的**顺序契约**（见 `READING_ORDER`），保证卡片之间能左右扫读。
 *
 * 有真实产物之后的读数（时长 / 分辨率）由 `CanvasNode` 从媒体元素实测后补，
 * 因为它们依赖 `<video>` / `<img>` 的加载事件，不是从契约里读得出来的。
 */
import type { StudioCanvasNode } from './contracts/canvas.js'

/** 标题里「类型」与「名字」的分隔符 —— 产品里就是它（`mediaNodeTitle` 也用）。 */
const SEGMENT_SEPARATOR = '·'

/**
 * 摘掉标题里与头部标签重复的那一段。
 *
 * 三种输入都要照顾到（都是真实标题）：
 * - `关键帧` + 「分镜 3 · 关键帧」 → 「分镜 3」（标签在尾段，整段删掉）
 * - `分镜` + 「分镜 3 · 中近景」   → 「3 · 中近景」（标签是首段的**前缀**，
 *   只摘前缀，编号要留下 —— 编号是这张卡最有信息量的部分）
 * - `角色` + 「角色 · 林晚」       → 「林晚」
 * - `BGM` + 「BGM」                → `''`（标题就是类型本身，头部只剩标签，
 *   不显示重复的空标题）—— 这一条最关键：没有它，BGM 卡的头部会写成「BGM BGM」。
 *
 * 全程不改 `node.title`：这是**显示层**派生，用户重命名与磁盘数据都不受影响。
 */
export function headTitleOf(node: StudioCanvasNode, label: string): string {
  const raw = (node.title ?? '').trim()
  if (raw.length === 0) return ''
  const segments = raw
    .split(SEGMENT_SEPARATOR)
    .map(segment => segment.trim())
    .filter(segment => segment.length > 0)
  const kept = segments.filter(segment => segment !== label)
  if (kept.length === 0) return ''
  const first = kept[0]
  if (first !== undefined && first.startsWith(label)) {
    const rest = first.slice(label.length).trim()
    if (rest.length === 0) kept.shift()
    else kept[0] = rest
  }
  return kept.length === 0 ? '' : kept.join(` ${SEGMENT_SEPARATOR} `)
}

/**
 * 脚部读数的**显示顺序**（从左到右）。定义在这里而不是散在 JSX：
 * 「时长在分辨率左边」是一条跨卡片的一致性约定，散着写就会有的卡左有的卡右。
 */
export const READING_ORDER = ['audio-mix', 'duration', 'dims', 'declared-duration', 'chars'] as const
export type ReadingKey = (typeof READING_ORDER)[number]

/**
 * 节点**自带**的读数（不依赖媒体加载）。
 *
 * 为什么有真实产物时不再显示声明时长：`CV-140` 起 `duration` 是 ffprobe 实测值，
 * `declaredDuration` 是下当时的请求值，两者会差几十毫秒。同一张卡上同时出现
 * 两个来源不同的秒数，读者无法判断该信哪个 —— 只留实测值。
 */
export function declaredReadingsOf(node: StudioCanvasNode): { key: ReadingKey; text: string }[] {
  const out: { key: ReadingKey; text: string }[] = []
  const declared = node.declaredDuration
  if (node.url === undefined && declared !== undefined && Number.isFinite(declared) && declared > 0) {
    out.push({ key: 'declared-duration', text: `${declared.toFixed(1)}s` })
  }
  if (node.kind === 'text' || node.kind === 'sticky' || node.kind === 'prompt') {
    // 字数按「非空白字符」算 —— 剧本/分镜正文里换行与缩进很多，按 `length` 算
    // 会让「200 字」的卡片实际只读得到 150 字，用户一数就对不上。
    const chars = (node.text ?? '').replace(/\s+/g, '').length
    if (chars > 0) out.push({ key: 'chars', text: `${chars} 字` })
  }
  return out
}
