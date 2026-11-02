/**
 * 相对锚定（REQ-036 C4，CV-400）—— manifest 事件的「锚词」时机字段的唯一解析实现。
 *
 * 背景：manifest 事件锚**绝对帧** —— 变体替换文案后词数变化 → 能量谷重排 → 时机漂移，
 * 只能人工重调（SKILL §5 自曝此坑，是「批量裂变」质量不稳的根因）。`anchor` 字段把
 * 时机从「算术」变回「关系」：事件挂在 caption 轨的句/词窗口上，文案换了几遍时机自己跟对。
 *
 * ## 字段（与现有绝对帧字段**互斥**，同时出现以 schema 校验报错）
 *
 *   "anchor": { "ref": "cap-1", "phrase": 2, "word": 5, "from": "start", "offsetFrames": 0 }
 *
 * | 字段 | 说明 |
 * | ref | 目标 caption 轨 id（该轨须带 `src` 旁白） |
 * | phrase | 句索引，0 起（caption 轨 text 按句末标点切开） |
 * | word | 词索引，0 起（该句内第几个口播字）；省略 = 整句窗口 |
 * | from | `start`（窗口起点，缺省）/ `end`（窗口终点） |
 * | offsetFrames | 相对偏移，可负 |
 *
 * ## 解析规则（REQ §4.3 定死）
 *
 * 渲染期 caption 词级 timing 就绪后 anchor → 绝对帧：客户端渲染器**组合期**完成解析
 * （caption timing 先算，anchor 后解析，事件按解析帧执行）；宿主侧 `validateManifest`
 * 用**同一份**校验函数做 schema 级 fail-fast（ref 轨不存在 / phrase/word 越界 / 被锚轨
 * 无 src → 硬失败，错误信息含轨道 id 与索引，不许静默回退 0 帧）。
 *
 * 词级 timing 两种来源（与 Caption 组件同优先级）：显式 `words`（帧，**轨内相对** ——
 * 绝对帧 = track.startFrame + 相对帧）优先；缺省走能量谷推导（`word-timing.ts`，
 * 包络由客户端解码）。两路都汇总成本模块的 `PhraseTiming[]`（**绝对帧**窗口），
 * `resolveAnchor` 只吃这个结构 —— 纯函数，Host tsconfig 可测。
 */
import { isSpokenChar, wordTimingFromEnvelope, type WordTimingWindow } from './word-timing.js'

/** manifest 事件（animate / draw / colorShift）上的可选锚字段。 */
export interface TrackAnchor {
  /** 目标 caption 轨 id（该轨须带 `src` 旁白）。 */
  ref: string
  /** 句索引（0 起）。 */
  phrase: number
  /** 词索引（0 起，该句内的口播字）；省略 = 整句窗口。 */
  word?: number
  /** 锚窗口起点还是终点（缺省 `start`）。 */
  from?: 'start' | 'end'
  /** 相对偏移（帧，可负）。 */
  offsetFrames?: number
}

/** anchor 字段的已知键（契约外字段扫描用）。 */
export const KNOWN_ANCHOR_KEYS: ReadonlySet<string> = new Set(['ref', 'phrase', 'word', 'from', 'offsetFrames'])

/** 句末标点（caption 轨 text 的分句符；换行同样分句）。 */
const PHRASE_BREAKS = new Set(['。', '！', '？', '!', '?', '；', ';', '…', '\n'])

/** 一个句的词级窗口（**绝对帧**）。 */
export interface PhraseTiming {
  /** 该句逐口播字窗口（绝对帧）。 */
  words: WordTimingWindow[]
}

/** 逐字窗口序列 → 按句分组（纯函数）。 */
export function groupWordsByPhrase(text: string, spokenWindows: readonly WordTimingWindow[]): PhraseTiming[] {
  const chars = Array.from(text)
  const spokenIndexByChar = new Map<number, number>()
  let spokenIndex = 0
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i] ?? ''
    if (isSpokenChar(ch)) {
      spokenIndexByChar.set(i, spokenIndex)
      spokenIndex += 1
    }
  }
  // 句 = 两个句末标点之间的字符区间；每句收本区间内口播字的窗口。
  const phrases: PhraseTiming[] = []
  let current: WordTimingWindow[] = []
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i] ?? ''
    if (isSpokenChar(ch)) {
      const window = spokenWindows[spokenIndexByChar.get(i) ?? -1]
      if (window !== undefined) current.push(window)
    }
    if (PHRASE_BREAKS.has(ch) && current.length > 0) {
      phrases.push({ words: current })
      current = []
    }
  }
  if (current.length > 0) phrases.push({ words: current })
  return phrases
}

/** 每句的口播字数（校验 word 越界用，纯函数）。 */
export function spokenCharsPerPhrase(text: string): number[] {
  const chars = Array.from(text)
  const counts: number[] = []
  let current = 0
  for (const ch of chars) {
    if (isSpokenChar(ch)) current += 1
    if (PHRASE_BREAKS.has(ch) && current > 0) {
      counts.push(current)
      current = 0
    }
  }
  if (current > 0) counts.push(current)
  return counts
}

// ───────────────────────────── timing → PhraseTiming ─────────────────────────────

/** 显式 `words`（轨内相对帧）→ 绝对帧逐字窗口；长度与口播字数不符返回 null（同 Caption 组件的回退口径）。 */
export function explicitWordWindows(
  words: readonly { from: number; to: number }[] | undefined,
  text: string,
  trackStartFrame: number,
): WordTimingWindow[] | null {
  if (!Array.isArray(words)) return null
  const spokenCount = Array.from(text).filter((ch) => isSpokenChar(ch)).length
  if (words.length !== spokenCount) return null
  return words.map((w) => ({ start: w.from + trackStartFrame, end: w.to + trackStartFrame }))
}

/**
 * 能量谷包络 → 绝对帧逐字窗口（与 Caption 组件同源：`wordTimingFromEnvelope` 输出
 * 轨内相对帧 —— caption 的旁白音频从轨道起点起播）。包络未就绪返回 null。
 */
export function envelopeWordWindows(
  envelope: readonly number[] | null,
  text: string,
  fps: number,
  trackStartFrame: number,
): WordTimingWindow[] | null {
  if (envelope === null || envelope.length === 0) return null
  const spokenCount = Array.from(text).filter((ch) => isSpokenChar(ch)).length
  if (spokenCount <= 0) return null
  const local = wordTimingFromEnvelope({ envelope, fps, spokenChars: spokenCount })
  return local.map((w) => ({ start: w.start + trackStartFrame, end: w.end + trackStartFrame }))
}

// ───────────────────────────── resolveAnchor ─────────────────────────────

export interface AnchorResolveOptions {
  /** 错误信息里标注哪个事件在锚（如 `tracks[3].animate[0]`），便于定位。 */
  at?: string
}

/**
 * anchor → **绝对帧**（纯函数，fail-fast）。
 *
 * 越界直接抛错（错误含 ref 与索引）—— 同「缺素材硬失败」先例，绝不静默回退 0 帧：
 * 锚错帧的成片 = 时机全错但看起来「渲染成功」，比报错贵得多。
 */
export function resolveAnchor(
  anchor: TrackAnchor,
  phraseTimings: readonly PhraseTiming[],
  options: AnchorResolveOptions = {},
): number {
  const at = options.at ?? 'anchor'
  const phrase = phraseTimings[anchor.phrase]
  if (phrase === undefined) {
    throw new Error(
      `${at} 的 anchor 越界：ref「${anchor.ref}」共 ${phraseTimings.length} 句，phrase=${anchor.phrase} 不存在（句索引 0 起）。`,
    )
  }
  let start: number
  let end: number
  if (anchor.word === undefined) {
    const first = phrase.words[0]
    const last = phrase.words[phrase.words.length - 1]
    if (first === undefined || last === undefined) {
      throw new Error(`${at} 的 anchor 越界：ref「${anchor.ref}」phrase=${anchor.phrase} 没有可锚的词窗口。`)
    }
    start = first.start
    end = last.end
  } else {
    const word = phrase.words[anchor.word]
    if (word === undefined) {
      throw new Error(
        `${at} 的 anchor 越界：ref「${anchor.ref}」phrase=${anchor.phrase} 共 ${phrase.words.length} 个口播字，word=${anchor.word} 不存在（词索引 0 起）。`,
      )
    }
    start = word.start
    end = word.end
  }
  const base = anchor.from === 'end' ? end : start
  return Math.round(base + (anchor.offsetFrames ?? 0))
}

/** 收集 manifest 里全部锚字段引用的 caption 轨 id（去重保序 —— 客户端组合期按它取 timing）。 */
export function anchorRefsOf(tracks: readonly unknown[]): string[] {
  const refs: string[] = []
  for (const raw of tracks) {
    if (raw === null || typeof raw !== 'object') continue
    const track = raw as Record<string, unknown>
    for (const field of anchoredFieldsOfTrack(track, 'tracks[]')) {
      const ref = (field.anchor as Record<string, unknown> | null)?.ref
      if (typeof ref === 'string' && ref !== '' && !refs.includes(ref)) refs.push(ref)
    }
  }
  return refs
}

// ───────────────────────────── manifest 级校验与解析 ─────────────────────────────

/** 从轨道上读出三种「可锚时机字段」的原始值（animate 数组统一成条目列表）。 */
interface AnchoredField {
  at: string
  anchor: unknown
  /** 与 anchor 互斥的绝对帧字段是否同时出现。 */
  startFramePresent: boolean
}

function anchoredFieldsOfTrack(track: Record<string, unknown>, at: string): AnchoredField[] {
  const out: AnchoredField[] = []
  const animate = track.animate
  const animateList = Array.isArray(animate) ? animate : animate !== undefined ? [animate] : []
  animateList.forEach((item, i) => {
    if (item !== null && typeof item === 'object' && (item as Record<string, unknown>).anchor !== undefined) {
      out.push({
        at: `${at}.animate[${i}]`,
        anchor: (item as Record<string, unknown>).anchor,
        startFramePresent: (item as Record<string, unknown>).startFrame !== undefined,
      })
    }
  })
  for (const field of ['draw', 'colorShift'] as const) {
    const value = track[field]
    if (value !== null && typeof value === 'object' && (value as Record<string, unknown>).anchor !== undefined) {
      out.push({
        at: `${at}.${field}`,
        anchor: (value as Record<string, unknown>).anchor,
        startFramePresent: (value as Record<string, unknown>).startFrame !== undefined,
      })
    }
  }
  return out
}

function readAnchorShape(anchor: unknown, at: string, errors: string[]): TrackAnchor | null {
  if (anchor === null || typeof anchor !== 'object' || Array.isArray(anchor)) {
    errors.push(`${at}.anchor 必须是对象 {ref, phrase, word?, from?, offsetFrames?}`)
    return null
  }
  const a = anchor as Record<string, unknown>
  if (typeof a.ref !== 'string' || a.ref === '') {
    errors.push(`${at}.anchor.ref 必须是非空字符串（目标 caption 轨 id）`)
    return null
  }
  if (typeof a.phrase !== 'number' || !Number.isInteger(a.phrase) || a.phrase < 0) {
    errors.push(`${at}.anchor.phrase 必须是 >= 0 的整数（句索引 0 起）`)
  }
  if (a.word !== undefined && (typeof a.word !== 'number' || !Number.isInteger(a.word) || a.word < 0)) {
    errors.push(`${at}.anchor.word 必须是 >= 0 的整数（词索引 0 起）；省略 = 整句窗口`)
  }
  if (a.from !== undefined && a.from !== 'start' && a.from !== 'end') {
    errors.push(`${at}.anchor.from 只允许 "start" / "end"（缺省 start）`)
  }
  if (a.offsetFrames !== undefined && (typeof a.offsetFrames !== 'number' || !Number.isInteger(a.offsetFrames))) {
    errors.push(`${at}.anchor.offsetFrames 必须是整数（帧，可负）`)
  }
  return {
    ref: a.ref,
    phrase: typeof a.phrase === 'number' ? a.phrase : 0,
    ...(a.word !== undefined ? { word: a.word as number } : {}),
    ...(a.from !== undefined ? { from: a.from as 'start' | 'end' } : {}),
    ...(a.offsetFrames !== undefined ? { offsetFrames: a.offsetFrames as number } : {}),
  }
}

/**
 * 全 manifest 锚字段校验（纯函数）：宿主 `validateManifest` 与客户端组合期**同一份**
 * 实现，两处口径永不漂移。错误信息一律带轨道 id 与索引（fail-fast 纪律）。
 */
export function collectAnchorIssues(tracks: readonly unknown[]): string[] {
  const errors: string[] = []
  // ref → caption 轨（索引 + id + src + text）
  const captionByRef = new Map<string, { hasSrc: boolean; text: string }>()
  for (const raw of tracks) {
    if (raw === null || typeof raw !== 'object') continue
    const track = raw as Record<string, unknown>
    if (track.type !== 'caption' || typeof track.id !== 'string') continue
    captionByRef.set(track.id, { hasSrc: typeof track.src === 'string' && track.src !== '', text: typeof track.text === 'string' ? track.text : '' })
  }
  tracks.forEach((raw, index) => {
    if (raw === null || typeof raw !== 'object') return
    const track = raw as Record<string, unknown>
    const at = `tracks[${index}](${typeof track.id === 'string' ? track.id : '?'})`
    for (const field of anchoredFieldsOfTrack(track, at)) {
      if (field.startFramePresent) {
        errors.push(`${field.at} 不能同时给 startFrame 与 anchor（二选一 —— 绝对帧与相对锚混用会让时机口径算不清）`)
      }
      const anchor = readAnchorShape(field.anchor, field.at, errors)
      if (anchor === null) continue
      const ref = captionByRef.get(anchor.ref)
      if (ref === undefined) {
        errors.push(`${field.at}.anchor.ref 指向「${anchor.ref}」—— 不是本 manifest 里的 caption 轨（anchor 只能锚 caption 轨）。`)
        continue
      }
      if (!ref.hasSrc) {
        errors.push(`${field.at}.anchor.ref 指向的 caption 轨「${anchor.ref}」没有 src 旁白 —— 无词级 timing 可锚。`)
        continue
      }
      const phraseCounts = spokenCharsPerPhrase(ref.text)
      if (anchor.phrase >= phraseCounts.length) {
        errors.push(
          `${field.at}.anchor 越界：轨「${anchor.ref}」共 ${phraseCounts.length} 句，phrase=${anchor.phrase} 不存在（句索引 0 起）。`,
        )
        continue
      }
      if (anchor.word !== undefined && anchor.word >= (phraseCounts[anchor.phrase] ?? 0)) {
        errors.push(
          `${field.at}.anchor 越界：轨「${anchor.ref}」phrase=${anchor.phrase} 共 ${phraseCounts[anchor.phrase]} 个口播字，word=${anchor.word} 不存在。`,
        )
      }
    }
  })
  return errors
}

/**
 * 组合期解析：把 manifest 里全部锚字段折算成数值 startFrame（纯函数）。
 *
 * `phraseTimingsByRef` = 每个被锚 caption 轨的句级窗口（绝对帧，由调用方先算好 ——
 * 显式 words 同步可得，能量谷包络要等音频解码）。ref 缺 timing / timing 为空 =
 * 渲染期硬失败（带轨道 id 与索引），绝不静默回退。
 *
 * 返回**新 manifest**（不就地改入参）；无锚字段时原样返回（零拷贝、逐像素同路）。
 */
export function applyAnchorResolution(
  manifest: { tracks: readonly unknown[] } & Record<string, unknown>,
  phraseTimingsByRef: ReadonlyMap<string, readonly PhraseTiming[]>,
): { tracks: unknown[]; errors: string[] } {
  const errors: string[] = []
  const tracks: unknown[] = manifest.tracks.map((raw, index) => {
    if (raw === null || typeof raw !== 'object') return raw
    const track = raw as Record<string, unknown>
    const fields = anchoredFieldsOfTrack(track, `tracks[${index}]`)
    if (fields.length === 0) return raw
    const trackStart = typeof track.startFrame === 'number' ? track.startFrame : 0
    const resolvedTrack: Record<string, unknown> = { ...track }
    // animate 数组逐项解析（单对象同构处理）
    if (Array.isArray(track.animate) || (track.animate !== undefined && typeof track.animate === 'object')) {
      const animateList = Array.isArray(track.animate) ? track.animate : [track.animate]
      const resolvedAnimate = animateList.map((item, i) => {
        if (item === null || typeof item !== 'object') return item
        const record = item as Record<string, unknown>
        if (record.anchor === undefined) return item
        const anchor = readAnchorShape(record.anchor, `tracks[${index}].animate[${i}]`, errors)
        if (anchor === null) return item
      const absolute = resolveAnchorFrame(anchor, phraseTimingsByRef, `tracks[${index}](${String(track.id ?? '?')}).animate[${i}]`, errors)
      if (absolute === null) return item
      const next: Record<string, unknown> = { ...record, startFrame: absolute - trackStart }
      delete next.anchor
      return next
    })
    resolvedTrack.animate = Array.isArray(track.animate) ? resolvedAnimate : resolvedAnimate[0]
  }
  for (const field of ['draw', 'colorShift'] as const) {
    const value = track[field]
    if (value === null || typeof value !== 'object') continue
    const record = value as Record<string, unknown>
    if (record.anchor === undefined) continue
    const anchor = readAnchorShape(record.anchor, `tracks[${index}].${field}`, errors)
    if (anchor === null) continue
    const absolute = resolveAnchorFrame(anchor, phraseTimingsByRef, `tracks[${index}](${String(track.id ?? '?')}).${field}`, errors)
    if (absolute === null) continue
    const next: Record<string, unknown> = { ...record, startFrame: absolute - trackStart }
    delete next.anchor
    resolvedTrack[field] = next
  }
  return resolvedTrack
  })
  return { tracks, errors }
}

function resolveAnchorFrame(
  anchor: TrackAnchor,
  phraseTimingsByRef: ReadonlyMap<string, readonly PhraseTiming[]>,
  at: string,
  errors: string[],
): number | null {
  const timings = phraseTimingsByRef.get(anchor.ref)
  if (timings === undefined || timings.length === 0) {
    errors.push(`${at}.anchor 无法解析：轨「${anchor.ref}」的词级 timing 不可用（音频解码失败或轨不在本 manifest）。`)
    return null
  }
  try {
    return resolveAnchor(anchor, timings, { at })
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
    return null
  }
}
