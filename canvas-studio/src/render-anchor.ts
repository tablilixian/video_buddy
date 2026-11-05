/**
 * 出片锚点（骨架优先出片 · P0）。
 *
 * ## 它解决什么
 *
 * 2026-11-05 的真机会话跑了 3h37m：故事板落地、8 段旁白、BGM、数据源全都齐了，
 * 唯独卡在 `build/manifest.json` 这一个文件上，4 个 turn 里 `render_composition`
 * 一次没跑。中间压了 8 次上下文，摘要从 8,886 膨胀到 29,420 字符 —— 模型不信任
 * 摘要，回去重读源码，再把整片 1326 帧重排一遍，循环直到输出预算打满。
 *
 * 根因不是能力，是**没有可回退的落点**：每次压缩后模型都从零推演。
 *
 * 所以这里把「当前最好的一版」落成磁盘上的两份产物：
 *  - `build/PROGRESS.md`：人读 + 模型读的唯一状态源（当前成片 / 版本时间线 / 下一步）；
 *  - `build/versions/vN.json`：manifest 快照（压缩后要回退，读它，不用重推）。
 *
 * 关键取舍：**由宿主写，不靠模型自觉**。模型可以忘，宿主不会 —— 这也正是「记忆
 * 层不解决问题，因为它本身是失真的」这句判断的落地方式。
 *
 * ## 边界
 *
 * - 只读返回值里已有的事实（url / 时长 / 像素 / 轨数），**不推断、不补全**。
 * - 写盘失败不阻断渲染：锚点是辅助设施，不能让成片陪葬（调用方 try/catch）。
 * - `probe` / `spotFrames` **不写** —— 探针与静帧不是成片，写进去会污染锚点。
 * - 模型手工编辑 PROGRESS.md 的两段（下一步 / 未决）在重写时原样保留。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { M1_DEADLINE_MS } from './milestone-clock.js'

/** 锚点版本目录 / 文件（相对项目根）。 */
const BUILD_DIR = 'build'
const VERSIONS_DIR = 'versions'
const STATE_FILE = 'anchor-state.json'
const PROGRESS_FILE = 'PROGRESS.md'

/**
 * M1 硬线（分钟）：故事板落地后多久必须有一条 draft 成片。
 *
 * 数值唯一源在 `milestone-clock.ts`（客户端那行验收件用的是毫秒口径 —— 两边各写
 * 一份 20，迟早出现「工具返回说 12min、面板显示 6:36 剩」的自相矛盾）。
 */
export const M1_DEADLINE_MINUTES = M1_DEADLINE_MS / 60_000

/** 一版成片的帧窗指纹（只取字幕类轨：它们就是「段边界」）。 */
export interface AnchorSegment {
  id: string
  startFrame: number
  endFrame: number
}

/** 一版成片的机器事实（全部来自工具返回值，零推断）。 */
export interface AnchorVersion {
  version: number
  at: number
  quality: string
  durationSec: number
  width?: number
  height?: number
  trackCount: number
  segments: AnchorSegment[]
  sampledFrames: number[]
}

/** `build/anchor-state.json` 的形态。 */
export interface AnchorState {
  title?: string
  versions: AnchorVersion[]
  /** 模型手写的「下一步唯一动作」（重写 PROGRESS 时原样保留）。 */
  nextAction?: string
  /** 模型手写的「已知未决」。 */
  openIssues?: string
}

export interface AnchorWriteInput {
  projectDir: string
  manifest: unknown
  quality: string
  durationSec: number
  width?: number
  height?: number
  trackCount: number
  sampledFrames?: number[]
  title?: string
  now?: number
}

export interface AnchorWriteResult {
  version: number
  progressPath: string
  statePath: string
  trackCount: number
  /** 给工具返回用的一行摘要。 */
  summary: string
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * 帧窗指纹：字幕类轨的 `[startFrame, startFrame+duration)` 列表。
 *
 * 为什么只取字幕：整片骨架里「段」不单独存在（manifest 只有 tracks），而字幕轨
 * 恰好是**一段一句**的载体。用它当段边界，等于「句子在哪儿切，段就在哪儿切」，
 * 后续加视觉/动效都不该动它 —— 一旦变了就是重排，脚本层的断言据此报错。
 */
export function segmentsOf(manifest: unknown): AnchorSegment[] {
  const tracks = asRecord(manifest)?.tracks
  if (!Array.isArray(tracks)) return []
  const rows = tracks.map(asRecord).filter((t): t is Record<string, unknown> => t !== undefined)
  const captions = rows.filter((t) => t.type === 'caption')
  const picked = captions.length > 0 ? captions : rows.filter((t) => t.type === 'textCard')
  return picked
    .map((t) => {
      const start = num(t.startFrame)
      return {
        id: str(t.id) ?? `t${String(start)}`,
        startFrame: start,
        endFrame: start + num(t.durationInFrames),
      }
    })
    .sort((a, b) => a.startFrame - b.startFrame)
}

/** 下一版号：读 `build/versions/` 里已存在的 `vN.json` 取最大 +1。 */
export function nextAnchorVersion(versionsDir: string): number {
  if (!existsSync(versionsDir)) return 1
  let max = 0
  for (const name of readdirSync(versionsDir)) {
    const hit = /^v(\d+)\.json$/.exec(name)
    if (hit !== null) max = Math.max(max, Number(hit[1]))
  }
  return max + 1
}

/** 读机器状态；文件缺失 / 损坏一律回落空状态（锚点是辅助设施，绝不因此报错）。 */
export function readAnchorState(projectDir: string): AnchorState {
  const path = join(projectDir, BUILD_DIR, STATE_FILE)
  if (!existsSync(path)) return { versions: [] }
  try {
    const parsed = asRecord(JSON.parse(readFileSync(path, 'utf8')))
    if (parsed === undefined) return { versions: [] }
    const versions = Array.isArray(parsed.versions)
      ? parsed.versions.map(asRecord)
        .filter((v): v is Record<string, unknown> => v !== undefined)
        .map((v) => ({
          version: num(v.version),
          at: num(v.at),
          quality: str(v.quality) ?? 'standard',
          durationSec: num(v.durationSec),
          ...(typeof v.width === 'number' ? { width: v.width } : {}),
          ...(typeof v.height === 'number' ? { height: v.height } : {}),
          trackCount: num(v.trackCount),
          segments: Array.isArray(v.segments)
            ? v.segments.map(asRecord)
              .filter((s): s is Record<string, unknown> => s !== undefined)
              .map((s) => ({ id: str(s.id) ?? '', startFrame: num(s.startFrame), endFrame: num(s.endFrame) }))
            : [],
          sampledFrames: Array.isArray(v.sampledFrames) ? v.sampledFrames.filter((n): n is number => typeof n === 'number') : [],
        }))
        .filter((v) => v.version > 0)
        .sort((a, b) => a.version - b.version)
      : []
    return {
      versions,
      ...(str(parsed.title) === undefined ? {} : { title: str(parsed.title) as string }),
      ...(typeof parsed.nextAction === 'string' ? { nextAction: parsed.nextAction } : {}),
      ...(typeof parsed.openIssues === 'string' ? { openIssues: parsed.openIssues } : {}),
    }
  } catch {
    return { versions: [] }
  }
}

/**
 * 从已有 PROGRESS.md 里取回模型手写的两段。
 *
 * 宿主每次渲染都整篇重写这个文件；不先取回就等于**把模型的计划抹掉**，
 * 而那两段恰恰是「压缩后从哪儿接着干」的答案。
 */
export function readProgressSections(markdown: string): { nextAction?: string; openIssues?: string } {
  const grab = (heading: string): string | undefined => {
    const re = new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, 'm')
    const hit = re.exec(markdown)
    const body = hit?.[1]?.trim()
    return body === undefined || body === '' ? undefined : body
  }
  return {
    ...(grab('下一步唯一动作') === undefined ? {} : { nextAction: grab('下一步唯一动作') as string }),
    ...(grab('已知未决') === undefined ? {} : { openIssues: grab('已知未决') as string }),
  }
}

function clockText(at: number): string {
  const d = new Date(at)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 版本一行：`v3 · 14:21 · draft · 45.00s · 78 轨`。 */
function versionLine(v: AnchorVersion): string {
  const size = v.width === undefined || v.height === undefined ? '' : ` · ${String(v.width)}×${String(v.height)}`
  return `- v${String(v.version)} · ${clockText(v.at)} · ${v.quality} · ${v.durationSec.toFixed(2)}s${size} · ${String(v.trackCount)} 轨`
}

/** 渲染 PROGRESS.md（纯函数，便于单测）。 */
export function renderProgressMarkdown(state: AnchorState, now: number): string {
  const best = state.versions.at(-1)
  const title = state.title ?? '（未命名）'
  const lines: string[] = [
    `# 进度锚 · ${title}`,
    `更新：${new Date(now).toLocaleString('zh-CN', { hour12: false })}`,
    '',
    '## 当前最佳成片',
  ]
  if (best === undefined) {
    lines.push('- **尚无成片**：还没渲过一版（probe / spotFrames 不算成片，不会写进这里）')
  } else {
    lines.push(versionLine(best))
    lines.push(`- manifest 快照：${BUILD_DIR}/${VERSIONS_DIR}/v${String(best.version)}.json`)
    if (best.sampledFrames.length > 0) {
      lines.push(`- 本版抽帧：${best.sampledFrames.map(String).join(', ')}`)
    }
    lines.push('- **要接着改，先读上面这个快照，不要重推整片**')
  }
  lines.push('', '## 版本时间线（最近 6 版）')
  if (state.versions.length === 0) {
    lines.push('- 空')
  } else {
    for (const v of state.versions.slice(-6)) lines.push(versionLine(v))
  }
  lines.push('', '## 下一步唯一动作')
  lines.push(state.nextAction ?? '- （尚未填写：写完本轮就该在这里留一条，下一轮只做这一条）')
  lines.push('', '## 已知未决')
  lines.push(state.openIssues ?? '- （无记录）')
  return `${lines.join('\n')}\n`
}

/**
 * 落一版锚点：写 `versions/vN.json` + 重写 `PROGRESS.md`。
 *
 * 调用方只在「真成片」时调用（非 probe、非 spot）。返回值里的 `summary` 直接进
 * 工具返回文本 —— 让模型每渲一次就看见「现在最好的是第几版」，这是压缩后不用
 * 重新推演的最小提示。
 */
export function writeRenderAnchor(input: AnchorWriteInput): AnchorWriteResult {
  const now = input.now ?? Date.now()
  const buildDir = join(input.projectDir, BUILD_DIR)
  const versionsDir = join(buildDir, VERSIONS_DIR)
  mkdirSync(versionsDir, { recursive: true })
  const version = nextAnchorVersion(versionsDir)
  const record: AnchorVersion = {
    version,
    at: now,
    quality: input.quality,
    durationSec: Number.isFinite(input.durationSec) ? Math.max(0, input.durationSec) : 0,
    ...(input.width === undefined ? {} : { width: input.width }),
    ...(input.height === undefined ? {} : { height: input.height }),
    trackCount: input.trackCount,
    segments: segmentsOf(input.manifest),
    sampledFrames: (input.sampledFrames ?? []).filter((n) => Number.isFinite(n)),
  }
  const statePath = join(buildDir, STATE_FILE)
  const previous = readAnchorState(input.projectDir)
  const progressPath = join(buildDir, PROGRESS_FILE)
  let nextAction = previous.nextAction
  let openIssues = previous.openIssues
  if (existsSync(progressPath)) {
    const kept = readProgressSections(readFileSync(progressPath, 'utf8'))
    if (kept.nextAction !== undefined) nextAction = kept.nextAction
    if (kept.openIssues !== undefined) openIssues = kept.openIssues
  }
  const state: AnchorState = {
    ...(input.title === undefined ? (previous.title === undefined ? {} : { title: previous.title }) : { title: input.title }),
    versions: [...previous.versions.filter((v) => v.version !== version), record].sort((a, b) => a.version - b.version),
    ...(nextAction === undefined ? {} : { nextAction }),
    ...(openIssues === undefined ? {} : { openIssues }),
  }
  writeFileSync(join(versionsDir, `v${String(version)}.json`), JSON.stringify(input.manifest, null, 2), 'utf8')
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  writeFileSync(progressPath, renderProgressMarkdown(state, now), 'utf8')
  return {
    version,
    progressPath,
    statePath,
    trackCount: record.trackCount,
    summary: `锚点 v${String(version)} · ${record.durationSec.toFixed(2)}s · ${String(record.trackCount)} 轨 · ${BUILD_DIR}/${PROGRESS_FILE}`,
  }
}

/** 时钟输入：全部来自 registry（landedAt / firstDraftAt）与锚点状态。 */
export interface MilestoneClockInput {
  landedAt?: number
  firstDraftAt?: number
  now: number
  best?: AnchorVersion
}

/**
 * 里程碑时钟一行（每次 canvas 工具返回都追加）。
 *
 * 为什么要「每次工具返回都出现」：真机事故里模型 205 步全在读源码，一次渲染都没
 * 发起 —— 只挂在渲染返回上的提示，正好在**最需要它的时刻**看不见。挂在所有工具
 * 上，它才是持续可见的进度条。
 *
 * 老项目没有 `landedAt`（该字段是本批新增）时返回空串：不给存量项目凭空造红字。
 */
export function formatMilestoneClock(input: MilestoneClockInput): string {
  if (input.landedAt === undefined || !Number.isFinite(input.landedAt) || input.landedAt <= 0) return ''
  const elapsedMin = Math.max(0, Math.floor((input.now - input.landedAt) / 60_000))
  const best = input.best
  if (best !== undefined) {
    const firstMin = input.firstDraftAt === undefined || !Number.isFinite(input.firstDraftAt)
      ? null
      : Math.max(0, Math.round((input.firstDraftAt - input.landedAt) / 60_000))
    const firstText = firstMin === null ? '首片时刻未记' : `首片 T+${String(firstMin)}min`
    return `⏱ M1 已达成（${firstText}）· 当前最佳 v${String(best.version)} · ${best.durationSec.toFixed(2)}s · ${String(best.trackCount)} 轨`
  }
  const remaining = M1_DEADLINE_MINUTES - elapsedMin
  if (remaining > 0) {
    return `⏱ M1 剩余 ${String(remaining)}min（T+${String(elapsedMin)}min）· **尚无成片** —— 先出片再优化`
  }
  return `⏱ **已超 M1 硬线**（T+${String(elapsedMin)}min 仍无成片）：停止美化与读源码，立刻 `
    + '`scaffold_manifest` → 写 `build/manifest.json` → `render_composition({quality:"draft"})`'
}
