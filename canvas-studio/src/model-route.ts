/**
 * R-P1-03 Phase 1：图像模型路由统一决策点（Host 侧纯函数）。
 *
 * 为什么需要这一层：此前「用哪个端点」的判据是散在各工具 description 里的
 * **散文**——agent 某一轮依据「提示词含中文」选了 withtxt（Qwen）后，用户删掉
 * 中文再重试，agent 不会回头重读判据，路由不会自己改道（Bug C-12 的根因：
 * 散文判据不可重算）。
 *
 * 解法（设计稿 `docs/plans/R-P1-03-提示词语言呈现与模型路由设计.md` v1.0）：
 * 路由 = **每次工具调用现场重算**的纯函数，判据只有一个机械事实——
 * `extractTextSpec(prompt).renderableTexts`（未被否定的引号文字，即「提示词里
 * 明确写了要显示到画面上的文字」，2026-10-04 拍板）。C-12 场景下删掉中文后，
 * 下一次提交现算即自然改道回 Krea2，无需 agent「重新判断」。
 *
 * 消费点：`generateAsset` 图像分支（图像链路汇聚的唯一模型出口）——
 * 决策函数与消费点分离，但各自只有一份实现；工具 description 的「路由纪律」
 * 摘要由 {@link ROUTE_SUMMARY} 生成（一处事实两处消费，CI 断言同源）。
 *
 * **迁移 B3-2（2026-11-22）**：DramaServer 生成后端 8082（端点即模型）退役，
 * 路由输出从 Drama 端点换成业务 API 的 **模型 code + operation**（目录实测
 * 见 docs/api-probe/generation-migration-20261122/report.md）：
 * - 纯文生图（无文字）→ image.krea2 @ txt2image
 * - 文字渲染 → image.qwen-image-2.1 @ txt2image
 * - 图生图（带 1-4 参考）→ image.qwen-image-2.1 @ image2image（目录里
 *   image2image 只有 Qwen 声明——与旧「图生图维持 Qwen」同构）
 * - 角色四视图 → image.krea2 @ image2character
 * - **image_fix（Boogu 改字）下线**：新目录没有承载「只改文字不动画面」特化
 *   语义的模型/operation（拍板 2026-11-22，老端口彻底废弃）；文字出错改走
 *   Qwen 文字渲染重出。
 */

import { extractTextSpec } from './text-detection.js'
import type { GenerationOperation } from './contracts/generation.js'

/**
 * 模型路由表（业务 API 版；模型 code 均为目录实测值，探测报告
 * `docs/api-probe/generation-migration-20261122/report.md` §1）。
 */
export const MODEL_ROUTE_TABLE = {
  /** 纯文生图默认：image.krea2 @ txt2image（旧 8082 的 txt2image/Krea2 Turbo 同源）。 */
  t2iDefault: { model: 'image.krea2', operation: 'txt2image' },
  /** 文字渲染特化：image.qwen-image-2.1 @ txt2image（中文逐字正确）。 */
  textRender: { model: 'image.qwen-image-2.1', operation: 'txt2image' },
  /** 图生图（带参考图入参）：image.qwen-image-2.1 @ image2image。 */
  imageEdit: { model: 'image.qwen-image-2.1', operation: 'image2image' },
  /** 角色四视图：image.krea2 @ image2character。 */
  character4v: { model: 'image.krea2', operation: 'image2character' },
} as const

/** REQ-031 H5 注记：video 车道**不消费** `modelOverride` —— H3 是唯一真模型，
 * 节点卡 video 形态的模型 chip 为展示 + 置灰（不写 model 参数）。SeedDance 端点
 * 接入时再收编路由表。
 */

/** 参与图像路由的工具（image_fix 已随 Boogu 特化下线）。 */
export type ImageRouteTool =
  | 'image_generate'
  | 'image_generate_withtxt'
  | 'character_generate'

/** 路由理由码：随结果进 warnings / 日志，出问题可回答「为什么走了这条链路」。 */
export type ModelRouteReason =
  | 'explicit-setting'
  | 'text-render'
  | 'default-t2i'
  | 'i2i-references'
  | 'character-4v'
  | 'node-override-text-render'
  | 'node-override-krea2'

/** 节点卡「高级」手动指定的合法值（其余输入一律按未指定处理——兜底纪律）。 */
export type ImageModelOverride = 'textRender' | 'krea2'

/** 卡片写入的 `modelOverride` 参数 → 路由覆盖值；不认识的一律 undefined。 */
export function normalizeImageModelOverride(value: string | undefined): ImageModelOverride | undefined {
  if (value === 'textRender' || value === 'krea2') return value
  return undefined
}

export interface ModelRouteRequest {
  /** 发起工具。 */
  tool: ImageRouteTool
  /** 提交的提示词原文（@ref 令牌不影响判据——引号文字检测只看引号段）。 */
  prompt: string
  /** 是否带参考图入参（filename / filenames 解析后非空）。 */
  hasReferences: boolean
  /** 设置页「默认生图模型」显式指定（覆盖 t2i 两条判据，优先级最高）。 */
  setting?: string
  /**
   * REQ-029 拍板④（CV-281 Step 4）：节点输入框卡「高级」手动指定的模型。
   * 只在**纯文生图车道**生效 —— 图生图 / 角色四视图不是「默认生图模型」
   * 能指配的语义（本文件头注）；优先级：带参考车道 > 节点覆盖 > 设置页 > 文字判据。
   */
  override?: ImageModelOverride
}

export interface ModelRoute {
  /** 业务 API 模型 code（`POST /v1/generations` 的 `model` 字段）。 */
  model: string
  /** 业务 API operation。 */
  operation: GenerationOperation
  /** 理由码。 */
  reason: ModelRouteReason
}

/** 设置页「默认生图模型」的合法值（迁移 B3-2：端点路径 → 模型 code）。 */
export const DEFAULT_IMAGE_MODEL_CODES = {
  /** 默认（Krea2 快档）。 */
  krea2: 'image.krea2',
  /** 文字渲染（Qwen）。 */
  qwen: 'image.qwen-image-2.1',
} as const

/**
 * 图像模型路由。判定顺序（高到低）：
 * 角色卡（工具语义固定）→ 图生图（带参考）→ 设置显式指定 →
 * 文字渲染（未被否定的引号文字）→ 默认文生图。
 */
export function routeImageModel(request: ModelRouteRequest): ModelRoute {
  switch (request.tool) {
    case 'character_generate':
      return { ...MODEL_ROUTE_TABLE.character4v, reason: 'character-4v' }
  }
  if (request.hasReferences) {
    return { ...MODEL_ROUTE_TABLE.imageEdit, reason: 'i2i-references' }
  }
  // REQ-029 拍板④：节点级手动指定 —— 优先于设置页（更具体的作用域），只在
  // 纯文生图车道生效（上面的 i2i / 角色车道均不受影响）。
  if (request.override !== undefined) {
    return request.override === 'textRender'
      ? { ...MODEL_ROUTE_TABLE.textRender, reason: 'node-override-text-render' }
      : { ...MODEL_ROUTE_TABLE.t2iDefault, reason: 'node-override-krea2' }
  }
  if (request.setting !== undefined) {
    const model = normalizeDefaultImageModelSetting(request.setting)
    if (model !== undefined) {
      return { model, operation: 'txt2image', reason: 'explicit-setting' }
    }
    // 设置值不是合法模型 code（旧端点路径等历史遗留）——按默认链路走并在
    // reason 里保持 explicit 语义已不可能，落 default-t2i（工具调用侧不感知）。
  }
  if (extractTextSpec(request.prompt).renderableTexts.length > 0) {
    return { ...MODEL_ROUTE_TABLE.textRender, reason: 'text-render' }
  }
  return { ...MODEL_ROUTE_TABLE.t2iDefault, reason: 'default-t2i' }
}

/**
 * 设置页「默认生图模型」历史值迁移（CV-281 起该值存的是 Drama 端点路径）。
 * 端点路径 / 模型 code 双向识别：`txt2image_withtxt` / `image.qwen-image-2.1` →
 * Qwen code；`txt2image` / `image.krea2` → Krea2 code；其余 undefined（按默认走）。
 */
export function normalizeDefaultImageModelSetting(value: string): string | undefined {
  const v = value.trim()
  if (v === '' ) return undefined
  if (v === DEFAULT_IMAGE_MODEL_CODES.qwen || v === 'txt2image_withtxt') return DEFAULT_IMAGE_MODEL_CODES.qwen
  if (v === DEFAULT_IMAGE_MODEL_CODES.krea2 || v === 'txt2image') return DEFAULT_IMAGE_MODEL_CODES.krea2
  return undefined
}

/**
 * 路由纪律摘要（工具 description 的「选工具判据」段由此生成）。
 * 一处事实两处消费：执行时用 {@link routeImageModel}，模型可读文本用本摘要；
 * 守卫测试断言两份工具 description 都插值了本串，防「摘要与路由表各说各话」。
 */
export const ROUTE_SUMMARY =
  '【模型路由 R-P1-03】图像模型由 Host 逐次调用现算，你只管按内容调工具：'
  + '提示词里有**要显示到画面上的文字**（引号框住、未被「不要/避免」否定）→ 自动走 Qwen 文字渲染链路（逐字正确，约 20s）；'
  + '带参考图 → 自动走 Qwen 图生图链路；其余纯文生图 → Krea2（更快）。'
  + '纯文生的文字图调 image_generate 或 image_generate_withtxt 等价（路由按提示词改道）；带参考图只能用 image_generate；'
  + '已出图的文字错了调 image_generate_withtxt 重出（带原画面描述与新文字规格——Boogu 改字特化链路已随后台改版下线）。'
