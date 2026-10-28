// 判定层 —— 「这次调用算通过吗？」
//
// 旧行为：只要 HTTP 2xx 就记 PASS。问题在于后端 200 但响应体缺产物 URL 时，
// 客户端拿不到任何东西，测试台却报全绿 —— 这不是断言，这是计数。
//
// 新行为（本文件是唯一判定入口，UI 与 smoke.mjs 共用）：
//   PASS = HTTP 2xx  **且** 端点声明的结构断言（`expect`）全过。
//   非 2xx = FAIL，并把后端错误（尤其 FastAPI 422 的 detail[].loc/msg）抽成人话。
//   另有**软告警**通道（`warn`）：值得记录但不影响 PASS。
//   分界线是「会不会让客户端拿不到东西」—— 缺产物 URL 属前者，契约漂移属后者。
//
// 断言本身住在 endpoints.ts 的 `EndpointDef.expect` / `.warn` 里（响应 schema 与请求
// schema 同处一个事实来源），本文件只负责「跑断言 + 拼错误摘要」。
//
// ⚠️ 这里的相对导入**必须带 `.ts` 扩展名**：smoke.mjs / test-verdict.mjs 直接用
// Node 原生 TS 类型剥离 `import()` 本文件，而 Node ESM 不做无扩展名解析。
// tsconfig 已开 allowImportingTsExtensions，Vite/esbuild 侧同样接受。

import { getEndpoint, type EndpointDef } from './endpoints.ts'

export interface Verdict {
  /** 最终判定：HTTP 2xx 且断言全过。 */
  pass: boolean
  /** 失败原因列表（人类可读）。空数组 = 通过。 */
  failures: string[]
  /**
   * 软告警列表：**不影响 pass**。用于「值得记录但没坏」的情况 ——
   * 目前只有 health 的契约漂移与队列深度（见 endpoints.ts 的 WARN）。
   */
  warnings: string[]
  /** HTTP 层失败的摘要（非 2xx 时非空），用于报告「摘要」列。 */
  httpError: string | null
}

/** FastAPI 422 错误体：{detail:[{loc:(string|number)[],msg,type}]}。 */
interface ValidationErrorItem {
  loc?: unknown
  msg?: unknown
  type?: unknown
}

function asValidationItems(json: unknown): ValidationErrorItem[] {
  if (typeof json !== 'object' || json === null) return []
  const detail = (json as { detail?: unknown }).detail
  return Array.isArray(detail) ? (detail as ValidationErrorItem[]) : []
}

/**
 * 从 422 响应里抽出「后端认为有问题的字段路径」。
 *
 * `loc` 形如 `["body","duration"]`（去掉首段 `body`/`query` 后即字段名）。
 * 负向用例靠它验证「报错定位准不准」——只回 422 但 loc 指错字段，同样算用例失败。
 */
export function extractValidationFields(json: unknown): string[] {
  const out: string[] = []
  for (const item of asValidationItems(json)) {
    if (!Array.isArray(item.loc)) continue
    const parts = item.loc.filter((p) => p !== 'body' && p !== 'query' && p !== 'path')
    if (parts.length > 0) out.push(parts.map((p) => String(p)).join('.'))
  }
  return Array.from(new Set(out))
}

/** 非 2xx 时的人类可读摘要：优先用 422 的结构化定位，其次 detail/msg 字符串。 */
export function describeHttpError(status: number, json: unknown): string {
  // status 0 = 请求根本没拿到 HTTP 响应（连接被拒 / DNS / 超时 / 被中断）。
  // 这时不存在响应体，必须如实说是传输层问题 —— 报「HTTP 0」会让人以为后端返回了 0。
  if (status === 0) return '请求未完成：没有拿到 HTTP 响应'
  const items = asValidationItems(json)
  if (items.length > 0) {
    const parts = items.map((it) => {
      const loc = Array.isArray(it.loc) ? it.loc.filter((p) => p !== 'body').map((p) => String(p)).join('.') : '?'
      const msg = typeof it.msg === 'string' ? it.msg : '校验失败'
      const type = typeof it.type === 'string' ? ` [${it.type}]` : ''
      return `${loc || '(body)'}: ${msg}${type}`
    })
    return `HTTP ${status} 参数校验失败 → ${parts.join(' | ')}`
  }
  if (typeof json === 'object' && json !== null) {
    const d = (json as { detail?: unknown }).detail
    if (typeof d === 'string' && d.length > 0) return `HTTP ${status} · ${d}`
    const m = (json as { msg?: unknown }).msg
    if (typeof m === 'string' && m.length > 0) return `HTTP ${status} · ${m}`
    const e = (json as { error?: unknown }).error
    if (typeof e === 'object' && e !== null) {
      const em = (e as { message?: unknown }).message
      if (typeof em === 'string' && em.length > 0) return `HTTP ${status} · ${em}`
    }
  }
  return `HTTP ${status}`
}

/**
 * 非端点的报告 id → 应该用哪个端点的断言来判。
 *
 * `/api/fetch-to-upload` 是 vite 的同源中间件路由，后端没有这个端点；但它**原样转发**
 * upload 端点的响应体（`{name,subfolder,type}`），所以按 upload 的断言判它是准确的
 * 归并，不是放宽标准 —— 没有这条归并时它会退化成「仅 HTTP」，而它恰恰是句柄链路的
 * 关键一跳，最不该被弱判定。
 */
const ASSERT_ALIAS: Record<string, string> = {
  'fetch-to-upload': 'upload',
}

/**
 * 报告里的合成 id（`txt2image#fix`、`image2image#480p/16:9`）映射回真实端点：
 * 取 `#` 前那段，再走一次别名表。
 */
export function resolveAssertTarget(id: string): EndpointDef | undefined {
  const key = id.split('#')[0] ?? id
  return getEndpoint(ASSERT_ALIAS[key] ?? key)
}

/** 判定一次调用。`json` 为解析成功时的响应体，解析失败传 null。
 *  `transportError` 是 status 0（无 HTTP 响应）时调用方手上的异常文本，用来交代真因。 */
export function evaluate(id: string, status: number, json: unknown, transportError?: string): Verdict {
  if (status < 200 || status >= 300 || status === 0) {
    const base = describeHttpError(status, json)
    const msg = status === 0 && transportError && transportError.trim() !== '' ? `${base}（${transportError.trim().slice(0, 200)}）` : base
    return { pass: false, failures: [msg], warnings: [], httpError: msg }
  }
  const ep = resolveAssertTarget(id)
  if (!ep?.expect && !ep?.warn) {
    // 未声明断言的端点：如实说明这是「只校验了 HTTP」的弱判定，不当成结构已验证。
    return { pass: true, failures: [], warnings: [], httpError: null }
  }
  const failures = ep.expect ? ep.expect(json) : []
  // 软告警与判定无关，所以即使断言已失败也照跑 —— 信息越全越省一次重跑。
  const warnings = ep.warn ? ep.warn(json) : []
  return { pass: failures.length === 0, failures, warnings, httpError: null }
}

/** 该 id 对应的端点是否声明了结构断言（报告里用来区分「已验证」与「仅 HTTP」）。 */
export function hasAssertion(id: string): boolean {
  return typeof resolveAssertTarget(id)?.expect === 'function'
}

/** 把失败原因拼成报告「摘要」列的一行文本。 */
export function summarize(v: Verdict, fallback: string): string {
  if (v.pass) return fallback
  return v.failures.join('；')
}
