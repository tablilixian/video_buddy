/**
 * CV-212：含文字图片的「非 ASCII 文本触发文字修复链」算法。
 *
 * 这是 skill 文档与 host-tools 侧自动触发共用的纯函数模块；测试在
 * `tests/text-fix-trigger.test.mjs`。
 *
 * 背景：后端 VLM 对非英文字符的字形复述不可靠，硬要走 image2vl 校验
 * 等于在错误判据上反复烧成本。新策略改用 prompt 字符集启发——
 * 含引号内非 ASCII 就前置触发 image_fix，不再做 VLM 复读。
 *
 * 检测规则：
 *   1. 从 prompt 里抽出所有引号包裹的字符串片段；
 *   2. 任何一段含 `U+0080` 以上字符（含 CJK / 阿拉伯 / 西里尔 / 天城 /
 *      泰 / 韩 / 全角标点 / Emoji 等）即视为非英文 → 触发修复。
 */

const QUOTED_TEXT_RE = /["'“”「」『』‘’]([^"'“”「」『』‘’]{1,200})["'“”「」『』‘’]/gu
const NON_ASCII_RE = /[^\x00-\x7F]/u

/** 从 prompt 中抽出所有引号内的字符串片段。 */
export function extractQuotedText(prompt: string): string[] {
  if (typeof prompt !== 'string' || prompt.length === 0) return []
  const out: string[] = []
  // 每次调用 reset lastIndex，避免模块级正则的副作用
  const re = new RegExp(QUOTED_TEXT_RE.source, QUOTED_TEXT_RE.flags)
  let m: RegExpExecArray | null
  while ((m = re.exec(prompt)) !== null) out.push(m[1] ?? '')
  return out
}

/** 单段文本是否含非 ASCII 字符。 */
export function containsNonAscii(text: string): boolean {
  return NON_ASCII_RE.test(text)
}

/** 检测 prompt 是否含"非英文"文字（CV-212 触发条件）。 */
export function shouldAutoFixText(prompt: string): boolean {
  return extractQuotedText(prompt).some(containsNonAscii)
}

/**
 * 构造 `image_fix` 的修复 prompt（针对 Boogu Edit 接口）—— 用原 prompt
 * 引号内的"正确文字"作为修复目标，告诉模型在保持其他元素不变的前提下
 * 把那块字形重写正确。不要带场景/角色/画风描述（改图接口的纪律）。
 */
export function buildAutoFixTextPrompt(quotedSegments: readonly string[]): string {
  const targets = quotedSegments.filter(containsNonAscii)
  const targetList = targets.map((s) => `"${s}"`).join('、')
  return [
    `重绘图中所有文字内容，使其正确显示为 ${targetList}。`,
    '保持原有的字体风格、字号、颜色、位置与排版不变；',
    '保留画面其余部分（角色、背景、构图、光线、道具）完全不变；',
    '不要新增其他文字、不要改任何其他元素。',
  ].join('')
}
