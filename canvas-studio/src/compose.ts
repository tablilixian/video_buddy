/**
 * Canvas Studio P9.2 成片合成路由（Host 侧）。
 *
 * 收集画布上的分镜视频片段（clip）→ 逐段用 ffmpeg 统一分辨率/帧率转码 →
 * concat demuxer 拼接 → 可选 BGM `amix` 混音 → 落项目 assets 根目录
 * `export-<uuid>.mp4`（兼容现有两段式资产路由 `<projectId>/<file>`）。
 *
 * 所有 ffmpeg 解析/执行复用 `ffmpeg-run`；纯函数（clip 收集、参数构造、
 * concat 清单、分辨率解析）直接由单测断言，端到端用假 ffmpeg 替身覆盖。
 */
import { mkdtemp, writeFile, access, rm, mkdir, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProjectRegistry } from './projects.js'
import type { StudioAudioComposition, StudioCanvasNode } from './contracts/canvas.js'
import { newAssetId } from './config.js'
import { applySupersede, isActiveShot } from './shot-versions.js'
import { frameSizeOf, DEFAULT_NODE_SIZE } from './canvas-aspect.js'

/** 成片节点缺分辨率时的回退画布显示尺寸（横屏占位，媒体加载后由框比例校正兜底）。
 *  C10：改取统一出口 —— 它是**节点框**尺寸（画面 + 镜头条 chrome），
 *  与 project-store / generate / video-frames 同源。 */
const COMPOSED_FALLBACK_SIZE = { ...DEFAULT_NODE_SIZE }
import { resolveFfmpegPath, runFfmpeg, parseFfmpegStreams, parseFfmpegDuration, FFMPEG_TIMEOUT_MS } from './ffmpeg-run.js'

/** 合成整体超时上限（毫秒）：本地拼接几十秒视频应远小于此，超时报中文错误。 */
const COMPOSE_TIMEOUT_MS = 120_000
/** 统一转码目标帧率。 */
const TARGET_FPS = 25
/** BGM 单轨音量（0–1）：成片只有 BGM 时（多镜拼接，无 amix、无归一化）。 */
const BGM_VOLUME = 0.8
/**
 * CV-141：单镜「环境声 + BGM」叠混时的 BGM 音量。
 *
 * 混音分支已改 `amix=normalize=0`（线性求和，不再把每一路各乘 0.5 / −6dB，实测
 * 单路 −33.12dB → 默认归一化输出 −36.99dB、`normalize=0` 为 −30.97dB）。线性
 * 求和下环境声留在前景、BGM 只作铺底，否则两路相加会削顶。
 */
const BGM_MIX_VOLUME = 0.35
/**
 * CV-138：BGM 时长守卫的容差（秒）。差额不超过它视为「等长」（探测本身有毫秒级
 * 抖动，不值得为此报错）。
 */
export const BGM_SHORTFALL_TOLERANCE_SEC = 0.05
/**
 * v1 中性默认调色（统一 eq 滤镜，治各镜色调漂移）：轻微提对比 + 饱和归一，
 * 所有片段应用同一滤镜链，把逐镜生成的色调差异拉到同一基线。传 false 关闭，
 * 传字符串覆盖本预设（见 ComposeOptions.colorGrade）。
 */
const DEFAULT_COLOR_GRADE = 'eq=contrast=1.03:saturation=1.02'
/** BGM 淡入淡出时长（秒）。 */
const BGM_FADE_SEC = 1

/** 成片合成结果（返回给客户端落画布节点）。 */
export interface ComposeResult {
  /** 同源资产 URL（webServer 托管）。 */
  url: string
  /** 合成后成片时长（秒；探测失败为 0）。 */
  duration: number
  /** 合成后成片分辨率宽（像素；探测失败为 undefined）。 */
  width?: number
  /** 合成后成片分辨率高（像素；探测失败为 undefined）。 */
  height?: number
  /**
   * CV-143：成片音轨构成。让验收一眼看出环境声有没有被丢掉、BGM 有没有混进去。
   */
  audioComposition: StudioAudioComposition
  /**
   * CV-138 / CV-141：需要让用户与 agent 知道的降级说明（探测失败回退、
   * 多镜无 BGM 导致成片无声等）。空数组不写入结果。
   */
  warnings?: string[]
}

/** 合成可选覆盖项（测试注入 / 高级用法）。 */
export interface ComposeOptions {
  /** 显式指定 ffmpeg 可执行文件路径。 */
  ffmpegPath?: string
  /** 统一转码目标帧率（默认 25）。 */
  fps?: number
  /** 覆盖输出文件名（默认 export-<uuid>.mp4）。 */
  outputName?: string
  /**
   * 统一调色预设（ffmpeg 滤镜串，如 `eq=contrast=1.02:saturation=1.02`）。
   * - 缺省：应用中性默认预设（DEFAULT_COLOR_GRADE），治各镜色调漂移；
   * - `false`：关闭调色 pass（片段已色调一致时可用）；
   * - 字符串：覆盖默认预设。
   */
  colorGrade?: string | false
}

/** 单个分镜片段的输入描述（用于转码阶段）。 */
export interface ComposeClip {
  id: string
  /** 同源资产 URL（/canvas-studio/assets/<projectId>/<file>）。 */
  url: string
  /** 本地绝对文件路径。 */
  inputPath: string
  /** 该片段是否含音轨（决定转码编码参数）。 */
  hasAudio: boolean
  /** CV-142：下当时的**请求**时长（秒），用于与成片真值对照出时长漂移。 */
  declaredDuration?: number
}

/**
 * 将画布节点同源 URL 反查为本地资产文件绝对路径。
 * URL 形如 `/canvas-studio/assets/<projectId>/<file>`，资产目录由 registry
 * 提供；返回 `join(assetsDir, file)`。
 */
export function urlToAssetPath(assetsDir: string, url: string): string {
  const parts = url.split('/').filter(Boolean)
  const idx = parts.indexOf('assets')
  const file = idx >= 0 ? parts[idx + 2] : parts.at(-1)
  return join(assetsDir, file ?? url.split('/').at(-1) ?? '')
}

/**
 * 从画布节点收集合成所需的视频 clip（纯函数）。
 * - 仅接受 kind=video 的节点；
 * - clipIds 中缺失/非视频/重复 id 一律跳过；
 * - 返回命中的节点与缺失的 id 列表（缺失由调用方面向用户报「片段文件不存在」）。
 */
export function collectClips(
  nodes: readonly StudioCanvasNode[],
  clipIds: readonly string[],
): { clips: StudioCanvasNode[]; missingIds: string[] } {
  const byId = new Map(nodes.map((node) => [node.id, node] as const))
  const clips: StudioCanvasNode[] = []
  const missingIds: string[] = []
  const seen = new Set<string>()
  for (const id of clipIds) {
    if (seen.has(id)) continue
    seen.add(id)
    const node = byId.get(id)
    if (node === undefined || node.kind !== 'video' || node.url === undefined) {
      missingIds.push(id)
      continue
    }
    clips.push(node)
  }
  return { clips, missingIds }
}

/** 构造 concat demuxer 清单内容（纯函数）：每行 `file '<绝对路径>'`。 */
export function buildConcatList(paths: readonly string[]): string {
  return paths.map((path) => `file '${path}'`).join('\n') + '\n'
}

/** 统一转码参数（纯函数）。无音轨加 `-an`，有音轨重新编码为 aac。
 * `colorGrade` 非空时在 vf 末尾追加统一调色滤镜（治各镜色调漂移）。 */
export function buildTranscodeArgs(
  input: string,
  output: string,
  width: number,
  height: number,
  fps: number,
  hasAudio: boolean,
  colorGrade?: string,
): string[] {
  // CR-022：等比缩放 + 黑边补足，避免画幅不一致的片段被非等比拉伸变形。
  // `force_original_aspect_ratio=decrease` 保持纵横比缩放到 WxH 内，
  // 再 `pad` 居中补到目标画幅，保证 concat 时所有片段同尺寸可拼接。
  // C5：末尾追加统一调色（eq 等），各镜应用同一滤镜链拉到同一色调基线。
  const gradeVf = colorGrade ? `,${colorGrade}` : ''
  const vf = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps}${gradeVf}`
  return [
    '-i', input,
    '-vf', vf,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    ...(hasAudio ? ['-c:a', 'aac'] : ['-an']),
    '-y', output,
  ]
}

/** concat 拼接参数（纯函数）。 */
export function buildConcatArgs(concatListPath: string, output: string): string[] {
  return ['-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', '-y', output]
}

/**
 * 构造 BGM 淡入淡出滤镜串（纯函数）。时长不足一个淡入周期时只做淡入。
 * 返回空串表示不做任何淡化（如时长未知）。
 *
 * ⚠️ CV-138：传入的**不是 BGM 自身时长，而是淡化锚点**（= `fadeAnchorOf(bgm, 成片)`）。
 * 此前直接按 BGM 时长算淡出起点，BGM 长于成片时淡出区间整个落在片外——成片结尾
 * 变成硬切，而「BGM 比成片长」恰恰是最可能的默认路径。
 */
export function buildBgmFade(duration: number): string {
  if (!Number.isFinite(duration) || duration <= 0) return ''
  const fadeIn = `afade=t=in:st=0:d=${BGM_FADE_SEC}`
  const fadeOut = duration > BGM_FADE_SEC
    ? `,afade=t=out:st=${(duration - BGM_FADE_SEC).toFixed(3)}:d=${BGM_FADE_SEC}`
    : ''
  return `,${fadeIn}${fadeOut}`
}

/**
 * CV-138：淡出锚点——取 BGM 与成片真值中的较小者（这就是「听着该收尾」的时刻）。
 * 两者都未知（≤0 / 非有限）时返回 0，`buildBgmFade` 会据此不加任何淡化。
 */
export function fadeAnchorOf(bgmDuration: number, filmDuration: number): number {
  const known = [bgmDuration, filmDuration].filter((value) => Number.isFinite(value) && value > 0)
  return known.length === 0 ? 0 : Math.min(...known)
}

/**
 * CV-138：BGM 时长守卫（纯函数）。BGM 短于成片时返回中文报错文案，够长或无法
 * 判定（任一时长未知）时返回 `null`。
 *
 * 为什么报错而不是自动循环/拉伸：拉伸会变调，循环会在非节拍点接缝——两者都是
 * 「听得出错」的降级。报错让人重新生成一段够长的，比悄悄出错好。
 */
export function bgmShortfallMessage(bgmDuration: number, filmDuration: number): string | null {
  // 无法判定时不报错（调用方会降级并留 warning），避免把「探测失败」当成「BGM 太短」。
  if (!(filmDuration > 0) || !(bgmDuration > 0)) return null
  const shortfall = filmDuration - bgmDuration
  // 浮点容差：两个时长都来自 ffprobe 的小数解析（如 15.5 − 15.45 在二进制下差 7e-16），
  // 恰好在阈值上时不该因为浮点误差报错。
  if (shortfall <= BGM_SHORTFALL_TOLERANCE_SEC + 1e-6) return null
  return `BGM 比成片短 ${shortfall.toFixed(3)} 秒（成片 ${filmDuration.toFixed(3)}s，BGM ${bgmDuration.toFixed(3)}s）。`
    + `请把 BGM 时长提高到 ≥${filmDuration.toFixed(3)}s（建议 ${Math.ceil(filmDuration + 0.5)}s）后重新合成。`
}

/**
 * BGM 混音参数（纯函数）。
 *
 * - `hasConcatAudio = true`（**单镜整出**，保留着原生环境声）：与 BGM 做
 *   `amix=inputs=2:duration=first:normalize=0`——线性求和（CV-141：默认
 *   `normalize=1` 会把每一路各乘 0.5，两条声音一起被压暗），BGM 走
 *   `BGM_MIX_VOLUME` 只作铺底，环境声留在前景。
 * - `hasConcatAudio = false`（**多镜拼接**，原生音轨已丢）：直接把 BGM 作为
 *   成片音轨，走 `BGM_VOLUME`（该分支无 amix、无归一化，无需补偿）。
 *
 * 两种情形 BGM 都过 `buildBgmFade` 淡入淡出（C5：BGM 单轨贯穿 + 头尾不突兀），
 * 锚点取 `fadeAnchorOf(bgm, film)`（CV-138）。输出时长用 `-t <成片真值>` 而不是
 * `-shortest`——后者在单轨分支会按 BGM 长度把画面裁掉（6s 画面 + 2s BGM →
 * 2.000s，`exit=0` 且一句报错都没有）；真值不可得时退回 `-shortest`。
 */
export function buildAmixArgs(
  concatOutput: string,
  bgmInput: string,
  output: string,
  hasConcatAudio: boolean,
  bgmDuration: number = 0,
  filmDuration: number = 0,
): string[] {
  const fade = buildBgmFade(fadeAnchorOf(bgmDuration, filmDuration))
  const bgmVolume = hasConcatAudio ? BGM_MIX_VOLUME : BGM_VOLUME
  const bgmChain = `[1:a]volume=${bgmVolume}${fade}[bgm]`
  const durationArgs = filmDuration > 0 ? ['-t', filmDuration.toFixed(3)] : ['-shortest']
  if (hasConcatAudio) {
    return [
      '-i', concatOutput,
      '-i', bgmInput,
      '-filter_complex',
      `${bgmChain};[0:a][bgm]amix=inputs=2:duration=first:normalize=0[out]`,
      '-map', '0:v',
      '-map', '[out]',
      '-c:v', 'copy',
      '-c:a', 'aac',
      ...durationArgs,
      '-y', output,
    ]
  }
  return [
    '-i', concatOutput,
    '-i', bgmInput,
    '-filter_complex',
    bgmChain,
    '-map', '0:v',
    '-map', '[bgm]',
    '-c:v', 'copy',
    '-c:a', 'aac',
    ...durationArgs,
    '-y', output,
  ]
}

/**
 * CV-142：时长漂移告警阈值（秒，约 6 帧 @24fps）。
 *
 * 取值理由：单镜的帧量化偏差在 0.167s 量级（请求 5s → 5.167s），不值得每次都打扰；
 * 而多镜累计会线性放大（3 镜 → 0.5s），那正是「BGM 按声明值生成就会短」的分野，
 * 必须报出来。0.25s 正好把两者分开。
 */
export const TIMELINE_DRIFT_TOLERANCE_SEC = 0.25

/** CV-142：结构化时间轴校验的输入。 */
export interface TimelineAuditInput {
  /** 分镜卡声明时长之和（秒；无分镜卡或未解析出数字时为 0）。 */
  storyboardDeclared: number
  /** 本次实际纳入片段的**请求**时长之和（秒）。 */
  clipDeclared: number
  /** 成片真值（秒；探测失败为 0）。 */
  filmDuration: number
  /** 项目目标总时长（秒，可选；项目创建时锁定）。 */
  targetDuration?: number
}

/**
 * CV-142：结构化时间轴校验（纯函数）——把「分镜表声明 / 实际生成请求 / 成片真值 /
 * 目标总时长」四个数互相对照，返回需要提醒的漂移说明（空数组 = 对齐）。
 *
 * 为什么值得做：**时长漂移此前从不显形**。分镜表写「5s」，agent 可能传
 * `duration=8`；请求 5s 经 H3 按帧率量化又变成 5.167s。用户直到听见音乐与画面对
 * 不上才知道出事。这里让它在合成那一刻就变成一句可读的提示。
 *
 * 三组对照按「危害从近到远」排列：
 * 1. **请求 vs 成片真值**——帧量化漂移，直接决定「BGM 该生成多长」（最近）；
 * 2. **分镜声明 vs 实际请求**——agent 没照分镜表传参（工程层面的不一致）；
 * 3. **成片真值 vs 项目目标总时长**——整体偏离立项规格。
 */
export function auditTimeline(input: TimelineAuditInput): string[] {
  const tolerance = TIMELINE_DRIFT_TOLERANCE_SEC
  const notices: string[] = []
  const { storyboardDeclared, clipDeclared, filmDuration, targetDuration } = input

  if (clipDeclared > 0 && filmDuration > 0 && Math.abs(filmDuration - clipDeclared) > tolerance) {
    notices.push(
      `逐镜请求时长合计 ${clipDeclared}s，成片真值 ${filmDuration.toFixed(3)}s（相差 ${(filmDuration - clipDeclared).toFixed(3)}s）——`
      + 'H3 按帧率量化输出，成片会比请求略长；BGM 请按**成片真值**生成，不要按请求值。',
    )
  }

  if (storyboardDeclared > 0 && clipDeclared > 0 && Math.abs(clipDeclared - storyboardDeclared) > tolerance) {
    notices.push(
      `分镜表声明时长合计 ${storyboardDeclared}s，但实际生成用了 ${clipDeclared}s（相差 ${(clipDeclared - storyboardDeclared).toFixed(3)}s）——`
      + '请核对逐镜 video_generate / video_composite 的 duration 是否与分镜表一致。',
    )
  }

  if (targetDuration !== undefined && targetDuration > 0 && filmDuration > 0 && Math.abs(filmDuration - targetDuration) > tolerance) {
    notices.push(
      `成片真值 ${filmDuration.toFixed(3)}s 与项目目标总时长 ${targetDuration}s 相差 ${(filmDuration - targetDuration).toFixed(3)}s。`,
    )
  }

  return notices
}

function isVideoFile(path: string): boolean {
  // CV-125：BGM 放行音频扩展名（txt2audio 产物为 mp3；ffmpeg amix 对音频容器同样适用）。
  return /\.(mp4|m4v|mov|webm|mkv|avi|mp3|wav|m4a|aac|ogg|flac)$/iu.test(path)
}
/**
 * 执行成片合成全流程（Host 侧）：
 * 1) 读取画布节点，收集 clip 并反查本地文件，缺失报「片段文件不存在」；
 * 2) 探测首个 clip 的分辨率（后续片段统一到此尺寸），无分辨率则报错；
 * 3) 逐段统一转码（25fps / yuv420p；**CV-141：仅单镜整出保留音轨**，多镜一律
 *    `-an` 丢弃原生环境声，有音轨时转 aac）；
 * 4) concat demuxer 拼接，并探测产物真值（时长 + 是否有音轨）；
 * 5) 可选 BGM：**CV-138 先做时长守卫**（BGM 短于成片即报错、不落半成品），
 *    再按有无 concat 音轨走「叠混（normalize=0）」或「BGM 单轨」，输出时长锚定
 *    成片真值（`-t`）；
 * 6) 落 `export-<uuid>.mp4` 于 assets 根目录，返回同源 URL + 成片时长 +
 *    音轨构成（CV-143）。
 *
 * 整体受 120s 超时与调用方 `signal` 双重约束，超时/中断即抛中文错误。
 */
export async function composeStudioVideo(
  registry: ProjectRegistry,
  projectId: string,
  clipIds: readonly string[],
  bgmNodeId?: string,
  options: ComposeOptions = {},
  signal?: AbortSignal,
): Promise<ComposeResult> {
  if (clipIds.length === 0) throw new Error('请先选择至少一个分镜片段')
  const project = await registry.getProject(projectId)
  if (project === null) throw new Error(`项目不存在: ${projectId}`)
  const assetsDir = registry.assetsDir(projectId)
  await mkdir(assetsDir, { recursive: true })

  const document = await registry.readCanvas(projectId)
  const { clips, missingIds } = collectClips(document.nodes, clipIds)
  if (clips.length === 0) {
    throw new Error('所选片段中没有可合成的视频节点，请重新生成片段')
  }

  // 反查本地文件，缺失即报错（不落半成品）。
  const resolvedClips: ComposeClip[] = []
  for (const clip of clips) {
    const inputPath = urlToAssetPath(assetsDir, clip.url!)
    try {
      await access(inputPath)
    } catch {
      missingIds.push(clip.id)
    }
    resolvedClips.push({
      id: clip.id,
      url: clip.url!,
      inputPath,
      hasAudio: false,
      ...(typeof clip.declaredDuration === 'number' ? { declaredDuration: clip.declaredDuration } : {}),
    })
  }
  if (missingIds.length > 0) {
    throw new Error('片段文件不存在，请重新生成后再导出')
  }

  // CV-141：原生音轨保留策略 —— **单镜整出保留，多分镜拼接全丢**。
  // 1 个片段 = 同一次生成的连续画面，环境声前后一致，保留最和谐；≥2 个片段时
  // 各镜环境声互不连续，硬拼会「跳」。判据只看本次纳入的片段数。
  const keepNativeAudio = resolvedClips.length === 1

  const ffmpegPath = resolveFfmpegPath(options.ffmpegPath)
  const fps = Math.max(1, options.fps ?? TARGET_FPS)
  // C5：统一调色预设解析 —— false 关闭，字符串覆盖，缺省用中性默认。
  const colorGrade = options.colorGrade === false
    ? undefined
    : (typeof options.colorGrade === 'string' ? options.colorGrade : DEFAULT_COLOR_GRADE)
  const tempDir = await mkdtemp(join(tmpdir(), 'cs-compose-'))

  // 整体超时：调用方 signal 与 120s 上限取并集。
  const timeout = AbortSignal.timeout(COMPOSE_TIMEOUT_MS)
  const composed = AbortSignal.any([signal ?? AbortSignal.timeout(COMPOSE_TIMEOUT_MS), timeout])

  try {
    // 1) 探针首个 clip 分辨率 + 每段音轨存在性。
    const firstProbe = await runFfmpeg(ffmpegPath, ['-i', resolvedClips[0]!.inputPath], FFMPEG_TIMEOUT_MS, composed)
    const firstStreams = parseFfmpegStreams(firstProbe.stderr)
    const width = firstStreams.width
    const height = firstStreams.height
    if (width === undefined || height === undefined) {
      throw new Error('无法识别片段分辨率，请重新生成片段')
    }
    const probeTasks = resolvedClips.map(async (clip) => {
      const probe = await runFfmpeg(ffmpegPath, ['-i', clip.inputPath], FFMPEG_TIMEOUT_MS, composed)
      clip.hasAudio = parseFfmpegStreams(probe.stderr).hasAudio
      return clip
    })
    await Promise.all(probeTasks)

    // 2) 逐段统一转码。
    const transcodedPaths: string[] = []
    for (let i = 0; i < resolvedClips.length; i += 1) {
      const clip = resolvedClips[i]!
      const out = join(tempDir, `clip-${i}.mp4`)
      // CV-141：多镜拼接时强制丢弃原生音轨（`-an`）——丢在转码阶段而不是事后
      // mute，这样 concat 产物天然无音轨，下游自动走「BGM 单轨」分支，链路自洽。
      const args = buildTranscodeArgs(clip.inputPath, out, width, height, fps, clip.hasAudio && keepNativeAudio, colorGrade)
      const result = await runFfmpeg(ffmpegPath, args, COMPOSE_TIMEOUT_MS, composed)
      if (result.code !== 0) {
        const detail = result.stderr.trim().split('\n').at(-1) ?? ''
        throw new Error(`片段转码失败（${clip.id}${detail.length > 0 ? `: ${detail}` : ''}）`)
      }
      transcodedPaths.push(out)
    }

    // 3) concat 拼接。
    const concatListPath = join(tempDir, 'concat.txt')
    await writeFile(concatListPath, buildConcatList(transcodedPaths))
    const concatOutput = join(tempDir, 'concat.mp4')
    const concatResult = await runFfmpeg(ffmpegPath, buildConcatArgs(concatListPath, concatOutput), COMPOSE_TIMEOUT_MS, composed)
    if (concatResult.code !== 0) {
      const detail = concatResult.stderr.trim().split('\n').at(-1) ?? ''
      throw new Error(`片段拼接失败${detail.length > 0 ? `: ${detail}` : ''}`)
    }

    // 4) 探测 concat 产物：时长 + 音轨存在性。
    //    CV-138：此前这次探测只解析了 `hasAudio`，而 `Duration:` 行就在同一个
    //    stderr 里——补一次解析就拿到「混音前的成片真实时长」，零额外进程、零依赖。
    //    它同时驱动三件事：时长守卫、淡出锚点、输出时长（`-t`）。
    const concatProbe = await runFfmpeg(ffmpegPath, ['-i', concatOutput], FFMPEG_TIMEOUT_MS, composed)
    const filmDuration = parseFfmpegDuration(concatProbe.stderr)
    const hasConcatAudio = parseFfmpegStreams(concatProbe.stderr).hasAudio
    const warnings: string[] = []
    if (filmDuration <= 0) {
      warnings.push('未能探测成片真实时长，本次按 -shortest 收尾（音画对齐可能不精确）。')
    }

    // CV-142：结构化时间轴校验——四个数互相对照，把时长漂移在合成那一刻显形，
    // 而不是等用户听见音乐与画面对不上才发现。
    const clipDeclared = resolvedClips.reduce((sum, clip) => sum + (clip.declaredDuration ?? 0), 0)
    const storyboardDeclared = document.nodes
      .filter((node) => node.toolName === 'submit_storyboard_for_approval')
      .reduce((sum, node) => sum + (typeof node.declaredDuration === 'number' ? node.declaredDuration : 0), 0)
    warnings.push(...auditTimeline({
      storyboardDeclared,
      clipDeclared,
      filmDuration,
      ...(project.plan?.targetDuration !== undefined ? { targetDuration: project.plan.targetDuration } : {}),
    }))

    // 5) 可选 BGM 混音；无 BGM 时 concat 产物即成片。
    const outputName = options.outputName ?? `export-${newAssetId()}.mp4`
    const finalOutput = join(assetsDir, outputName)
    if (bgmNodeId !== undefined) {
      const bgmNode = document.nodes.find((node) => node.id === bgmNodeId)
      if (bgmNode === undefined || bgmNode.url === undefined) {
        throw new Error('BGM 片段不存在，请重新选择')
      }
      if (!isVideoFile(bgmNode.url)) {
        throw new Error('BGM 仅支持视频/音频文件')
      }
      const bgmInput = urlToAssetPath(assetsDir, bgmNode.url)
      try {
        await access(bgmInput)
      } catch {
        throw new Error('BGM 文件不存在，请重新上传后再导出')
      }
      // C5：探测 BGM 时长，驱动淡出起点（时长不足淡入周期时只淡入）。
      const bgmProbe = await runFfmpeg(ffmpegPath, ['-i', bgmInput], FFMPEG_TIMEOUT_MS, composed)
      const bgmDuration = parseFfmpegDuration(bgmProbe.stderr)
      // CV-138：守卫 —— BGM 不够长直接报错，**不落半成品**（否则会得到一个
      // 「看着像成片、其实被截了」的假产物，比报错更糟）。
      const shortfall = bgmShortfallMessage(bgmDuration, filmDuration)
      if (shortfall !== null) throw new Error(shortfall)
      if (bgmDuration <= 0) {
        warnings.push('未能探测 BGM 时长，本次未做时长守卫、也未加淡入淡出（请人工确认音画等长）。')
      }
      const amixResult = await runFfmpeg(
        ffmpegPath,
        buildAmixArgs(concatOutput, bgmInput, finalOutput, hasConcatAudio, bgmDuration, filmDuration),
        COMPOSE_TIMEOUT_MS,
        composed,
      )
      if (amixResult.code !== 0) {
        const detail = amixResult.stderr.trim().split('\n').at(-1) ?? ''
        throw new Error(`BGM 混音失败${detail.length > 0 ? `: ${detail}` : ''}`)
      }
    } else {
      // 无 BGM：直接把 concat 产物落盘为最终成片。
      // CV-141：多镜拼接时原生音轨已按策略丢弃 → 成片无声，必须明确告知而不是
      // 让用户导出后才发现没声音。
      if (!hasConcatAudio) {
        warnings.push('本次为多分镜合成且未提供 BGM，成片将无声（各镜环境声按策略已丢弃）。')
      }
      // CR-023：copyFile 流式复制，不再把大视频整读进内存再写。
      await copyFile(concatOutput, finalOutput)
    }

    // CV-143：成片音轨构成（策略的实际结果，而非意图）。
    const audioComposition: StudioAudioComposition = bgmNodeId !== undefined
      ? (hasConcatAudio ? 'native+bgm' : 'bgm')
      : (hasConcatAudio ? 'native' : 'none')

    // 6) 探测成片时长（ffmpeg -i 非零退出属预期，时长在 stderr）。
    const finalProbe = await runFfmpeg(ffmpegPath, ['-i', finalOutput], FFMPEG_TIMEOUT_MS, composed)
    const duration = parseFfmpegDuration(finalProbe.stderr)
    const finalStreams = parseFfmpegStreams(finalProbe.stderr)

    return {
      url: `/canvas-studio/assets/${projectId}/${outputName}`,
      duration,
      audioComposition,
      ...(warnings.length > 0 ? { warnings } : {}),
      ...(finalStreams.width !== undefined ? { width: finalStreams.width } : {}),
      ...(finalStreams.height !== undefined ? { height: finalStreams.height } : {}),
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

/** Host 侧把成片结果落为画布 video-composite 节点（供模型工具 compose_video 直接回写）。 */
export interface ComposedNodeInput {
  url: string
  duration?: number
  width?: number
  height?: number
  /** 源片段节点 id（血缘边指向它们）。 */
  sourceIds: string[]
  /** 成片文案（广告词/对白/字幕等），来自 write_script 节点。 */
  script?: string
  /** CV-143：成片音轨构成（角标展示）。 */
  audioComposition?: StudioAudioComposition
}

/**
 * 把合成结果写为画布节点（video-composite，origin=agent，血缘指向源片段），
 * 返回新建节点。位置沿用 4 列网格；真实分辨率写入 mediaWidth/mediaHeight，
 * 文案写入 `script`，使详情面板可展示。客户端工具/结果重载后即出现在画布。
 * 节点框按真实分辨率等比换算（竖屏成片不再被 260×180 横屏占位框 cover 裁切）。
 */
export async function appendComposedVideoNode(
  registry: ProjectRegistry,
  projectId: string,
  input: ComposedNodeInput,
): Promise<StudioCanvasNode> {
  const existing = (await registry.readCanvas(projectId)).nodes
  const index = existing.length
  // CV-108：成片也进版本链——重新合成后旧成片标记失效（保留在画布上供对比，
  // 但不再被当作「当前成片」，避免多个成片并列分不清最终版）。
  const previousComposed = existing.filter((node) => node.toolName === 'compose' && isActiveShot(node))
  const composedVersion = previousComposed.reduce((max, node) => Math.max(max, node.shotVersion ?? 1), 0) + 1
  const supersedeIds = previousComposed.map((node) => node.id)
  // 宽高齐备时按真实分辨率换算显示框（1:1→420×420、9:16→267×480、16:9→480×270，
  // 各自由 C10 的 frameSizeOf 再补上镜头条 chrome）；探测失败回退横屏占位，
  // 由客户端媒体加载后的框比例校正兜底。
  const size = input.width !== undefined && input.height !== undefined && input.width > 0 && input.height > 0
    ? frameSizeOf({ width: input.width, height: input.height })
    : COMPOSED_FALLBACK_SIZE
  const node: StudioCanvasNode = {
    id: newAssetId(),
    kind: 'video',
    title: `成片 ${new Date().toLocaleString('zh-CN')}`,
    url: input.url,
    ...(input.duration !== undefined ? { duration: input.duration } : {}),
    ...(input.width !== undefined ? { mediaWidth: input.width } : {}),
    ...(input.height !== undefined ? { mediaHeight: input.height } : {}),
    x: 40 + (index % 4) * 300,
    y: 40 + Math.floor(index / 4) * 240,
    width: size.width,
    height: size.height,
    createdAt: Date.now(),
    toolName: 'compose',
    origin: 'agent',
    sourceIds: input.sourceIds,
    operationType: 'video-composite',
    ...(input.audioComposition !== undefined ? { audioComposition: input.audioComposition } : {}),
    shotVersion: composedVersion,
    ...(supersedeIds.length > 0 ? { supersedes: supersedeIds } : {}),
    ...(input.script !== undefined ? { script: input.script } : {}),
  }
  await registry.appendCanvasNode(projectId, node)
  if (supersedeIds.length > 0) {
    const persisted = (await registry.readCanvas(projectId)).nodes
    await registry.writeCanvas(projectId, applySupersede(persisted, node.id, supersedeIds))
  }
  return node
}
