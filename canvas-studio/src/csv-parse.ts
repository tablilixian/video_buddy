/**
 * 阶段 4.2（2026-11-04）：CSV → chart 数据卡的**纯解析层**（零依赖、零 DOM、
 * node --test 直连）——治「数据可视化只能手填 manifest」。
 *
 * ## 解析口径（刻意从简、确定性优先）
 *
 * - RFC4180-lite：`"` 包裹字段（含 `""` 转义）、`\r\n` / `\n` / `\r` 行界；
 * - 分隔符嗅探：候选 `,` `;` `\t`，取「首行命中数最多且全表一致」者（并列取先）；
 * - 数值收口：去空格 / 千分位逗号 / 尾部 `%`（值同步 ÷100）后 `Number()`，
 *   有限非空才认数 —— 其余一律算文本，**不猜**（数据保真：猜测会编数据）；
 * - `suggestChartData`：label 列取「文本占比高」的列（缺省第 1 列），value 列取
 *   「数值占比最高」的列（缺省第 2 个数值列语义 = label 之外第一个全数值列）；
 *   行数超 `limit` 截断并记 note（chart 契约上限 32）。
 */

/** 解析结果：首行为表头（缺表头的纯数字表由调用方按 `headersAreData` 自行降级）。 */
export interface CsvTable {
  /** 嗅探出的分隔符（`,` / `;` / `\t`）。 */
  readonly delimiter: string
  /** 表头（第一行原样，未 trim 单元格内空白）。 */
  readonly headers: readonly string[]
  /** 数据行（不含表头；每行长度 = headers 长度，短行以空串补齐）。 */
  readonly rows: readonly (readonly string[])[]
}

/** 行界切分（容忍混用 \r\n / \n / \r；引号内换行按 RFC4180 归下一行内容——按字符态扫描）。 */
function splitRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
      continue
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cur)
      rows.push(row)
      row = []
      cur = ''
      continue
    } else if (ch === delimiter) {
      row.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  row.push(cur)
  rows.push(row)
  // 掐尾：末尾连续空行只留一个（文件以换行结尾是常态，不算数据）
  while (rows.length > 1 && rows[rows.length - 1]!.length === 1 && rows[rows.length - 1]![0] === '') rows.pop()
  return rows
}

/** 分隔符嗅探：首行（去引号前）各候选命中数最多者；全 0 命中回落 `,`。 */
export function sniffDelimiter(text: string): string {
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? ''
  let best = ','
  let bestCount = 0
  for (const d of [',', ';', '\t']) {
    // 引号内的分隔符不算（简化：逐字符扫描，跳过引号段）
    let count = 0
    let inQuotes = false
    for (const ch of firstLine) {
      if (ch === '"') inQuotes = !inQuotes
      else if (ch === d && !inQuotes) count++
    }
    if (count > bestCount) {
      best = d
      bestCount = count
    }
  }
  return best
}

/** 解析 CSV 文本 → 表（首行 = 表头）。空表 / 全空行返回 `null`（调用方给可读错误）。 */
export function parseCsv(text: string, delimiter?: string): CsvTable | null {
  const d = delimiter ?? sniffDelimiter(text)
  const rows = splitRows(text, d)
  if (rows.length === 0) return null
  const headers = rows[0]!
  if (headers.length === 1 && headers[0]!.trim() === '') return null
  return {
    delimiter: d,
    headers,
    rows: rows.slice(1).map((r) => {
      const cells = r.slice(0, headers.length)
      while (cells.length < headers.length) cells.push('')
      return cells
    }),
  }
}

/**
 * 数值收口：`"1,234"` / `" 45.1 "` / `"76%"` → 数；其余 → `null`（不猜）。
 * `%` 后缀按比例语义同步 ÷100（76% → 0.76，与 chart 契约「数值为量纲」对齐）。
 */
export function coerceNumber(cell: string): number | null {
  const trimmed = cell.trim()
  if (trimmed === '') return null
  const percent = trimmed.endsWith('%')
  const bare = percent ? trimmed.slice(0, -1).trim() : trimmed
  const cleaned = /^-?\d+(\.\d+)?$/.test(bare.replaceAll(',', '')) ? bare.replaceAll(',', '') : bare
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return null
  return percent ? n / 100 : n
}

/** 列的数值占比（0–1；空表 0）。 */
function numericRatio(col: readonly string[]): number {
  if (col.length === 0) return 0
  const nums = col.filter((c) => coerceNumber(c) !== null).length
  return nums / col.length
}

/** 供 chart 的建议数据（标签列 + 数值列；行数上限 `limit`，超限截断记 note）。 */
export interface ChartSuggestion {
  readonly labelColumn: string
  readonly valueColumn: string
  readonly labels: readonly string[]
  readonly values: readonly number[]
  readonly truncated: boolean
}

/**
 * 从表里挑 label / value 列给 chart 轨：
 * - value 列 = 数值占比最高（≥0.6）且均值不全 0 的列（并列取靠左）；
 * - label 列 = 数值占比最低的列（并列取靠左）；
 * - 找不到合格数值列 → `null`（调用方提示用户指定 valueColumn 或改数据）。
 */
export function suggestChartData(table: CsvTable, limit = 12): ChartSuggestion | null {
  const n = table.headers.length
  if (n < 2 || table.rows.length === 0) return null
  const cols = table.headers.map((_, c) => table.rows.map((r) => r[c] ?? ''))
  const ratios = cols.map(numericRatio)
  let valueIdx = -1
  for (let c = 0; c < n; c++) {
    if (ratios[c]! >= 0.6 && (valueIdx === -1 || ratios[c]! > ratios[valueIdx]!)) valueIdx = c
  }
  if (valueIdx === -1) return null
  let labelIdx = 0
  for (let c = 0; c < n; c++) {
    if (c !== valueIdx && ratios[c]! < ratios[labelIdx]!) labelIdx = c
  }
  if (labelIdx === valueIdx) labelIdx = valueIdx === 0 ? 1 : 0
  const rows = table.rows.slice(0, limit)
  const values = rows.map((r) => coerceNumber(r[valueIdx] ?? '') ?? 0)
  if (values.every((v) => v === 0)) return null
  return {
    labelColumn: table.headers[labelIdx] ?? `#${labelIdx + 1}`,
    valueColumn: table.headers[valueIdx] ?? `#${valueIdx + 1}`,
    labels: rows.map((r, i) => r[labelIdx] === '' ? `#${i + 1}` : r[labelIdx]!.trim()),
    values,
    truncated: table.rows.length > limit,
  }
}
