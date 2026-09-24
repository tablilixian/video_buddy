/**
 * 文件名扩展名解析与四类媒体文件分类（纯函数）。
 *
 * 音频（`audio-reference.ts`）与视频（`video-reference.ts`）两侧都要按扩展名
 * 做格式把关。**同一规则只准一份实现** —— 故提升到这里，两侧共用。
 *
 * CV-241：图片 / 视频 / 音频 / 文字统一上传 —— 分类白名单、分类型限额与
 * 错误文案标签的**唯一来源**（Host 与 Client 同仓共用，无 DOM 依赖）。
 */

/** 取小写扩展名（含点）；无扩展名返回空串。 */
export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot < 0 ? '' : filename.slice(dot).toLowerCase()
}

/** 统一上传入口接受的四类文件。 */
export type MediaKind = 'image' | 'video' | 'audio' | 'text'

/** 全部 kind 的稳定顺序（分类遍历 / accept 拼接共用）。 */
export const MEDIA_KINDS = ['image', 'video', 'audio', 'text'] as const satisfies readonly MediaKind[]

/**
 * 四类扩展白名单（首版，可表驱动扩展）。`extensionOf` 的输出形态（小写、含点）。
 *
 * - image 含 bmp：与 `ASSET_CONTENT_TYPES` 及既有落盘口径一致，避免回归。
 * - video 含 m4v / avi：对齐托管 Content-Type 表（拖放分类用；上传仍走 `/upload-video`）。
 * - audio 含 opus：计划 §5.2 首版白名单。
 */
export const MEDIA_EXTENSIONS: Readonly<Record<MediaKind, readonly string[]>> = {
  image: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'],
  video: ['.mp4', '.mov', '.webm', '.mkv', '.m4v', '.avi'],
  audio: ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus'],
  text: ['.txt', '.md', '.json', '.csv', '.log'],
}

/**
 * 分类型上传限额（原始字节；Q2 拍板）。image 与旧 `MAX_BODY_BYTES` 数值一致
 * 但按**原始字节**计（base64 膨胀消失后实际可用变大）；video 走独立
 * `/upload-video`（128MB），此表作文档与 Step 2 新端点校验同源。
 */
export const MEDIA_UPLOAD_LIMITS: Readonly<Record<MediaKind, number>> = {
  image: 16 * 1024 * 1024,
  audio: 32 * 1024 * 1024,
  text: 5 * 1024 * 1024,
  video: 128 * 1024 * 1024,
}

/** 四类的中文标签（错误文案 / toast 用，不散写死字符串）。 */
export const MEDIA_KIND_LABEL: Readonly<Record<MediaKind, string>> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  text: '文本',
}

/**
 * 按扩展名分类；未知 / 无扩展名返回 null。
 *
 * **绝不静默、绝不伪装类别** —— 调用方拿到 null 必须给出用户可见的拒绝提示。
 * 纯函数，供拖放分发、工具栏 accept、服务端落盘校验共用。
 */
export function classifyFile(fileName: string): MediaKind | null {
  const ext = extensionOf(fileName)
  if (ext === '') return null
  for (const kind of MEDIA_KINDS) {
    if (MEDIA_EXTENSIONS[kind].includes(ext)) return kind
  }
  return null
}

/** 四类白名单并集（工具栏 / 文件选择器的 `accept` 属性）。 */
export function mediaAcceptAttribute(): string {
  return MEDIA_KINDS.flatMap((kind) => MEDIA_EXTENSIONS[kind]).join(',')
}
