/**
 * Canvas Studio P3 明文配置（验收后整理）。
 *
 * 优先读取环境变量，便于本地验收时切换；未设置时回退到下方明文常量。
 * 接口形态参考 WL-AI-Director 的 Drama Backend 适配器
 *（`services/adapters/imageAdapter.ts`、`videoAdapter.ts`）。
 */
import { randomUUID } from 'node:crypto'
import type { VideoResolution } from './providers/types.js'

/**
 * 生成接口端点（与 WL 适配器对齐）。
 * 注：Drama Backend 的基址 / 密钥已外置到 DSH 设置系统（见 host-config.ts），
 * 不再在此写死明文常量。
 */
export const DRAMA_ENDPOINTS = {
  health: '/api/v1/health',
  txt2image: '/api/v1/generate/txt2image',
  txt2imageanime: '/api/v1/generate/txt2imageanime',
  image2image: '/api/v1/generate/image2image',
  /**
   * 图内文字修复（CV-202，2026-09-18 后端新增 + 同日探针实测接入）：Boogu Edit
   * 专用改图链路 —— Krea2 出图后画面文字出错时的修复通道，改几个字不必整图重画。
   * 后端同事用法纪律：prompt **只写文字部分**（从原出图 prompt 提取），其余画面
   * 描述不带。产物名 `boogu_*` 前缀（后端文档示例写 boogu_edit_*，以实测为准），
   * 属「产物名」类不可直接入参（探针复证：直用 500 快失败，CV-155 同型）。
   * 探针证据：docs/api-probe/image2fix-20260918/report.md（200 / 68.5s，SALLE→SALE 修复生效）。
   */
  image2fix: '/api/v1/generate/image2fix',
  /**
   * 统一文件上传（图片 / 视频 / 音频）——**唯一**的上传端点（CV-137，2026-09-10 实测）。
   *
   * 旧的 `/api/v1/generate/uploadimage` 已从后端路由表移除：对任何文件均返回
   * `404 {"detail":"Not Found"}`（openapi.json 里也不再出现该路径）。不要再改回去。
   * 响应为 ComfyUI 原生结构 `{name, subfolder, type}`，`name` 即下游工具所需的文件名。
   */
  upload: '/api/v1/generate/upload',
  promptEnhance: '/api/v1/generate/image2promptenhance',
  image2vl: '/api/v1/generate/image2vl',
  character: '/api/v1/generate/image2character',
  videoFl2va: '/api/v1/generate/image2videofl2va',
  videoRef2va: '/api/v1/generate/image2videoref2va',
  txt2audio: '/api/v1/generate/txt2audio',
} as const

/**
 * Drama 后端「同步单任务」纪律的**模型可见文案（唯一源）**。
 *
 * 后端同刻只处理一个请求，一次 POST 等到出片才返回；并发提交只排队、不加速
 * （实测 A 9.4s / B 18.7s 并发墙钟仍 18.7s）。**必须写进工具描述**——描述每回合
 * 都在模型上下文里，而 SKILL.md 只有被加载后才进上下文。多个工具共用同一措辞，
 * 防两处漂移（与 `h3-ir-validate.ts` 的 `COUNT_MODE_HINT` 同一做法）。
 *
 * 不适用于本地 ffmpeg 工具（`compose_video` / `extract_last_frame`，不占后端）。
 */
export const DRAMA_SERIAL_HINT =
  '⚠️ Drama 后端**同步单任务**（同刻只处理一个请求）：需要多次生成时**逐个调用、等上一个返回**再发下一个。并发提交只排队不加速，还会让用户以为卡死。'

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

/** 默认档位（设置项 `defaultResolution` 的默认值，两处必须一致）。 */
export const DEFAULT_RESOLUTION: VideoResolution = '736p'

/** 合法档位判定 —— 工具入参 / 设置项 / 历史值归一三处共用（避免校验散落）。 */
export function isVideoResolution(value: unknown): value is VideoResolution {
  return value === '480p' || value === '736p' || value === '2k'
}

/**
 * 宽高比 + 档位 → 像素尺寸（图片与视频**共用同一个档位**，故只用这一份实现）。
 *
 * 9:16 反宽高；1:1 恒 1024×1024（方形不是 H3 输出规格，三档共用，无档位意义）。
 * 第 2 参带默认值 ⇒ 既有调用点（`generate.ts`）与既有测试零改动即可编译。
 */
export function sizeForAspectRatio(
  aspectRatio: string | undefined,
  resolution: VideoResolution = DEFAULT_RESOLUTION,
): { width: number; height: number } {
  switch (aspectRatio) {
    case '9:16': {
      const base = OUTPUT_SIZE[resolution]
      return { width: base.height, height: base.width }
    }
    case '1:1': return { width: 1024, height: 1024 }
    case '16:9':
    default: return { ...OUTPUT_SIZE[resolution] }
  }
}

/** 生成一个资产文件名用的 UUID。 */
export function newAssetId(): string {
  return randomUUID()
}
