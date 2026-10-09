/**
 * 提示词前缀组装（CV-288 验收反馈批抽出）。
 *
 * ## 为什么独立成模块
 *
 * 这段逻辑原本住在 `generate.ts`，但客户端要显示「最终提示词预览」就需要它，
 * 而 `generate.ts` 顶部 import 了 `node:fs` / `node:path` / `node:url` —— 浏览器
 * bundle 引进来会把 Node 内置模块拖进打包，直接炸。所以把**纯函数**抽到这里：
 *
 * - `generate.ts` 改为从本模块 import（**调用点与行为逐字节不变**）；
 * - 客户端也 import 本模块，预览用的就是**生成时用的同一个函数**，不存在
 *   「预览一套、实际另一套」的漂移；
 * - `scripts/probe-style-prefix.mjs` 原本自己抄了一份 `prefixes.join('，') + prompt`
 *   （第 226 行），是第三份实现——一并收敛到本模块。
 *
 * 本模块**不依赖任何运行时**（无 fs / 无网络 / 无 React），可被 host、client、
 * 脚本三方共用。这是它必须独立于 `generate.ts` 的前提，改动时勿引入副作用。
 */

/** 前缀注入所需的最小参数集（只取四个字段，故三者共用同一签名）。 */
export interface PromptInjection {
  /** 用户在输入框里写的提示词正文。 */
  readonly prompt: string
  /** 节奏前缀（影片级剪辑节奏）。图像节点不写此字段。 */
  readonly pacingPrefix?: string | undefined
  /** 摄像机前缀（镜头参数）。 */
  readonly cameraPrefix?: string | undefined
  /** 风格前缀（画面质感）。 */
  readonly stylePrefix?: string | undefined
}

/**
 * 生成提示词组装 —— 节点卡「节奏 / 摄像机 / 风格」参数以**前缀注入**落到提示词
 * 最前（后端 0.7.0 对拍后没有 style 参数，工具 description 明确「风格表达直接写进
 * prompt」；后端亦无分镜/节奏参数——REQ-031 拍板①，同走注入通道）。
 *
 * 前缀顺序 = 导演层 → 摄影层 → 美术层：节奏（影片级剪辑节奏）→ 摄像机（镜头
 * 参数）→ 风格（画面质感），以「，」连接。注入作用于 image_generate / withtxt
 * 与 video_generate / video_composite 四条生成车道；image_fix 不注入（改字指令
 * 加前缀会污染修复语义）。空白前缀跳过；图像节点不写 pacingPrefix，本函数
 * 泛化对图像车道逐字节零影响。
 */
export function composeImagePrompt(params: PromptInjection): string {
  const prefixes = [params.pacingPrefix, params.cameraPrefix, params.stylePrefix]
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
  return prefixes.length > 0 ? `${prefixes.join('，')}，${params.prompt}` : params.prompt
}
