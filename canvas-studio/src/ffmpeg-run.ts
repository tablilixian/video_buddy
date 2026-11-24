/**
 * Canvas Studio ffmpeg 运行基础设施（P8.4 抽出 / P9 复用）。
 *
 * 解析本机可用的 ffmpeg 可执行文件，并封装一次 ffmpeg 子进程调用（超时强杀、
 * 信号中断、stdout/stderr 收集）。video-style 与 compose 都复用同一套
 * 环境 / ffmpeg-static / PATH 解析顺序。
 *
 * 解析顺序（CV-201 起）：显式参数 → `FFMPEG_PATH` → **随包二进制**
 * （`<Resources>/ffmpeg/<platform>-<arch>/ffmpeg`，见 `bundledFfmpegCandidates`）
 * → ffmpeg-static 包内二进制（仅当二进制真实存在）→ PATH 上的系统 ffmpeg。
 *
 * 随包档是产品主路径：安装包在**打包期**把二进制放进 `Contents/Resources/ffmpeg/`
 * （Windows 为 `resources/ffmpeg/`），终端用户无需自装 ffmpeg。仓库根 .yarnrc.yml
 * 设了 enableScripts: false，ffmpeg-static 的 postinstall 二进制下载会被跳过，
 * 故那条档在开发态通常落空、自动回退系统 ffmpeg。全部落空时抛面向用户的错误。
 */
import { spawn } from 'node:child_process'
import { accessSync, constants as fsConstants } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { throwError } from './error-system.js'
import './errors/catalog.js'

/** 单段 ffmpeg 调用的默认超时（毫秒）。合成整体另有 120s 上限。 */
export const FFMPEG_TIMEOUT_MS = 120_000

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

/** 按 PATH 约定枚举候选可执行文件（win32 补 .exe）。 */
function pathCandidates(): string[] {
  const base = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  return (process.env.PATH ?? '')
    .split(process.platform === 'win32' ? ';' : ':')
    .filter((dir) => dir.length > 0)
    .map((dir) => join(dir, base))
}

/** 随包 ffmpeg 的目录键（与打包脚本 `build/ffmpeg/<key>/` 同名）。 */
export function bundledFfmpegKey(platform: string, arch: string): string {
  return `${platform}-${arch}`
}

/** 随包 ffmpeg 的定位输入（纯数据，便于单测注入）。 */
export interface BundledFfmpegLocator {
  /** 运行平台，如 `darwin` / `win32`。 */
  readonly platform: string
  /** 运行架构，如 `arm64` / `x64`（Rosetta 下为 x64，与随包目录一致）。 */
  readonly arch: string
  /** Electron 主进程的 `process.resourcesPath`；纯 Node 下不存在。 */
  readonly resourcesPath?: string | undefined
  /** 显式覆盖目录（`DSH_FFMPEG_DIR`）：其下同样按 `ffmpeg/<platform>-<arch>/` 布局。 */
  readonly overrideDir?: string | undefined
  /** 当前模块所在目录，用于向上寻找随包资源根。 */
  readonly moduleDir?: string | undefined
}

/** 向上收集祖先目录（含自身，最多 `depth` 级）。 */
function ancestorDirs(dir: string | undefined, depth: number): string[] {
  if (dir === undefined || dir.length === 0) return []
  const dirs: string[] = []
  let current = dir
  for (let level = 0; level <= depth; level += 1) {
    dirs.push(current)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return dirs
}

/**
 * 随包 ffmpeg 的候选路径（按优先级、去重）。纯函数：不读盘、不看全局状态。
 *
 * 候选根依次：显式覆盖目录 → Electron `resourcesPath` → 模块祖先目录。最后一档
 * 覆盖「代码不在 Electron 主进程、拿不到 `resourcesPath`」的场景——打包后模块位于
 * `<Resources>/app.asar.unpacked/node_modules/canvas-studio/lib/`，向上第三级正是
 * `<Resources>`，于是 `<Resources>/ffmpeg/<key>/ffmpeg` 仍能被命中。
 */
export function bundledFfmpegCandidates(locator: BundledFfmpegLocator): string[] {
  const binary = locator.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const key = bundledFfmpegKey(locator.platform, locator.arch)
  const roots: string[] = []
  if (locator.overrideDir !== undefined && locator.overrideDir.length > 0) {
    roots.push(locator.overrideDir)
  }
  if (locator.resourcesPath !== undefined && locator.resourcesPath.length > 0) {
    roots.push(locator.resourcesPath)
  }
  roots.push(...ancestorDirs(locator.moduleDir, 4))
  const candidates: string[] = []
  const seen = new Set<string>()
  for (const root of roots) {
    const candidate = join(root, 'ffmpeg', key, binary)
    if (seen.has(candidate)) continue
    seen.add(candidate)
    candidates.push(candidate)
  }
  return candidates
}

/** 当前模块所在目录；URL 解析失败时返回 `undefined`（跳过祖先探测）。 */
function currentModuleDir(): string | undefined {
  try {
    return dirname(fileURLToPath(import.meta.url))
  } catch {
    return undefined
  }
}

/** Electron 主进程的 `process.resourcesPath`；纯 Node 下为 `undefined`。 */
function readResourcesPath(): string | undefined {
  const value = (process as NodeJS.Process & { resourcesPath?: unknown }).resourcesPath
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * 解析本机可用的 ffmpeg 可执行路径：显式参数 → FFMPEG_PATH → 随包二进制 →
 * ffmpeg-static（仅当二进制真实存在）→ PATH。全部落空抛面向用户的错误。
 */
export function resolveFfmpegPath(explicit?: string): string {
  const candidates: string[] = []
  if (explicit !== undefined && explicit.length > 0) candidates.push(explicit)
  const envPath = process.env.FFMPEG_PATH
  if (envPath !== undefined && envPath.length > 0) candidates.push(envPath)
  candidates.push(...bundledFfmpegCandidates({
    platform: process.platform,
    arch: process.arch,
    resourcesPath: readResourcesPath(),
    overrideDir: process.env.DSH_FFMPEG_DIR,
    moduleDir: currentModuleDir(),
  }))
  try {
    // 动态解析避免硬依赖：包缺失/未构建二进制时静默跳过，不阻塞系统回退。
    const required = createRequire(import.meta.url)('ffmpeg-static') as unknown
    if (typeof required === 'string' && required.length > 0) candidates.push(required)
  } catch {
    /* ffmpeg-static 未安装则跳过 */
  }
  for (const candidate of [...candidates, ...pathCandidates()]) {
    if (isExecutableFile(candidate)) return candidate
  }
  throwError('CS-FFMPEG-001', { detail: '未找到可用的 ffmpeg：应用内置的 ffmpeg 组件缺失或被移除，请重新安装应用后重试。若你自行管理 ffmpeg，可设置环境变量 FFMPEG_PATH 指向可执行文件。' })
}

/** 一次 ffmpeg 调用的结果。 */
export interface FfmpegRunResult {
  code: number
  stdout: string
  stderr: string
}

/**
 * 运行一次 ffmpeg，收集 stdout/stderr；超时强杀并报错；`signal` 中断时以
 * `signal.reason` 拒绝（与上游 DOMException 语义一致）。
 */
export function runFfmpeg(
  ffmpegPath: string,
  args: readonly string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<FfmpegRunResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    // CR-019：settled 防重入——error 与 close 可能都触发（error 后 close 仍会
    // 派发），finish 只执行一次（清 timer / 解监听 / 回调）。
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = () => {
      child.kill('SIGKILL')
      finish(() => rejectPromise(signal?.reason ?? new DOMException('aborted', 'AbortError')))
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(() => rejectPromise(new Error(`ffmpeg 执行超时（${Math.round(timeoutMs / 1000)}s）`)))
    }, timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })
    // CR-020：stdout/stderr 累计上限（1MB）——进度日志再长也只留尾部有用信息，
    // 防单次转码输出无界占内存。
    const MAX_LOG_BYTES = 1 * 1024 * 1024
    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_LOG_BYTES) stdout += String(chunk).slice(0, MAX_LOG_BYTES - stdout.length)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_LOG_BYTES) stderr += String(chunk).slice(0, MAX_LOG_BYTES - stderr.length)
    })
    child.on('error', (cause) => {
      finish(() => rejectPromise(new Error(`ffmpeg 启动失败: ${cause instanceof Error ? cause.message : String(cause)}`)))
    })
    child.on('close', (code) => {
      finish(() => resolvePromise({ code: code ?? -1, stdout, stderr }))
    })
  })
}

/**
 * 从 `ffmpeg -i` 的 stderr 解析视频流分辨率与音频存在性。返回的尺寸为
 * `undefined` 表示未探测到视频流（调用方按错误/兜底处理）；`hasAudio` 反映
 * 是否出现 `Audio:` 流描述。
 */
export interface FfmpegStreamInfo {
  width?: number
  height?: number
  hasAudio: boolean
}

export function parseFfmpegStreams(stderr: string): FfmpegStreamInfo {
  // 视频流行可能带语言标签（如 `Stream #0:0(und): Video:`），逐行匹配更稳。
  const videoLine = stderr.split('\n').find((line) => /Video:/.test(line))
  const resolution = videoLine === undefined ? null : /(\d{2,5})x(\d{2,5})/u.exec(videoLine)
  const width = resolution === null ? undefined : Number(resolution[1])
  const height = resolution === null ? undefined : Number(resolution[2])
  const hasAudio = stderr.split('\n').some((line) => /Audio:/.test(line))
  const info: FfmpegStreamInfo = { hasAudio }
  if (width !== undefined) info.width = width
  if (height !== undefined) info.height = height
  return info
}

/**
 * 从 `ffmpeg -i` 的 stderr 里解析 `Duration: HH:MM:SS.frac` 为秒。
 * 解析失败返回 0（调用方按「未知时长」处理）。
 */
export function parseFfmpegDuration(stderr: string): number {
  const match = /Duration:\s*(\d+):(\d{2}):(\d{2})\.(\d+)/u.exec(stderr)
  if (match === null) return 0
  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  const fraction = Number(`0.${match[4]}`)
  return hours * 3600 + minutes * 60 + seconds + fraction
}

/**
 * CV-188：一次 `ffmpeg -i` 的探测结果 —— 时长 + 视频流分辨率。
 *
 * `duration` 为 0 / 尺寸字段缺失 = 未探到（调用方回退声明值），不区分失败原因。
 */
export interface MediaInfo {
  /** 时长（秒）；未探到为 `0`。 */
  duration: number
  /** 视频流宽度（px）；未探到为 `undefined`。 */
  width?: number
  height?: number
}

/**
 * 探测一个**本地媒体文件**的真实时长与分辨率，尽力而为。
 *
 * 时长（CV-140）：生成产物落盘后把「请求时长」换成真值。实测 H3 按时长与帧率
 * 量化输出（请求 5s → 5.167s = 124 帧 @24fps），请求值当真值会让下游的时长校验
 * 与音画对齐全部偏一帧量级。
 *
 * 分辨率（CV-188）：**同一个 stderr 里就有**（`parseFfmpegStreams` 早已在解析
 * 它，只是此前只给末帧抽取用）。视频侧的真实产物像素由**供应商**决定——Drama
 * 固定 0.4MP、fal 按档——所以「上游声明的像素」是一句会随后端行为静默失真的
 * 二手话。实测句号：`ffmpeg -i` 说多少就是多少，后端哪天变了也自动跟上。
 *
 * **绝不抛错**：ffmpeg 不可用（未安装 / 未设 FFMPEG_PATH）、文件不存在、格式
 * 不识别、探测超时——一律返回 `{ duration: 0 }`，由调用方按「未知」回退。
 * 生成主路径不能因为一个「顺带的探测」而失败。
 */
export async function probeMediaInfo(
  path: string,
  ffmpegPath?: string,
  signal?: AbortSignal,
): Promise<MediaInfo> {
  try {
    const resolved = resolveFfmpegPath(ffmpegPath)
    // `ffmpeg -i <file>` 无输出参数时必然非零退出，但 stderr 里带着 Duration 与 Stream 行。
    const probe = await runFfmpeg(resolved, ['-i', path], FFMPEG_TIMEOUT_MS, signal)
    const streams = parseFfmpegStreams(probe.stderr)
    return {
      duration: parseFfmpegDuration(probe.stderr),
      ...(streams.width !== undefined ? { width: streams.width } : {}),
      ...(streams.height !== undefined ? { height: streams.height } : {}),
    }
  } catch {
    return { duration: 0 }
  }
}

/** 只要时长时的薄封装（CV-140 既有调用点与测试共用同一实现，不另写一份探测）。 */
export async function probeMediaDuration(
  path: string,
  ffmpegPath?: string,
  signal?: AbortSignal,
): Promise<number> {
  return (await probeMediaInfo(path, ffmpegPath, signal)).duration
}

/**
 * 从 `ffmpeg -af ebur128` 的 stderr 解析综合响度 `I:  -15.3 LUFS`（解析纯函数，可单测）。
 * ebur128 汇总表里 `I:` 行出现多次（实时行 + Summary 行），取**最后一次**（Summary 是真值）。
 */
export function parseEbur128IntegratedLufs(stderr: string): number | undefined {
  const matches = [...stderr.matchAll(/^\s*I:\s+(-?\d+(?:\.\d+)?)\s+LUFS\s*$/gmu)]
  const last = matches[matches.length - 1]
  if (last === undefined) return undefined
  const value = Number(last[1])
  return Number.isFinite(value) ? value : undefined
}

/**
 * 从 `ffmpeg -af ebur128=peak=true` 的 stderr 解析**真峰**（True peak, dBTP）。
 *
 * 输出形状（ffmpeg 6/7 实测，2026-11-24 本机 `sine` + volume 样本）：
 *
 * ```
 *   True peak:
 *     Peak:      -27.1 dBFS
 * ```
 *
 * 三个坑：① 实时行里有 `TPK: -27.1 -27.1 dBFS`（每声道两个值），**不能**在全文里
 * 找第一个 `Peak:`/`TPK:`；② `LRA low: / LRA high:` 也在 Summary 里，但它们不是
 * `Peak:`；③ 静音时输出 `Peak: -inf dBFS`，`Number('-inf')` 为 NaN ⇒ 按未测得处理。
 * 因此锚定**最后一个 `True peak:` 段**，只在其后取 `Peak:` 行。
 */
export function parseEbur128TruePeakDbtp(stderr: string): number | undefined {
  const anchor = stderr.lastIndexOf('True peak:')
  if (anchor < 0) return undefined
  const match = /^\s*Peak:\s+(-?\d+(?:\.\d+)?)\s+dBFS\s*$/mu.exec(stderr.slice(anchor))
  if (match === null) return undefined
  const value = Number(match[1])
  return Number.isFinite(value) ? value : undefined
}

/** 一次 ebur128 解码能拿到的全部响度结论（缺字段 = 该项未测得，不是 0）。 */
export interface LoudnessProbeResult {
  /** 产物是否真有音轨（`ffmpeg -i` 的 `Audio:` 行）。无音轨时另两项必然缺省。 */
  hasAudio: boolean
  /** 综合响度（ITU-R BS.1770 integrated LUFS）。 */
  lufs?: number
  /** 真峰（dBTP；ffmpeg 报的是相对满刻度的 dBFS，数值口径与 dBTP 一致）。 */
  truePeakDbtp?: number
}

/**
 * 探测一个**本地媒体文件**的响度：有无音轨 + 综合 LUFS + 真峰。
 *
 * Q1 响度闸 / A1 交付闸的数据源：复刻 / 广告片场景里响度直接决定观感对齐（甜品复刻
 * 会话实测：成片 -15.3 LUFS vs 原片 -11.4，无人发现）；A1 另需真峰判削波（`-1.5 dBTP`
 * 上限，削波不可逆）。**绝不抛错**：ffmpeg 不可用 / 解码失败一律返回空结论（`hasAudio`
 * 也报 true —— 因为「测不到」不等于「没有」，别把环境问题判成废片），由调用方按
 * 「未测得」跳过。
 *
 * 为什么先单跑一次 `ffmpeg -i`：无音轨的产物跑 ebur128 会白解码一遍视频再报错；
 * `-i` 不解码、几十毫秒，先把「本来就没有音轨」这件事判掉。
 *
 * 成本：完整解码一遍音轨（15s 片 ≈ 亚秒级）。`peak=true` 比 `peak=none` 多一次真峰
 * 重采样，仍在同一遍解码里，不额外跑 ffmpeg。
 */
export async function probeLoudness(
  path: string,
  ffmpegPath?: string,
  signal?: AbortSignal,
): Promise<LoudnessProbeResult> {
  try {
    const resolved = resolveFfmpegPath(ffmpegPath)
    const head = await runFfmpeg(resolved, ['-i', path], FFMPEG_TIMEOUT_MS, signal)
    if (!parseFfmpegStreams(head.stderr).hasAudio) return { hasAudio: false }
    // `-vn` 跳过视频解码（只解码音轨）。
    const probe = await runFfmpeg(
      resolved,
      ['-i', path, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'],
      FFMPEG_TIMEOUT_MS,
      signal,
    )
    const lufs = parseEbur128IntegratedLufs(probe.stderr)
    const truePeakDbtp = parseEbur128TruePeakDbtp(probe.stderr)
    return {
      hasAudio: true,
      ...(lufs !== undefined ? { lufs } : {}),
      ...(truePeakDbtp !== undefined ? { truePeakDbtp } : {}),
    }
  } catch {
    return { hasAudio: true }
  }
}

/** 只要综合响度时的薄封装（既有调用点与测试共用同一实现，不另跑一遍 ffmpeg）。 */
export async function probeLoudnessLufs(
  path: string,
  ffmpegPath?: string,
  signal?: AbortSignal,
): Promise<number | undefined> {
  return (await probeLoudness(path, ffmpegPath, signal)).lufs
}
