/**
 * 「参考模式（r2v）改写提示」（纯函数，Host 侧使用）。
 *
 * 官方：帧模式（first_frame / last_frame）与参考模式（reference_*）**互斥**。
 * 本项目按「带参考音频或参考视频即走参考模式（r2v）」处理，但若调用方**原本**会走
 * 首尾帧插值（`video_composite` 恰好 2 图），语义就被改写了 —— 必须显式告知，
 * 不静默按原意图生成。
 *
 * 从 `audio-reference.ts` 提到本模块：本提示现在**同时服务参考音频与参考视频**
 * （两者都是「把帧模式改写成 r2v」）。挂在音频模块名下会让读代码的人误以为视频
 * 走的是另一条规则。
 */

/**
 * @param baseCapability 假设**不带任何参考素材**时解析出的能力（即调用方原意图）。
 * @param visualCount 本次实际提供的视觉素材数（图 + 视频）。
 * @param what 触发改写的东西，用于文案；多个时用 `/` 连接（如 `参考音频/参考视频`）。
 * @returns 需附加到结果 warnings 的说明；无冲突时返回 undefined。
 */
export function referenceModeNotice(
  baseCapability: string,
  visualCount: number,
  what = '参考音频',
): string | undefined {
  if (baseCapability !== 'first-last-frame') return undefined
  return `带${what}时按官方「参考模式（r2v）」生成（${visualCount} 个视觉素材作参考）`
    + '——H3 的帧模式与参考模式互斥，本次不按首尾帧插值'
}
