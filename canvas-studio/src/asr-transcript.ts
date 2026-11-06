/**
 * ASR（`asr2txt`）响应 → `evidence_grid.transcriptPath` 可直食的词级转写 JSON（CV-448）。
 *
 * 后端 `POST /api/v1/generate/asr2txt`（fast-Whisper-large-v3-turbo-ct2）回三个**行式
 * 字符串**（docs/api.md §asr2txt）：
 * - `txt`：整篇识别文本，无时间戳；
 * - `txt_word`：词级时间戳，每行 `(开始秒, 结束秒) 词`；
 * - `txt_segment`：句段级时间戳，每行 `(开始秒, 结束秒) 文本`。
 *
 * 而 `evidence-grid.ts` 的 `parseTranscript`（`transcriptPath` 的**唯一**消费方）要的是
 * `{ segments: [{ start, end, text, words: [{ t, start, end }] }] }`，且 **words 不允许
 * 缺项**（AC5：缺项即拒收）。本模块就是这层形状适配 —— 解析行串 → 按时间把词归进句段
 * → 出 JSON 落盘。
 *
 * 归组策略（纯函数，全部有单测）：
 * 1. 每个词归进**重叠最大**的句段（段边界与词起点相等、段间偶发重叠都不致错位；
 *    全程无重叠时取最近段）—— 只在后端给了 `txt_segment` 时走这条路；
 * 2. `txt_segment` 缺失 / 一行都解析不出来时，从词序列按**标点 + 时间断句**自造句段
 *    （不丢时间戳，回执照样能出 JSON）；这些段**已按构造分好组**，不再二次归组
 *    （二次归组会把每个词推两遍，单测钉死）；
 * 3. 归不到任何词的句段**丢弃**并在 stats 里计数 —— 留着必然被 parseTranscript 拒收，
 *    静默保留等于把红抛给下游；
 * 4. `txt_word` 完全缺失时 `doc = null` —— 调用方只回文本、不落盘（并在回执里明说）。
 *
 * IO（落盘）与纯函数同文件但**入参全量注入**（`root`），与 `teardown-store.ts` 同一做法，
 * 单测可以只跑纯函数段。
 */
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

/** 词级时间戳条目（与 `parseTranscript` 的 `words[]` 同形状）。 */
export interface AsrWord {
  t: string
  start: number
  end: number
}

/** 句段（与 `parseTranscript` 的 `segments[]` 同形状）。 */
export interface AsrSegment {
  start: number
  end: number
  text: string
  words: AsrWord[]
}

/** 落盘的转写 JSON 根形状（`transcriptPath` 的文件形态）。 */
export interface AsrTranscriptDoc {
  segments: AsrSegment[]
}

/** 解析 / 归组的产出：`doc = null` 表示没拿到词级时间戳（只能回文本）。 */
export interface AsrTranscriptBuild {
  doc: AsrTranscriptDoc | null
  stats: {
    /** 解析出的词数（= 落盘 JSON 的 words 总数）。 */
    words: number
    /** 最终保留的句段数。 */
    segments: number
    /** 因为归不到词而被丢弃的句段数（>0 时回执要说明）。 */
    dropped: number
  }
}

/**
 * 时间戳行：`(0.0, 1.32) 今天天气真好` → [起, 止, 文本]。
 *
 * 容忍前后空白 / 整数秒 / 逗号后多空格；不匹配的行**静默跳过**（后端若混进
 * `VAD 阈值` 之类的元信息行，不能让整份转写失败）。
 */
const TIMED_LINE = /^\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)\s*(.*)$/u

/** 解析一行 `(起, 止) 文本`；非法时间（NaN / 止 < 起）与空文本一律丢弃。 */
export function parseAsrTimedLines(raw: string): Array<{ start: number; end: number; text: string }> {
  const out: Array<{ start: number; end: number; text: string }> = []
  for (const line of raw.split('\n')) {
    const match = TIMED_LINE.exec(line.trim())
    if (match === null) continue
    const start = Number(match[1])
    const end = Number(match[2])
    const text = (match[3] ?? '').trim()
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || text === '') continue
    out.push({ start, end, text })
  }
  return out
}

/** 拉丁词拼接补空格：`['Hello', 'world']` → `Hello world`，中文照旧紧邻。 */
function joinWordTexts(tokens: readonly string[]): string {
  let out = ''
  for (const token of tokens) {
    const latinBoundary = /[A-Za-z0-9]$/u.test(out) && /^[A-Za-z0-9]/u.test(token)
    out += latinBoundary ? ` ${token}` : token
  }
  return out
}

/** 内部句段形状（归组前 words 为空，归组后填满）。 */
type Span = AsrSegment

/**
 * 词序列 → 句段（`txt_segment` 缺失时的兜底）。
 *
 * 断句判据二选一命中即切：① 词文本以句读收尾（。！？!?；;：:）；② 与上一词的
 * **间隙 > 1s**（静音断句 —— whisper 的时间戳在长停顿处天然分段）。
 */
function spansFromWords(words: readonly AsrWord[]): Span[] {
  const spans: Span[] = []
  let current: AsrWord[] = []
  const flush = (): void => {
    if (current.length === 0) return
    spans.push({
      start: current[0]!.start,
      end: current[current.length - 1]!.end,
      text: joinWordTexts(current.map((w) => w.t)),
      words: [...current],
    })
    current = []
  }
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i]!
    current.push(word)
    const prev = words[i - 1]
    const gap = prev === undefined ? 0 : word.start - prev.end
    if (/[。！？!?；;：:]$/u.test(word.t) || gap > 1) flush()
  }
  flush()
  return spans
}

/**
 * 词归句段：逐词挑**重叠最大**的那段；全程无重叠（词落在段间隙 / 段外）时挑
 * **距离最近**的那段，平手取更早的段。
 *
 * 不做「半开区间顺序扫」—— 后端的段边界常与词起点**完全相等**（`(1.32, 2.4) 我们`
 * 接 `(0.0, 1.32) 今天天气真好`），顺序扫会把边界词判给上一段、整段错位；重叠计分
 * 对这类边界天然免疫，也不怕 whisper 偶发的段重叠。每个词恰好落一段 ——
 * `words` 不缺项是 `parseTranscript` 的硬要求（AC5）。
 */
function assignWords(spans: Span[], words: readonly AsrWord[]): void {
  for (const word of words) {
    let best = 0
    let bestScore = Number.NEGATIVE_INFINITY
    for (let i = 0; i < spans.length; i += 1) {
      const span = spans[i]!
      const overlap = Math.min(span.end, word.end) - Math.max(span.start, word.start)
      const gap = word.start < span.start ? span.start - word.end : word.start - span.end
      const score = overlap > 0 ? overlap : -Math.max(gap, 0)
      if (score > bestScore) {
        bestScore = score
        best = i
      }
    }
    spans[best]!.words.push(word)
  }
}

/**
 * 把 `txt_word` + `txt_segment` 组装成 `transcriptPath` 可直食的转写文档。
 *
 * @param txtWord - 后端 `txt_word` 原文（词级时间戳行）。
 * @param txtSegment - 后端 `txt_segment` 原文（句段级时间戳行，可为空）。
 */
export function buildAsrTranscript(txtWord: string, txtSegment: string): AsrTranscriptBuild {
  const words: AsrWord[] = parseAsrTimedLines(txtWord)
    .map((line) => ({ t: line.text, start: line.start, end: line.end }))
    .sort((a, b) => a.start - b.start)
  if (words.length === 0) {
    return { doc: null, stats: { words: 0, segments: 0, dropped: 0 } }
  }

  const fromSegments = parseAsrTimedLines(txtSegment)
    .map((line) => ({ start: line.start, end: line.end, text: line.text, words: [] as AsrWord[] }))
  const hasSegments = fromSegments.length > 0
  const spans: Span[] = hasSegments ? fromSegments : spansFromWords(words)
  // `spansFromWords` 产出的段**已经按构造分好组**（段就是从词序列切出来的，words 已填满）；
  // 只有后端给了 `txt_segment` 时才需要按时间归组。无条件再跑一遍 assignWords 会把每个词
  // 推第二次（单测实测 [6,2,2] 而非 [3,1,1]）—— 归组路径互斥，不叠着跑。
  if (hasSegments) assignWords(spans, words)

  const kept: Span[] = []
  let dropped = 0
  for (const span of spans) {
    if (span.words.length === 0) {
      dropped += 1
      continue
    }
    const first = span.words[0]!
    const last = span.words[span.words.length - 1]!
    // 边界夹回词的实际范围：段头段尾贴边时，段区间若不覆盖自己的词，
    // 下游「时刻 → 激活词」（evidence-grid 的词命中）会算出段内无词。
    kept.push({
      start: Math.min(span.start, first.start),
      end: Math.max(span.end, last.end),
      text: span.text,
      words: span.words,
    })
  }
  if (kept.length === 0) {
    // 理论不可达（词至少会落进一段），留一道兜底：单段全收，绝不返回空 segments。
    kept.push({
      start: words[0]!.start,
      end: words[words.length - 1]!.end,
      text: joinWordTexts(words.map((w) => w.t)),
      words: [...words],
    })
    dropped = 0
  }
  return { doc: { segments: kept }, stats: { words: words.length, segments: kept.length, dropped } }
}

/** 序列化成落盘正文（两格缩进，便于人眼 diff）。 */
export function asrTranscriptJson(doc: AsrTranscriptDoc): string {
  return `${JSON.stringify(doc, null, 2)}\n`
}

/**
 * 落盘转写 JSON，返回**绝对路径**（可直接填 `evidence_grid.transcriptPath`）。
 *
 * 跨项目目录 `<root>/transcripts/`（缺省 `dshHomePath('canvas-studio')`），
 * 与 `teardown-store` / `evidence` 同一存放哲学：产物属于「拆解证据」，不绑项目。
 *
 * @param doc - 转写文档（`buildAsrTranscript` 的非 null 产出）。
 * @param options - `root` 覆盖存储根（测试注入）。
 */
export async function writeAsrTranscript(
  doc: AsrTranscriptDoc,
  options: { root?: string } = {},
): Promise<string> {
  const root = options.root ?? dshHomePath('canvas-studio')
  const dir = join(root, 'transcripts')
  await mkdir(dir, { recursive: true })
  const id = `${new Date().toISOString().replace(/[:.]/gu, '-')}-${randomUUID().slice(0, 8)}`
  const file = join(dir, `asr-${id}.json`)
  await writeFile(file, asrTranscriptJson(doc), 'utf8')
  return file
}
