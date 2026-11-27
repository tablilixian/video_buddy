/**
 * 意图卡的展示分层（Host 侧纯函数，客户端与测试共用）。
 *
 * 五段含义见 skills/canvas-studio-creation/references/intent-card.md：
 * needsUser 是唯一必填，inferred 带默认可改，其余都是已裁决的记录。
 * 旧卡片把五段平铺成一张长表 ⇒ 信息过载；这里把它们分成「默认展开」与
 * 「折叠明细」两层，客户端只按本文件的结论渲染，不在 JSX 里另写一套判据。
 */
import type { StudioIntentField } from './contracts/project.js'

/** 默认展开的两段：只有用户能答的项 + 带默认依据的推断。 */
const PRIMARY_SOURCES = new Set(['needsUser', 'inferred'])

/** 其余 source（含历史脏值）一律进折叠区，不给首屏添噪。 */
export function intentCardSections(fields: readonly StudioIntentField[]): {
  primary: StudioIntentField[]
  more: StudioIntentField[]
} {
  const primary: StudioIntentField[] = []
  const more: StudioIntentField[] = []
  for (const field of fields) {
    (PRIMARY_SOURCES.has(field.source) ? primary : more).push(field)
  }
  return { primary, more }
}

/**
 * 只读判据：显式项锁用户原话、缺省项只读（均可事后按便签回退）；
 * 冲突项允许改（用户可推翻机器裁决）；kind:'readonly' 是字段级硬锁。
 */
export function intentFieldEditable(field: StudioIntentField): boolean {
  if (field.kind === 'readonly') return false
  return field.source !== 'explicit' && field.source !== 'defaults'
}

/** 候选项脏数据防御：只保留非空字符串，最多 8 项（与工具入参闸同上限）。 */
export function intentFieldOptions(field: StudioIntentField): string[] {
  if (!Array.isArray(field.options)) return []
  return field.options.filter(o => typeof o === 'string' && o.trim() !== '').slice(0, 8).map(o => o.trim())
}
