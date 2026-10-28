// 批量运行的**纯逻辑**：表单草稿合并、前置依赖解析、参数矩阵展开。
//
// 为什么单独成模块（而不是留在 App.tsx 里）：
//  ① 这些函数决定「实际会发多少次请求、发什么值」，是批量运行的全部策略所在，
//     但它们在 .tsx 里既无法被 Node 直接 import（Node 的 TS 剥离不支持 JSX），
//     也就没法进自测 —— 而「跑 20 分钟才发现值传错了」的代价太高。
//  ② App.tsx 的调用次数估算与真正执行必须共用同一份算法，两处各写一遍必然漂移
//     （漂移的后果是「提示 8 次，实际跑了 24 次」，而后端是同步单任务，用户要等的就是它）。
//
// 本模块只做纯计算，不碰 fetch / React / DOM。

import { HANDLE_DEPENDENT, type EndpointDef } from './endpoints.ts'

/** 批量链路里「文字修复基图」两个步骤的独立报告 id（与角色基图分开，避免互相覆盖）。 */
export const TXT2IMAGE_FIX_ID = 'txt2image#fix'
export const UPLOAD_FIX_ID = 'upload#fix'
/** 只吃「角色基图」的句柄依赖端点；image2fix 用文字场景基图，image2vl 任意图皆可。 */
export const CHAR_BASE_EPS = HANDLE_DEPENDENT.filter((id) => id !== 'image2fix' && id !== 'image2vl')

/** 端点字段初始值：角色驱动字段用当前全局角色，其余用 default。 */
export function initialValues(ep: EndpointDef, character: string): Record<string, string> {
  const v: Record<string, string> = {}
  for (const f of ep.fields) {
    if (f.characterDriven) v[f.key] = character
    else if (f.default !== undefined) v[f.key] = String(f.default)
    else v[f.key] = ''
  }
  return v
}

// ===== 参数矩阵 =====

/**
 * 参数矩阵：勾选的轴做**笛卡尔积**，每个组合独立跑一遍选中端点。
 * 没勾的轴不参与（该字段沿用表单值）。
 */
export interface MatrixSpec {
  resolution: string[]
  aspectRatio: string[]
  duration: string[]
}

export const EMPTY_MATRIX: MatrixSpec = { resolution: [], aspectRatio: [], duration: [] }

/**
 * 时长候选。**不写 15 以上**：OpenAPI 里 duration 没有任何 maximum 约束，
 * 「上限 15」是产品侧约定而非后端校验；而探针实测（canvas-studio/scripts/h3-duration-probe.mjs）
 * duration ≥ 10 的单次推理要 5 分钟以上，再往上代价不成比例。
 */
export const MATRIX_DURATIONS = ['5', '8', '10']
/** 图片端点的矩阵宽高比（含方形）；视频端点只有 16:9 / 9:16。 */
export const MATRIX_IMG_ASPECT = ['16:9', '9:16', '1:1']

/** 把一个组合渲染成短标签，用作报告 id 的后缀与 UI 展示。 */
export function comboLabel(combo: Record<string, string>): string {
  const parts = [combo.resolution, combo.aspectRatio, combo.duration].filter((x): x is string => !!x)
  return parts.length === 0 ? '默认' : parts.join('/')
}

/** 组合 → 报告 id 后缀（空组合不加后缀，保持单次运行的报告可读）。 */
export function comboIdSuffix(combo: Record<string, string>): string {
  const label = comboLabel(combo)
  return label === '默认' ? '' : `#${label}`
}

/**
 * 笛卡尔积展开：任选轴为空数组则该轴不参与；全空 = 只有一个空组合。
 *
 * 对**缺轴**的入参做了兜底（`?? []`）：调用方少传一个键不该让整轮运行崩掉
 * （这个坑是被 scripts/test-batch.mjs 抓出来的）。非数组值同样按「不参与」处理。
 */
export function expandMatrix(m: MatrixSpec): Record<string, string>[] {
  const axes = (
    [
      ['resolution', m.resolution],
      ['aspectRatio', m.aspectRatio],
      ['duration', m.duration],
    ] as Array<[string, string[] | undefined]>
  ).filter((pair): pair is [string, string[]] => Array.isArray(pair[1]) && pair[1].length > 0)
  if (axes.length === 0) return [{}]
  let out: Record<string, string>[] = [{}]
  for (const [key, vals] of axes) {
    const next: Record<string, string>[] = []
    for (const base of out) for (const v of vals) next.push({ ...base, [key]: v })
    out = next
  }
  return out
}

/**
 * 合并「表单草稿 + 矩阵组合 + 注入值」成一次调用的字段值。
 * 优先级：注入值（如句柄）> 矩阵组合 > 表单草稿 > 端点默认值。
 */
export function mergeVals(
  ep: EndpointDef,
  drafts: Record<string, Record<string, string>>,
  combo: Record<string, string>,
  character: string,
  id: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  const base = { ...initialValues(ep, character), ...(drafts[id] ?? {}) }
  // 矩阵只覆盖该端点**真的有**的字段（免得给 image2fix 塞一个不存在的 resolution）
  const keys = new Set(ep.fields.map((f) => f.key))
  for (const [k, v] of Object.entries(combo)) {
    if (keys.has(k) && !(k in extra)) base[k] = v
  }
  return { ...base, ...extra }
}

// ===== 前置依赖解析 =====

/**
 * 「跑这些端点」实际会跑到的全部端点（含自动前置句柄链路）。
 *
 * UI 的调用次数估算与真正执行共用这一份，避免「提示 8 次、实际 24 次」。
 */
export function resolveEffective(ids: Set<string>): { effective: Set<string>; prereq: string[] } {
  // 基图分两类，各自独立生成，互不覆盖：
  //   · 角色基图（txt2image + upload）→ 给 image2image / image2character / 视频端点用
  //   · 文字修复基图（txt2image#fix + upload#fix）→ 给 image2fix 用，须含远近景中文文字
  const effective = new Set(ids)
  const prereq: string[] = []
  const addPrereq = (id: string) => {
    if (!effective.has(id)) {
      effective.add(id)
      prereq.push(id)
    }
  }
  const wantsUpload = effective.has('upload')
  const needsFixBase = effective.has('image2fix')
  const needsCharBase = CHAR_BASE_EPS.some((id) => effective.has(id))
  if (needsCharBase || wantsUpload) {
    addPrereq('upload')
    addPrereq('txt2image')
  }
  if (needsFixBase) {
    addPrereq(TXT2IMAGE_FIX_ID)
    addPrereq(UPLOAD_FIX_ID)
  }
  return { effective, prereq }
}

/** 一个组合预计要发多少次请求（含自动前置）。 */
export function estimateCalls(ids: Set<string>): number {
  return resolveEffective(ids).effective.size
}
