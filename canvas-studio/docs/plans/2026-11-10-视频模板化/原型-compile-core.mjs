// 模板编译核心（可复用，无副作用、无 console 输出）
//
// 从 `原型-compile.mjs` 拆出来，目的有两个：
//   ① 让 `原型-llm-fill-test.mjs` 能对同一份模板跑「LLM 填参」测试，
//      而不必复制一遍校验逻辑（复制必漂移）。
//   ② 依赖注入（manifest / slotsDoc / validateManifest），换模板只换参数。
//
// 逻辑与 `原型-audit-text-fit.mjs` 共用同一套容量口径 —— 那里是单一事实源。
import { canvasOf, displayLen, measure, scanSlots } from './原型-audit-text-fit.mjs'

const PLACEHOLDER = /^\{\{([^{}]+)\}\}$/

/**
 * 造一个编译器实例。
 *
 * @param {object} input.manifest        模板骨架（含 `{{slot}}` 占位符）
 * @param {object} input.slotsDoc        参数合同（`slots[]` 带 maxChars/maxLines/required）
 * @param {Function} input.validateManifest  仓库真实的 `validateManifest`
 */
export function createCompiler({ manifest, slotsDoc, validateManifest }) {
  const canvas = canvasOf(manifest)
  const usedSlots = scanSlots(manifest)
  const slotById = new Map((slotsDoc.slots ?? []).map((s) => [s.id, s]))

  /**
   * 编译：**先校验再替换**。超长/超行/未知槽位/缺必填全部在编译前拦住，
   * 且给出「压到几个字」的可执行建议 —— 这是模板相对于自由编排的核心价值
   * （错误在花钱渲染之前暴露，而不是出片后才发现）。
   */
  function compile(values) {
    const errors = []
    const warnings = []
    const known = new Set(slotById.keys())

    for (const k of Object.keys(values ?? {})) {
      if (!known.has(k)) errors.push(`未知槽位 "${k}"（可用：${[...known].join(', ')}）`)
    }

    for (const s of slotsDoc.slots ?? []) {
      const raw = values?.[s.id]
      if (raw === undefined || String(raw).trim() === '') {
        if (s.required) errors.push(`缺少必填槽位 "${s.id}"（${s.label}）`)
        continue
      }
      const text = String(raw)
      const chars = displayLen(text)
      if (chars > s.maxChars) {
        errors.push(
          `槽位 "${s.id}" 超字数：${chars} > ${s.maxChars}（${s.label}）—— 建议压到 ${s.maxChars} 个全角字内（半角算半个）`,
        )
      }
      const lineCount = text.split('\n').length
      if (lineCount > s.maxLines) {
        errors.push(`槽位 "${s.id}" 超行数：${lineCount} > ${s.maxLines}（${s.label}）—— 建议只写 ${s.maxLines} 行`)
      }
    }

    const out = JSON.parse(JSON.stringify(manifest))
    for (const t of out.tracks ?? []) {
      if (t.type !== 'textCard') continue
      const m = PLACEHOLDER.exec(String(t.text))
      if (!m) continue
      const v = values?.[m[1]]
      if (v !== undefined) t.text = String(v)
    }

    if (errors.length > 0) return { ok: false, errors, warnings, manifest: null }

    const v = validateManifest(out)
    for (const e of v.errors) errors.push(`validateManifest: ${e}`)
    for (const w of v.warnings) warnings.push(`validateManifest: ${w}`)

    // 声明容量是一回事，实际填的内容放不放得下是另一回事 —— 逐轨再量一遍。
    for (const s of slotsDoc.slots ?? []) {
      const raw = values?.[s.id]
      if (raw === undefined) continue
      for (const trackId of usedSlots.get(s.id) ?? []) {
        const t = out.tracks.find((x) => x.id === trackId)
        const m = measure(t, String(raw), canvas)
        if (m.overflow || m.clipped) {
          errors.push(
            `槽位 "${s.id}" 填入轨 "${trackId}" 后版面溢出（字号 ${m.fontPx}px，${m.lineCount}/${m.maxLines} 行）`,
          )
        }
      }
    }
    return { ok: errors.length === 0, errors, warnings, manifest: out }
  }

  return { compile, usedSlots, canvas, slotById }
}

/** 结构比对：除 `text` 外任何差异都算失败（「只改内容不动结构」的机器证明）。 */
export function structuralDiff(a, b, at = '') {
  const out = []
  const isObj = (x) => x !== null && typeof x === 'object'
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return [`${at}: 数组/非数组不一致`]
    if (a.length !== b.length) out.push(`${at}: 轨数 ${a.length} → ${b.length}`)
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) out.push(...structuralDiff(a[i], b[i], `${at}[${i}]`))
    return out
  }
  if (isObj(a) && isObj(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of keys) {
      if (k === 'text') continue // 唯一允许变的字段
      out.push(...structuralDiff(a[k], b[k], at === '' ? k : `${at}.${k}`))
    }
    return out
  }
  if (a !== b) out.push(`${at}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`)
  return out
}
