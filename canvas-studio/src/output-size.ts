/**
 * 档位 → 像素 / megapixels 的**派生视图**（不再是事实源）。
 *
 * 2026-10-27 起事实源统一到 `resolution-tiers.ts`（显示名 / 内部键 / 后台真值同表）。
 * 本模块只把那张表拍平成两个 `Record`，供既有调用点继续用下标访问
 * （`OUTPUT_SIZE[resolution]` / `MEGAPIXELS_BY_RESOLUTION[resolution]`），
 * **不要在这里补任何新数字** —— 补进来就又长了第二张表。
 *
 * 为什么保留独立文件而不是直接删：`config.ts` 顶部 import 了 `node:crypto`（Host 专属），
 * 而客户端 bundle 与 node:test 直连的纯函数模块都不能拖它 —— 本文件是纯数据，
 * 三方（Host / client / 测试）共用同一份。
 */
import { RESOLUTION_TIERS, type ResolutionFrame, type ResolutionId } from './resolution-tiers.js'

/**
 * 档位 → 16:9 基准输出像素（宽高均为 32 的倍数）。
 *
 * 视频端点只收 `megapixels`，像素由 H3 表反推；图片端点直接发这组像素
 * （2026-09-15 实测逐字节一致）⇒ 本表即「声明的分辨率」。
 */
export const OUTPUT_SIZE = Object.fromEntries(
  RESOLUTION_TIERS.map(tier => [tier.id, { ...tier.frames['16:9'] }]),
) as Record<ResolutionId, ResolutionFrame>

/**
 * 档位 → megapixels（视频端点唯一旋钮，H3 官方表 0.4 / 1.0 / 2.0）。
 *
 * 改造前这里是手填的 0.4 / 0.9 / 2.0 —— 0.9 不在任何官方表内，且与 `docs/api.md`
 * 的另一处（1.0）直接矛盾。现由 `resolution-tiers.ts` 单点定义。
 */
export const MEGAPIXELS_BY_RESOLUTION = Object.fromEntries(
  RESOLUTION_TIERS.map(tier => [tier.id, tier.megapixels]),
) as Record<ResolutionId, number>
