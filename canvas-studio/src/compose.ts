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
import { isShotCard } from './contracts/canvas.js'
import { resolveAudioMixRole, nodeAudioOverride, type AudioMixRole } from './compose-selection.js'

/** 旁白短于成片时的提示容差（秒）：差这么点不值得刷一条 warning。 */
const VOICE_SHORTFALL_NOTE_SEC = 0.5
import { newAssetId } from './config.js'
import { applySupersede, isActiveShot } from './shot-versions.js'
import { frameSizeOf, DEFAULT_NODE_SIZE } from './canvas-aspect.js'
import { deriveNodePlacement } from './canvas-placement.js'

/** 成片节点缺分辨率时的回退画布显示尺寸（横屏占位，媒体加载后由框比例校正兜底）。
 *  C10：改取统一出口 —— 它是**节点框**尺寸（画面 + 镜头条 chrome），
 *  与 project-store / generate / video-frames 同源。 */
const COMPOSED_FALLBACK_SIZE = { ...DEFAULT_NODE_SIZE }
import { resolveFfmpegPath, runFfmpeg, parseFfmpegStreams, parseFfmpegDuration, FFMPEG_TIMEOUT_MS } from './ffmpeg-run.js'
import { audioCompositionFrom } from './remotion/manifest.js'
import { throwError } from './error-system.js'
import { resolveAssetPathIn } from './asset-path.js'
import { recordAssetHistory } from './asset-history.js'
import { resolveAudioTimeline, compositionFromTimeline, buildAudioGraph, AUDIO_DELIVERY_SAMPLE_RATE, AUDIO_DELIVERY_CHANNELS } from './audio-timeline.js'
import {
  timelineFromComposeClips,
  buildAudioTrackArgs,
  buildMuxArgs,
  bgmAutopadDecision,
  buildBgmFade,
  fadeAnchorOf,
  inferBgmSilenceProfile,
  BGM_VOLUME,
  BGM_MIX_VOLUME,
  VOICE_VOLUME,
  type BgmSilenceProfile,
  type VoiceOverPlacement,
  type ResolvedMixSource,
  type ResolvedVoiceOver,
} from './audio-compose.js'
import './errors/catalog.js'

// 兼容再导出（S2b：BGM 淡变/守卫纯函数迁往 audio-compose.ts，历史 import 路径不变）。
// 兼容再导出（S3：角色判定迁往 compose-selection.ts —— 客户端混音面板要复用，
// 而 compose.js 是 Host 重模块（拖 node:fs 依赖进 bundle）。
export { buildBgmFade, fadeAnchorOf, inferBgmSilenceProfile, bgmShortfallMessage, BGM_SHORTFALL_TOLERANCE_SEC, timelineFromComposeClips } from './audio-compose.js'
export type { BgmSilenceProfile, VoiceOverPlacement } from './audio-compose.js'
export { AUDIO_DELIVERY_SAMPLE_RATE, AUDIO_DELIVERY_CHANNELS } from './audio-timeline.js'
export { resolveAudioMixRole, type AudioMixRole } from './compose-selection.js'

/** 合成整体超时上限（毫秒）：本地拼接几十秒视频应远小于此，超时报中文错误。 */
const COMPOSE_TIMEOUT_MS = 240_000
/** 统一转码目标帧率。 */
const TARGET_FPS = 25
/**
 * v1 中性默认调色（统一 eq 滤镜，治各镜色调漂移）：轻微提对比 + 饱和归一，
 * 所有片段应用同一滤镜链，把逐镜生成的色调差异拉到同一基线。传 false 关闭，
 * 传字符串覆盖本预设（见 ComposeOptions.colorGrade）。
 */
const DEFAULT_COLOR_GRADE = 'eq=contrast=1.03:saturation=1.02'

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
  /**
   * 混入音源的角色（D6）：`bgm`（配乐，铺底 + 淡入淡出 + 严格时长守卫）或
   * `voiceOver`（旁白，前景满音量 + 无淡入淡出 + 允许短于成片）。
   *
   * 缺省由 `resolveAudioMixRole()` 按节点来源自动识别；此字段只用于**强制覆盖**
   * （例如用户故意把一段人声当配乐垫底）。
   */
  mixRole?: AudioMixRole
  /**
   * S2b（2026-10-28）：多句旁白节点（与 `bgmNodeId` 并存，**仅装配路径生效**）。
   * 字符串 = 顺序堆叠（前一句结束处，零间隙）；对象 = 显式 `startSec`（与 render
   * 路径 `audio.voiceOver[]` 的 startFrame 语义对齐）。每句满音量、无淡入淡出、
   * 允许短于成片（D6 口径）。
   */
  voiceOverNodeIds?: ReadonlyArray<string | VoiceOverPlacement>
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
  /** S2a（2026-10-28）：探测到的片段真实时长（秒）。探测失败记 0（不伪造）。 */
  realDurationSec?: number
}

/**
 * 将画布节点同源 URL 反查为本地资产文件绝对路径。
 * URL 形如 `/canvas-studio/assets/<projectId>/<file>`，资产目录由 registry
 * 提供。
 *
 * CR-01/CR-02：末段文件名一律过 `asset-path.ts` 的唯一判据再拼路径 —— 此前是
 * 裸 `join(assetsDir, file)`，`../../..` 会被折叠成项目外的任意文件，而 url 来自
 * 画布节点（可被 agent 写入）。成片合成 / 抽帧 / 波形 / 素材核对四条链路共用本
 * 函数，收口在这里等于一次收紧四路。
 */
export function urlToAssetPath(assetsDir: string, url: string): string {
  const parts = url.split('/').filter(Boolean)
  const idx = parts.indexOf('assets')
  const file = idx >= 0 ? parts[idx + 2] : parts.at(-1)
  return resolveAssetPathIn(assetsDir, file ?? '')
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

/**
 * S2a（2026-10-28 · CV-040 收口）：音频交付口径常量（`AUDIO_DELIVERY_SAMPLE_RATE`
 * / `AUDIO_DELIVERY_CHANNELS`）已随 S2b 迁往 audio-timeline.ts（装配图与转码参数
 * 共用一份口径），本模块经文件头部再导出保持 import 路径不变。
 */

/** 音频编码参数（纯函数，S2a 抽出避免 `buildTranscodeArgs` 签名膨胀）。
 *
 * - 有音轨：重编码 aac + 统一 48k 立体声。
 * - 无音轨：**不再 `-an` 丢流**（丢流让 concat 流结构不一致 ⇒ 音轨断裂、末段静音，
 *   即 CV-040 实验 A）——改为补一条 `anullsrc` 等长静音轨再编码 aac，保证每段输出
 *   都有同构音轨。`clipDurationSec` 是该段**探测到的真实时长**（不是请求值）：补的
 *   静音按真实时长裁（`-t`），探测失败（≤0）退 `-shortest` 兜底、不伪造时长。
 */
export interface AudioCodecArgsInput {
  hasAudio: boolean
  /** 片段真实时长（秒；0/缺省 = 未探到）。 */
  clipDurationSec?: number
}

export function buildAudioCodecArgs({ hasAudio, clipDurationSec = 0 }: AudioCodecArgsInput): string[] {
  const unified = ['-ar', String(AUDIO_DELIVERY_SAMPLE_RATE), '-ac', String(AUDIO_DELIVERY_CHANNELS)]
  if (hasAudio) return ['-c:a', 'aac', ...unified]
  // 无音轨：补一条 anullsrc 静音输入 + aac 编码。⚠️ 输入声明必须整体落在输出选项
  // 之前（ffmpeg 选项按「下一个文件」归属，实测 `-vf` 之后再声明 `-i` 会报
  // `Option vf cannot be applied to input`）—— 调用方须把本函数的产出整体放在
  // 所有 `-i` 之后、`-vf` 等输出选项之前。
  return [
    '-f', 'lavfi', '-i', `anullsrc=r=${AUDIO_DELIVERY_SAMPLE_RATE}:cl=stereo`,
    '-c:a', 'aac', ...unified,
    ...(clipDurationSec > 0 ? ['-t', clipDurationSec.toFixed(3)] : []),
    '-shortest',
  ]
}

/** 统一转码参数（纯函数）。音频参数一律经 `buildAudioCodecArgs`（统一 48k 立体声；
 * 无音轨补等长静音轨），且紧跟 `-i` 输入区（见 buildAudioCodecArgs 的归属注释）。
 * `colorGrade` 非空时在 vf 末尾追加统一调色滤镜（治各镜色调漂移）。
 * `clipRealDurationSec` 只在无音轨分支被消费（补静音的裁切时长）。 */
export function buildTranscodeArgs(
  input: string,
  output: string,
  width: number,
  height: number,
  fps: number,
  hasAudio: boolean,
  colorGrade?: string,
  clipRealDurationSec?: number,
): string[] {
  // CR-022：等比缩放 + 黑边补足，避免画幅不一致的片段被非等比拉伸变形。
  // `force_original_aspect_ratio=decrease` 保持纵横比缩放到 WxH 内，
  // 再 `pad` 居中补到目标画幅，保证 concat 时所有片段同尺寸可拼接。
  // C5：末尾追加统一调色（eq 等），各镜应用同一滤镜链拉到同一色调基线。
  const gradeVf = colorGrade ? `,${colorGrade}` : ''
  const vf = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps}${gradeVf}`
  return [
    '-i', input,
    ...buildAudioCodecArgs({ hasAudio, ...(clipRealDurationSec !== undefined ? { clipDurationSec: clipRealDurationSec } : {}) }),
    '-vf', vf,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-y', output,
  ]
}

/** concat 拼接参数（纯函数）。 */
export function buildConcatArgs(concatListPath: string, output: string): string[] {
  return ['-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', '-y', output]
}

/**
 * BGM 混音参数（纯函数）。
 *
 * CV-209 升级：多镜拼接不再丢原生音轨。两种情形：
 * - **单镜整出**（`hasConcatAudio=true`，compose 时只有一段）：与 BGM 做
 *   `amix=inputs=2:duration=first:normalize=0`——线性求和（CV-141：默认
 *   `normalize=1` 会把每一路各乘 0.5，两条声音一起被压暗），BGM 走
 *   `BGM_MIX_VOLUME` 只作铺底，环境声留在前景。
 * - **多镜拼接**（`hasConcatAudio=true` 但 `resolvedClips.length ≥ 2`，每镜都开了
 *   `generateAudio=true`）：与 BGM 做 `amix`——原生音轨是主声轨，BGM 仍只铺底。
 * - **无原生音轨**（`hasConcatAudio=false`，用户主动静音 / 老产物）：直接把
 *   BGM 作为成片音轨，走 `BGM_VOLUME`（无 amix、无归一化，无需补偿）。
 *
 * 两种情形 BGM 都过 `buildBgmFade` 淡入淡出（C5 兜底 + CV-209 自适应），锚点取
 * `fadeAnchorOf(bgm, film)`（CV-138）。输出时长用 `-t <成片真值>` 而不是 `-shortest`
 * ——后者在单轨分支会按 BGM 长度把画面裁掉；真值不可得时退回 `-shortest`。
 */
export function buildAmixArgs(
  concatOutput: string,
  bgmInput: string,
  output: string,
  hasConcatAudio: boolean,
  bgmDuration: number = 0,
  filmDuration: number = 0,
  bgmProfile?: BgmSilenceProfile,
  role: AudioMixRole = 'bgm',
): string[] {
  // D6：旁白走独立处理 —— 满音量、**不**淡入淡出（淡变会咬掉字头字尾；配乐的淡变
  // 是防爆音的兜底，旁白本身没有这个问题）。
  const fade = role === 'voiceOver' ? '' : buildBgmFade(fadeAnchorOf(bgmDuration, filmDuration), bgmProfile)
  const bgmVolume = role === 'voiceOver' ? VOICE_VOLUME : (hasConcatAudio ? BGM_MIX_VOLUME : BGM_VOLUME)
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
 * 3) 逐段统一转码（25fps / yuv420p；每段统一 48k 立体声 aac，无音轨段补等长静音轨
 *    —— S2a；转码产物保留音轨，供 legacy 回退与装配期取用）；
 * 4) concat demuxer 拼接，并探测产物真值（时长 + 是否有音轨）；
 * 5) 音轨（S2b 分叉）：
 *    - **多镜默认：从零装配**（D-01）——母版视频流 + AudioTimeline（原生段按真实
 *      时长前缀和落位 / BGM / 多句旁白 `voiceOverNodeIds`）→ `buildAudioGraph` 一条
 *      完整音轨 → `-c:v copy` 合流；短 BGM 自动补静音（D-02）；
 *    - **单镜整出 / `CANVAS_STUDIO_AUDIO_LEGACY_CONCAT=1`：concat+amix 旧路径**
 *      （单镜音轨行为逐字符不变）；
 * 6) 落 `export-<uuid>.mp4` 于 assets 根目录，返回同源 URL + 成片时长 +
 *    音轨构成（装配路径由时间轴派生，S1 的读出口）。
 *
 * 整体受 240s 超时与调用方 `signal` 双重约束，超时/中断即抛中文错误。
 */
export async function composeStudioVideo(
  registry: ProjectRegistry,
  projectId: string,
  clipIds: readonly string[],
  bgmNodeId?: string,
  options: ComposeOptions = {},
  signal?: AbortSignal,
): Promise<ComposeResult> {
  if (clipIds.length === 0) throwError('CS-COMP-001')
  const project = await registry.getProject(projectId)
  if (project === null) throwError('CS-PROJ-001', { id: projectId })
  const assetsDir = registry.assetsDir(projectId)
  await mkdir(assetsDir, { recursive: true })

  const document = await registry.readCanvas(projectId)
  const { clips, missingIds } = collectClips(document.nodes, clipIds)
  if (clips.length === 0) {
    throwError('CS-USER-ERR', { message: '所选片段中没有可合成的视频节点，请重新生成片段' })
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
    throwError('CS-USER-ERR', { message: '片段文件不存在，请重新生成后再导出' })
  }

  // CV-141 + CV-209 重写：原生音轨保留策略 —— **所有镜头都保留**。
  // 单镜整出保留原生音轨（与旧逻辑一致）；多镜拼接时每镜都开 `generateAudio=true`，
  // 原生音轨由 ffmpeg `concat` demuxer 拼接到一起，对白/场景音效完整保留为主声轨，
  // BGM 由 `music_generation` 单独生成、按 `amix` 在主声轨下方铺底。
  const keepNativeAudio = true

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
      throwError('CS-USER-ERR', { message: '无法识别片段分辨率，请重新生成片段' })
    }
    const probeTasks = resolvedClips.map(async (clip) => {
      const probe = await runFfmpeg(ffmpegPath, ['-i', clip.inputPath], FFMPEG_TIMEOUT_MS, composed)
      clip.hasAudio = parseFfmpegStreams(probe.stderr).hasAudio
      // S2a：`Duration:` 就在同一次探测的 stderr 里——顺带解析拿段真实时长（零额外进程），
      // 供无音轨段补等长静音轨。探测失败记 0（不伪造，转码时退 `-shortest` 兜底）。
      clip.realDurationSec = parseFfmpegDuration(probe.stderr)
      return clip
    })
    await Promise.all(probeTasks)

    // S2a：无原生音轨的段逐段回显（模型能自查、用户能看见）——「哪段缺声、补了多久」。
    // 补静音轨本身在 buildTranscodeArgs 内完成；这里只负责把事实说出口。
    // ⚠️ 仅 legacy 路径消费（S2b 装配路径的回显来自 timelineFromComposeClips 的
    // notices ——「该区间保持静音」，装配并不真的逐段补静音轨，文案不能撒谎）。
    const paddedNotices: string[] = []
    resolvedClips.forEach((clip, index) => {
      if (clip.hasAudio) return
      paddedNotices.push(
        clip.realDurationSec !== undefined && clip.realDurationSec > 0
          ? `第 ${index + 1} 段无原生音轨，已补 ${clip.realDurationSec.toFixed(1)}s 静音`
          : `第 ${index + 1} 段无原生音轨（时长未探到），已按视频实际长度补静音`,
      )
    })
    // S2b 分叉判定提前（回显集合依赖它）。
    const useAssembly = resolvedClips.length >= 2 && process.env.CANVAS_STUDIO_AUDIO_LEGACY_CONCAT !== '1'

    // 2) 逐段统一转码。
    const transcodedPaths: string[] = []
    for (let i = 0; i < resolvedClips.length; i += 1) {
      const clip = resolvedClips[i]!
      const out = join(tempDir, `clip-${i}.mp4`)
      // CV-141 + CV-209：keepNativeAudio 现在恒为 true；多镜也保留原生音轨。
      // 转码阶段不会再 `-an` 丢原生音轨；老的无音轨片段（无 `generateAudio=true`
      // 出图）会自动落在 `clip.hasAudio=false`，S2a 起补等长静音轨（不再丢流）。
      const args = buildTranscodeArgs(
        clip.inputPath,
        out,
        width,
        height,
        fps,
        clip.hasAudio && keepNativeAudio,
        colorGrade,
        clip.realDurationSec,
      )
      const result = await runFfmpeg(ffmpegPath, args, COMPOSE_TIMEOUT_MS, composed)
      if (result.code !== 0) {
        const detail = result.stderr.trim().split('\n').at(-1) ?? ''
        throwError('CS-COMP-002', { clipId: clip.id, detail })
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
      throwError('CS-USER-ERR', { message: '片段拼接失败，请重试', detail })
    }

    // 4) 探测 concat 产物：时长 + 音轨存在性。
    //    CV-138：此前这次探测只解析了 `hasAudio`，而 `Duration:` 行就在同一个
    //    stderr 里——补一次解析就拿到「混音前的成片真实时长」，零额外进程、零依赖。
    //    它同时驱动三件事：时长守卫、淡出锚点、输出时长（`-t`）。
    const concatProbe = await runFfmpeg(ffmpegPath, ['-i', concatOutput], FFMPEG_TIMEOUT_MS, composed)
    const filmDuration = parseFfmpegDuration(concatProbe.stderr)
    const hasConcatAudio = parseFfmpegStreams(concatProbe.stderr).hasAudio
    // S2a：补的静音轨让 concat 产物恒有音频流，但「有流」≠「有原生声」——角标与
    // amix 分支的语义必须维持「至少一段真有声」（与补静音前行为一致，不静默漂移）。
    const hasNativeAudio = hasConcatAudio && resolvedClips.some((clip) => clip.hasAudio)
    const warnings: string[] = useAssembly ? [] : [...paddedNotices]
    if (filmDuration <= 0) {
      warnings.push('未能探测成片真实时长，本次按 -shortest 收尾（音画对齐可能不精确）。')
    }

    // CV-142：结构化时间轴校验——四个数互相对照，把时长漂移在合成那一刻显形，
    // 而不是等用户听见音乐与画面对不上才发现。
    const clipDeclared = resolvedClips.reduce((sum, clip) => sum + (clip.declaredDuration ?? 0), 0)
    const storyboardDeclared = document.nodes
      .filter((node) => isShotCard(node))
      .reduce((sum, node) => sum + (typeof node.declaredDuration === 'number' ? node.declaredDuration : 0), 0)
    warnings.push(...auditTimeline({
      storyboardDeclared,
      clipDeclared,
      filmDuration,
      ...(project.plan?.targetDuration !== undefined ? { targetDuration: project.plan.targetDuration } : {}),
    }))

    // 5) 音轨。S2b（D-01 拍板）：**多镜默认走「从零装配」**——母版视频流 + AudioTimeline
    //    装配出一条完整音轨 + `-c:v copy` 合流（绝对时间坐标是 duck/多轨/精确落点的
    //    前提）。单镜整出与显式回退（`CANVAS_STUDIO_AUDIO_LEGACY_CONCAT=1`）保留
    //    concat+amix 旧路径 —— 单镜音轨行为逐字符不变是 S2b 的验收判据之一。
    //    （useAssembly 判定已在探测后提前算好。）
    const outputName = options.outputName ?? `export-${newAssetId()}.mp4`
    const finalOutput = join(assetsDir, outputName)
    let audioComposition: StudioAudioComposition
    if (useAssembly) {
      // ── S2b 装配路径 ──────────────────────────────────────────────────────
      // 混入音源解析（bgmNodeId + voiceOverNodeIds；与 legacy 同一套校验口径）。
      let resolvedMix: ResolvedMixSource | undefined
      let assemblyBgmDuration = 0
      if (bgmNodeId !== undefined) {
        const bgmNode = document.nodes.find((node) => node.id === bgmNodeId)
        if (bgmNode === undefined || bgmNode.url === undefined) {
          throwError('CS-USER-ERR', { message: 'BGM 片段不存在，请重新选择' })
        }
        if (!isVideoFile(bgmNode.url)) {
          throwError('CS-USER-ERR', { message: 'BGM 仅支持视频/音频文件' })
        }
        const bgmInput = urlToAssetPath(assetsDir, bgmNode.url)
        try {
          await access(bgmInput)
        } catch {
          throwError('CS-USER-ERR', { message: 'BGM 文件不存在，请重新上传后再导出' })
        }
        const bgmProbe = await runFfmpeg(ffmpegPath, ['-i', bgmInput], FFMPEG_TIMEOUT_MS, composed)
        assemblyBgmDuration = parseFfmpegDuration(bgmProbe.stderr)
        const mixRole: AudioMixRole = options.mixRole ?? resolveAudioMixRole(bgmNode)
        // S3：混音面板写回的节点 audioTimeline（音量/淡变）优先于装配默认口径。
        const mixOverride = nodeAudioOverride(bgmNode, 'bgm')
        resolvedMix = {
          url: bgmNode.url,
          inputPath: bgmInput,
          role: mixRole,
          ...(assemblyBgmDuration > 0 ? { realDurationSec: assemblyBgmDuration } : {}),
          ...(mixOverride !== undefined && (mixOverride.gain !== undefined || mixOverride.fadeInSec !== undefined || mixOverride.fadeOutSec !== undefined)
            ? {
              override: {
                ...(mixOverride.gain !== undefined ? { gain: mixOverride.gain } : {}),
                ...(mixOverride.fadeInSec !== undefined ? { fadeInSec: mixOverride.fadeInSec } : {}),
                ...(mixOverride.fadeOutSec !== undefined ? { fadeOutSec: mixOverride.fadeOutSec } : {}),
              },
            }
            : {}),
        }
      }
      const voiceOverSources: ResolvedVoiceOver[] = []
      for (const entry of options.voiceOverNodeIds ?? []) {
        const nodeId = typeof entry === 'string' ? entry : entry.nodeId
        const voNode = document.nodes.find((node) => node.id === nodeId)
        if (voNode === undefined || voNode.url === undefined) {
          throwError('CS-USER-ERR', { message: `旁白节点不存在：${nodeId}` })
        }
        if (!isVideoFile(voNode.url)) {
          throwError('CS-USER-ERR', { message: `旁白仅支持视频/音频文件：${nodeId}` })
        }
        const voInput = urlToAssetPath(assetsDir, voNode.url)
        try {
          await access(voInput)
        } catch {
          throwError('CS-USER-ERR', { message: `旁白文件不存在：${nodeId}` })
        }
        const voProbe = await runFfmpeg(ffmpegPath, ['-i', voInput], FFMPEG_TIMEOUT_MS, composed)
        const voDuration = parseFfmpegDuration(voProbe.stderr)
        // S3：混音面板写回的音量/duck（节点 audioTimeline）；显式 API 入参优先。
        const voOverride = nodeAudioOverride(voNode, 'voiceOver')
        voiceOverSources.push({
          nodeId,
          url: voNode.url,
          inputPath: voInput,
          ...(voDuration > 0 ? { realDurationSec: voDuration } : {}),
          ...(typeof entry === 'object' && entry.startSec !== undefined ? { startSec: entry.startSec } : {}),
          ...(typeof entry === 'object' && entry.gain !== undefined ? { gain: entry.gain } : voOverride?.gain !== undefined ? { gain: voOverride.gain } : {}),
          ...(voOverride?.duckAmount !== undefined ? { duckAmount: voOverride.duckAmount } : {}),
        })
      }

      // 片段 + 混入音源 → AudioTimeline（装配事实源的 compose 侧唯一入口）。
      const composed2 = timelineFromComposeClips({
        clips: resolvedClips.map((clip) => ({ id: clip.id, inputPath: clip.inputPath, hasAudio: clip.hasAudio, ...(clip.realDurationSec !== undefined ? { realDurationSec: clip.realDurationSec } : {}) })),
        ...(resolvedMix !== undefined ? { bgm: resolvedMix } : {}),
        ...(voiceOverSources.length > 0 ? { voiceOvers: voiceOverSources } : {}),
        filmDurationSec: filmDuration,
        fps,
      })
      warnings.push(...composed2.notices)
      warnings.push(`音轨装配（${composed2.timeline.segments.length} 段）：\n${composed2.summary}`)
      if (composed2.timeline.segments.length === 0) {
        warnings.push('本次合成无任何音轨（片段未开启原生音轨 + 未提供 BGM），成片将为静片。')
      }

      // D-02：短 BGM 默认自动补静音（装配图尾部 apad=whole_dur 兜住补齐），env=0 回退报错。
      if (resolvedMix?.role === 'bgm' && assemblyBgmDuration > 0) {
        const decision = bgmAutopadDecision(assemblyBgmDuration, filmDuration, process.env.CANVAS_STUDIO_AUDIO_AUTOPAD !== '0')
        if (decision.action === 'error') throwError('CS-USER-ERR', { message: decision.message })
        if (decision.message !== undefined) warnings.push(decision.message)
      }

      const resolvedTimeline = resolveAudioTimeline(composed2.timeline)
      if (!resolvedTimeline.ok) {
        const detail = resolvedTimeline.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message).join('；')
        throwError('CS-USER-ERR', { message: `音轨时间轴校验失败：${detail}` })
      }
      const graph = buildAudioGraph(resolvedTimeline.timeline)
      const audioTrackPath = join(tempDir, 'audio-track.m4a')
      const trackResult = await runFfmpeg(
        ffmpegPath,
        buildAudioTrackArgs(resolvedTimeline.timeline.segments.map((segment) => segment.url), graph.filterComplex, audioTrackPath, filmDuration),
        COMPOSE_TIMEOUT_MS,
        composed,
      )
      if (trackResult.code !== 0) {
        const detail = trackResult.stderr.trim().split('\n').at(-1) ?? ''
        throwError('CS-USER-ERR', { message: '音轨装配失败，请重试', detail })
      }
      const muxResult = await runFfmpeg(
        ffmpegPath,
        buildMuxArgs(concatOutput, audioTrackPath, finalOutput, filmDuration),
        COMPOSE_TIMEOUT_MS,
        composed,
      )
      if (muxResult.code !== 0) {
        const detail = muxResult.stderr.trim().split('\n').at(-1) ?? ''
        throwError('CS-USER-ERR', { message: '成片合流失败，请重试', detail })
      }
      // 八枚举由时间轴派生（S1 的读出口，取代手工三布尔）。
      audioComposition = compositionFromTimeline(resolvedTimeline.timeline)
    } else if (bgmNodeId !== undefined) {
      // ── legacy concat+amix 路径（单镜整出 / env 回退）────────────────────
      // D6：混入音源的角色 —— 旁白 ≠ 配乐（文案 / 音量 / 淡变 / 时长守卫全都不同）。
      const bgmNode = document.nodes.find((node) => node.id === bgmNodeId)
      if (bgmNode === undefined || bgmNode.url === undefined) {
        throwError('CS-USER-ERR', { message: 'BGM 片段不存在，请重新选择' })
      }
      if (!isVideoFile(bgmNode.url)) {
        throwError('CS-USER-ERR', { message: 'BGM 仅支持视频/音频文件' })
      }
      const mixRole: AudioMixRole = options.mixRole ?? resolveAudioMixRole(bgmNode)
      const bgmInput = urlToAssetPath(assetsDir, bgmNode.url)
      try {
        await access(bgmInput)
      } catch {
        throwError('CS-USER-ERR', { message: 'BGM 文件不存在，请重新上传后再导出' })
      }
      // C5：探测 BGM 时长，驱动淡出起点（时长不足淡入周期时只淡入）。
      const bgmProbe = await runFfmpeg(ffmpegPath, ['-i', bgmInput], FFMPEG_TIMEOUT_MS, composed)
      const bgmDuration = parseFfmpegDuration(bgmProbe.stderr)
      // CV-138 → D-02：默认自动补静音（amix duration=first 的尾段本就以成片为准补齐，
      // 单轨分支 -t 锚定片长、BGM 结束后即静音），`CANVAS_STUDIO_AUDIO_AUTOPAD=0`
      // 回退旧报错行为。
      //
      // D6：**旁白不适用这条守卫** —— 旁白短于成片是正常形态（话说完就静了），
      // 报错等于把合法的旁白用法封死。改为一条提示，让用户知道末段没人说话。
      if (mixRole === 'voiceOver') {
        const gap = filmDuration - bgmDuration
        if (bgmDuration > 0 && gap > VOICE_SHORTFALL_NOTE_SEC) {
          warnings.push(`旁白比成片短 ${gap.toFixed(2)} 秒（成片 ${filmDuration.toFixed(2)}s、旁白 ${bgmDuration.toFixed(2)}s），末段将无旁白；如需覆盖全片请延长旁白或用 cut_audio 补齐。`)
        }
      } else {
        const decision = bgmAutopadDecision(bgmDuration, filmDuration, process.env.CANVAS_STUDIO_AUDIO_AUTOPAD !== '0')
        if (decision.action === 'error') throwError('CS-USER-ERR', { message: decision.message })
        if (decision.message !== undefined) warnings.push(decision.message)
      }
      if (bgmDuration <= 0) {
        warnings.push('未能探测混入音源时长，本次未做时长守卫、也未加淡入淡出（请人工确认音画等长）。')
      }
      const bgmProfile = inferBgmSilenceProfile(bgmDuration, filmDuration)
      const amixResult = await runFfmpeg(
        ffmpegPath,
        buildAmixArgs(concatOutput, bgmInput, finalOutput, hasNativeAudio, bgmDuration, filmDuration, bgmProfile, mixRole),
        COMPOSE_TIMEOUT_MS,
        composed,
      )
      if (amixResult.code !== 0) {
        const detail = amixResult.stderr.trim().split('\n').at(-1) ?? ''
        throwError('CS-USER-ERR', { message: 'BGM 混音失败，请重试', detail })
      }
      // CV-143：成片音轨构成（策略的实际结果，而非意图）。legacy 路径沿用三布尔口径
      // （与 render_composition 同一实现）。
      audioComposition = audioCompositionFrom({
        hasNative: hasNativeAudio,
        hasBgm: mixRole === 'bgm',
        hasVoiceOver: mixRole === 'voiceOver',
      })
    } else {
      // 无 BGM：直接把 concat 产物落盘为最终成片。
      // CV-209：多镜拼接时原生音轨现在保留，对白/场景音效走主声轨，无声这条
      // 警告只在 `hasConcatAudio=false` 时（用户主动静音 / 老产物没开 generateAudio）
      // 才需要抛。
      if (!hasNativeAudio) {
        warnings.push('本次合成无任何音轨（片段未开启原生音轨 + 未提供 BGM），成片将为静片。')
      }
      // CR-023：copyFile 流式复制，不再把大视频整读进内存再写。
      await copyFile(concatOutput, finalOutput)
      audioComposition = audioCompositionFrom({
        hasNative: hasNativeAudio,
        hasBgm: false,
        hasVoiceOver: false,
      })
    }

    // 6) 探测成片时长（ffmpeg -i 非零退出属预期，时长在 stderr）。
    const finalProbe = await runFfmpeg(ffmpegPath, ['-i', finalOutput], FFMPEG_TIMEOUT_MS, composed)
    const duration = parseFfmpegDuration(finalProbe.stderr)
    const finalStreams = parseFfmpegStreams(finalProbe.stderr)

    // CV-246：成片入历史账（concat 直落与 BGM 混音两条路径都汇聚到 finalOutput，
    // 此处记账一次覆盖；失败不阻断合成主流程）。
    await recordAssetHistory(registry, projectId, { file: outputName, tool: 'compose' }).catch(() => {})
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
  /**
   * 三期 W5-4：草稿档产物标。
   *
   * `render_composition` 用 `quality: 'draft'` 渲出来的片（半分辨率 / 低码率 /
   * 10s 关键帧间隔）**同样落画布、同样参与版本链**，但必须一眼能和交付档区分开 ——
   * 否则用户会把「快速看一版」的粗片当最终成片交付。角标由 CanvasNode 渲染。
   */
  draft?: boolean
}

/**
 * 把合成结果写为画布节点（video-composite，origin=agent，血缘指向源片段），
 * 返回新建节点。位置沿用 4 列网格；真实分辨率写入 mediaWidth/mediaHeight，
 * 文案写入 `script`，使详情面板可展示。客户端工具/结果重载后即出现在画布。
 * 节点框按真实分辨率等比换算（竖屏成片不再被 260×180 横屏占位框 cover 裁切）。
 *
 * **O-13：`draft: true` 时不再 append —— 就地替换当前活动的草稿成片节点**
 * （同一 id / 位置 / 框尺寸，只换 url 与真值），画布上永远只有一个草稿预览。
 * 交付档仍走「append + supersede 上一版」（CV-108 的版本链要留）。
 */
export async function appendComposedVideoNode(
  registry: ProjectRegistry,
  projectId: string,
  input: ComposedNodeInput,
): Promise<StudioCanvasNode> {
  const existing = (await registry.readCanvas(projectId)).nodes
  // CV-108：成片也进版本链——重新合成后旧成片标记失效（保留在画布上供对比，
  // 但不再被当作「当前成片」，避免多个成片并列分不清最终版）。
  const previousComposed = existing.filter((node) => node.toolName === 'compose' && isActiveShot(node))
  // O-13：**草稿档就地替换上一版草稿**。
  //
  // 真机症状：7 次成功渲染 ⇒ 画布上 7 个 video-composite 节点并排（6 个 draft:true，
  // 各约 1MB），用户得手工清，画布随迭代线性膨胀。草稿是「快速看一版」的一次性预览，
  // 它的历史价值是 0（要看的是当前这一版）；而交付档必须留版本链（CV-108）供对比回滚。
  //
  // 所以只对 draft 做替换：复用同一节点 id / 位置 / 框尺寸（用户手动摆过的位置不动），
  // 只换 url / 时长 / 真值像素 / 血源 / 音轨构成，版本号 +1。交付档照旧 append + supersede。
  if (input.draft === true) {
    const previousDraft = previousComposed
      .filter((node) => node.draft === true)
      .sort((a, b) => b.createdAt - a.createdAt)[0]
    if (previousDraft !== undefined) {
      const updated: StudioCanvasNode = {
        ...previousDraft,
        url: input.url,
        title: `草稿成片 ${new Date().toLocaleString('zh-CN')}`,
        ...(input.duration !== undefined ? { duration: input.duration } : {}),
        ...(input.width !== undefined ? { mediaWidth: input.width } : {}),
        ...(input.height !== undefined ? { mediaHeight: input.height } : {}),
        sourceIds: input.sourceIds,
        ...(input.audioComposition !== undefined ? { audioComposition: input.audioComposition } : {}),
        ...(input.script !== undefined ? { script: input.script } : {}),
        draft: true,
        shotVersion: (previousDraft.shotVersion ?? 1) + 1,
      }
      await registry.writeCanvas(
        projectId,
        existing.map((node) => (node.id === previousDraft.id ? updated : node)),
      )
      return updated
    }
  }
  // 版本号对**所有**成片求最大值（不只 active）：上一版被取代后 active 集合会空，
  // 只看 active 会让版本号从 1 重来（O-13 顺带修的口径问题）。
  const composedVersion = existing.reduce(
    (max, node) => (node.toolName === 'compose' ? Math.max(max, node.shotVersion ?? 1) : max),
    0,
  ) + 1
  const supersedeIds = previousComposed.map((node) => node.id)
  // 宽高齐备时按真实分辨率换算显示框（1:1→420×420、9:16→267×480、16:9→480×270，
  // 各自由 C10 的 frameSizeOf 再补上镜头条 chrome）；探测失败回退横屏占位，
  // 由客户端媒体加载后的框比例校正兜底。
  const size = input.width !== undefined && input.height !== undefined && input.width > 0 && input.height > 0
    ? frameSizeOf({ width: input.width, height: input.height })
    : COMPOSED_FALLBACK_SIZE
  // CV-184：成片落点改走唯一入口（此前是本文件自己写的一份裸网格 40/300/240，
  // 没有血缘避让 —— 480 宽的成片走 300 的步距必然压住前一格）。
  const placement = deriveNodePlacement(existing, input.sourceIds, size.width, size.height)
  const node: StudioCanvasNode = {
    id: newAssetId(),
    kind: 'video',
    title: `${input.draft === true ? '草稿成片' : '成片'} ${new Date().toLocaleString('zh-CN')}`,
    url: input.url,
    ...(input.duration !== undefined ? { duration: input.duration } : {}),
    ...(input.width !== undefined ? { mediaWidth: input.width } : {}),
    ...(input.height !== undefined ? { mediaHeight: input.height } : {}),
    x: placement.x,
    y: placement.y,
    width: size.width,
    height: size.height,
    createdAt: Date.now(),
    toolName: 'compose',
    origin: 'agent',
    sourceIds: input.sourceIds,
    operationType: 'video-composite',
    ...(input.audioComposition !== undefined ? { audioComposition: input.audioComposition } : {}),
    // 三期 W5-4：只有草稿档才写（缺省不写 ⇒ 老节点与交付档节点的落盘形态一字不变）。
    ...(input.draft === true ? { draft: true } : {}),
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
