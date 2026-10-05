/**
 * 分辨率档位 → 输出像素表（REQ-021 检查点库与 config.ts 共用的唯一事实源）。
 *
 * 从 `config.ts` 抽出的原因：`config.ts` 顶部 import 了 `node:crypto`（Host 专属），
 * 客户端 bundle 与 node:test 直连的纯函数模块都不能拖它。像素表本身是纯数据 ——
 * 独立成模块后，Host（config.ts 再出口）、客户端检查点库（auto-test-checkpoints.ts）、
 * 单测（tests/auto-test-checkpoints.test.mjs）三方共用同一份，不留第二张表。
 */
import type { VideoResolution } from './providers/types.js'

/**
 * 分辨率档位 → 输出像素（16:9 基准，宽高**均为 32 的倍数**）。**唯一事实来源**。
 *
 * 数值 = H3 推荐分辨率表的 0.4 / 1.0 / 2.0 三行，**不是自由取值**：
 * 视频端点（`image2videofl2va` / `image2videoref2va`）只收 `megapixels`，
 * 不收 width/height，像素只能由这张表反推。
 *
 * 为什么必须与真实产物同值：节点落盘写 `mediaWidth/mediaHeight`，而客户端只在
 * `mediaWidth === undefined` 时用自然尺寸回填（StudioFrame.tsx）——**已写入的值永不
 * 被纠正**。填表外的值（如旧的 1280×720）会让「声明的分辨率 ≠ 真实产物」永久留在
 * 画布上（详情面板给每个视频显示错误的数字）。
 */
export const OUTPUT_SIZE: Record<VideoResolution, { width: number; height: number }> = {
  '480p': { width: 864, height: 480 },
  '736p': { width: 1280, height: 736 },
  '2k': { width: 1920, height: 1088 },
}

/**
 * 档位 → megapixels（视频端点只收 `megapixels`，不收 width/height）。
 * 数值取自 H3 推荐分辨率表的 0.4 / 1.0 / 2.0 三行，与 `OUTPUT_SIZE` 同源。
 * Drama 视频适配器按当前档位取对应值，不再写死 0.4（CV-写死修复）。
 */
export const MEGAPIXELS_BY_RESOLUTION: Record<VideoResolution, number> = {
  '480p': 0.4,
  '736p': 0.9,
  '2k': 2.0,
}
