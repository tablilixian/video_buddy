/**
 * H3-Context-IR 简报格式校验器（TS 移植，源自 MiniMax-H3-Context-IR-Skill validate.py）。
 *
 * 规则从 MiniMax 官方两份写作指南 + 四组官方实际 IR 输出独立推导。
 * 冲突时以官方实际输出为准 —— 数值型"句数/词数"约束官方自己也会超，
 * 因此 ERROR 只留给结构性错误，数值区间一律 WARN。
 *
 * 硬闸门：tests/h3-ir-validate.test.mjs 用 tests/fixtures/official_ir.json
 * 断言官方 IR 输出 100% 通过（对应 validate.py --self-test）。
 */

export const BASE_SECTIONS = [
  'integrated_multimodal_description',
  'overall_soundscape',
  'non_diegetic_music',
] as const

export const REF_SECTIONS = [
  'subject_definitions',
  'summary',
  'retention_analysis',
  'detailed_description',
  'overall_soundscape',
  'non_diegetic_music',
] as const

export type IrMode = 'T2VA' | 'I2VA' | 'L2VA' | 'FL2VA' | 'Ref2VA'
const ALIGNED_MODES: readonly IrMode[] = ['I2VA', 'L2VA', 'FL2VA']

/** C1 — 运镜封闭词表（20 个，供提示词侧与测试引用）。 */
export const CAMERA_TERMS = [
  'zoom in', 'zoom out', 'push in', 'pull out', 'pan left', 'pan right',
  'truck left', 'truck right', 'tilt up', 'tilt down', 'pedestal up',
  'pedestal down', 'arc shot', 'tracking shot', 'static shot',
  'shake slightly', 'shake strongly', 'pov', 'roll clockwise',
  'roll counterclockwise',
]

// C1 — 表外的常见运镜说法，出现即报错
const CAMERA_OUT_OF_VOCAB = [
  'dolly', 'crane shot', 'cranes up', 'cranes down', 'steadicam', 'handheld',
  'hand-held', 'gimbal', 'whip pan', 'jib', 'drone shot', 'aerial shot',
  'dutch angle', 'dutch tilt', 'orbit around', 'orbits around', 'zolly',
  'snap zoom', 'crash zoom', 'swish pan',
]

// T6 — 切镜动词封闭集
const CUT_VERBS = [
  'the camera cuts to', 'the shot cuts to', 'the shot transitions to',
  'the shot changes to', 'the shot switches to',
]

// T7 — 仅在用户明确要求时使用
const OPTIONAL_TRANSITIONS = ['cross-dissolve', 'cross dissolve', 'fade to', 'wipe to']

// R10 — 六个合法任务类型
const TASK_TYPES = ['keyframe completion', 'reference generation', 'video editing',
  'video continuation', 'audio reuse', 'audio reference']

// R17 / R18 — 两套 retention 档位，不通用
const VISUAL_RETENTION = ['fully_preserved', 'partially_preserved',
  'attribute_transfer', 'weak_reference']
const AUDIO_RETENTION = ['fully_copy', 'partially_copy', 'reference', 'weak_reference']

// K1-K3 — 对齐行，逐字匹配
const ALIGN_I2VA =
  /^For the target video, at 0\.00 seconds into the target video, <Picture 1> \(from \[Shot 1\]\) is fully referenced\.$/
const ALIGN_FL2VA =
  /^How the reference pictures align with the target video — Picture 1 \(from Shot 1\) aligns with the 0\.00-second mark of the target video; Picture 2 \(from Shot (\d+)\) aligns with the (\d+\.\d{2})-second mark of the target video\.$/
const ALIGN_L2VA =
  /^How the reference pictures align with the target video — <Picture 1> \(from \[Shot (\d+)\]\) aligns with the (\d+\.\d{2})-second mark of the target video\.$/

// L1 — 主描述词数经验区间（WARN only）
const WORD_HINTS: Record<IrMode, [number, number]> = {
  T2VA: [180, 320], I2VA: [220, 580], L2VA: [220, 580],
  FL2VA: [220, 580], Ref2VA: [200, 520],
}

export interface IrFinding {
  rule: string
  severity: 'ERROR' | 'WARN'
  message: string
}

export interface IrReport {
  mode: IrMode
  duration: number
  findings: IrFinding[]
  /** ERROR 级 findings（判失败）。 */
  errors: IrFinding[]
  /** WARN 级 findings（不判失败）。 */
  warnings: IrFinding[]
  /** 无 ERROR 即通过。 */
  ok: boolean
}

export interface ValidateH3IrOptions {
  mode: IrMode
  /** 目标时长（秒）。 */
  duration: number
  pictures?: number
  videos?: number
  audios?: number
  allowTransitions?: boolean
}

/** python repr 风格截断展示（错误信息里带上下文）。 */
function q(s: string, max = 70): string {
  const t = s.length > max ? `${s.slice(0, max)}…` : s
  return JSON.stringify(t)
}

function words(s: string): number {
  return (s.match(/[A-Za-z0-9'’-]+/g) ?? []).length
}

function sentences(s: string): number {
  const t = s.trim()
  if (!t || t === 'N/A') return 0
  return t.split(/(?<=[.!?])\s+/).filter((x) => x.trim()).length
}

interface SectionHits {
  sections: Map<string, string>
  hits: Array<{ name: string; start: number; end: number }>
}

/** 兼容 `name: body` 与 `name:\nbody` 两种段名写法。 */
function splitSections(text: string, names: readonly string[]): SectionHits {
  const pat = new RegExp(`^(${names.join('|')}):[ \\t]*`, 'gm')
  const matches = [...text.matchAll(pat)]
  const hits = matches.map((m) => ({
    name: m[1]!,
    start: m.index,
    end: m.index + m[0].length,
  }))
  const sections = new Map<string, string>()
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i]!
    const bodyEnd = i + 1 < hits.length ? hits[i + 1]!.start : text.length
    sections.set(hit.name, text.slice(hit.end, bodyEnd).trim())
  }
  return { sections, hits }
}

export function validateH3Ir(text: string, opts: ValidateH3IrOptions): IrReport {
  const { mode, duration } = opts
  if (!['T2VA', 'I2VA', 'L2VA', 'FL2VA', 'Ref2VA'].includes(mode)) {
    throw new Error(`unknown mode ${mode}; expected one of T2VA/I2VA/L2VA/FL2VA/Ref2VA`)
  }
  const findings: IrFinding[] = []
  const err = (rule: string, message: string) => findings.push({ rule, severity: 'ERROR', message })
  const warn = (rule: string, message: string) => findings.push({ rule, severity: 'WARN', message })

  const isRef = mode === 'Ref2VA'
  const names: readonly string[] = isRef ? REF_SECTIONS : BASE_SECTIONS
  const other: readonly string[] = isRef ? BASE_SECTIONS : REF_SECTIONS
  const mainName = isRef ? 'detailed_description' : 'integrated_multimodal_description'
  const alignPrefixes = ['For the target video,', 'How the reference pictures align']

  // ---------- S6 裸文本 ----------
  if (text.includes('```')) err('S6', '输出含 markdown 围栏 ```')
  const stripped = text.trim()
  // 末尾一个换行是正常的文本文件收尾，不算问题；只有前导空白或多余空行才提示
  if (/^\s/.test(text) || text.endsWith('\n\n')) warn('S6', '首尾有多余空白')
  const firstLine = stripped ? stripped.split('\n', 1)[0] ?? '' : ''
  const startsOk = names.some((n) => firstLine.startsWith(`${n}:`))
    || alignPrefixes.some((p) => firstLine.startsWith(p))
  if (!startsOk) err('S6', `第一行既不是段名也不是对齐行: ${q(firstLine)}`)

  // ---------- S1/S2 段名与顺序 ----------
  const { sections, hits } = splitSections(stripped, names)
  const presentOrder = [...sections.keys()]
  const missing = names.filter((n) => !sections.has(n))
  if (missing.length) err(isRef ? 'S2' : 'S1', `缺少段: ${missing.join(', ')}`)
  const expectedOrder = names.filter((n) => sections.has(n))
  if (presentOrder.join('\u0000') !== expectedOrder.join('\u0000')) {
    err(isRef ? 'S2' : 'S1', `段顺序错误: ${presentOrder.join(', ')}`)
  }
  for (const n of other) {
    if (!names.includes(n) && new RegExp(`^${n}:`, 'm').test(stripped)) {
      err('S1', `出现了不属于本模式的段名 ${n}（模板混用）`)
    }
  }

  // ---------- S3/S4 段名与正文是否同行 ----------
  // 官方两种都出过：A1/A2/A4 三段式同行，B6 三段式换行；A3 六段式换行。
  // 系统本身对此不敏感，因此只作 WARN，不判失败。
  for (const m of hits) {
    const inline = stripped.slice(m.end, m.end + 1) !== '\n'
    if (isRef && inline) warn('S4', `六段式的 ${m.name} 正文通常另起一行`)
    if (!isRef && !inline) warn('S3', `三段式的 ${m.name} 正文通常与段名同一行`)
  }

  // ---------- S5 段间分隔 ----------
  for (let i = 1; i < hits.length; i++) {
    const hit = hits[i]!
    if (isRef && !stripped.slice(0, hit.start).endsWith('\n\n')) {
      err('S5', `六段式 ${hit.name} 之前必须有空行`)
    }
  }

  // ---------- K1-K5 对齐行 ----------
  if (ALIGNED_MODES.includes(mode)) {
    const pat = mode === 'I2VA' ? ALIGN_I2VA : mode === 'FL2VA' ? ALIGN_FL2VA : ALIGN_L2VA
    const m = pat.exec(firstLine)
    if (!m) {
      err('K1/K2/K3', `${mode} 对齐行句式不符: ${q(firstLine, 110)}`)
    } else if (mode === 'FL2VA' || mode === 'L2VA') {
      const sSs = parseFloat(m[2]!)
      if (Math.abs(sSs - duration) > 0.005) {
        err('K4', `对齐行时间 ${m[2]!} 与目标时长 ${duration} 不符`)
      }
    }
    const nlIdx = stripped.indexOf('\n')
    const rest = nlIdx === -1 ? '' : stripped.slice(nlIdx + 1)
    if (!rest.startsWith('\n')) err('K1/K2/K3', '对齐行之后必须紧跟一个空行')
  } else if (alignPrefixes.some((p) => firstLine.startsWith(p))) {
    err('K5', `${mode} 不应有对齐行`)
  }

  const main = sections.get(mainName) ?? ''

  // ---------- R23 六段式风格句位置 ----------
  if (isRef && main) {
    if (!main.includes('[Shot 1]')) {
      err('T5', 'detailed_description 里没有 [Shot 1]')
    } else {
      const head = main.slice(0, main.indexOf('[Shot 1]')).trim()
      if (!head) err('R23', '六段式的风格句必须写在 [Shot 1] 之前')
    }
  }

  // ---------- T1-T6 分镜与时间戳 ----------
  const shotIter = [...main.matchAll(/\[Shot (\d+)\]/g)]
  const nums = shotIter.map((m) => parseInt(m[1]!, 10))
  if (!nums.length) {
    err('T5', `${mainName} 里没有 [Shot N] 标记`)
  } else {
    if (nums[0] !== 1) err('T5', `第一个镜头应是 [Shot 1]，实际是 [Shot ${nums[0]}]`)
    const uniq = [...new Set(nums)].sort((a, b) => a - b)
    const consecutive = Array.from({ length: uniq.length }, (_, i) => i + 1)
    if (uniq.join(',') !== consecutive.join(',')) {
      err('T5', `镜头序号不连续: ${uniq.join(', ')}`)
    }
  }

  const tsSecs: Array<[number, number]> = []
  for (const m of shotIter) {
    const n = parseInt(m[1]!, 10)
    const tail = main.slice(m.index + m[0].length, m.index + m[0].length + 200)
    const tm = /^\s*At (\d{2}):(\d{2})\.(\d{3}),/.exec(tail)
    if (n === 1) {
      if (tm) err('T1', '[Shot 1] 不应带时间戳')
      continue
    }
    if (!tm) {
      err('T2', `[Shot ${n}] 缺少 \`At MM:SS.mmm,\` 时间戳`)
      continue
    }
    const t = parseInt(tm[1]!, 10) * 60 + parseInt(tm[2]!, 10) + parseInt(tm[3]!, 10) / 1000
    tsSecs.push([n, t])
    if (t >= duration) err('T4', `[Shot ${n}] 时间戳 ${t.toFixed(3)}s 不小于目标时长 ${duration}s`)
    const after = tail.slice(tm[0].length).replace(/^\s+/, '')
    const afterLower = after.toLowerCase()
    const startsWithVerb = CUT_VERBS.some(
      (v) => afterLower.startsWith(v) || afterLower.startsWith(v.split('the ', 2)[1] ?? v),
    )
    if (!startsWithVerb) {
      const tailLower = tail.toLowerCase()
      if (!CUT_VERBS.some((v) => tailLower.includes(v))) {
        err('T6', `[Shot ${n}] 未使用合法切镜动词: ${q(after, 60)}`)
      }
    }
  }

  for (let i = 1; i < tsSecs.length; i++) {
    const [na, ta] = tsSecs[i - 1]!
    const [nb, tb] = tsSecs[i]!
    if (tb <= ta) err('T3', `时间戳未严格递增: [Shot ${na}]=${ta.toFixed(3)} → [Shot ${nb}]=${tb.toFixed(3)}`)
  }

  // ---------- T7 转场 ----------
  if (!opts.allowTransitions) {
    const lower = text.toLowerCase()
    for (const t of OPTIONAL_TRANSITIONS) {
      if (lower.includes(t)) warn('T7', `用了 '${t}'，只应在用户明确要求时使用`)
    }
  }

  // ---------- C1 运镜词表 ----------
  for (const bad of CAMERA_OUT_OF_VOCAB) {
    const escaped = bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`\\b${escaped}`, 'i').test(text)) {
      err('C1', `运镜用词 '${bad}' 不在封闭词表内`)
    }
  }

  // ---------- D5 台词标签 ----------
  const openD = (text.match(/<d>/g) ?? []).length
  const closeD = (text.match(/<\/d>/g) ?? []).length
  if (openD !== closeD) err('D5', `<d> 标签不配对: ${openD} 开 / ${closeD} 闭`)
  for (const body of [...text.matchAll(/<d>([\s\S]*?)<\/d>/g)].map((m) => m[1] ?? '')) {
    if (!/^\[[^\]]+\]\s/.test(body)) err('D5', `<d> 内缺少 [Language] 标签: ${q(body, 50)}`)
  }

  // ---------- L2/L3 声音两段 ----------
  for (const [sec, lo, hi, rule] of [
    ['overall_soundscape', 1, 4, 'L2'],
    ['non_diegetic_music', 1, 3, 'L3'],
  ] as const) {
    const body = sections.get(sec) ?? ''
    if (body.trim() === 'N/A') continue
    const n = sentences(body)
    if (n < lo || n > hi) {
      // 指南写 1-4 / 1-3，但官方 B5/C2 的 overall_soundscape 实测 5 句；
      // 按"官方输出 > 指南文字"的优先级降级为 WARN。
      warn(rule, `${sec} ${n} 句，指南建议 ${lo}-${hi} 句`)
    }
  }
  const nds = sections.get('non_diegetic_music') ?? ''
  if (nds && nds.trim() !== 'N/A') {
    const ndsLower = nds.toLowerCase()
    for (const w of ['melancholic', 'hopeful', 'uplifting', 'emotional', 'nostalgic',
      'tense atmosphere', 'sense of wonder', 'feeling of']) {
      if (ndsLower.includes(w)) warn('L3', `non_diegetic_music 含抽象情绪词 '${w}'`)
    }
  }

  // ---------- L1 词数（仅 WARN） ----------
  if (main) {
    const w = words(main)
    const [lo, hi] = WORD_HINTS[mode]
    if (w < lo || w > hi) {
      warn('L1', `${mainName} ${w} 词，在经验区间 ${lo}-${hi} 之外（非硬约束）`)
    }
  }

  // ---------- 素材标签编号 ----------
  const labelNums = (kind: string) =>
    [...new Set(
      [...text.matchAll(new RegExp(`<${kind} (\\d+)>`, 'g'))].map((m) => parseInt(m[1]!, 10)),
    )].sort((a, b) => a - b)

  const pictures = labelNums('Picture')
  const vids = labelNums('Video')
  const auds = labelNums('Audio')
  for (const [kind, got, cap] of [
    ['Picture', pictures, opts.pictures ?? 0],
    ['Video', vids, opts.videos ?? 0],
  ] as const) {
    if (got.length) {
      const consecutive = Array.from({ length: got.length }, (_, i) => i + 1)
      if (got.join(',') !== consecutive.join(',')) {
        err('R7', `<${kind} N> 编号不连续: ${got.join(', ')}`)
      }
      if (cap && got[got.length - 1]! > cap) {
        err('R7', `<${kind} ${got[got.length - 1]!}> 超出输入的 ${kind} 数量 ${cap}`)
      }
    }
  }
  // R7/R8: 视频的同步音轨可被提升为 <Audio N>，且官方 C4 只输出 <Audio 2>，
  // 因此音频标签不要求从 1 连续，只查上限（输入音频 + 视频同步轨）。
  if (auds.length) {
    const cap = (opts.audios ?? 0) + (opts.videos ?? 0)
    if (cap && auds[auds.length - 1]! > cap) {
      err('R7', `<Audio ${auds[auds.length - 1]!}> 超出可能的音频标签上限 ${cap}（输入音频 ${opts.audios ?? 0} + 视频同步轨 ${opts.videos ?? 0}）`)
    }
  }

  if (!isRef) {
    // 三段式不应出现 Ref2VA 的 Subject 标签
    if (/<Subject \d+>/.test(text)) {
      err('M1', '三段式模板里不应出现 <Subject N> 标签（那是 Ref2VA 的）')
    }
  } else {
    validateRef()
  }

  function validateRef(): void {
    const defs = sections.get('subject_definitions') ?? ''
    const summary = sections.get('summary') ?? ''
    const retention = sections.get('retention_analysis') ?? ''

    // R10/R11 summary 任务类型前缀
    const m = /^\[([^\]]+)\]/.exec(summary)
    if (!m) {
      err('R10', 'summary 缺少方括号任务类型前缀')
    } else {
      const parts = m[1]!.split('+').map((p) => p.trim())
      const bad = parts.filter((p) => !TASK_TYPES.includes(p))
      if (bad.length) err('R10', `非法任务类型 ${bad.join(', ')}；合法值 ${TASK_TYPES.join(', ')}`)
      if (new Set(parts).size !== parts.length) err('R11', `任务类型重复: ${parts.join(', ')}`)
      if (!m[1]!.includes(' + ') && parts.length > 1) err('R11', '多个任务类型必须用 ` + ` 连接')
      // R15 video editing 固定首句
      if (parts.includes('video editing')) {
        const after = summary.slice(m[0].length).trim()
        if (!after.startsWith('The target video is an edited version of <Video')) {
          err('R15', 'video editing 的 summary 前缀后应接 `The target video is an edited version of <Video 1>.`')
        }
      }
    }

    // declared — subject_definitions 里出现过的所有标签（含被内嵌引用的）
    // tracked  — 自成一行的标签，即需要后续单独追踪的条目
    // R4/R5：只用来指明另一项出处的标签不单独立行，也不需要 retention 条目。
    const declared = new Set(
      [...defs.matchAll(/<(Subject|Picture|Video|Audio) (\d+)>/g)].map((x) => `<${x[1]!} ${x[2]!}>`),
    )
    const tracked = new Set(
      [...defs.matchAll(/^(<(?:Subject|Picture|Video|Audio) \d+>)/gm)].map((x) => x[1]!),
    )
    if (!tracked.size) err('R3', 'subject_definitions 里没有任何自成一行的引用标签定义')

    // R14 summary 不得引入新标签
    const inSummary = new Set(summary.match(/<(?:Subject|Picture|Video|Audio) \d+>/g) ?? [])
    const newInSummary = [...inSummary].filter((t) => !declared.has(t)).sort()
    if (newInSummary.length) err('R14', `summary 引入了未定义的新标签: ${newInSummary.join(', ')}`)

    // 使用前必须已定义（检查 detailed_description）
    const used = new Set(
      (sections.get('detailed_description') ?? '').match(/<(?:Subject|Picture|Video|Audio) \d+>/g) ?? [],
    )
    const undefinedUsed = [...used].filter((t) => !declared.has(t)).sort()
    if (undefinedUsed.length) err('R2', `detailed_description 使用了未定义的标签: ${undefinedUsed.join(', ')}`)

    // R16-R18 retention
    const retLines = retention.split('\n').map((l) => l.trim()).filter(Boolean)
    const covered = new Set<string>()
    for (const line of retLines) {
      const lm = /^(<(Subject|Picture|Video|Audio) \d+>)\s*(\([^)]*\))?\s*:\s*([a-z_]+)\s*-\s*(.+)$/.exec(line)
      if (!lm) {
        err('R19', `retention 行格式不符: ${q(line)}`)
        continue
      }
      const [, label, kind, , marker, reason] = lm as unknown as [string, string, string, string, string, string]
      covered.add(label)
      const allowed = kind === 'Audio' ? AUDIO_RETENTION : VISUAL_RETENTION
      if (!allowed.includes(marker)) {
        err(kind === 'Audio' ? 'R18' : 'R17',
          `${label} 的档位 '${marker}' 不在${kind === 'Audio' ? '音频' : '视觉'}合法集内 ${allowed.join(', ')}`)
      }
      if (!reason!.trim()) err('R19', `${label} 缺少理由`)
    }

    const uncovered = [...tracked].filter((t) => !covered.has(t)).sort()
    if (uncovered.length) err('R16', `retention_analysis 未覆盖单独追踪的标签: ${uncovered.join(', ')}`)
    const extra = [...covered].filter((t) => !declared.has(t)).sort()
    if (extra.length) err('R16', `retention_analysis 出现未定义标签: ${extra.join(', ')}`)

    // R22 (Sx) 禁入 retention
    if (/\(S\d/.test(retention)) err('R22', 'retention_analysis 里出现了 (Sx)，明文禁止')
  }

  const errors = findings.filter((f) => f.severity === 'ERROR')
  const warnings = findings.filter((f) => f.severity === 'WARN')
  return { mode, duration, findings, errors, warnings, ok: errors.length === 0 }
}

// ---------------------------------------------------------------------------
// CV-119：工具层预检（video_generate / video_composite 的 execute 前置闸门）
// ---------------------------------------------------------------------------

/** IR 标记：段名（行首）、对齐行前缀、素材标签。 */
const IR_MARKERS: ReadonlyArray<{ kind: 'section' | 'align' | 'label'; re: RegExp }> = [
  ...[...BASE_SECTIONS, ...REF_SECTIONS].map((name) => ({
    kind: 'section' as const,
    re: new RegExp(`^${name}:`, 'm'),
  })),
  { kind: 'align', re: /^For the target video,/ },
  { kind: 'align', re: /^How the reference pictures align/ },
  { kind: 'label', re: /<(?:Picture|Subject|Video|Audio) \d+>/ },
]

/**
 * 判断 prompt 是否「像」一份 H3-Context-IR 简报。纯文本提示词（哪怕偶尔
 * 含单个可疑标记，如一行 `summary:` 开头）必须原样透传，因此要求命中
 * ≥2 个不同标记才认定为 IR —— 半成品 IR（模型想写 IR 但写漏/写错段）通常
 * 仍带有多个段名或标签，能被拦下。
 */
export function looksLikeH3Ir(text: string): boolean {
  const seen = new Set<string>()
  for (const marker of IR_MARKERS) {
    if (marker.re.test(text)) seen.add(`${marker.kind}:${marker.re.source}`)
    if (seen.size >= 2) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// CV-156：模式判定的「双轨」错位识别
//
// 工具侧按**素材数量**推模式（1 图=I2VA / 2 图=FL2VA / ≥3 图=Ref2VA），
// h3-prompt-writing 技能按**素材角色**判（首帧/尾帧/首尾帧/通用参考）。
// 两者不一致时，validateH3Ir 会派生出一堆「段名混用 / 缺段 / 对齐行不符」
// 的 ERROR —— 格式问题全是**症状**，真因是模式选错了。
// 下面三个导出给 assertH3IrPrompt 与校验 CLI 共用，避免提示文案两处漂移。
// ---------------------------------------------------------------------------

/** 六段式（Ref2VA）独有的段名 —— 三段式模板不会出现。 */
const REF_ONLY_SECTIONS = [
  'subject_definitions', 'summary', 'retention_analysis', 'detailed_description',
] as const

/** 从 IR 正文反推**作者想走的模板**（不看模式判成了什么）。 */
export function detectIrTemplate(text: string): 'base' | 'ref' | null {
  if (REF_ONLY_SECTIONS.some((n) => new RegExp(`^${n}:`, 'm').test(text))) return 'ref'
  return /^integrated_multimodal_description:/m.test(text) ? 'base' : null
}

/** 工具侧「图片数量 → 预检模式」的唯一权威映射。 */
export function modeByPictureCount(pictures: number): IrMode {
  if (pictures >= 3) return 'Ref2VA'
  if (pictures === 2) return 'FL2VA'
  if (pictures === 1) return 'I2VA'
  return 'T2VA'
}

/** 数量 → 模式的语言说明（工具描述与报错提示共用，防两处漂移）。 */
export const COUNT_MODE_HINT =
  '1 图 = 首帧 I2VA（第 1 张即首帧）；2 图 = 首尾帧 FL2VA（第 1 张首帧、第 2 张尾帧）；'
  + '≥3 图 = 多参考 Ref2VA（第 N 张即 `<Picture N>`，位次就是 filenames 的顺序）；'
  + '带 audioRefs 时一律按 Ref2VA'

/**
 * 模式 / 模板错位提示；两者一致时返回 null。
 *
 * 错位的方向有两类，处理方式完全不同：
 * - 写成六段式但被判成三段式模式 → 语义多半是「参考图 + 首帧」，而 skill
 *   硬约束禁止混用 → **正解是拆两步**（先出关键帧，再单图走 I2VA）。
 * - 写成三段式但被判成 Ref2VA → 补齐六段式，或把参考图减到 ≤2 张。
 */
export function irModeMismatchHint(
  mode: IrMode,
  template: 'base' | 'ref' | null,
  pictures?: number,
): string | null {
  if (template === null) return null
  const n = pictures ?? 0
  if (mode !== 'Ref2VA' && template === 'ref') {
    return `⚠ 真因很可能是**模式选错**，不是格式写错：你写的是 Ref2VA **六段式**，`
      + `而工具按素材数量把本镜判成 **${mode}**（本镜 ${n} 张图）。`
      + 'h3-prompt-writing 的硬约束是 FL2VA/I2VA/L2VA 与 Ref2VA **互斥**：'
      + '锁首帧与参考风格**只能两步走**。若本镜语义是「风格参考 + 首帧」，'
      + '请先用风格参考出关键帧（image_generate），再把该关键帧**单图**走 I2VA；'
      + '或把参考图补齐到 ≥3 张，才走 Ref2VA 多参考合成。'
  }
  if (mode === 'Ref2VA' && template === 'base') {
    return `⚠ 真因很可能是**模式选错**，不是格式写错：你写的是**三段式**，`
      + `而工具按素材数量把本镜判成 **Ref2VA**（本镜 ${n} 张图，≥3 图即多参考合成）。`
      + 'Ref2VA 必须六段式：subject_definitions → summary → retention_analysis → '
      + 'detailed_description → overall_soundscape → non_diegetic_music。'
      + '也可以把参考图减到 ≤2 张，改走 I2VA / FL2VA（三段式 + 对齐行）。'
  }
  return null
}

export interface AssertH3IrPromptOptions {
  mode: IrMode
  /** 有效时长（秒）——调用方应传钳制后的值，与实际发往后端的时长一致。 */
  duration: number
  pictures?: number
  videos?: number
  audios?: number
  allowTransitions?: boolean
}

/**
 * CV-119：video_generate / video_composite 的 prompt 预检。
 *
 * prompt 不是 IR（纯文本）→ 直接放行；是 IR 但有 ERROR 级违规 → 抛错取消
 * 本次生成（不再打到后端才发现格式问题浪费一次调用）。WARN 只提示、不阻断。
 */
export function assertH3IrPrompt(text: string, opts: AssertH3IrPromptOptions): void {
  if (!looksLikeH3Ir(text)) return
  const report = validateH3Ir(text, opts)
  if (report.ok) return
  const lines = report.errors.map((e) => `  - [${e.rule}] ${e.message}`)
  // CV-156：把「模式判定」这层单独讲一遍 —— 否则段名/对齐行的 ERROR 列表会被
  // 当成格式写错，而真因常常是工具按数量判的模式与作者按角色写的模板不一致。
  const hint = irModeMismatchHint(report.mode, detectIrTemplate(text), opts.pictures)
  throw new Error(
    `prompt 疑似 H3-Context-IR 简报（mode=${report.mode}, duration=${report.duration}s, pictures=${opts.pictures ?? 0}），`
    + `但本地预检发现 ${report.errors.length} 处 ERROR，已取消本次生成：\n`
    + `${lines.join('\n')}\n`
    + `模式提醒：本预检的模式是**按素材数量**推出来的（${COUNT_MODE_HINT}），`
    + '而 h3-prompt-writing 是按**素材角色**判模式。两者不一致时，上面这些段名 / 对齐行 ERROR 多半只是派生症状。\n'
    + (hint !== null ? `${hint}\n` : '')
    + '请按 h3-prompt-writing 技能的五步 Workflow 修正后重试；若本镜不需要 IR 格式，也可改用纯文本提示词。'
    + (report.warnings.length > 0 ? `\n（另有 ${report.warnings.length} 条 WARN 软警告，不阻断生成。）` : ''),
  )
}
