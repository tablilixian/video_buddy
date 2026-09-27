/**
 * Host 侧音频裁切（BUG-002）。
 *
 * 用户会直接说「把这首 mp3 裁成 12–20 秒」——在本模块之前，agent 手里**没有任何**
 * 音频加工入口：`music_generation` 只能整段生成、`compose_video.bgmNodeId` 只能整段
 * 混入，而 ffmpeg 二进制（CV-201 已随包）与裁剪路径只存在于 Host 内部，模型既看不见
 * 也调不到 ⇒ 只能把 ffmpeg 路径告诉它、让它自己拼 shell 命令（BUG-002 的现场）。
 *
 * 这里把「裁一段」收成一个可单测的纯能力：入参是**项目资产文件名**（不是 URL、不是
 * 节点引用 —— 引用解析在 `host-tools.ts` 的 `resolveCutAudioSource`，与其它工具同一
 * 分层），出参是新资产文件。落画布节点由工具层负责（与 `compose_video` 同构：
 * 能力模块只管产物，节点与血缘归工具）。
 *
 * ## 两个刻意的选择
 *
 * 1. **重编码为 mp3，而不是 `-c copy`**：`-c copy` 的切点落在源文件的关键帧/帧边界
 *    上，mp3 帧约 26ms 尚可，但 wav/flac 源切到 aac/mp3 容器时 copy 根本不成立。
 *    统一 `libmp3lame` 重编码，切点精确、输出形态恒定（`<assetId>.mp3`），下游
 *    `bgmNodeId` / `audioRefs` 拿到的永远是同一种文件。随包 ffmpeg 显式
 *    `--enable-libmp3lame`（tessus 构建，实测 `-encoders` 在列），不存在编码器缺失。
 * 2. **终点超长就截到末尾 + warnings，起点越界才报错**：用户说「从第 10 秒裁到结尾」
 *    时 `end` 常被写成一个大于总长的估值，把它拦成报错是拿一个能自愈的输入去打断
 *    整次调用；而起点越界意味着「你要的这段根本不存在」，只能报错并给出可用区间。
 */
import { mkdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { classifyFile, MEDIA_KIND_LABEL } from './media-extension.js'
import { FFMPEG_TIMEOUT_MS, probeMediaDuration, resolveFfmpegPath, runFfmpeg } from './ffmpeg-run.js'
import type { ProjectRegistry } from './projects.js'
import { newAssetId } from './config.js'
import { throwError } from './error-system.js'
import './errors/catalog.js'

/** 裁剪产物的扩展名（与 `libmp3lame` 输出一致，见文件头理由 1）。 */
export const AUDIO_CUT_OUTPUT_EXT = 'mp3'

/**
 * 项目资产「纯文件名」的字符集 —— **单一事实来源**：`resolveSourcePath` 用它拒收
 * 路径穿越，`host-tools.resolveCutAudioSource` 也用它判断「这串到底是文件名还是
 * 一个没命中的引用」（否则中文节点标题找不到时会报「文件名不合法」，误导模型）。
 */
export const PLAIN_ASSET_NAME_RE = /^[A-Za-z0-9._-]+$/u

/** 秒值保留 3 位（凑 `-t` 参数与标题展示；音频切点精度到毫秒足够）。 */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

/** `cut_audio` 的入参（文件名已在工具层解析为项目资产名）。 */
export interface CutAudioInput {
  /** 项目 `assets/` 下的文件名（纯文件名，不是路径、不是 URL）。 */
  readonly file: string
  /** 起点，秒（含）。 */
  readonly start: number
  /** 终点，秒（不含）；超过源时长时截到末尾并给出 warnings。 */
  readonly end: number
}

/** 裁剪产物。 */
export interface CutAudioResult {
  /** 新资产的同源 URL。 */
  readonly url: string
  /** 新资产文件名（`<assetId>.mp3`）。 */
  readonly assetFile: string
  /** 片段真实时长（秒，落盘后 ffmpeg 实测；探测不可用时回退区间长度）。 */
  readonly duration: number
  /** 实际生效的起点（秒）。 */
  readonly start: number
  /** 实际生效的终点（秒；被截到末尾时不等于入参 end）。 */
  readonly end: number
  /** 非致命提示（如终点超出源时长已被截断）。非空时必须转告用户。 */
  readonly warnings?: readonly string[]
}

/**
 * 校验秒值入参：必须是有限数、非负。非法即抛（`start`/`end` 由 schema 声明为
 * number，但工具层不保证运行时类型 —— 模型把 `"12"` 这类串传进来是常见形态）。
 */
function requireSeconds(name: 'start' | 'end', value: unknown): number {
  const seconds = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(seconds)) {
    throwError('CS-USER-ERR', { message: `${name} 必须是数字（单位秒），实得 ${JSON.stringify(value)}`, detail: `${name}=${String(value)}` })
  }
  if (seconds < 0) {
    throwError('CS-USER-ERR', { message: `${name} 不能为负数（实得 ${seconds}s），裁切区间从 0 起算`, detail: `${name}=${seconds}` })
  }
  return seconds
}

/**
 * 把项目资产文件名解析成磁盘路径，并做三道校验：
 * ① 纯文件名（无路径分隔 / 无 `..`，与 `promoteAssetFile` 同一防穿越字符集）；
 * ② 扩展名在四类媒体白名单内、且属音频或视频（复用 `classifyFile`，同一规则一份实现）；
 * ③ 文件真实存在（早于 ffmpeg 报错，给出「找得到但读不到」与「根本不在」的区分）。
 *
 * 与 `waveform-host.resolveAudioAssetPath` 的差别：这里放行**视频**源（裁的是它的
 * 音轨，`-vn` 丢画面），而波形只画音频。故不复用那份白名单，改走 `classifyFile`。
 */
async function resolveSourcePath(registry: ProjectRegistry, projectId: string, file: string): Promise<string> {
  const name = file.trim()
  if (!PLAIN_ASSET_NAME_RE.test(name) || name.includes('..')) {
    throwError('CS-USER-ERR', { message: `音频文件名不合法：${file}（只接受项目资产的纯文件名，不含路径）`, detail: `invalid asset name: ${file}` })
  }
  const kind = classifyFile(name)
  if (kind === null || (kind !== 'audio' && kind !== 'video')) {
    const label = kind === null ? '未知类型' : `${MEDIA_KIND_LABEL[kind]}文件`
    throwError('CS-USER-ERR', { message: `只能裁切音频或视频文件（${label}：${name} 不在可裁范围）`, detail: `classified as ${String(kind)}` })
  }
  const project = (await registry.list()).find((entry) => entry.id === projectId)
  if (project === undefined) throwError('CS-PROJ-001', { id: projectId })
  const path = join(registry.assetsDir(projectId), name)
  const info = await stat(path).catch(() => null)
  if (info === null) {
    throwError('CS-USER-ERR', { message: `找不到音频文件 ${name}（它可能已被删除，请重新上传或重新生成）`, detail: `missing asset: ${path}` })
  }
  return path
}

/**
 * 把 `[start, end)` 区间从源文件裁成一个新的 mp3 资产。
 *
 * @param signal 中断信号（与 `runFfmpeg` 的 abort 语义对齐：拒绝原因 = `signal.reason`）。
 * @param ffmpegPath 显式 ffmpeg 路径（测试替身注入点；缺省走 CV-201 解析链）。
 */
export async function cutAudioSegment(
  registry: ProjectRegistry,
  projectId: string,
  input: CutAudioInput,
  signal?: AbortSignal,
  ffmpegPath?: string,
): Promise<CutAudioResult> {
  const start = requireSeconds('start', input.start)
  const end = requireSeconds('end', input.end)
  if (start >= end) {
    throwError('CS-USER-ERR', { message: `裁切区间无效：起点 ${start}s 必须小于终点 ${end}s（单位秒，左闭右开）`, detail: `start=${start} end=${end}` })
  }

  // 先解析 ffmpeg：二进制缺失时应在做任何探测之前失败（探测会吞掉 CS-FFMPEG-001
  // 返回 0，把「没有 ffmpeg」伪装成「时长未知」）。
  const ffmpeg = resolveFfmpegPath(ffmpegPath)
  const source = await resolveSourcePath(registry, projectId, input.file)

  const warnings: string[] = []
  const sourceDuration = await probeMediaDuration(source, ffmpeg, signal)
  if (sourceDuration > 0 && start >= sourceDuration) {
    throwError('CS-USER-ERR', {
      message: `起点 ${start}s 超出源文件总长（${sourceDuration.toFixed(1)}s）；可用区间是 0 ～ ${round3(sourceDuration)}s`,
      detail: `start=${start} sourceDuration=${sourceDuration}`,
    })
  }
  let effectiveEnd = end
  if (sourceDuration > 0 && end > sourceDuration) {
    effectiveEnd = sourceDuration
    warnings.push(`终点 ${end}s 超出源文件时长（${sourceDuration.toFixed(1)}s），已截到末尾`)
  }
  const length = round3(effectiveEnd - start)
  if (!(length > 0)) {
    throwError('CS-USER-ERR', { message: `裁切区间无效：起点 ${start}s 之后已无可裁内容`, detail: `start=${start} effectiveEnd=${effectiveEnd}` })
  }

  const directory = registry.assetsDir(projectId)
  await mkdir(directory, { recursive: true })
  const assetFile = `${newAssetId()}.${AUDIO_CUT_OUTPUT_EXT}`
  const target = join(directory, assetFile)

  const run = await runFfmpeg(ffmpeg, [
    '-hide_banner', '-v', 'error', '-y',
    // `-ss` 放在 `-i` 前：输入侧快速 seek（解码从切点开始），配合重编码切点仍然
    // 精确；`-t` 是时长语义，不受 `-ss` 是否重置时间轴影响，比 `-to` 少一个坑。
    '-ss', String(start),
    '-i', source,
    '-t', String(length),
    '-vn',
    '-map', '0:a:0',
    '-c:a', 'libmp3lame',
    '-q:a', '2',
    target,
  ], FFMPEG_TIMEOUT_MS, signal)

  if (run.code !== 0) {
    // 半成品不留在盘上（与 compose 的「不落 export-* 半成品」同一不变式）。
    await rm(target, { force: true }).catch(() => undefined)
    const detail = run.stderr.slice(-400)
    const noAudio = /matches no streams|does not contain any stream|Stream map '0:a:0'/u.test(run.stderr)
    throwError('CS-USER-ERR', {
      message: noAudio
        ? '裁切失败：源文件没有可裁的音轨（视频需带音轨）'
        : `音频裁切失败（ffmpeg 退出码 ${run.code}）：${detail.slice(-200) || '无输出'}`,
      detail: `ffmpeg exit ${run.code}: ${detail}`,
    })
  }

  const info = await stat(target).catch(() => null)
  if (info === null || info.size === 0) {
    await rm(target, { force: true }).catch(() => undefined)
    throwError('CS-USER-ERR', { message: '裁切失败：没有产出音频文件（源文件可能损坏或不含可解码音轨）', detail: `empty output: ${target}` })
  }

  const probed = await probeMediaDuration(target, ffmpeg, signal)
  const duration = probed > 0 ? round3(probed) : length
  return {
    url: `/canvas-studio/assets/${projectId}/${assetFile}`,
    assetFile,
    duration,
    start: round3(start),
    end: round3(effectiveEnd),
    ...(warnings.length > 0 ? { warnings } : {}),
  }
}
