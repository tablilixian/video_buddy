/**
 * 项目级**布局坐标表**（`layout.json`）：一次量清「表盘区 / 左栏 / 字幕带 / 安全边」，
 * 全片复用。
 *
 * ## 为什么需要它
 *
 * 会话 #5（2026-10-25，187.6 分钟）里 agent 跑了 **88 次 python3**，大量是手工把
 * 「表盘在画面哪个位置、占多大」算成百分比 —— 而且**每一个 shot 都重算一遍**。这正是
 * shotcraft 那套方法论里最值钱的一句：「先量出布局坐标，再让内容去填格子」。
 *
 * ## 它是**工作台**，不是第二个事实源（这条是本模块最重要的设计约束）
 *
 * 本仓的铁律是「唯一事实源」：`storyboard.json.landed` 管规划、`canvas.json` 管画布、
 * manifest 管渲染。再引入一个参与渲染的 `layout.json` 必然出现
 * 「layout 说表盘 x=30、manifest 写 32」这类漂移，且没有任何一方能判谁对。
 *
 * 所以本表**只服务于 agent 的测量与复用**：
 *   - 写入方：`inspect_image` 的 `bbox-*` / `sample` 量出来的画布百分比；
 *   - 读取方：agent 写 manifest 时把数值**展开**进去（本模块提供可直接粘的片段）；
 *   - `render_composition` **不读它**。最终真值永远是 manifest 里那几个数字。
 *
 * 这样既拿到「不用每镜手算」的收益，又不会多出一个能跟 manifest 打架的事实源。
 *
 * ## 语义（与 `render_composition` 的 `box` 完全同口径）
 *
 * `x`/`y` 是矩形的**中心**，`w`/`h` 是宽高，全部是画布百分比（0–100）。
 * 四个值都必须是有限数字，`w`/`h` 必须 > 0 —— 中心语义下 `w=0` 的矩形没有意义。
 */
import { readFileSync } from 'node:fs'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { throwError } from './error-system.js'

/** 一块命名矩形（中心语义，画布百分比）。 */
export interface LayoutRect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export interface LayoutEntry {
  readonly rect: LayoutRect
  /** 可选备注：这块是什么、量自哪张图，便于下次复用时不靠记忆。 */
  readonly note?: string
}

/** 名字 → 条目。名字由调用方自定（`dialArea` / `leftRail` / `subtitleBand` / `safeArea`…）。 */
export type LayoutTable = Readonly<Record<string, LayoutEntry>>

export interface NormalizedLayout {
  readonly table: LayoutTable
  /** 被丢弃的条目及原因（不静默丢 —— 用户会以为存进去了）。 */
  readonly dropped: readonly string[]
}

const MAX_ENTRIES = 40
const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/

function toRect(raw: unknown): LayoutRect | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const num = (key: string): number | null => {
    const value = record[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }
  const x = num('x')
  const y = num('y')
  const w = num('w')
  const h = num('h')
  if (x === null || y === null || w === null || h === null) return null
  if (w <= 0 || h <= 0) return null
  // 中心语义：矩形的四条边都必须落在画布内，否则这块区域根本描不出来。
  if (x - w / 2 < 0 || x + w / 2 > 100 || y - h / 2 < 0 || y + h / 2 > 100) return null
  const clamp = (v: number): number => Math.round(v * 100) / 100
  return { x: clamp(x), y: clamp(y), w: clamp(w), h: clamp(h) }
}

/**
 * 归一化任意输入（读盘 / 工具入参共用一条路径）。
 *
 * 丢弃而不报错的理由是「一张表里有一条写坏，不该让整张表不可用」；但每条丢弃都进
 * `dropped`，调用方必须报给用户 —— 静默丢弃会让人以为布局已存。
 */
export function normalizeLayoutTable(raw: unknown): NormalizedLayout {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { table: {}, dropped: [] }
  }
  const source = raw as Record<string, unknown>
  const table: Record<string, LayoutEntry> = {}
  const dropped: string[] = []
  let count = 0
  for (const [name, value] of Object.entries(source)) {
    if (count >= MAX_ENTRIES) {
      dropped.push(`${name}（超出 ${String(MAX_ENTRIES)} 条上限）`)
      continue
    }
    if (!NAME_PATTERN.test(name)) {
      dropped.push(`${name}（名字须英文字母开头、只含字母数字下划线中划线、≤40 字符）`)
      continue
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      dropped.push(name)
      continue
    }
    const entry = value as Record<string, unknown>
    const rect = toRect(entry.rect ?? entry)
    if (rect === null) {
      dropped.push(`${name}（rect 需要 x/y/w/h 四个数字、w/h > 0，且整个矩形要落在 0–100 内）`)
      continue
    }
    const note = typeof entry.note === 'string' && entry.note.trim() !== '' ? entry.note.trim() : undefined
    table[name] = { rect, ...(note === undefined ? {} : { note }) }
    count += 1
  }
  return { table, dropped }
}

/** 读盘：文件不存在返回空表（不是错误 —— 还没量过任何东西）。 */
export function loadLayoutFile(file: string): NormalizedLayout {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return { table: {}, dropped: [] }
  }
  try {
    return normalizeLayoutTable(JSON.parse(text) as unknown)
  } catch (cause) {
    throwError('CS-USER-ERR', {
      message: `layout.json 不是合法 JSON（${file}）：${cause instanceof Error ? cause.message : String(cause)}。请修好它或先 action:"clear" 重来。`,
    })
  }
}

/** 落盘：原子写（JSON 状态档的硬要求，裸 writeFile 会被 AR-03① 判红）。 */
export async function saveLayoutFile(file: string, table: LayoutTable): Promise<void> {
  await writeFileAtomic(file, `${JSON.stringify(table, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
}

/**
 * 把整张表渲染成两段可直接粘进 manifest 的片段：
 * ① `transform/box` 数值；② 一句「这些数字是中心语义」的提醒。
 *
 * 为什么要给片段而不是只给 JSON：模型的下一步就是往 `tracks[]` 里填，让它自己做
 * 「百分比 → box 字段」的翻译正是过去出错的地方（`x/y` 是中心这件事被反复误解）。
 */
export function layoutTableToManifestSnippet(table: LayoutTable): string {
  const names = Object.keys(table)
  if (names.length === 0) return '（空表：先用 inspect_image 的 bbox-* 量出至少一块区域）'
  const lines = names.map((name) => {
    const { rect, note } = table[name] as LayoutEntry
    const body = `"box": { "x": ${rect.x}, "y": ${rect.y}, "w": ${rect.w}, "h": ${rect.h} }`
    return `· ${name}${note === undefined ? '' : `（${note}）`} → ${body}`
  })
  return lines.join('\n')
}
