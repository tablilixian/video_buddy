// 测试报告的**数据模型与导出**。
//
// 为什么单独成模块：导出是「报告离开这个页面之后的唯一形态」——贴到群里、
// 挂到 issue 上，读的人只能靠它判断结论。所以格式要能单测（scripts/test-report.mjs），
// 而 .tsx 里的函数跑不了 Node 测试。
//
// 本模块不碰 React；`download` 用到 DOM，但只在被调用时才触达。

/** 素材库条目：句柄类可直接入参，URL 类需先转存。 */
export type AssetKind = 'handle' | 'url'

export interface Asset {
  id: string
  kind: AssetKind
  mediaType: 'image' | 'video' | 'audio' | null
  label: string
  url?: string
  handle?: string
  fromEndpoint: string
  /** 生成该产物所用的提示词（双击放大时展示）。 */
  prompt?: string
}

export interface ReportRow {
  id: string
  title: string
  ok: boolean
  skip?: boolean
  status: number
  ms: number
  note: string
  /** 响应结构断言的失败原因（为空表示断言全过或该步未执行）。 */
  failures?: string[]
  /** 该步的预期（负向用例：期望被挡下 + loc 命中的字段）。 */
  expect?: string
  /** 该步实际发出的请求体（或说明），用于回看每次输入。 */
  input?: string
  /** 该步实际拿到的响应（截断），用于回看每次输出。 */
  output?: string
  /** 后端返回的 duration（服务端生成耗时，秒），非媒体时长。 */
  serverDuration?: number
}


/** 响应体入库前的截断 —— 历史会进 localStorage，超大响应体能把配额撑爆。 */
export function truncBody(s: string, n = 1600): string {
  return s.length > n ? `${s.slice(0, n)}\n…(已省略 ${s.length - n} 字)` : s
}


// ===== 报告导出 =====

/** 触发浏览器下载（不依赖任何库）。 */
export function download(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 立刻回收会让部分浏览器取消下载，延后一拍
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 文件名里带时间戳，多次导出不会互相覆盖（也方便和同事对比）。 */
export function exportStamp(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export interface ExportMeta {
  ts: number
  baseUrl: string
  rows: ReportRow[]
  assets: Asset[]
}

/** JSON 导出：给机器读（回归对比、贴 issue）。 */
export function buildExportJson(meta: ExportMeta): string {
  const { rows } = meta
  const passed = rows.filter((r) => r.ok).length
  const failed = rows.filter((r) => !r.ok && !r.skip).length
  const skipped = rows.filter((r) => r.skip).length
  return JSON.stringify(
    {
      tool: 'Drama API Playground',
      exportedAt: new Date(meta.ts).toISOString(),
      baseUrl: meta.baseUrl,
      // 判定口径写进产物本身，避免报告离开上下文后口径失传
      verdictRule: 'PASS = HTTP 2xx 且响应结构断言通过；负向用例相反（非 2xx 且 422 的 loc 命中预期字段）',
      summary: {
        total: rows.length,
        passed,
        failed,
        skipped,
        passRate: rows.length ? Math.round((passed / rows.length) * 100) : 0,
        totalMs: rows.filter((r) => !r.skip).reduce((s, r) => s + r.ms, 0),
      },
      rows,
      assets: meta.assets.map((a) => ({
        fromEndpoint: a.fromEndpoint,
        kind: a.kind,
        mediaType: a.mediaType,
        handle: a.handle ?? null,
        url: a.url ?? null,
        prompt: a.prompt ?? null,
      })),
    },
    null,
    2,
  )
}

/** Markdown 导出：给人读（直接贴群/贴 PR）。 */
export function buildExportMarkdown(meta: ExportMeta): string {
  const { rows, assets } = meta
  const passed = rows.filter((r) => r.ok).length
  const failed = rows.filter((r) => !r.ok && !r.skip).length
  const skipped = rows.filter((r) => r.skip).length
  const esc = (s: string) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')
  const lines: string[] = []
  lines.push('# Drama API Playground · 测试报告')
  lines.push('')
  lines.push(`- 生成时间：${new Date(meta.ts).toLocaleString('zh-CN')}`)
  lines.push(`- 后端：\`${meta.baseUrl}\``)
  lines.push(`- 判定口径：PASS = HTTP 2xx **且** 响应结构断言通过；负向用例相反（非 2xx 且 422 的 \`loc\` 命中预期字段）`)
  lines.push('')
  lines.push(`**用例 ${rows.length} · 通过 ${passed} · 失败 ${failed} · 跳过 ${skipped}**`)
  lines.push('')
  lines.push('| 接口 | 结果 | HTTP | 耗时 | 服务端 | 预期 | 摘要 |')
  lines.push('|---|---|---:|---:|---:|---|---|')
  for (const r of rows) {
    const tag = r.skip ? 'SKIP' : r.ok ? 'PASS' : 'FAIL'
    lines.push(
      `| \`${esc(r.id)}\` | ${tag} | ${r.status || '—'} | ${r.ms ? `${r.ms}ms` : '—'} | ${
        r.serverDuration != null ? `${r.serverDuration}s` : '—'
      } | ${esc(r.expect ?? '—')} | ${esc(r.failures && r.failures.length > 0 ? r.failures.join('；') : r.note)} |`,
    )
  }
  const withFailures = rows.filter((r) => r.failures && r.failures.length > 0)
  if (withFailures.length > 0) {
    lines.push('')
    lines.push('## 失败明细')
    for (const r of withFailures) {
      lines.push('')
      lines.push(`### \`${r.id}\` — ${r.title}`)
      for (const f of r.failures ?? []) lines.push(`- ${f}`)
      if (r.input) lines.push(`- 请求体：\`${esc(r.input).slice(0, 300)}\``)
      if (r.output) lines.push(`- 响应：\`${esc(r.output).slice(0, 300)}\``)
    }
  }
  if (assets.length > 0) {
    lines.push('')
    lines.push('## 本次产物')
    lines.push('')
    lines.push('| 来源端点 | 类型 | 句柄 / URL |')
    lines.push('|---|---|---|')
    for (const a of assets) lines.push(`| \`${a.fromEndpoint}\` | ${a.mediaType ?? a.kind} | \`${esc(a.handle ?? a.url ?? a.label)}\` |`)
  }
  lines.push('')
  return lines.join('\n')
}

