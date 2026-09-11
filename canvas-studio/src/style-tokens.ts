/**
 * Look tokens（5 项风格 tokens）的**单一权威定义**（纯常量 + 纯函数，无 IO / 无网络）。
 *
 * 背景见 docs/look-asset-plan.md §3.2：把「风格」从「澄清问卷里的一个选项」换成
 * 「一份可寻址的 5 元组」，让四种输入（一句创意 / 参考图 / 参考视频 / 预设）都归一到
 * 同一份 tokens —— 因为它同时是**完备基**（任何 look 都只能用这 5 个自由度表达）与
 * **汇合点**（四种输入都能产出同一个 5 元组）。
 *
 * 为什么要结构化而不是让模型写一段风格描述：自由文本一改就牵连全段、跨镜复制会漂移、
 * 样张不对时说不清是哪一项的问题。结构化把这三个缺陷同时消掉（改「再暗一点」只动「光线」一行）。
 *
 * 本文件是**唯一权威**：
 * - Host 侧 `video-style.ts`（参考视频归纳）从这里取提示词；
 * - Agent 侧 `skills-local/…/references/look.md` 里的提示词原文由测试断言与本文件逐字节一致
 *   （防 CV-116 那类「多处同改漏一处」的漂移）；
 * - 不要在别处重复写这 5 个字段名的字面量。
 */

/** Look tokens 的 5 个字段。**顺序固定、不增不减** —— 四路输入与逐镜注入都按此顺序。 */
export const LOOK_TOKEN_KEYS = ['色彩', '光线', '材质', '镜头语汇', '节奏'] as const

export type LookTokenKey = (typeof LOOK_TOKEN_KEYS)[number]

/** VLM 归纳时的系统提示词（参考视频逐帧归纳与参考图归纳共用）。 */
export const LOOK_ANALYST_SYSTEM_PROMPT = '你是一个专业的影视视觉分析师，擅长从画面中提炼可复用的风格要素。'

/**
 * 画面 → 5 项 tokens 的归纳提示词（参考视频逐帧归纳的**每一帧**、参考图归纳都用它）。
 *
 * 只给**字段名**、不给字段解释 —— 否则模型会把解释照抄回来当结论。措辞要求「具体结论」
 * 是为了防这类退让：字段名是「问什么」，结论是「这部片子怎么答」。
 */
export const LOOK_TOKENS_PROMPT = [
  '请从电影摄影角度归纳这段画面的视觉风格，严格按下面 5 行输出（顺序固定、不增不减、不要序号、不要额外说明，每行给出具体结论而不是字段解释）：',
  ...LOOK_TOKEN_KEYS.map((key) => `${key}：`),
].join('\n')

/** 行首修饰（`-` / `*` / `+` / `1.` / `1、`）与包裹的 `**` 都不算字段名的一部分。 */
const TOKEN_LINE = /^\s*(?:[-*+]|\d+[.、])?\s*\*{0,2}\s*([^\s：:*]{1,12})\s*\*{0,2}\s*[：:]\s*(.*)$/u

/** 是否是合法的 Look 字段名（仅本文件内部用 —— 对外只暴露 `parseLookTokens` / `mergeLookTokens`）。 */
function isLookTokenKey(value: string): value is LookTokenKey {
  return (LOOK_TOKEN_KEYS as readonly string[]).includes(value)
}

/**
 * 从任意文本里解析 5 项 tokens（**容错**：解析不到就返回空对象，绝不抛）。
 *
 * 容错是刻意的 —— 归纳文本来自 VLM，格式不可能 100% 守约（可能出现序号、加粗、
 * 换行续写、或干脆回退成自由要点）。解析失败时上层走降级路径（提示用户改用反推），
 * 而不是把生成流程打断。
 */
export function parseLookTokens(text: string): Partial<Record<LookTokenKey, string>> {
  const out: Partial<Record<LookTokenKey, string>> = {}
  for (const raw of text.split(/\r?\n/u)) {
    const matched = TOKEN_LINE.exec(raw)
    if (matched === null) continue
    const key = matched[1]!.trim()
    // 去尾部残留的加粗标记（`光线：柔光**` 这类）。
    const value = matched[2]!.trim().replace(/\*{1,2}$/u, '').trim()
    if (value.length === 0 || !isLookTokenKey(key)) continue
    const previous = out[key]
    // 同一字段写了两行（换行续写）：合并而不是覆盖，后者会静默丢信息。
    out[key] = previous === undefined ? value : `${previous}；${value}`
  }
  return out
}

/** 按「；」切分子句（归并时以子句为单位去重，避免整行不同就整行重复）。 */
function splitClauses(value: string): string[] {
  return value
    .split(/[；;]/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

/**
 * 把多份归纳文本**归并**成一份 5 项 tokens（纯函数，零额外 VLM 调用）。
 *
 * 参考视频的逐帧分析现状只是 `join('\n\n')` 拼接 —— 那不是归纳，是把 N 帧的观察堆在一起，
 * 读的人还得自己做合并。归并按「字段 → 子句」两级去重：同一字段下多帧观察到的相同子句只留一份，
 * 不同的子句按帧序并列，于是「色彩」一行就是全片色彩的完整描述。
 *
 * 返回 `''` 表示**一份可用的 tokens 都没归纳出来**（VLM 没按格式输出）→ 调用方应走降级：
 * 如实说明未归纳成功，请用户改用参考图或直接描述。
 */
export function mergeLookTokens(texts: readonly string[]): string {
  const buckets = new Map<LookTokenKey, string[]>()
  for (const text of texts) {
    const parsed = parseLookTokens(text)
    for (const key of LOOK_TOKEN_KEYS) {
      const value = parsed[key]
      if (value === undefined) continue
      const bucket = buckets.get(key) ?? []
      for (const clause of splitClauses(value)) {
        if (!bucket.includes(clause)) bucket.push(clause)
      }
      buckets.set(key, bucket)
    }
  }
  const lines: string[] = []
  for (const key of LOOK_TOKEN_KEYS) {
    const bucket = buckets.get(key)
    if (bucket === undefined || bucket.length === 0) continue
    lines.push(`${key}：${bucket.join('；')}`)
  }
  return lines.join('\n')
}
