/**
 * 分辨率展示口径 ↔ 真值档位映射（REQ-028 拍板②的唯一权威表）。
 *
 * REQ-029（CV-281 Step 4）从 `lobby-spec.ts` **上提为共享模块**：首页规格选择器与
 * 节点输入框卡两块表面同源消费，防「两处映射各说各话」（拍板⑥：可见名统一
 * 480P/720P/1080P，内部键 480p/736p/2k 不动；BUG-053 的 agent 可见口径同步亦以此为准）。
 */

import type { VideoResolution } from './providers/types.js'

/** 分辨率的演示展示口径（label/meta 逐字取自演示 HTML 的三项菜单）。 */
export interface ResolutionDisplay {
  /** 内部真值档位（video_generate 等工具的 resolution 枚举）。 */
  readonly value: VideoResolution
  /** chip / 菜单里展示的演示口径名。 */
  readonly label: string
  /** 菜单右侧 meta（耗时倍数，以 720P 为 1× 基准；推荐档写「推荐」）。 */
  readonly meta: string
}

/**
 * 展示口径 → 真值档位映射（REQ-028 拍板②的唯一权威表）。
 *
 * 顺序即弹出框菜单顺序：480P（0.4×）→ 720P（推荐）→ 1080P（2.0×）。
 */
export const RESOLUTION_DISPLAY: readonly ResolutionDisplay[] = [
  { value: '480p', label: '480P', meta: '0.4×' },
  { value: '736p', label: '720P', meta: '推荐' },
  { value: '2k', label: '1080P', meta: '2.0×' },
]

/** 首页默认档位 = 演示默认（720P），映射到真值 736p（与 DEFAULT_RESOLUTION 同值）。 */
export const DEFAULT_LOBBY_RESOLUTION: VideoResolution = '736p'

/** 真值档位 → 展示口径（未知值回落默认档，防脏数据把 chip 渲染成 undefined）。 */
export function resolutionDisplay(value: VideoResolution | string | undefined): ResolutionDisplay {
  return RESOLUTION_DISPLAY.find((item) => item.value === value)
    ?? (RESOLUTION_DISPLAY.find((item) => item.value === DEFAULT_LOBBY_RESOLUTION) as ResolutionDisplay)
}
