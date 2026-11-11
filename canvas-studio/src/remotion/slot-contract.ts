/**
 * 1（CV-463）· **槽位合同**（slot contract）：模板对 LLM 的唯一接口。
 *
 * ## 为什么需要有这一层
 *
 * 模板要「只改内容不动结构」，就必须说清**每个内容位能吃多少字**。此前没有任何一层
 * 声明这件事 ⇒ 超长文本被 `overflow:hidden` 静默裁掉（0B 修的是**上报**，这里修的是
 * **不许发生**）。槽位合同就是「填参前就拦下」的那道闸。
 *
 * ## 两条实测踩过的规则（数组 vs 字符串必须分开判）
 *
 * - `type: "string[]"` = 作者**显式分行** ⇒ 判**数组长度 ≤ maxLines** + **每行 ≤ maxCharsPerLine**；
 * - `type: "string"` = 整块 ⇒ 判**总字数 ≤ maxChars** + **内含 `\n` 的行数 ≤ maxLines**。
 *
 * 真实项目里「有意两行标题」是存在的（`["四季","是因为离太阳远近吗？"]`）⇒ 数组形式
 * **不因为「看起来长」就拒收**，只按 `maxLines` 判。
 *
 * ## 字数的口径
 *
 * 一律按 **Unicode 码点**数（`[...text].length`），`\n` 不计入。这与 `text-fit-plan`
 * 的容量估算同口径（汉字按 1em 计），避免「合同说 40 字、体检说超宽」两套账。
 */

/** 槽位值的类型。`number` 给「时长/序号」这类真数字位（模板里暂无用例，先留能力）。 */
export type SlotType = 'string' | 'string[]' | 'number'

/** 一个槽位（`slots.json` 的一项）。 */
export interface SlotContract {
  /** 槽位 id（= manifest 里的占位符名 `{{id}}`）。 */
  id: string
  /** 给人看的名字（错误文案里出现，模型据此理解语义）。 */
  label: string
  type: SlotType
  /** 缺省 false：不传就不替换（占位符留空串）。 */
  required?: boolean
  /** 总字数上限（`string` 与 `string[]` 都判）。 */
  maxChars?: number
  /** 行数上限（`string` 判 `\n` 行数，`string[]` 判数组长度）。 */
  maxLines?: number
  /** 单行字数上限。 */
  maxCharsPerLine?: number
  /** 语义说明：这一格该写什么（模型填参的唯一依据）。 */
  semantic?: string
  /** 版式角色（`title` / `body` / `eyebrow`…），给后续版式参数化留的接口。 */
  styleRole?: string
  /** 示例值（模型照抄风格，别照抄内容）。 */
  example?: string
  /** 缺省值：模型没给时用它，省掉一次「必填被拒 → 再问用户」的往返。 */
  default?: string
}

export type SlotIssueCode =
  | 'SLOT_REQUIRED'
  | 'SLOT_TYPE'
  | 'SLOT_TOO_LONG'
  | 'SLOT_TOO_MANY_LINES'
  | 'SLOT_LINE_TOO_LONG'
  | 'SLOT_UNKNOWN'
  | 'SLOT_UNRESOLVED'

export interface SlotIssue {
  slotId: string
  code: SlotIssueCode
  severity: 'error' | 'warning'
  /** **可执行**文案：说清「超了多少」+「怎么改」。 */
  message: string
}

/** 字数：按码点数，换行不计。 */
export function charCount(text: string): number {
  let count = 0
  for (const char of text) {
    if (char !== '\n' && char !== '\r') count += 1
  }
  return count
}

/** 行数：`\n` 切分后的段数（连续换行也算一行，不做空行折叠 —— 作者怎么写就怎么算）。 */
export function lineCount(text: string): number {
  return text.split('\n').length
}

/** 把任意值按 `type` 归一成「可判的文本 + 行数组」；类型不符返回 undefined。 */
function normalize(value: unknown, type: SlotType): { text: string; lines: string[] } | undefined {
  if (type === 'number') {
    if (typeof value === 'number' && Number.isFinite(value)) return { text: String(value), lines: [String(value)] }
    return undefined
  }
  if (type === 'string[]') {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return undefined
    // 数组元素里的 `\n` 会让「行数」失真 ⇒ 按行再拆一层。
    const lines = (value as string[]).flatMap((item) => item.split('\n'))
    return { text: lines.join('\n'), lines }
  }
  if (typeof value !== 'string') return undefined
  return { text: value, lines: value.split('\n') }
}

/** 是否算「没给」（`undefined` / 空串 / 空数组 / 全空白）。 */
function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0 || value.every((item) => typeof item === 'string' && item.trim() === '')
  return false
}

/**
 * 校验一组填参值。**纯函数、零 IO**（渲染前与 dryRun 都用它，两处口径不可能漂）。
 *
 * 返回的 issues 里 `severity: 'error'` 会阻断编译；`warning` 只提示（多余槽位）。
 */
export function validateSlotValues(
  slots: readonly SlotContract[],
  values: Record<string, unknown>,
): SlotIssue[] {
  const issues: SlotIssue[] = []
  const known = new Set(slots.map((slot) => slot.id))

  for (const key of Object.keys(values)) {
    if (!known.has(key)) {
      issues.push({
        slotId: key,
        code: 'SLOT_UNKNOWN',
        severity: 'warning',
        message: `模板没有槽位 \`${key}\`，已忽略（可用槽位：${slots.map((slot) => slot.id).join(' / ')}）`,
      })
    }
  }

  for (const slot of slots) {
    const value = values[slot.id]
    const label = slot.label === '' ? slot.id : `${slot.id}（${slot.label}）`
    if (isEmptyValue(value)) {
      if (slot.default !== undefined && slot.default !== '') continue
      if (slot.required === true) {
        issues.push({
          slotId: slot.id,
          code: 'SLOT_REQUIRED',
          severity: 'error',
          message: `槽位 ${label} 必填${slot.semantic === undefined ? '' : `（${slot.semantic}）`}`
            + `${slot.example === undefined ? '' : `，例：「${slot.example}」`}`,
        })
      }
      continue
    }
    const normalized = normalize(value, slot.type)
    if (normalized === undefined) {
      const hint = slot.type === 'string[]'
        ? `应传字符串数组（作者按行声明），如 ${JSON.stringify([slot.example ?? '第一行', '第二行'])}`
        : slot.type === 'number' ? '应传数字' : '应传字符串'
      issues.push({
        slotId: slot.id,
        code: 'SLOT_TYPE',
        severity: 'error',
        message: `槽位 ${label} ${hint}；收到 ${describeType(value)}`,
      })
      continue
    }

    const total = charCount(normalized.text)
    if (slot.maxChars !== undefined && total > slot.maxChars) {
      issues.push({
        slotId: slot.id,
        code: 'SLOT_TOO_LONG',
        severity: 'error',
        message: `槽位 ${label} 共 ${String(total)} 字，上限 ${String(slot.maxChars)} 字 —— `
          + `请改到 ${String(slot.maxChars)} 字以内（删掉 ${String(total - slot.maxChars)} 字）`,
      })
    }
    if (slot.maxLines !== undefined && normalized.lines.length > slot.maxLines) {
      issues.push({
        slotId: slot.id,
        code: 'SLOT_TOO_MANY_LINES',
        severity: 'error',
        message: `槽位 ${label} 有 ${String(normalized.lines.length)} 行，上限 ${String(slot.maxLines)} 行 —— `
          + `请合成 ${String(slot.maxLines)} 行以内（这个版式只留了 ${String(slot.maxLines)} 行的位置）`,
      })
    }
    const perLine = slot.maxCharsPerLine
    if (perLine !== undefined) {
      normalized.lines.forEach((line, index) => {
        const count = charCount(line)
        if (count <= perLine) return
        issues.push({
          slotId: slot.id,
          code: 'SLOT_LINE_TOO_LONG',
          severity: 'error',
          message: `槽位 ${label} 第 ${String(index + 1)} 行 ${String(count)} 字，单行上限 ${String(perLine)} 字 —— `
            + `请把这一行拆成两行或压到 ${String(perLine)} 字以内`,
        })
      })
    }
  }
  return issues
}

function describeType(value: unknown): string {
  if (Array.isArray(value)) return `数组（${String(value.length)} 项）`
  if (typeof value === 'number') return `数字 ${String(value)}`
  return `字符串「${String(value).slice(0, 20)}${String(value).length > 20 ? '…' : ''}」`
}

/**
 * 合并缺省值后再校验（编译入口用这个）：模型没给的必填槽若模板写了 `default`，
 * 直接用它 —— 「必填」说的是「成片里不能空」，不是「模型必须逐字给」。
 */
export function resolveSlotValues(
  slots: readonly SlotContract[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...values }
  for (const slot of slots) {
    if (!isEmptyValue(out[slot.id])) continue
    if (slot.default === undefined || slot.default === '') continue
    out[slot.id] = slot.default
  }
  return out
}

/** 槽位容量总和（必填且有 `maxChars` 的槽）—— 闸门判据 1「容量」用它。 */
export function requiredCapacity(slots: readonly SlotContract[]): number {
  return slots
    .filter((slot) => slot.required === true && typeof slot.maxChars === 'number')
    .reduce((sum, slot) => sum + (slot.maxChars ?? 0), 0)
}
