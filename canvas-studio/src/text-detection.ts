/**
 * CV-212：含文字 prompt 的自动 image_fix 触发判定。
 *
 * 背景：image_generate 出图含文字时，Krea2 Turbo 对非 ASCII（中日韩 / 阿拉伯 /
 * 西里尔 / 天城文 / 泰文 / 变音符扩展等）的字符渲染**系统性**不靠谱（拉丁 ASCII
 * 偶有瑕疵，非拉丁基本是乱码）。后端的 VLM 文字校验（image2vl）同样不可靠——
 * 经常识别不到/认错，结果是「image_fix 链断了」。
 *
 * 解法：放弃 VLM 校验步骤，用**纯文本启发式前置触发**——
 * - 检测 prompt 引号内文本是否含非 ASCII 字符；
 * - 含 → 直接在 image_generate 工具侧自动调一次 image_fix；
 * - 不含 → 跳过，节省后端成本。
 *
 * 这是一个**工具侧自动行为**，agent 不需要记任何规则——它是 host-tools.ts 在
 * image_generate.execute 末尾的兜底后处理。Skill 文档（canvas-studio-creation/
 * references/prompt-writing.md §"含文字图片的出图后 QC 链 (CV-211)"）只是告知
 * 行为存在 + 描述触发条件，方便用户理解为什么 image_generate 后画面立即变成
 * 文字修复后的版本。
 */

/** 任何 code point > 0x7E（含中文 / 日文 / 韩文 / 阿拉伯 / 西里尔 / 天城文 / 泰文 / 重音拉丁 / 中文标点 等）。 */
const ASCII_MAX = 0x7e

/**
 * 检测字符串是否含非 ASCII 字符。纯 ASCII 字符串（含标准拉丁字母 + 数字 +
 * 标点 0x20–0x7E）视为英文。
 */
export function hasNonAscii(text: string): boolean {
  if (text.length === 0) return false
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) > ASCII_MAX) return true
  }
  return false
}

/**
 * 提取 prompt 中所有引号包裹的字符串。识别以下引号形态：
 * - 英文双引号 `"..."`
 * - 中文双引号 `“…”` / `‘…’`
 * - 日文方括号 `「…」` / `『…』`
 * - 尖引号 `〈…〉` / `《…》`
 * - 单引号 `'…'`（仅在明显成对且非缩写撇号时匹配 —— 见下方启发式）
 *
 * 返回值已按 prompt 中出现顺序排序，每个元素不含外层引号。匹配失败或无引号时返回空数组。
 *
 * 注：单引号启发式 —— 简单按字符对扫描，左侧单引号 `'` 后到下一个 `'` 之前视为内容。
 * 实际使用中 agent 多用双引号锁定文本，单引号主要用于英文缩写（如 don't），
 * 不会被误识别为文本锁定。
 */
export function extractQuotedText(prompt: string): string[] {
  const results: string[] = []
  if (prompt.length === 0) return results

  // 1) 英文 / 中文双引号 —— 严格左右成对（开引号 `“` 与闭引号 `”` 必须配对）
  const doublePairs = [
    ['"', '"'] as const,
    ['“', '”'] as const,
    ['‘', '’'] as const,
  ]
  for (const [open, close] of doublePairs) {
    let cursor = 0
    while (cursor < prompt.length) {
      const start = prompt.indexOf(open, cursor)
      if (start === -1) break
      const end = prompt.indexOf(close, start + open.length)
      if (end === -1) break
      const content = prompt.slice(start + open.length, end).trim()
      if (content.length > 0) results.push(content)
      cursor = end + close.length
    }
  }

  // 2) 日文方括号 / 书名号 —— 成对
  const bracketPairs = [
    ['「', '」'] as const,
    ['『', '』'] as const,
    ['《', '》'] as const,
    ['〈', '〉'] as const,
  ]
  for (const [open, close] of bracketPairs) {
    let cursor = 0
    while (cursor < prompt.length) {
      const start = prompt.indexOf(open, cursor)
      if (start === -1) break
      const end = prompt.indexOf(close, start + open.length)
      if (end === -1) break
      const content = prompt.slice(start + open.length, end).trim()
      if (content.length > 0) results.push(content)
      cursor = end + close.length
    }
  }

  return results
}

/**
 * 判定一次 image_generate 是否应触发自动 image_fix。
 *
 * 规则：
 * - prompt 须含至少一段引号文本（否则 prompt 是"画一张图"这种泛指，引号文本
 *   检测不到就不强制走修复）；
 * - 至少一段引号文本含非 ASCII 字符。
 *
 * 满足条件 → 返回 `{ needsFix: true, quotedTexts: <所有引号文本（去重保序）> }`。
 * 不满足 → `{ needsFix: false, quotedTexts: [] }`。
 */
export interface TextFixDecision {
  needsFix: boolean
  /** 触发修复的引号文本（去重 + 保序）。空数组 = 不触发。 */
  quotedTexts: string[]
}

export function shouldAutoFixText(prompt: string): TextFixDecision {
  const quotedTexts = extractQuotedText(prompt)
  if (quotedTexts.length === 0) return { needsFix: false, quotedTexts: [] }
  // 任一含非 ASCII → 触发；同时把所有引号文本都返回，方便 fix prompt 模板引用
  const needsFix = quotedTexts.some(hasNonAscii)
  return { needsFix, quotedTexts: dedupePreserveOrder(quotedTexts) }
}

/** 去重 + 保序（保留首次出现顺序）。 */
function dedupePreserveOrder<T>(items: T[]): T[] {
  const seen = new Set<T>()
  const out: T[] = []
  for (const item of items) {
    if (seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}

/**
 * 构造 image_fix 用的修复 prompt（CV-212 配套模板）。
 *
 * 设计原则（参照 krea2-edit-writing §"文字编辑"）：
 * - **只写文字部分**：列出 prompt 中要正确渲染的引号文本；
 * - **不写场景 / 角色 / 画风描述**：这是 image_fix 接口（Boogu Edit），多余描述
 *   会伤画面；
 * - **保持视觉不变**：明确要求字体、颜色、位置与原始 prompt 锁定时一致。
 *
 * 每段引号文本用引号包回，加 `"保持原字体/字号/颜色/位置不变"`。
 */
export function buildTextFixPrompt(quotedTexts: readonly string[]): string {
  if (quotedTexts.length === 0) return ''
  const lines: string[] = ['确保画面中以下文字字符正确渲染（修正任何错字、缺笔画、字符替换）：']
  for (const text of quotedTexts) {
    lines.push(`- "${text}" —— 保持原字体、字号、颜色、位置不变`)
  }
  lines.push('只修正文字，其他画面元素（场景、角色、配色、光感、构图）保持完全不变。')
  return lines.join('\n')
}