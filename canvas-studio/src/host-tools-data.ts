/**
 * 阶段 4.2（2026-11-04）：数据导入类工具（`import_csv`）——与音频 / 素材加工同款
 * 外置件模式（host-tools.ts 函数跨度棘轮，新工具组进独立文件）。
 *
 * `import_csv` 是纯文本解析（零 IO、零后端槽位）：CSV 内容进、chart 轨可用的
 * `{labels, values}` 建议出。**只做结构化，不做数据加工** —— 不排序、不聚合、
 * 不猜缺失值；数据保真纪律归 chart 轨校验层。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { parseCsv, suggestChartData } from './csv-parse.js'
import { throwError } from './error-system.js'

/** 数据导入工具组（当前仅 import_csv；后续 json/xml 导入进本组）。 */
export function defineDataTools(): ReturnType<typeof defineTool>[] {
  return [
    defineTool({
      name: 'import_csv',
      description:
        'CSV → chart 数据卡（4.2）：把 CSV 文本解析成 chart 轨可直接使用的 {labels, values} 建议。'
        + '分隔符自动嗅探（逗号/分号/Tab），支持引号包裹与混用行界；数值列自动识别'
        + '（千分位 / % 后缀按比例收口），**文本列不会被猜成数字**（数据保真：解析器不编数据）。'
        + '返回行数 / 表头 / 每列数值占比 / 建议 label·value 列与对应数组 —— 把建议数组'
        + '原样写进 chart 轨的 labels / values（超 32 行先截断或聚合，chart 契约上限 32）。',
      parameters: {
        content: { type: 'string' as const, required: true, description: 'CSV 文本全文（首行为表头；用户贴在对话里或附件文本原样传入）' },
        limit: { type: 'number' as const, description: '可选：建议数组最大行数（缺省 12，上限 32 = chart 契约上限）；超出截断并在 notes 标注' },
      },
      output: { schema: { type: 'object' as const, additionalProperties: true, properties: { rowCount: { type: 'integer' as const }, delimiter: { type: 'string' as const }, headers: { type: 'array' as const, items: { type: 'string' as const } }, columnProfile: { type: 'array' as const, items: { type: 'object' as const, additionalProperties: true } }, suggested: { type: 'object' as const, additionalProperties: true }, notes: { type: 'array' as const, items: { type: 'string' as const } } } }, render: (_args, value) => {
        const v = value as {
          rowCount?: number
          delimiter?: string
          headers?: string[]
          columnProfile?: { name: string; numericRatio: number; sample: string }[]
          suggested?: { labelColumn: string; valueColumn: string; labels: string[]; values: number[]; truncated: boolean } | null
          notes?: string[]
        }
        const lines = [
          `CSV 解析：${v.rowCount ?? 0} 行 × ${v.headers?.length ?? 0} 列（分隔符 ${JSON.stringify(v.delimiter ?? ',')}）。`,
          ...(v.columnProfile ?? []).map((c) => `  - ${c.name}：数值占比 ${(c.numericRatio * 100).toFixed(0)}%（如：${c.sample}）`),
          v.suggested
            ? `建议 → labels（${v.suggested.labelColumn}）=[${v.suggested.labels.map((l) => JSON.stringify(l)).join(', ')}]；values（${v.suggested.valueColumn}）=[${v.suggested.values.join(', ')}]${v.suggested.truncated ? '（已截断）' : ''}。可直接写进 chart 轨。`
            : '未找到合格数值列（数值占比 ≥60% 且不全 0）——指定数据或改用文本卡呈现。',
          ...(v.notes ?? []).map((note) => `⚠️ ${note}`),
        ]
        return [{ type: 'text', text: lines.filter(Boolean).join('\n') }]
      } },
      async execute(args) {
        const a = args as { content?: string; limit?: number }
        const content = typeof a.content === 'string' ? a.content : ''
        if (content.trim() === '') {
          throwErrorUser('content 不能为空 —— 把 CSV 文本全文贴进 content（首行为表头）')
        }
        const limit = Math.min(32, Math.max(1, Math.round(typeof a.limit === 'number' && Number.isFinite(a.limit) ? a.limit : 12)))
        const table = parseCsv(content)
        if (table === null) {
          throwErrorUser('CSV 解析失败：没有可用数据行（首行会被当作表头）')
        }
        const notes: string[] = []
        const suggested = suggestChartData(table, limit)
        if (suggested?.truncated) {
          notes.push(`数据共 ${table.rows.length} 行，建议数组只取前 ${limit} 行（chart 契约上限 32）；需要全量请先聚合或分多张卡。`)
        }
        const columnProfile: Record<string, JsonValue>[] = table.headers.map((name, c) => {
          const col = table.rows.map((r) => r[c] ?? '')
          const numeric = col.filter((cell) => /^-?\d+(\.\d+)?%?$/.test(cell.trim().replaceAll(',', '')) && cell.trim() !== '').length
          return {
            name: name === '' ? `#${c + 1}` : name,
            numericRatio: table.rows.length === 0 ? 0 : numeric / table.rows.length,
            sample: col[0] ?? '',
          }
        })
        return {
          rowCount: table.rows.length,
          delimiter: table.delimiter,
          headers: table.headers.map((h, i) => (h === '' ? `#${i + 1}` : h)),
          columnProfile,
          // schema 推断不收 null（只收缺省）——无建议时不落字段（exactOptionalPropertyTypes 惯例）
          ...(suggested === null
            ? {}
            : {
                suggested: {
                  labelColumn: suggested.labelColumn,
                  valueColumn: suggested.valueColumn,
                  labels: [...suggested.labels],
                  values: [...suggested.values],
                  truncated: suggested.truncated,
                } as Record<string, JsonValue>,
              }),
          notes,
        }
      },
    }),
  ]
}

/** 结构化用户错误（与 host-tools 各 execute 的 CS-USER-ERR 同款）。 */
function throwErrorUser(message: string): never {
  throwError('CS-USER-ERR', { message })
}
