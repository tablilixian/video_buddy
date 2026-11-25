/** REQ-041：段产物只读清单的跨端形状（Host 产出 / Client 消费，无 Node 依赖）。 */

/** 清单一条：一个可播放的段产物。 */
export interface SegmentMediaItem {
  id: string
  /** `spec:<spec 原始 id>`；只有发布时段表整表对齐才有。 */
  ref?: string
  /** assets 媒体路由的 URL（不含 `?v=`；客户端按 v 自己拼）。 */
  url: string
  startFrame: number
  frames: number
  durationSec: number
  /** 段文件 mtimeMs，用作缓存版本。 */
  v: number
}

export interface SegmentMediaView {
  projectId: string
  segments: SegmentMediaItem[]
}

/** `node.segmentRef` → 段视频 URL（带 `?v=` 缓存版本）。 */
export type SegmentMediaByRef = ReadonlyMap<string, string>
