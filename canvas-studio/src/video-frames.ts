/**
 * Canvas Studio C3 尾帧链（Host 侧）。
 *
 * 取视频片段的**真实末帧**（而不是分镜图 / 关键帧）作下一镜的首帧输入，实现
 * 同场景连续镜头（chain）的像素级衔接 —— Veo 3.1 Scene Extension 与 deepwiki
 * extract-last-frame 的共同工程结论：链帧必须来自生成产物的末帧，任何「用分镜
 * 图近似」的做法都会在切点处产生跳变。
 *
 * ffmpeg 复用 `ffmpeg-run`（与 compose / video-style 同一套解析顺序）；帧图落
 * 项目 assets 目录并回传 Drama 取 filename，使产物可直接填进 video_generate 的
 * `filename` 或 video_composite 的 `filenames`（首帧位）。画布节点由 Host 落盘
 * （单一真相源），客户端在 tool/result 时重载即可见。
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProjectRegistry } from './projects.js'
import type { StudioCanvasNode } from './contracts/canvas.js'
import { newAssetId } from './config.js'
import { uploadBytesToDrama, deriveNodePlacement } from './generate.js'
import { urlToAssetPath } from './compose.js'
import { frameSizeOf, DEFAULT_NODE_SIZE } from './canvas-aspect.js'
import {
  resolveFfmpegPath,
  runFfmpeg,
  parseFfmpegStreams,
  parseFfmpegDuration,
  FFMPEG_TIMEOUT_MS,
} from './ffmpeg-run.js'

/**
 * 末帧内缩秒数：从「时长 - ε」处抽帧。直接 seek 到时长末尾可能取到容器尾部的
 * 空帧 / 黑帧，内缩一帧多一点更稳（25fps 下 ε=0.05s ≈ 1.25 帧）。
 */
const LAST_FRAME_EPSILON_SEC = 0.05

/** 帧图节点缺分辨率时的回退**节点框**尺寸（与成片回退一致，见 canvas-aspect
 *  的 DEFAULT_NODE_SIZE = 画面 260×180 + 镜头条 chrome）。
 *  C10：改取统一出口 —— 直接内联使用，此处不再另存一份副本。 */

/**
 * 规划末帧抽帧时间点（纯函数）：时长未知 / 非正时取 0；否则取
 * `时长 - ε`（两位小数，不低于 0）。
 */
export function planLastFrameSeek(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0
  const seek = Math.round((durationSec - LAST_FRAME_EPSILON_SEC) * 100) / 100
  return Math.max(0, seek)
}

/** 末帧抽取结果。 */
export interface LastFrameResult {
  /** 末帧图的同源 URL（画布节点已落盘）。 */
  url: string
  /** 末帧图的 Drama Backend 文件名（可直接作下游工具输入）。 */
  filename: string
  /** 探测到的源视频时长（秒；探测失败为 0）。 */
  duration: number
  /** 帧图宽度（像素；探测失败为 undefined）。 */
  width?: number
  /** 帧图高度（像素；探测失败为 undefined）。 */
  height?: number
  /** 落盘节点 id（便于后续按节点引用）。 */
  nodeId: string
}

/** 可选覆盖项（测试注入 / 高级用法）。 */
export interface LastFrameOptions {
  /** 显式指定 ffmpeg 可执行文件路径。 */
  ffmpegPath?: string
  /** 上传帧图取 filename 的实现；缺���用 `uploadBytesToDrama`（Drama uploadimage）。 */
  upload?: (bytes: Uint8Array, signal?: AbortSignal) => Promise<string>
}

/**
 * 抽取某视频节点的真实末帧并落画布。
 *
 * @param registry - project registry（读画布、落节点、定位 assets 目录）。
 * @param projectId - target project id.
 * @param videoUrl - 视频节点的同源 URL（video_generate / video_composite 返回的 url）。
 * @param options - ffmpeg 路径与上传实现覆盖。
 * @param signal - 取消信号（用户中断 / 请求断开）。
 * @throws 视频文件不存在、ffmpeg 不可用、抽帧失败时抛中文错误。
 */
export async function extractLastFrame(
  registry: ProjectRegistry,
  projectId: string,
  videoUrl: string,
  options: LastFrameOptions = {},
  signal?: AbortSignal,
): Promise<LastFrameResult> {
  const document = await registry.readCanvas(projectId)
  const source = document.nodes.find((node) => node.kind === 'video' && node.url === videoUrl)
  const inputPath = urlToAssetPath(registry.assetsDir(projectId), videoUrl)
  if (!existsSync(inputPath)) {
    throw new Error(
      `视频文件不存在（${videoUrl}）。请确认传入的是本项目画布上视频节点的 url（video_generate / video_composite 工具返回的 url 字段）。`,
    )
  }

  const ffmpegPath = resolveFfmpegPath(options.ffmpegPath)
  // 1) 探测时长与分辨率：`ffmpeg -i`（无输出目标）以非零码结束属预期，元信息在 stderr。
  const probe = await runFfmpeg(ffmpegPath, ['-i', inputPath], FFMPEG_TIMEOUT_MS, signal)
  const duration = parseFfmpegDuration(probe.stderr)
  const streams = parseFfmpegStreams(probe.stderr)

  // 2) 抽末帧。-ss 放在 -i 之前走关键帧快速 seek，配合 -frames:v 1 只解一帧。
  const directory = registry.assetsDir(projectId)
  await mkdir(directory, { recursive: true })
  const frameId = newAssetId()
  const frameFile = `${frameId}.png`
  const framePath = join(directory, frameFile)
  const extraction = await runFfmpeg(
    ffmpegPath,
    ['-ss', planLastFrameSeek(duration).toFixed(2), '-i', inputPath, '-frames:v', '1', '-q:v', '2', '-y', framePath],
    FFMPEG_TIMEOUT_MS,
    signal,
  )
  if (extraction.code !== 0) {
    const detail = (extraction.stderr.trim().split('\n').at(-1) ?? '').slice(0, 200)
    throw new Error(`末帧抽取失败${detail.length > 0 ? `：${detail}` : ''}`)
  }
  if (!existsSync(framePath)) {
    throw new Error('末帧抽取失败：ffmpeg 正常退出但未产出帧图')
  }

  // 3) 回传 Drama 取 filename —— 下游 video_generate / video_composite 直接可用。
  const upload = options.upload ?? ((bytes: Uint8Array, sig?: AbortSignal) => uploadBytesToDrama(bytes, 'png', sig))
  const filename = await upload(new Uint8Array(await readFile(framePath)), signal)

  // 4) 落画布节点：标记为 frame 参考（进参考托盘，可用 @ref 引用），血缘指向源视频。
  //
  // C10：**两件事不能混** —— `streams.width/height` 是**媒体分辨率**（ffprobe 探到的
  // 1920×1080），`source.width/height` 是**节点框**。改前两者被塞进同一个 width/height
  // 变量直接当节点框写盘，于是源视频多高，末帧卡就有多宽（1920），靠客户端加载后的
  // 比例校正兜回来 —— 而 1920 宽的卡比例偏差只有 4.6%，**低于 5% 阈值，校不回来**。
  // 现在媒体分辨率一律走 frameSizeOf 换算成节点框（长边 480 + 镜头条 chrome），
  // 落盘即正确，校正无事可做。
  const box = streams.width !== undefined && streams.height !== undefined && streams.width > 0 && streams.height > 0
    ? frameSizeOf({ width: streams.width, height: streams.height })
    : source !== undefined
      ? { width: source.width, height: source.height }
      : { ...DEFAULT_NODE_SIZE }
  const sourceIds = source !== undefined ? [source.id] : []
  const placement = deriveNodePlacement(document.nodes, sourceIds, box.width, box.height)
  const node: StudioCanvasNode = {
    id: frameId,
    kind: 'image',
    url: `/canvas-studio/assets/${projectId}/${frameFile}`,
    title: `末帧 · ${source?.title ?? '视频片段'}`,
    isReference: true,
    referenceRole: 'frame',
    x: placement.x,
    y: placement.y,
    width: box.width,
    height: box.height,
    createdAt: Date.now(),
    toolName: 'extract_last_frame',
    runId: frameId,
    origin: 'agent',
    sourceIds,
    operationType: 'import',
    generationPrompt: JSON.stringify({ videoUrl, seek: planLastFrameSeek(duration) }),
  }
  await registry.appendCanvasNode(projectId, node)

  return {
    url: node.url!,
    filename,
    duration,
    ...(streams.width !== undefined ? { width: streams.width } : {}),
    ...(streams.height !== undefined ? { height: streams.height } : {}),
    nodeId: frameId,
  }
}
