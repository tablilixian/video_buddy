/**
 * 「本地现成产物 → 画布节点」登记（2026-11-10 香水样本 P0-2 收口）。
 *
 * ## 病灶（不是「模型偷懒」，是**没有合规工具**）
 *
 * 真机会话（`香水视频dsh-session-session-d3ab688d-…`）第 4 轮：用户要看的草稿是一段
 * 已经躺在 `build/draft-final-480p.mp4` 的 mp4。当时没有任何工具能把它挂上画布 ——
 * `upload_image` 只传后端拿句柄、**不建节点**（契约里也没写它只收图片），`download_video`
 * 只吃视频页链接。于是模型做了三件错事：手写 `build/manifest.json` → 被「先 scaffold_manifest」
 * 拒收（护栏本身是对的，但**没给出路**）→ `cp canvas.json build/canvas.json.bak && node -e …`
 * 直接改盘。
 *
 * 绕过 `registry.writeCanvas` 的后果不是「难看」，而是**正确性**：没有 merge-protect
 * （并发客户端保存会被整档盖掉）、没有 `touchUpdatedAt`、资产不进历史账、节点不在
 * 资产链里。本模块给「只想把现成产物放上画布」这条真实需求一个一等公民入口，
 * 拒收文案才有资格继续拦手写 manifest。
 *
 * ## 判据（复刻 CV-459 `storyboard-user-refs.ts` 的「Host 确定性登记」范式）
 *
 * 登记是 Host 行为，不是模型行为：扩展名分类（`classifyFile`，唯一来源）+ 魔数复核
 * （防 `.png` 里装 mp4）→ `saveLocalAssetBytes`（唯一落盘入口，进资产历史）→
 * `appendCanvasNode`（`writeCanvas` 写口家族的追加面，**入队 + merge-protect**）→
 * `tool/result` 触发客户端 `reloadCanvas`（工具名登记在 `asset-capture.ts` 的
 * `WORKFLOW_TOOLS`，漏登记 = 落盘了画布不刷新，CV-130 同款坑）。
 *
 * 模型只负责「补语义」（标题 / 时长 / 是不是参考素材），不再负责「保证写进去」。
 */
import { open, readFile, stat } from 'node:fs/promises'
import { basename, isAbsolute } from 'node:path'
import { DEFAULT_NODE_SIZE, frameSizeOf } from './canvas-aspect.js'
import { deriveNodePlacement } from './canvas-placement.js'
import { newAssetId } from './config.js'
import type { StudioCanvasNode } from './contracts/canvas.js'
import { throwError } from './error-system.js'
import { probeMediaInfo, type MediaInfo } from './ffmpeg-run.js'
import { saveLocalAssetBytes } from './generate.js'
import { MEDIA_KIND_LABEL, MEDIA_UPLOAD_LIMITS, classifyFile, type MediaKind } from './media-extension.js'
import type { ProjectRegistry } from './projects.js'
import { resolveAssetPathIn } from './asset-path.js'

/** 工具名常量：拒收文案与 `asset-capture` 的刷新白名单都引用它，避免三处各写一遍。 */
export const ATTACH_CANVAS_ASSET_TOOL = 'attach_canvas_asset'

/** 本工具只接三类**媒体**（文本请用 `write_note`，见工具描述）。 */
export type AttachableKind = Exclude<MediaKind, 'text'>

/** 魔数嗅探窗口（≥16B；ftyp 在 4..8）。 */
const HEAD_BYTES = 32

/** 嗅探结论 → 人话（拒收文案用）。 */
const KIND_LABEL: Readonly<Record<MediaKind, string>> = MEDIA_KIND_LABEL

/** 头部字节的 latin1 视图（魔数全是 ASCII 或定长字节，用字符串比较最省事）。 */
function ascii(head: Uint8Array, from: number, to: number): string {
  return Buffer.from(head.slice(from, to)).toString('latin1')
}

function startsWith(head: Uint8Array, ascii4: string): boolean {
  return head.length >= ascii4.length && ascii(head, 0, ascii4.length) === ascii4
}

/**
 * 按**文件头魔数**判类别（纯函数）。认不出返回 null —— 调用方退回扩展名判据，
 * 不因为「没见过这种头」就拒收（`mkv`/`aac` 的变体多）。
 *
 * 为什么必须有这一层：`upload_image` 吞下 `.mp4` 的直接原因就是**只看扩展名**，
 * 而 provider / 用户导出常出现「名字是 png、内容其实是 mp4」的临时文件。
 */
export function sniffMediaKind(head: Uint8Array): MediaKind | null {
  if (head.length < 4) return null
  const riff = startsWith(head, 'RIFF')
  if (riff) {
    const form = head.length >= 12 ? ascii(head, 8, 12) : ''
    if (form === 'WEBP') return 'image'
    if (form === 'AVI ') return 'video'
    if (form === 'WAVE') return 'audio'
    return null
  }
  if (head[0] === 0x89 && startsWith(head, '\x89PNG')) return 'image'
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image'
  if (startsWith(head, 'GIF8')) return 'image'
  if (startsWith(head, 'BM')) return 'image'
  // ISO BMFF（mp4 / mov / m4v / m4a）：第 4..8 字节恒为 `ftyp`。
  if (head.length >= 8 && ascii(head, 4, 8) === 'ftyp') {
    const brand = ascii(head, 8, 12)
    return brand.startsWith('M4A') || brand.startsWith('M4B') ? 'audio' : 'video'
  }
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'video'
  if (startsWith(head, 'ID3')) return 'audio'
  if (head[0] === 0xff && (head[1] !== undefined && (head[1] & 0xe0) === 0xe0)) return 'audio'
  if (startsWith(head, 'fLaC') || startsWith(head, 'OggS')) return 'audio'
  return null
}

/**
 * `upload_image` 的**非图片**拦截判据（纯函数，返回 null 表示放行）。
 *
 * 契约含糊的直接代价：真机会话把一个 mp4 交给 `upload_image`，拿到一个「成功」的
 * 句柄，用户以为它会出现在画布上。这里只判**能确定**的情形（扩展名落在视频 / 音频 /
 * 文本白名单）——拿不准就不拦，避免把带 query 的外链误杀。
 */
export function nonImageUploadReason(imageUrl: string): string | null {
  const file = fileNameOf(imageUrl)
  if (file === '') return null
  const kind = classifyFile(file)
  if (kind === null || kind === 'image') return null
  return `imageUrl 指向的是${KIND_LABEL[kind]}（${file}），本工具仅上传图片。`
    + `要把现成的 ${kind === 'video' ? 'mp4' : KIND_LABEL[kind]} 挂到画布，用 \`${ATTACH_CANVAS_ASSET_TOOL}\``
    + '（本地路径 → 画布节点，一步到位）；`upload_image` 只上传、**不创建画布节点**。'
}

/** URL / 路径的末段文件名（去 query / hash / 解码）；取不到返回空串。 */
export function fileNameOf(raw: string): string {
  const noQuery = raw.split(/[?#]/u)[0] ?? ''
  const tail = noQuery.split('/').pop() ?? ''
  try {
    return decodeURIComponent(tail)
  } catch {
    return tail
  }
}

/** 读文件头（只读前 N 字节，不把 128MB 视频读两遍）。 */
async function readHead(path: string, length = HEAD_BYTES): Promise<Uint8Array> {
  const handle = await open(path, 'r')
  try {
    const buffer = new Uint8Array(length)
    const { bytesRead } = await handle.read(buffer, 0, length, 0)
    return buffer.slice(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/** 工具入参（schema 之外的结构形态；`kind` 故意收 string 以便报错能说清支持哪些）。 */
export interface AttachCanvasAssetInput {
  readonly path: string
  readonly kind?: string
  readonly title?: string
  readonly duration?: number
  readonly width?: number
  readonly height?: number
  readonly asReference?: boolean
}

/** 登记结果（回执与测试断言共用同一形态）。 */
export interface AttachCanvasAssetOutcome {
  readonly nodeId: string
  readonly kind: AttachableKind
  readonly title: string
  /** 同源画布资产 URL（`/canvas-studio/assets/<projectId>/<file>`）。 */
  readonly url: string
  readonly assetFile: string
  readonly bytes: number
  readonly width: number
  readonly height: number
  readonly duration?: number
  /** 时长 / 尺寸是否来自 ffmpeg 实测（false = 用入参或未知）。 */
  readonly probed: boolean
}

function reject(message: string, detail: string): never {
  throwError('CS-USER-ERR', { message, detail })
}

/** `kind` 入参 → 可登记类别（未传按扩展名推）。 */
function resolveKind(input: AttachCanvasAssetInput, file: string): AttachableKind {
  const byExtension = classifyFile(file)
  if (input.kind === undefined || input.kind === '') {
    if (byExtension === null || byExtension === 'text') {
      reject(
        `认不出这是什么媒体：${file}。请传 path 指向图片 / 视频 / 音频文件（png jpg webp / mp4 mov webm / mp3 wav m4a），或用 kind 显式说明。`,
        `unknown extension: ${file}`,
      )
    }
    return byExtension
  }
  if (input.kind !== 'image' && input.kind !== 'video' && input.kind !== 'audio') {
    reject(
      `kind 只支持 image / video / audio（收到 ${input.kind}）。文本请用 write_note 落便签，不要当媒体登记。`,
      `invalid kind: ${input.kind}`,
    )
  }
  // 显式 kind 与扩展名互相印证：不一致时**拒绝**而不是二选一 —— 两个判据打架说明
  // 要么文件名错、要么模型把内容记错了，任何一种都会让下游按错类型取用。
  if (byExtension !== null && byExtension !== input.kind) {
    reject(
      `kind（${input.kind}）与文件扩展名（.${file.split('.').pop() ?? ''} ⇒ ${byExtension}）不一致。`
        + '请核实这份产物到底是什么，再按真实类型登记。',
      `kind/extension mismatch: ${input.kind} vs ${byExtension}`,
    )
  }
  return input.kind
}

/**
 * 登记入口：本地路径 → 资产落盘 → 画布节点（**唯一写口**，不碰 `canvas.json`）。
 *
 * 任何一步失败都抛 `CS-USER-ERR`（面向用户、可行动），不做静默降级 —— 与 CV-459
 * 的「登记失败不拖死画布落卡」不同：那条路是**旁路登记**（节点已经在），这条路
 * 用户等的就是这一个节点，静默成功等于骗人。
 */
export async function attachCanvasAsset(
  registry: ProjectRegistry,
  projectId: string,
  input: AttachCanvasAssetInput,
  options: { signal?: AbortSignal } = {},
): Promise<AttachCanvasAssetOutcome> {
  if (typeof input.path !== 'string' || input.path.trim() === '') {
    reject('path 不能为空：传本地文件的绝对路径（如 /Users/…/build/draft-final-480p.mp4）。', 'empty path')
  }
  const source = input.path.trim()
  if (/^https?:\/\//u.test(source)) {
    reject(
      'path 只接**本地绝对路径**。链接请分两种：视频页（抖音 / B站 / YouTube）用 download_video；'
        + '外部图片链接用 upload_image。',
      `remote url rejected: ${source.slice(0, 120)}`,
    )
  }
  if (!isAbsolute(source)) {
    reject(`path 必须是绝对路径（收到相对路径 ${source}）—— 当前工作目录因会话而异，相对路径会落到别处。`, 'relative path')
  }

  const file = basename(source)
  const kind = resolveKind(input, file)

  let size = 0
  try {
    const info = await stat(source)
    if (!info.isFile()) reject(`path 不是普通文件：${source}`, 'not a regular file')
    size = info.size
  } catch (cause) {
    if (cause !== null && typeof cause === 'object' && 'code' in cause && (cause as { code: unknown }).code === 'ENOENT') {
      reject(`文件不存在：${source}。请先确认产物真的落在这个路径（不要凭记忆编路径）。`, 'ENOENT')
    }
    reject(
      `读不到这个文件：${source}（${cause instanceof Error ? cause.message : String(cause)}）—— 请确认路径与读权限。`,
      'stat failed',
    )
  }
  if (size === 0) reject(`文件是空的（0 字节），没有可登记的内容：${source}`, 'empty file')
  const limit = MEDIA_UPLOAD_LIMITS[kind]
  if (size > limit) {
    reject(
      `文件 ${(size / 1024 / 1024).toFixed(1)}MB 超过${KIND_LABEL[kind]}上限 ${(limit / 1024 / 1024).toFixed(0)}MB —— 请先压缩或裁短再登记。`,
      `oversize: ${size} > ${limit}`,
    )
  }

  const head = await readHead(source)
  const sniffed = sniffMediaKind(head)
  if (sniffed !== null && sniffed !== kind) {
    reject(
      `文件内容看起来是${KIND_LABEL[sniffed]}，但名字/kind 说是${KIND_LABEL[kind]}（${file}）。`
        + '按错类型挂上画布会让下游取错轨道，本次未登记 —— 请核实后按真实类型再来。',
      `magic mismatch: sniffed=${sniffed} declared=${kind}`,
    )
  }

  const bytes = await readFile(source)
  const saved = await saveLocalAssetBytes(registry, projectId, file, bytes)

  // 时长 / 尺寸：入参优先（模型刚探测过时省一次 ffmpeg），否则实测。
  // `probeMediaInfo` 绝不抛错，测不到就返回 0 ⇒ 按「未知」落节点，不阻断登记。
  const needProbe = kind !== 'image'
    && !(typeof input.duration === 'number' && input.duration > 0)
  const probe: MediaInfo = needProbe
    ? await probeMediaInfo(resolveAssetPathIn(registry.assetsDir(projectId), saved.assetFile), undefined, options.signal)
    : { duration: 0 }
  const duration = typeof input.duration === 'number' && input.duration > 0
    ? input.duration
    : probe.duration > 0 ? probe.duration : undefined
  const width = positive(input.width) ?? probe.width
  const height = positive(input.height) ?? probe.height
  const probed = needProbe && probe.duration > 0

  const title = typeof input.title === 'string' && input.title.trim() !== ''
    ? input.title.trim()
    : file
  const box = width !== undefined && height !== undefined
    ? frameSizeOf({ width, height })
    : { ...DEFAULT_NODE_SIZE }

  const existing = await registry.readCanvas(projectId)
  const placement = deriveNodePlacement(existing.nodes, [], box.width, box.height)
  const node: StudioCanvasNode = {
    id: newAssetId(),
    kind,
    title,
    url: saved.url,
    ...(duration !== undefined ? { duration } : {}),
    ...(width !== undefined ? { mediaWidth: width } : {}),
    ...(height !== undefined ? { mediaHeight: height } : {}),
    x: placement.x,
    y: placement.y,
    width: box.width,
    height: box.height,
    createdAt: Date.now(),
    toolName: ATTACH_CANVAS_ASSET_TOOL,
    origin: 'agent',
    sourceIds: [],
    operationType: 'import',
    // 参考素材身份：默认不标（成片 / 草稿是产物，不是参考）；模型显式要求时才标，
    // 标了才进素材托盘与 §07 引用链。
    ...(input.asReference === true
      ? { isReference: true, referenceRole: kind === 'image' ? 'image' as const : 'source' as const }
      : {}),
  }
  await registry.appendCanvasNode(projectId, node)

  return {
    nodeId: node.id,
    kind,
    title,
    url: saved.url,
    assetFile: saved.assetFile,
    bytes: size,
    width: box.width,
    height: box.height,
    ...(duration !== undefined ? { duration } : {}),
    probed,
  }
}

/** 正数才收（0 / 负数 / NaN 一律当「没给」）。 */
function positive(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}
