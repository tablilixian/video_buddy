/**
 * 复刻提效批二：**未知参数 → 报错教学**（Host 侧，唯一入口接线）。
 *
 * ## 抓的是什么浪费
 *
 * 2026-11-02 甜品复刻真机会话实测：模型为了确认「`render_composition` 到底有哪些
 * 入参」，前后 **18 次** grep/sed 读 `src/remotion/manifest.ts`、15 次读
 * `host-utils.ts`，光「读源码定契约」这一类就烧掉 **42.8 分钟**（占全会话模型时间
 * 的 40.5%）。根因不是文档不够 —— 手写的 `manifest-contract.md` 已有 39.6KB，它
 * 照样不信：**手写文档会漂，源码不会**。
 *
 * 而它读源码的触发点往往是「我上一次调用的字段名被报了个语焉不详的错」。一次
 * **失败的调用**如果能当场告诉它「合法字段是这些 + 最小可用调用长这样」，它就不必
 * 去读源码 —— 这是同一份信息、同一个时刻、零额外成本。
 *
 * ## 口径（宁可漏判，不可误判）
 *
 * - 只拒收**明确不在 `parameters` 声明里**的键；参数表就是唯一事实源（工具定义被
 *   框架导出给模型，模型看到的 schema 与这里读的是同一份）。
 * - 以 `$` / `__` 开头的键直接放行（框架/测试可能注入元字段，不属于模型手写面）。
 * - 非对象入参放行（交给 schema 校验报错）。
 * - 报错文案里**不出现「请读源码」**，而是反向提示「不要为确认字段名去读源码」——
 *   这句话本身就是省时间的那一句。
 */

import { throwError } from './error-system.js'

/** 工具定义的形状（只取本守卫关心的两段）。 */
export interface ToolShapeForParams {
  name?: unknown
  parameters?: unknown
}

/** 计算编辑距离（只用于「你是不是想写 X」的近似匹配；长度差 > 2 直接短路）。 */
function editDistance(left: string, right: string): number {
  if (Math.abs(left.length - right.length) > 2) return 3
  const rows = left.length + 1
  const cols = right.length + 1
  const prev = new Array<number>(cols)
  const curr = new Array<number>(cols)
  for (let j = 0; j < cols; j += 1) prev[j] = j
  for (let i = 1; i < rows; i += 1) {
    curr[0] = i
    for (let j = 1; j < cols; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1
      curr[j] = Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost)
    }
    for (let j = 0; j < cols; j += 1) prev[j] = curr[j] ?? 0
  }
  return prev[cols - 1] ?? 3
}

/** 在合法参数里找一个「最像」的，用于「是不是想写 X？」。 */
function closestParam(unknownName: string, known: readonly string[]): string | null {
  const lower = unknownName.toLowerCase()
  let best: { name: string; distance: number } | null = null
  for (const candidate of known) {
    if (candidate.toLowerCase() === lower) return candidate
    if (candidate.toLowerCase().includes(lower) || lower.includes(candidate.toLowerCase())) return candidate
    const distance = editDistance(lower, candidate.toLowerCase())
    if (distance <= 2 && (best === null || distance < best.distance)) best = { name: candidate, distance }
  }
  return best?.name ?? null
}

/** 参数的示例值（按声明的 type 生成，够模型看懂形状即可）。 */
function exampleValueOf(spec: unknown): string {
  const type = (spec as { type?: unknown } | null)?.type
  if (type === 'string') return '"<字符串>"'
  if (type === 'number' || type === 'integer') return '0'
  if (type === 'boolean') return 'false'
  if (type === 'array') return '[]'
  if (type === 'object') return '{}'
  return '"<值>"'
}

/**
 * 某条工具的合法参数清单 + 最小可用调用示例（纯函数，测试直连）。
 *
 * ⚠️ **两种形态都要认**：源码里 `defineTool({ parameters })` 写的是 `Record<name, spec>`，
 * 但 `defineTool` 返回的对象已把它转成 **JSON Schema**（`{type:'object', properties, required}`）。
 * 守卫在生产路径上拿到的是后者 —— 只认前者会把 `type/properties/required` 当成
 * 「合法参数」，然后任何真实入参都被判未知（等于全线拦死）。
 */
export function paramCatalogOf(shape: ToolShapeForParams): {
  names: string[]
  required: string[]
  example: string
} | null {
  const parameters = shape.parameters
  if (parameters === null || typeof parameters !== 'object') return null
  const asSchema = parameters as { type?: unknown; properties?: unknown; required?: unknown }
  let names: string[]
  let required: string[]
  let specOf: (name: string) => unknown
  if (asSchema.type === 'object' && asSchema.properties !== null && typeof asSchema.properties === 'object') {
    const properties = asSchema.properties as Record<string, unknown>
    names = Object.keys(properties)
    required = Array.isArray(asSchema.required)
      ? asSchema.required.filter((entry): entry is string => typeof entry === 'string')
      : []
    specOf = (name) => properties[name]
  } else {
    const entries = Object.entries(parameters as Record<string, unknown>)
    names = entries.map(([name]) => name)
    required = entries
      .filter(([, spec]) => (spec as { required?: unknown } | null)?.required === true)
      .map(([name]) => name)
    specOf = (name) => (parameters as Record<string, unknown>)[name]
  }
  if (names.length === 0) return null
  const exampleFields = required.length > 0 ? required : names.slice(0, 2)
  const example = `{${exampleFields
    .map((name) => `${JSON.stringify(name)}:${exampleValueOf(specOf(name))}`)
    .join(',')}}`
  return { names, required, example }
}

/**
 * 未知参数守卫：命中时抛 `CS-USER-ERR`，文案 = 合法字段清单 + 最小调用示例 + 纠错猜测。
 * 未命中直接返回（零副作用，先于 `execute`）。
 */
export function assertKnownToolParams(shape: ToolShapeForParams, args: unknown): void {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return
  const catalog = paramCatalogOf(shape)
  if (catalog === null) return
  const known = new Set(catalog.names)
  const unknown = Object.keys(args as Record<string, unknown>)
    .filter((key) => !known.has(key))
    .filter((key) => !key.startsWith('$') && !key.startsWith('__'))
  if (unknown.length === 0) return
  const tool = typeof shape.name === 'string' ? shape.name : '未知工具'
  const guessed = unknown
    .map((name) => {
      const near = closestParam(name, catalog.names)
      return near === null ? null : `${name} → ${near}`
    })
    .filter((entry): entry is string => entry !== null)
  const requiredLabel = catalog.required.length > 0 ? catalog.required.join(' / ') : '（无）'
  const message = [
    `${tool} 不认识参数：${unknown.map((name) => '`' + name + '`').join('、')}。`,
    `合法参数（${catalog.names.length} 个）：${catalog.names.join(' / ')}`,
    `必填：${requiredLabel}`,
    `最小可用调用：${catalog.example}`,
    ...(guessed.length > 0 ? [`疑似写错：${guessed.join('；')}`] : []),
    '参数名以这条报错为准 —— **不要为确认字段名去读 canvas-studio/src 下的源码**（那是最后一手，一次 grep 平均烧 30 秒以上）。',
  ].join('\n')
  // RQ-R8/E3：参数笔误模型改个名就自愈 —— agent-only（路由规则：无 user ⇒ 用户界面隐藏），
  // 模型仍从 `Error: …` 结果里拿到全部信息。旧通用 CS-USER-ERR 会画成用户红错。
  throwError('CS-TOOL-PARAMS', { message, detail: `unknown params: ${unknown.join(',')}` })
}
