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
 * 消费点：`generateAsset` 图像分支（四条图像链路汇聚的唯一 endpoint 出口）——
 * 决策函数与消费点分离，但各自只有一份实现；工具 description 的「路由纪律」
 * 摘要由 {@link ROUTE_SUMMARY} 生成（一处事实两处消费，CI 断言同源）。
 *
 * `setting`（设置页「默认生图模型」）优先于文字判据，但**不**覆盖改图 /
 * 角色卡 / 图生图链路——那三条不是「默认生图模型」能指配的语义。
 */

import { DRAMA_ENDPOINTS } from './config.js'
import { extractTextSpec } from './text-detection.js'

/**
 * 模型路由表（拍板闸 #1 的落地形态：Krea2 vs qwen 就是表里的一行默认值）。
 * 2026-10-04 拍板第一版：提示词含可显示文字 → Qwen；其余文生图 → Krea2；
 * 图生图 / 改字维持 Qwen（后端现状，R-P0-09 注记）。
 */
export const MODEL_ROUTE_TABLE = {
  /** 纯文生图默认：Krea2 Turbo（krea2_workflow，0.3.0 起后端工作流）。 */
  t2iDefault: DRAMA_ENDPOINTS.txt2image,
  /** 文字渲染特化：Qwen Image 2.1（txt2image_withtxt，中文逐字正确）。 */
  textRender: DRAMA_ENDPOINTS.txt2imageWithtxt,
  /** 图生图（带参考图入参）：image2image（image1~image4 槽位）。 */
  imageEdit: DRAMA_ENDPOINTS.image2image,
  /** 图内文字修复：Boogu Edit（image2fix）。 */
  textFix: DRAMA_ENDPOINTS.image2fix,
  /** 角色四视图：image2character（krea2_quadview）。 */
  character4v: DRAMA_ENDPOINTS.character,
} as const

/** 参与图像路由的工具（视频链路 Phase 3 才收编，刻意不在表内）。 */
export type ImageRouteTool =
  | 'image_generate'
  | 'image_generate_withtxt'
  | 'image_fix'
  | 'character_generate'

/** 路由理由码：随结果进 warnings / 日志，出问题可回答「为什么走了这条链路」。 */
export type ModelRouteReason =
  | 'explicit-setting'
  | 'text-render'
  | 'default-t2i'
  | 'i2i-references'
  | 'text-fix'
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
   * 只在**纯文生图车道**生效 —— 图生图 / 修复 / 角色四视图不是「默认生图模型」
   * 能指配的语义（本文件头注）；优先级：带参考车道 > 节点覆盖 > 设置页 > 文字判据。
   */
  override?: ImageModelOverride
}

export interface ModelRoute {
  /** Drama 端点（generateAsset 用它发请求）。 */
  endpoint: string
  /** 理由码。 */
  reason: ModelRouteReason
}

/**
 * 图像模型路由。判定顺序（高到低）：
 * 改图 / 角色卡（工具语义固定）→ 图生图（带参考）→ 设置显式指定 →
 * 文字渲染（未被否定的引号文字）→ 默认文生图。
 */
export function routeImageModel(request: ModelRouteRequest): ModelRoute {
  switch (request.tool) {
    case 'image_fix':
      return { endpoint: MODEL_ROUTE_TABLE.textFix, reason: 'text-fix' }
    case 'character_generate':
      return { endpoint: MODEL_ROUTE_TABLE.character4v, reason: 'character-4v' }
  }
  if (request.hasReferences) {
    return { endpoint: MODEL_ROUTE_TABLE.imageEdit, reason: 'i2i-references' }
  }
  // REQ-029 拍板④：节点级手动指定 —— 优先于设置页（更具体的作用域），只在
  // 纯文生图车道生效（上面的 i2i / fix / 角色车道均不受影响）。
  if (request.override !== undefined) {
    return request.override === 'textRender'
      ? { endpoint: MODEL_ROUTE_TABLE.textRender, reason: 'node-override-text-render' }
      : { endpoint: MODEL_ROUTE_TABLE.t2iDefault, reason: 'node-override-krea2' }
  }
  if (request.setting !== undefined) {
    return { endpoint: request.setting, reason: 'explicit-setting' }
  }
  if (extractTextSpec(request.prompt).renderableTexts.length > 0) {
    return { endpoint: MODEL_ROUTE_TABLE.textRender, reason: 'text-render' }
  }
  return { endpoint: MODEL_ROUTE_TABLE.t2iDefault, reason: 'default-t2i' }
}

/**
 * 路由纪律摘要（工具 description 的「选工具判据」段由此生成）。
 * 一处事实两处消费：执行时用 {@link routeImageModel}，模型可读文本用本摘要；
 * 守卫测试断言两份工具 description 都插值了本串，防「摘要与路由表各说各话」。
 */
export const ROUTE_SUMMARY =
  '【模型路由 R-P1-03】图像端点由 Host 逐次调用现算，你只管按内容调工具：'
  + '提示词里有**要显示到画面上的文字**（引号框住、未被「不要/避免」否定）→ 自动走 Qwen 文字渲染链路（逐字正确，约 20s）；'
  + '带参考图 → 自动走图生图链路；其余纯文生图 → Krea2（更快）。'
  + '纯文生的文字图调 image_generate 或 image_generate_withtxt 等价（路由按提示词改道）；'
  + '带参考图只能用 image_generate；已出图的文字错了用 image_fix 修，不要整图重出。'
