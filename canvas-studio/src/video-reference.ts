/**
 * H3 官方参考视频规格与校验（纯函数，Host 侧使用）。
 *
 * 与 `audio-reference.ts` 同构，差别有一处**关键**：**参考视频可以作唯一输入**
 * （官方只限制音频不能唯一）。故本模块没有 `visualCount` 参数。
 *
 * 官方规格（MiniMax H3 多源交叉核实：minimax.io 官方开源公告的 H3-Base-Ref2VA
 * 规格表 + ToAPIs `MiniMax-H3` API reference，两处逐条一致）：
 *
 * | 项 | 规格 |
 * | --- | --- |
 * | 数量 | ≤ 3 段 |
 * | 单段时长 | 2–15s |
 * | **合计时长** | **≤ 15s** |
 * | 格式 | MP4 / MOV（H.264/AVC 或 H.265/HEVC） |
 * | 单段大小 | ≤ 50MB |
 * | 组合 | 可作为**唯一**输入（与音频相反） |
 * | 模式 | 与帧模式（first_frame / last_frame）互斥 |
 * | 总文件数 | 图 + 视频 + 音频 **≤ 12**（图 ≤9 / 视频 ≤3 / 音频 ≤3） |
 *
 * 另注：参考视频**自带的音轨也计入音频预算**（官方按 15s 总量校验），本项目
 * 目前只支持独立音频文件，故未涉及。
 */

import { extensionOf } from './media-extension.js'

/** 官方上限：参考视频段数。 */
export const H3_VIDEO_MAX_CLIPS = 3

/** 官方下限：单段视频时长（秒）。 */
export const H3_VIDEO_MIN_SECONDS = 2

/** 官方上限：单段视频时长（秒）。 */
export const H3_VIDEO_MAX_SECONDS = 15

/** 官方上限：全部参考视频合计时长（秒）。 */
export const H3_VIDEO_TOTAL_SECONDS = 15

/** 官方上限：单段视频文件大小（字节）。 */
export const H3_VIDEO_MAX_BYTES = 50 * 1024 * 1024

/** 官方支持的视频容器（小写扩展名，含点）。 */
export const H3_VIDEO_EXTENSIONS: readonly string[] = ['.mp4', '.mov']

/** 官方上限：图 + 视频 + 音频的**文件总数**。 */
export const H3_MAX_TOTAL_FILES = 12

/** 一条待校验的参考视频。时长/大小由调用方实测提供，未知时传 undefined 跳过该项。 */
export interface VideoReferenceInput {
  /** 文件标识（Drama filename 或本地文件名），仅用于错误文案。 */
  readonly label: string
  /** 实测时长（秒）。未知传 undefined → 跳过时长项校验。 */
  readonly seconds?: number | undefined
  /** 实测字节数。未知传 undefined → 跳过大小项校验。 */
  readonly bytes?: number | undefined
}

/** 校验问题。`code` 供测试/调用方分支，`message` 面向 agent 与用户。 */
export interface VideoReferenceIssue {
  readonly code:
    | 'too-many'
    | 'too-short'
    | 'too-long'
    | 'total-too-long'
    | 'too-large'
    | 'bad-format'
    | 'too-many-files'
  readonly message: string
}

/**
 * 按官方规格校验参考视频集合。
 *
 * 顺序即 `<Video N>` 的编号顺序（官方按 prompt 里的引用顺序对齐），
 * 故本函数不改写顺序、不排序。
 *
 * @param refs 待校验视频（顺序敏感）。
 * @returns 问题列表；空数组 = 全部通过。
 */
export function validateH3VideoReferences(refs: readonly VideoReferenceInput[]): VideoReferenceIssue[] {
  const issues: VideoReferenceIssue[] = []
  if (refs.length === 0) return issues

  if (refs.length > H3_VIDEO_MAX_CLIPS) {
    issues.push({
      code: 'too-many',
      message: `参考视频最多 ${H3_VIDEO_MAX_CLIPS} 段，当前 ${refs.length} 段`,
    })
  }

  let total = 0
  let allKnown = true
  for (const ref of refs) {
    const ext = extensionOf(ref.label)
    if (ext !== '' && !H3_VIDEO_EXTENSIONS.includes(ext)) {
      issues.push({
        code: 'bad-format',
        message: `${ref.label} 格式不支持：官方仅接受 ${H3_VIDEO_EXTENSIONS.join(' / ')}（H.264/AVC 或 H.265/HEVC）`,
      })
    }
    if (ref.bytes !== undefined && ref.bytes > H3_VIDEO_MAX_BYTES) {
      issues.push({
        code: 'too-large',
        message: `${ref.label} 超过单段 ${Math.round(H3_VIDEO_MAX_BYTES / 1024 / 1024)}MB 上限`,
      })
    }
    if (ref.seconds === undefined) {
      allKnown = false
      continue
    }
    total += ref.seconds
    if (ref.seconds < H3_VIDEO_MIN_SECONDS) {
      issues.push({
        code: 'too-short',
        message: `${ref.label} 时长 ${ref.seconds.toFixed(1)}s 低于 ${H3_VIDEO_MIN_SECONDS}s 下限`,
      })
    } else if (ref.seconds > H3_VIDEO_MAX_SECONDS) {
      issues.push({
        code: 'too-long',
        message: `${ref.label} 时长 ${ref.seconds.toFixed(1)}s 超过单段 ${H3_VIDEO_MAX_SECONDS}s 上限`,
      })
    }
  }

  // 合计上限只在全部时长已知时判定：部分未知就下结论会误报（与音频侧同一纪律）。
  if (allKnown && total > H3_VIDEO_TOTAL_SECONDS) {
    issues.push({
      code: 'total-too-long',
      message: `参考视频合计 ${total.toFixed(1)}s 超过 ${H3_VIDEO_TOTAL_SECONDS}s 上限`
        + '（官方按总量校验：超限部分会被截断或整单被拒）',
    })
  }
  return issues
}

/** 本次请求的跨模态素材计数（图 / 视频 / 音频三路）。 */
export interface H3ReferenceBudget {
  readonly images: number
  readonly videos: number
  readonly audios: number
}

/**
 * 校验官方的**文件总数**上限（图 + 视频 + 音频 ≤ 12）。
 *
 * 这条规则横跨三个模态：单看每一路都不超（9 / 3 / 3），合起来却可能到 15。
 * 故独立成一个函数，由上层在发请求前调用一次。
 */
export function validateH3ReferenceBudget(budget: H3ReferenceBudget): VideoReferenceIssue[] {
  const total = budget.images + budget.videos + budget.audios
  if (total <= H3_MAX_TOTAL_FILES) return []
  return [{
    code: 'too-many-files',
    message: `本次共 ${total} 个参考文件（图 ${budget.images} + 视频 ${budget.videos} + 音频 ${budget.audios}）`
      + `，超过官方合计上限 ${H3_MAX_TOTAL_FILES} 个`,
  }]
}
