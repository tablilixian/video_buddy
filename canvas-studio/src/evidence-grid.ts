/**
 * 证据网格（REQ-036 C2，CV-398）—— 一次调用产出「带时间戳/台词标注的贴片网格 + 结构化清单」。
 *
 * 背景：拆解靠 `inspect_image` 逐帧轮询，甜品会话实测几十次调用才拼出一段的画面
 * 变化，且画面与口播对不上（不知道哪个画面变化服务哪句话）。hypit 的核心效率手段
 * 就是「一次调用返回带时间戳/台词标注的贴片网格」。
 *
 * ## 管线（单次解码连续输出，不逐帧起进程）
 *
 *   ffmpeg -i video
 *     -vf select='(isnan(prev_selected_t)+gte(t,prev_selected_t+I))*between(t,S,E)'
 *         ,showinfo                     ← 记录**实测帧 PTS**（select 保留原始时间戳，
 *                                          fps 滤镜会把 pts 重写成整点，故不用 fps）
 *         ,scale=cellPx:-2
 *         ,pad=iw:ih+STRIP              ← 底部标注条
 *         ,drawtext=%{pts\:hms}         ← 每格时间戳（实测 PTS 人话化）
 *         ,drawtext=台词词标签(enable)   ← 每个词窗口一条 drawtext，enable=between
 *         ,drawbox=切点描边(enable)      ← markCuts：切点所在格红框标记
 *         ,tile=CxR                     ← 拼网格；满页即出一帧，EOF 冲刷残页
 *     -vsync 0                          ← image2 缺省 CFR 会把首页复制到每页，必须透传
 *     page-%04d.jpg
 *
 * 切点检测**与 verify_teardown 共用同一份检测器**（CV-445 起 = `shot-detect.ts` 自适应
 * 三条件，不许复制实现），口径天然一致。
 *
 * 纯函数（采样展开 / 分页 / 词标签 / 滤镜链构造 / showinfo 解析）与 ffmpeg IO 分离，
 * 前者直接单测，后者走真 ffmpeg E2E。
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
// AR-03：JSON 状态档一律原子写（裸 writeFile 中断会留半截 JSON）。
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import {
  detectShotBoundaries,
  extractFrameTrack,
  SHOT_SAMPLE_FPS,
  type FrameTrack,
} from './shot-detect.js'
import { collectMethodEvidence, type MethodEvidence } from './method-evidence.js'
import { teardownFingerprintOf } from './teardown-store.js'
import { probeMediaDuration, resolveFfmpegPath, runFfmpeg, FFMPEG_TIMEOUT_MS } from './ffmpeg-run.js'
import { throwError } from './error-system.js'
import './errors/catalog.js'

// ───────────────────────────── 采样计划 ─────────────────────────────

/** 一段采样计划（秒）。缺省 = 整片概览 1s/格；密集段由 Agent 二次调用 0.1–0.3s/格。 */
export interface SamplingPass {
  /** 起始秒（含）。 */
  start: number
  /** 结束秒（含，超出片长自动截断）。 */
  end: number
  /** 采样间隔（秒）。 */
  interval: number
}

/** 单格总量上限（默认 4×3 网格 = 40 页；超出显式报错，防一次调用吞整片）。 */
export const MAX_CELLS = 480

/**
 * 单段采样计划 → 该段的格子时刻表（纯函数）。
 * 时刻 = start + i×interval（下标乘法避免浮点累积漂移），≤ end 且 < 片尾截断。
 */
export function passCellTimes(pass: SamplingPass, durationSec: number): number[] {
  const { start, end, interval } = pass
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(interval)
    || start < 0 || end <= start || interval <= 0) {
    throwError('CS-USER-ERR', {
      message: `采样计划非法：{start:${String(start)}, end:${String(end)}, interval:${String(interval)}} —— 需要 0 ≤ start < end、interval > 0（秒）。`,
      detail: 'invalid sampling pass',
    })
  }
  const limit = durationSec > 0 ? Math.min(end, durationSec) : end
  const times: number[] = []
  for (let i = 0; ; i += 1) {
    const t = start + i * interval
    if (t > limit + 1e-9) break
    times.push(Math.round(t * 1000) / 1000)
    if (times.length > MAX_CELLS) {
      throwError('CS-USER-ERR', {
        message: `采样格数超过上限 ${MAX_CELLS} —— 收紧 start/end 或加大 interval（当前 interval=${String(interval)}s）。`,
        detail: 'too many cells',
      })
    }
  }
  return times
}

/**
 * 全部采样计划 → 去重升序的格子时刻表（纯函数）。跨段重复时刻（同一秒被两段覆盖）
 * 只保留一次 —— 网格里同一画面出现两格只会浪费格子。
 */
export function plannedCellTimes(passes: readonly SamplingPass[], durationSec: number): number[] {
  if (passes.length === 0) {
    throwError('CS-USER-ERR', { message: 'passes 不能为空数组 —— 省略参数即用缺省整片概览，给了就至少要一段。' })
  }
  const seen = new Set<string>()
  const all: number[] = []
  for (const pass of passes) {
    for (const t of passCellTimes(pass, durationSec)) {
      const key = t.toFixed(3)
      if (seen.has(key)) continue
      seen.add(key)
      all.push(t)
    }
  }
  return all.sort((a, b) => a - b)
}

// ───────────────────────────── 分页 ─────────────────────────────

/** 一格的结构化条目。 */
export interface EvidenceCell {
  /** 全局格序号（0 起，按时间升序）。 */
  index: number
  /** 实测帧时刻（秒，来自 showinfo 的原始 PTS）。 */
  timestampSec: number
  /** 页码（0 起）。 */
  page: number
  /** 页内行（0 起）。 */
  row: number
  /** 页内列（0 起）。 */
  col: number
  /** 该时刻激活的台词词标签（有转写且命中词窗口时才有）。 */
  label?: string
}

/** 一张网格页。 */
export interface EvidencePage {
  /** 页码（0 起）。 */
  page: number
  fromSec: number
  toSec: number
  /** 本页格数（末页可能不满）。 */
  cellCount: number
}

/**
 * 实测时刻表 → 分页网格坐标（纯函数）。顺序即拼图顺序：tile 按输入顺序逐格填充，
 * 第 n 格落在 page=floor(n/perPage) 的 row=floor((n%perPage)/columns)、col=n%columns。
 */
export function paginateCellTimes(
  times: readonly number[],
  columns: number,
  rows: number,
): { cells: EvidenceCell[]; pages: EvidencePage[] } {
  const perPage = columns * rows
  const cells: EvidenceCell[] = []
  const pages: EvidencePage[] = []
  for (let i = 0; i < times.length; i += 1) {
    const t = times[i] ?? 0
    const page = Math.floor(i / perPage)
    const within = i % perPage
    if (within === 0) {
      pages.push({ page, fromSec: t, toSec: t, cellCount: 0 })
    }
    const currentPage = pages[page]
    if (currentPage !== undefined) {
      currentPage.toSec = t
      currentPage.cellCount += 1
    }
    cells.push({ index: i, timestampSec: t, page, row: Math.floor(within / columns), col: within % columns })
  }
  return { cells, pages }
}

// ───────────────────────────── 台词词标签 ─────────────────────────────

/** ASR 词级转写的一个词（契约见后台需求文档：秒单位、中文按字、标点不进 words）。 */
export interface TranscriptWord {
  /** 词文本。 */
  t: string
  start: number
  end: number
}

/** ASR 转写的一段（句）。 */
export interface TranscriptSegment {
  start: number
  end: number
  text: string
  words: TranscriptWord[]
}

/** ASR 词级转写 JSON（`transcriptPath` 的文件形态）。 */
export interface Transcript {
  duration?: number
  language?: string
  segments: TranscriptSegment[]
}

/**
 * 解析转写 JSON（形状校验，宽容单调性 —— 契约由后台保证，前端只拒收「用不了」的）。
 * segments / words 任一缺项、词缺 t/start/end 都显式报错（AC5：字段缺失视为不合格）。
 */
export function parseTranscript(raw: string): Transcript {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throwError('CS-USER-ERR', { message: 'transcriptPath 的文件不是合法 JSON —— 请传 ASR 词级转写服务的原始产物。' })
  }
  const root = parsed as { segments?: unknown; duration?: unknown; language?: unknown }
  if (!Array.isArray(root.segments) || root.segments.length === 0) {
    throwError('CS-USER-ERR', { message: '转写 JSON 缺 segments 数组（或为空）—— 请传词级转写产物（schema 见后台需求文档 §2.3）。' })
  }
  const segments: TranscriptSegment[] = []
  for (const item of root.segments) {
    const seg = item as { start?: unknown; end?: unknown; text?: unknown; words?: unknown }
    if (!Array.isArray(seg.words) || seg.words.length === 0) {
      throwError('CS-USER-ERR', { message: `转写段（${String(seg.start)}–${String(seg.end)}s）缺 words 数组 —— words 不允许缺项（AC5）。` })
    }
    const words: TranscriptWord[] = seg.words.map((w) => {
      const word = w as { t?: unknown; start?: unknown; end?: unknown }
      if (typeof word.t !== 'string' || word.t === ''
        || typeof word.start !== 'number' || typeof word.end !== 'number') {
        throwError('CS-USER-ERR', { message: '转写词缺 t/start/end 字段 —— 请传词级转写产物（schema 见后台需求文档 §2.3）。' })
      }
      return { t: word.t, start: word.start, end: word.end }
    })
    segments.push({
      ...(typeof seg.start === 'number' ? { start: seg.start } : { start: words[0]!.start }),
      ...(typeof seg.end === 'number' ? { end: seg.end } : { end: words[words.length - 1]!.end }),
      ...(typeof seg.text === 'string' ? { text: seg.text } : { text: words.map((w) => w.t).join('') }),
      words,
    })
  }
  return {
    ...(typeof root.duration === 'number' ? { duration: root.duration } : {}),
    ...(typeof root.language === 'string' ? { language: root.language } : {}),
    segments,
  }
}

/** 一格的词命中：命中的词 + 本句前文（供标签拼接与结构化清单）。 */
export interface WordHit {
  /** 命中的词文本。 */
  word: string
  /** 词窗口（秒）。 */
  window: { start: number; end: number }
  /** 本句中该词之前的至多 8 个 token（词间上下文）。 */
  prefix: string
}

/**
 * 时刻 → 激活词（纯函数）：首个满足 `start ≤ t < end` 的词（跨段顺序扫）。
 * 格中心时刻落在词间隙 / 无转写时返回 null（该格只显示时间戳）。
 */
export function wordAt(transcript: Transcript, timeSec: number): WordHit | null {
  for (const seg of transcript.segments) {
    for (let i = 0; i < seg.words.length; i += 1) {
      const word = seg.words[i]!
      if (word.start <= timeSec && timeSec < word.end) {
        const prefix = seg.words.slice(Math.max(0, i - 8), i).map((w) => w.t).join('')
        return { word: word.t, window: { start: word.start, end: word.end }, prefix }
      }
    }
  }
  return null
}

/** 词命中 → 烧录标签：`前8字上下文【词】`（词用【】标记 = 「词高亮」的 drawtext 形态）。 */
export function labelOfWord(hit: WordHit): string {
  return `${hit.prefix}【${hit.word}】`
}

/**
 * drawtext 标签清洗（纯函数）：标签是显示用文本，把 filtergraph / drawtext 展开层的
 * 元字符（`\ ' " % : , ; [ ] ( )` 反斜杠与换行）替换成全角或删除，免两层转义打架。
 * 中文标签不受影响； ASCII 标点在网格图上以全角形态显示，语义不丢。
 */
export function sanitizeDrawtextLabel(text: string): string {
  return text
    .replaceAll('\\', '')
    .replaceAll('\n', ' ')
    .replaceAll('\r', '')
    .replaceAll("'", '’')
    .replaceAll('"', '”')
    .replaceAll('%', '％')
    .replaceAll(':', '：')
    .replaceAll(',', '，')
    .replaceAll(';', '；')
    .replaceAll('[', '『')
    .replaceAll(']', '』')
    .replaceAll('(', '（')
    .replaceAll(')', '）')
    .replaceAll('=', '＝')
}

// ───────────────────────────── 滤镜链构造 ─────────────────────────────

/** 标注条常量：底部预留高度与字号（随 cellPx 缩放，480px 格 → 30px 字）。 */
export const LABEL_STRIP_TWO_LINES = 92
export const LABEL_STRIP_ONE_LINE = 56
export const CUT_BORDER_COLOR = 'red'
export const WORD_LABEL_COLOR = '0x5AD2FF'

export interface LabelWindow {
  /** 标签文本（调用方已 sanitize）。 */
  text: string
  /** 生效窗口（秒）：采样帧 PTS 落在窗口内才烧录。 */
  from: number
  to: number
}

export interface GridFilterChainOptions {
  interval: number
  start: number
  end: number
  cellPx: number
  /** 网格列数（tile=CxR 的 C）。 */
  columns: number
  /** 网格行数（tile=CxR 的 R）。 */
  rows: number
  /** 标注条高度（px）：有台词标签 92，无 56。 */
  stripPx: number
  fontFile: string
  /** 词标签窗口（来自转写，绝对时间 —— 与格子时刻解耦，天然免疫采样漂移）。 */
  labels?: readonly LabelWindow[]
  /** 要描边的格子时刻（秒）：切点落在 [T, T+interval) 的格。 */
  cutMarks?: readonly number[]
  /** 瓦片页边距/间距（px）。 */
  gapPx?: number
}

/**
 * 构造单段采样的完整 -vf 滤镜链（纯函数，argv 可断言）。
 *
 * select 的自适应间隔表达式保留**实测帧 PTS**（fps 滤镜会把 pts 重写成整点，
 * 故弃用 —— 「格时间戳取实测帧 PTS」是验收口径）。showinfo 紧跟 select，把每个
 * 被选中帧的 pts_time 打进 stderr（Executor 解析回读，JSON 清单与图上烧录同源）。
 */
export function buildGridFilterChain(options: GridFilterChainOptions): string {
  const { interval, start, end, cellPx, columns, rows, stripPx, fontFile } = options
  const gap = options.gapPx ?? 4
  const fontSize = Math.max(16, Math.round(cellPx / 16))
  const filters: string[] = [
    `select='(isnan(prev_selected_t)+gte(t,prev_selected_t+${interval}))*between(t,${start},${end})'`,
    'showinfo',
    `scale=${cellPx}:-2`,
    `pad=iw:ih+${stripPx}:0:0:black`,
    `drawtext=fontfile=${fontFile}:text='%{pts\\:hms}':fontsize=${fontSize}:fontcolor=white:x=(w-tw)/2:y=h-${stripPx - 12}`,
  ]
  for (const label of options.labels ?? []) {
    // 词窗口半开 [from, to)：帧恰落在词尾时避免与下一词标签叠在同一格上。
    filters.push(
      `drawtext=fontfile=${fontFile}:text='${label.text}':fontsize=${fontSize}:fontcolor=${WORD_LABEL_COLOR}`
        + `:x=(w-tw)/2:y=h-${Math.max(fontSize + 8, stripPx - 12 - fontSize - 6)}`
        + `:enable='gte(t,${label.from})*lt(t,${label.to})'`,
    )
  }
  for (const mark of options.cutMarks ?? []) {
    filters.push(
      `drawbox=x=0:y=0:w=iw:h=ih:color=${CUT_BORDER_COLOR}:thickness=${Math.max(4, Math.round(fontSize / 4))}`
        + `:enable='between(t,${mark - interval / 2},${mark + interval / 2})'`,
    )
  }
  filters.push(`tile=${columns}x${rows}:margin=${gap}:padding=${gap}:color=black`)
  return filters.join(',')
}

// ───────────────────────────── showinfo 回读 ─────────────────────────────

/**
 * 从 ffmpeg stderr 解析 showinfo 报告的实测帧 PTS（纯函数）。
 * showinfo 每个被选中帧打一行 `pts_time:秒`；其余行（进度/编码器）不含该模式。
 */
export function parseShowinfoTimes(stderr: string): number[] {
  const times: number[] = []
  for (const match of stderr.matchAll(/pts_time:(\d+(?:\.\d+)?)/gu)) {
    const value = Number(match[1])
    if (Number.isFinite(value)) times.push(Math.round(value * 1000) / 1000)
  }
  return times
}

// ───────────────────────────── 执行器 ─────────────────────────────

/** 随包 drawtext 字体（drawtext 需要实体字体文件，woff2 不适用 —— REQ §2.3 定死方案）。 */
export function bundledGridFontFile(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'fonts', 'noto-sans-sc-regular.ttf')
}

export interface EvidenceGridResult {
  /** 证据目录（跨项目：dshHomePath('canvas-studio')/evidence/<指纹>/）。 */
  dir: string
  /** 参考视频指纹（与 teardown_store 同源，便签可回链）。 */
  key: string
  /** 采样格数（实测）。 */
  cellCount: number
  pages: EvidencePage[]
  /** 每页产物文件名（含页码与时间范围，与 pages 同序）。 */
  files: string[]
  /** 实测画面切换点（秒，与 verify_teardown 同一份检测器）。 */
  cutPoints: number[]
  /** 确定性取证三项（CV-445 S2）：AIGC 元数据 / 帧率指纹 / 冻结帧。 */
  methodEvidence: MethodEvidence
  /** 结构化清单 JSON 的落盘文件名。 */
  manifestFile: string
  transcriptUsed: boolean
}

export interface EvidenceGridOptions {
  videoPath: string
  passes?: readonly SamplingPass[]
  columns?: number
  rows?: number
  cellPx?: number
  transcriptPath?: string
  markCuts?: boolean
  /** 测试注入：字体路径（缺省随包 assets/fonts/noto-sans-sc-regular.ttf）。 */
  fontFile?: string
  /** 测试注入：证据根目录（缺省 dshHomePath('canvas-studio')）。 */
  root?: string
  ffmpegPath?: string
  signal?: AbortSignal
}

/**
 * 证据网格入口：参考视频（+ 可选转写）→ 网格 jpg ×N + 结构化清单 JSON + 实测切点。
 *
 * 产物登记进拆解证据目录（teardown_store 同源的跨项目目录），便签可回链；
 * 返回值只带事实（路径 / 时刻 / 切点），拆解读法是 skill 层的事。
 */
export async function generateEvidenceGrid(options: EvidenceGridOptions): Promise<EvidenceGridResult> {
  const {
    videoPath, transcriptPath, markCuts = true,
  } = options
  const columns = clampInt(options.columns, 1, 12, 4)
  const rows = clampInt(options.rows, 1, 12, 3)
  const cellPx = clampInt(options.cellPx, 120, 960, 480)
  const ffmpeg = resolveFfmpegPath(options.ffmpegPath)

  if (!existsSync(videoPath)) {
    throwError('CS-USER-ERR', { message: `视频文件不存在：${videoPath} —— 参考视频要先落盘（画布上传产物路径即可）。` })
  }
  const fontFile = options.fontFile ?? bundledGridFontFile()
  if (!existsSync(fontFile)) {
    throwError('CS-USER-ERR', {
      message: `网格标注字体缺失：${fontFile} —— 应用安装不完整，请重新安装；或自备一份含中文的 TTF/OTF 放到上述路径。`,
      detail: 'grid font missing',
    })
  }

  // ① 片长（缺省采样计划需要它；探不到时长且未传 passes → 显式报错要 passes）
  const durationSec = await probeMediaDuration(videoPath, ffmpeg, options.signal)
  const passes = options.passes ?? [{ start: 0, end: durationSec > 0 ? durationSec : Number.NaN, interval: 1 }]
  if (durationSec <= 0 && options.passes === undefined) {
    throwError('CS-USER-ERR', { message: '探不到视频时长（文件损坏或不是视频）—— 请显式传 passes 指定采样区间。' })
  }
  const planned = plannedCellTimes(passes, durationSec)

  // ② 转写（可选）：不传即纯时间戳网格，能力立即可用（与后台 ASR 互不等待）
  let transcript: Transcript | undefined
  if (transcriptPath !== undefined && transcriptPath.trim() !== '') {
    transcript = parseTranscript(await readFile(transcriptPath, 'utf8'))
  }

  // ③ 帧轨迹一次抽取（6fps 全片）→ 切点预扫描与冻结帧/取证共用；
  //    抽不到不阻塞网格主路径（切点为空、取证降级）
  let fullTrack: FrameTrack | undefined
  let cutPoints: number[] = []
  try {
    fullTrack = await extractFrameTrack(videoPath, SHOT_SAMPLE_FPS, options.ffmpegPath, options.signal)
    if (markCuts && fullTrack.luma.length >= 4) {
      cutPoints = detectShotBoundaries(fullTrack).map((b) => Math.round(b.timeSec * 100) / 100)
    }
  } catch {
    fullTrack = undefined
  }

  // ④ 证据目录：teardown_store 同源指纹 → evidence/<key>/
  const root = options.root ?? dshHomePath('canvas-studio')
  const { key } = await teardownFingerprintOf(videoPath)
  const dir = join(root, 'evidence', key)
  await mkdir(dir, { recursive: true, mode: 0o700 })

  // ⑤ 逐段采样 → 拼网格（每段一次解码；页序号跨段连续）
  const stripPx = transcript !== undefined ? LABEL_STRIP_TWO_LINES : LABEL_STRIP_ONE_LINE
  const files: string[] = []
  const actualTimes: number[] = []
  let pageOffset = 0
  for (const pass of passes) {
    const passPlanned = passCellTimes(pass, durationSec).filter((t) => actualTimes.every((a) => Math.abs(a - t) > 1e-6))
    if (passPlanned.length === 0) continue
    const passEnd = passPlanned[passPlanned.length - 1] ?? pass.end
    // 词标签窗口：转写词中与本段采样范围有交集的（绝对时间 enable，免疫漂移）
    const labels = transcript === undefined ? [] : collectLabelWindows(transcript, pass.start, passEnd, planned)
    // 切点 → 所在格标记：cut ∈ [T, T+interval) 的 T（planned 口径；±interval/2 窗口铺满轴）
    const cutMarks = cutPoints
      .map((c) => passPlanned.find((t) => c >= t && c < t + pass.interval))
      .filter((t): t is number => t !== undefined)
    const chain = buildGridFilterChain({
      interval: pass.interval, start: pass.start, end: pass.end,
      cellPx, columns, rows, stripPx, fontFile,
      ...(labels.length > 0 ? { labels } : {}),
      ...(cutMarks.length > 0 ? { cutMarks } : {}),
    })
    const run = await runFfmpeg(ffmpeg, [
      '-hide_banner', '-loglevel', 'info',
      '-i', videoPath,
      '-vf', chain,
      '-vsync', '0',
      '-q:v', '2',
      '-start_number', String(pageOffset + 1),
      '-y', join(dir, 'page-%04d.jpg'),
    ], FFMPEG_TIMEOUT_MS, options.signal)
    const passTimes = parseShowinfoTimes(run.stderr)
    if (passTimes.length === 0) continue
    actualTimes.push(...passTimes)
    const pagesInPass = Math.ceil(passTimes.length / (columns * rows))
    for (let p = 0; p < pagesInPass; p += 1) {
      const pageCells = passTimes.slice(p * columns * rows, (p + 1) * columns * rows)
      const from = pageCells[0] ?? 0
      const to = pageCells[pageCells.length - 1] ?? from
      const muxerName = `page-${String(pageOffset + p + 1).padStart(4, '0')}.jpg`
      const finalName = `evidence-grid-${String(pageOffset + p + 1).padStart(2, '0')}-${from.toFixed(1)}-${to.toFixed(1)}s.jpg`
      await rename(join(dir, muxerName), join(dir, finalName)).catch(() => {})
      files.push(finalName)
    }
    pageOffset += pagesInPass
  }
  if (actualTimes.length === 0) {
    throwError('CS-USER-ERR', { message: '采样区间内没有抽到任何帧 —— 检查 passes 的 start/end 是否超出视频时长。' })
  }

  // ⑥ 结构化清单：实测时刻 → 分页坐标 + 词标签
  const { cells, pages } = paginateCellTimes(actualTimes, columns, rows)
  for (const cell of cells) {
    if (transcript === undefined) continue
    const hit = wordAt(transcript, cell.timestampSec)
    if (hit !== null) cell.label = labelOfWord(hit)
  }

  // ⑦ 确定性取证三项（CV-445 S2）：AIGC 元数据 / 帧率指纹 / 冻结帧 —— 绝不抛错
  const methodEvidence = await collectMethodEvidence({
    videoPath,
    ...(options.ffmpegPath !== undefined ? { ffmpegPath: options.ffmpegPath } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    ...(fullTrack !== undefined ? { fullTrack } : {}),
  })

  const manifestFile = 'evidence-grid.json'
  await writeFileAtomic(
    join(dir, manifestFile),
    `${JSON.stringify({ key, videoPath, cutPoints, methodEvidence, columns, rows, cellPx, pages, cells }, null, 2)}\n`,
    { mode: 0o600, dirMode: 0o700 },
  )

  return {
    dir,
    key,
    cellCount: cells.length,
    pages,
    files,
    cutPoints,
    methodEvidence,
    manifestFile,
    transcriptUsed: transcript !== undefined,
  }
}

/** 收集与采样范围有交集的词标签窗口（去重合并相邻同标签；上限 200 条防滤镜链爆炸）。 */
function collectLabelWindows(transcript: Transcript, rangeStart: number, rangeEnd: number, planned: readonly number[]): LabelWindow[] {
  const out: LabelWindow[] = []
  for (const seg of transcript.segments) {
    for (let i = 0; i < seg.words.length; i += 1) {
      const word = seg.words[i]!
      if (word.end <= rangeStart || word.start > rangeEnd) continue
      // 只有当本段采样格里真有时刻落进该词窗口时才烧（否则滤镜白挂）
      if (!planned.some((t) => word.start <= t && t < word.end)) continue
      const hit: WordHit = { word: word.t, window: { start: word.start, end: word.end }, prefix: seg.words.slice(Math.max(0, i - 8), i).map((w) => w.t).join('') }
      const text = sanitizeDrawtextLabel(labelOfWord(hit))
      const last = out[out.length - 1]
      if (last !== undefined && last.text === text && Math.abs(last.to - word.start) < 1e-6) {
        out[out.length - 1] = { text, from: last.from, to: word.end }
        continue
      }
      out.push({ text, from: word.start, to: word.end })
      if (out.length >= 200) return out
    }
  }
  return out
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}
