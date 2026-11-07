/**
 * 词级时间戳推导（能力基准 #05 收口，2026-10-31）—— 纯函数，Node 可单测。
 *
 * 背景：后端 TTS 只回整句 mp3，没有词级时间戳（skill 边界句因此一直写着
 * "不做词级字幕对齐"）。本模块把 bench 的**离线能量谷对齐**搬进产品：
 * 10ms RMS 包络 → 语音区起止 + 字间谷值 → 谷值为主边界、不足处在最长间隙内插，
 * 凑出逐字窗口。实测精度 ±1–3 帧（30fps，中文慢速 TTS；bench #05 像素验收过）。
 *
 * 确定性：输入相同 ⇒ 输出逐帧相同（无随机、无时钟）；解码在浏览器侧
 * （Caption.tsx 用 AudioContext.decodeAudioData，同 AudioViz 模式），这里只吃包络。
 */

/** 标点集合（口播时不发音 —— 不参与能量谷切分，只骑在前后字的间隙上）。 */
const PUNCTUATION = new Set(['，', '。', '！', '？', '；', '：', '、', ',', '.', '!', '?', ';', ':', '…', '"', '「', '」', '《', '》', '（', '）', '(', ')'])

/** 口播字符判定（非标点即口播；空格也按口播跳过 —— TTS 不读空格）。 */
export function isSpokenChar(c: string): boolean {
  return !PUNCTUATION.has(c) && c.trim() !== ''
}

/** 数一句文本的口播字符数（校验层与组件层共用，避免两处口径漂移）。 */
export function countSpokenChars(text: string): number {
  return Array.from(text).filter(isSpokenChar).length
}

export interface WordTimingWindow {
  /** 起始帧（含）。 */
  start: number
  /** 结束帧（不含）。 */
  end: number
}

export interface WordTimingInput {
  /**
   * RMS 包络（固定分桶，每桶 `bucketMs` 毫秒；原始或归一化皆可 —— 内部按峰值归一）。
   * 产生方式见 Caption.tsx（decodeAudioData → 10ms 分桶 RMS）。
   */
  envelope: readonly number[]
  /** 桶时长（毫秒，缺省 10 —— 与包络产生端约定一致）。 */
  bucketMs?: number
  /** 成片帧率。 */
  fps: number
  /** 口播字符数（不含标点 —— 调用方负责从文本里数）。 */
  spokenChars: number
}

/** 谷值检测窗（±5 桶 = ±50ms）：比 syllable 间隙窄，能咬住字间低谷。 */
const VALLEY_RADIUS = 5
/** 谷深阈值（相对峰值）：谷值低于此才算是字间停顿。 */
const VALLEY_DEPTH = 0.35
/** 语音区门槛（相对峰值）。 */
const SPEECH_GATE = 0.12
/** 候选谷最小间隔（桶）。 */
const VALLEY_MIN_GAP = 8

/**
 * 从包络推导逐字窗口（帧）。
 *
 * 边界选取：
 * 1. 语音区 = 包络越过峰值 12% 的首尾；
 * 2. 候选谷 = 区间内的局部极小（±5 桶窗），谷深 < 35% 峰值，间隔 ≥ 8 桶；
 * 3. 需要 `spokenChars − 1` 个内部切点：
 *    - 谷不够 ⇒ 在最长间隙里插中点，重复直到凑够（间隙近似均匀 ⇒ 偏差有界）；
 *    - 谷多余 ⇒ 按谷深从深到浅贪心挑（带最小间隔约束），再按位置排序；
 * 4. 包络全静音 / 口播数为 0 ⇒ 退化为均匀切分语音区（仍可用，只是精度降）。
 */
export function wordTimingFromEnvelope(input: WordTimingInput): WordTimingWindow[] {
  const { envelope, fps, spokenChars } = input
  const bucketMs = input.bucketMs ?? 10
  const bucketToFrame = (bucket: number) => Number(((bucket * bucketMs) / 1000 * fps).toFixed(2))

  if (spokenChars <= 0 || envelope.length === 0) return []

  const peak = envelope.reduce((m, v) => (v > m ? v : m), 0)
  if (peak <= 0) {
    return uniformWindows(0, envelope.length, spokenChars, bucketToFrame)
  }

  let start = envelope.findIndex((v) => v > peak * SPEECH_GATE)
  let end = envelope.length - 1
  while (end > start && (envelope[end] ?? 0) <= peak * SPEECH_GATE) end -= 1
  end += 1
  if (start < 0 || end - start < spokenChars) {
    return uniformWindows(start < 0 ? 0 : start, end, spokenChars, bucketToFrame)
  }

  // 候选谷：区间内的局部极小
  const valleys: Array<{ at: number; depth: number }> = []
  for (let i = start + 1; i < end - 1; i += 1) {
    const cur = envelope[i] ?? 0
    let isMin = true
    for (let k = Math.max(start, i - VALLEY_RADIUS); k <= Math.min(end - 1, i + VALLEY_RADIUS); k += 1) {
      if ((envelope[k] ?? Number.POSITIVE_INFINITY) < cur) {
        isMin = false
        break
      }
    }
    if (isMin && cur < peak * VALLEY_DEPTH) valleys.push({ at: i, depth: cur })
  }
  // 合并过近的谷（保最深；**等深取后** —— 平坦停顿区（如逗号）的谷应落在
  // 下一字起音点附近，而不是停顿开头，否则下一字会在静音期提前高亮）。
  const merged: Array<{ at: number; depth: number }> = []
  for (const v of valleys) {
    const last = merged[merged.length - 1]
    if (last !== undefined && v.at - last.at < VALLEY_MIN_GAP) {
      if (v.depth <= last.depth) merged[merged.length - 1] = v
    } else {
      merged.push(v)
    }
  }

  const target = spokenChars - 1
  let cuts: number[]
  if (merged.length >= target) {
    // 按谷深从浅到深（= 字间停顿越明显）贪心挑，带最小间隔约束，再按位置还原
    const picked: number[] = []
    for (const v of [...merged].sort((a, b) => a.depth - b.depth)) {
      if (picked.length >= target) break
      if (picked.every((p) => Math.abs(p - v.at) >= VALLEY_MIN_GAP)) picked.push(v.at)
    }
    // 贪心挑不满（谷挤在一起）就用位置均匀补
    if (picked.length < target) {
      cuts = spreadCuts(start, end, target)
    } else {
      cuts = picked.sort((a, b) => a - b)
    }
  } else {
    // 谷不够：已找到的谷作固定切点，剩余缺口按**间隙长度比例**分摊到各间隙内均匀补
    // （不要逐轮二分最大间隙 —— 那是二叉树分布，字窗会一长一短）。
    const fixed = merged.map((v) => v.at).sort((a, b) => a - b)
    const deficit = target - fixed.length
    cuts = deficit > 0 ? fillGapsProportionally(start, end, fixed, deficit) : fixed
    if (cuts.length < target) {
      return uniformWindows(start, end, spokenChars, bucketToFrame)
    }
  }

  const bounds = [start, ...cuts, end]
  const windows: WordTimingWindow[] = []
  for (let i = 0; i < spokenChars; i += 1) {
    const from = bounds[i] ?? start
    const to = bounds[i + 1] ?? end
    windows.push({ start: bucketToFrame(from), end: bucketToFrame(to) })
  }
  return windows
}

/** 均匀切分兜底：[fromBucket, toBucket) 等分 spokenChars 段。 */
function uniformWindows(fromBucket: number, toBucket: number, spokenChars: number, bucketToFrame: (b: number) => number): WordTimingWindow[] {
  const span = Math.max(1, toBucket - fromBucket)
  const out: WordTimingWindow[] = []
  for (let i = 0; i < spokenChars; i += 1) {
    out.push({
      start: bucketToFrame(fromBucket + Math.round((span * i) / spokenChars)),
      end: bucketToFrame(fromBucket + Math.round((span * (i + 1)) / spokenChars)),
    })
  }
  return out
}

/** 位置均匀切点（谷挤压在一起时的兜底）。 */
function spreadCuts(fromBucket: number, toBucket: number, cuts: number): number[] {
  const span = Math.max(1, toBucket - fromBucket)
  const out: number[] = []
  for (let i = 1; i <= cuts; i += 1) {
    out.push(fromBucket + Math.round((span * i) / (cuts + 1)))
  }
  return out
}

/**
 * 把 `deficit` 个补充切点按**间隙长度比例**分摊到 `[from, to]` 的各段里
 * （每段内部均匀）。固定切点（真谷）保留原位 —— 真停顿的语义不被均匀化稀释。
 */
function fillGapsProportionally(from: number, to: number, fixedCuts: readonly number[], deficit: number): number[] {
  const bounds = [from, ...fixedCuts, to]
  const gaps = bounds.slice(0, -1).map((b, i) => (bounds[i + 1] ?? to) - (b ?? from))
  const totalGap = gaps.reduce((s, g) => s + g, 0)
  if (totalGap <= 0 || deficit <= 0) return [...fixedCuts]
  // 最大余数法分配每个间隙的切点数
  const raw = gaps.map((g) => (g / totalGap) * deficit)
  const counts = raw.map((r) => Math.floor(r))
  let remaining = deficit - counts.reduce((s, c) => s + c, 0)
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac)
  for (const { i } of order) {
    if (remaining <= 0) break
    counts[i] = (counts[i] ?? 0) + 1
    remaining -= 1
  }
  const out: number[] = []
  for (let i = 0; i < gaps.length; i += 1) {
    const k = counts[i] ?? 0
    const gapFrom = bounds[i] ?? from
    const gapLen = gaps[i] ?? 0
    for (let j = 1; j <= k; j += 1) {
      out.push(gapFrom + Math.round((gapLen * j) / (k + 1)))
    }
  }
  return [...fixedCuts, ...out].sort((a, b) => a - b)
}

/** 逐字窗口（可直接作 manifest 的 `caption.words`；`from`/`to` 是**绝对帧号**）。 */
export interface CaptionWordSpan {
  text: string
  from: number
  to: number
}

/**
 * CV-450（P0-A 同批）：按**真实时长 + 口播字数**生成逐字窗口（缺省对齐）。
 *
 * 为什么需要它：`caption.words` 显式声明只有模型能填，实际没人填（真机 12 条 caption
 * 全是空）；能量谷推导要解码整段音频（`delayRender` 阻塞首帧拍摄）且**中文词间没有
 * 明显能量谷**，实测抖动 ±1–3 帧。
 *
 * 而 caption 轨的 `durationInFrames` 来自 `tts_narration` 的 ffprobe 真值 —— 本身已经是
 * 精确的。把它按口播字数等分，误差只来自「语速不完全均匀」，且**不累积**（线性拉伸，
 * 不是逐字漂移），同时完全不依赖音频解码。
 *
 * 与 `Caption.tsx` 的优先级配套：显式 `words` > 本函数 > 能量谷。
 *
 * @returns 逐字窗口（条数 === 口播字数，可直接对齐 `spokenIndices`）；无法生成时 `null`
 *   （无口播字 / 时长非法 / 帧数不足以分配）—— 调用方继续走能量谷兜底。
 */
export function captionWordsByCharCount(input: {
  text: string
  startFrame: number
  durationInFrames: number
}): CaptionWordSpan[] | null {
  const spoken = Array.from(input.text).filter(isSpokenChar)
  if (spoken.length === 0) return null
  if (!Number.isFinite(input.durationInFrames) || input.durationInFrames <= 0) return null
  if (!Number.isFinite(input.startFrame)) return null
  const origin = Math.max(0, Math.round(input.startFrame))
  const total = Math.max(1, Math.round(input.durationInFrames))
  const n = spoken.length
  // 帧数少于字数 ⇒ 每字分不到一帧，逐字高亮必然重复/跳帧。交回兜底，不硬压。
  if (total < n) return null
  const out: CaptionWordSpan[] = []
  for (let i = 0; i < n; i += 1) {
    out.push({
      text: spoken[i] ?? '',
      // 用 (total*i)/n 而不是 i*per，避免浮点误差累积；最后一个 to 必然等于 origin+total。
      from: origin + Math.round((total * i) / n),
      to: origin + Math.round((total * (i + 1)) / n),
    })
  }
  return out
}

/**
 * caption 轨 → 词级窗口（**轨内相对帧**口径，与组件在 `<Sequence from={track.startFrame}>`
 * 内拿到的 `useCurrentFrame()` 同一坐标系）。三级来源的前两级：
 * 1. 显式 `words`（0-based，长度须与口播字数一致）原样采用；
 * 2. 按真实时长 + 口播字数等分 —— **原点恒 0**。等分若以 `track.startFrame` 为原点会整体
 *    错位一个轨起点：startFrame=0 的首句恰好碰对、其余轨全句灰（四季片复盘 R-01；
 *    显式 words 本就 0-based，两条来源的坐标系必须一致）。
 * 两级都不成立返回 null，调用方退回能量包络推导（第三级）。
 */
export function trackWordWindows(track: {
  readonly words?: unknown
  text: string
  startFrame: number
  durationInFrames: number
}): WordTimingWindow[] | null {
  const spokenCount = countSpokenChars(track.text)
  if (Array.isArray(track.words) && track.words.length === spokenCount) {
    return (track.words as Array<{ from: number; to: number }>).map((w) => ({ start: w.from, end: w.to }))
  }
  const words = captionWordsByCharCount({ text: track.text, startFrame: 0, durationInFrames: track.durationInFrames })
  return words === null ? null : words.map((w) => ({ start: w.from, end: w.to }))
}
