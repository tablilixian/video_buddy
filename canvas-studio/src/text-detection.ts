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
/**
 * 句子切分：按中文句号 / 分号 / 叹号 / 问号 / 换行切，**保留句末标点**。
 *
 * 刻意**不按逗号切** —— 单个文字规格段内部大量用逗号连接
 * （如「顶部横向居中…墨黑。画面中上部为两行…」），按逗号切会把一段碎成多条。
 */
function splitClauses(prompt: string): string[] {
  const matches = prompt.match(/[^。；！？\n]+[。；！？]?/g) ?? []
  return matches.map((s) => s.trim()).filter((s) => s.length > 0)
}

/**
 * 否定词 —— 用于识别「被引号框住、但**不是**要渲染的文字」。
 *
 * 只为拦 `不要"水墨"风格` 这一类；判据是**引号开引号前 3 个字符**内出现否定词，
 * 窗口刻意取窄。⚠️ 刻意**不含「无」「非」**：`用无衬线"SALE"` 的前三字是「无衬线」，
 * 含「无」会被误判成否定。
 */
const NEGATION_WORDS = ['不要', '不用', '避免', '不是', '禁用', '别用', '勿用', '禁止'] as const

/** 该引号文本是否被前面的否定词否掉（取开引号前 3 字窗口）。 */
function isNegatedQuotedText(clause: string, openQuoteIndex: number): boolean {
  const head = clause.slice(Math.max(0, openQuoteIndex - 3), openQuoteIndex)
  return NEGATION_WORDS.some((w) => head.includes(w))
}

/**
 * 收集句子里所有引号文本单元（含「是否被否定」），按出现顺序。
 * 与 `extractQuotedText` 的差别：这里保留**位置**，才能判断引号前面有没有否定词。
 */
function quotedUnits(clause: string): Array<{ text: string; negated: boolean }> {
  const QUOTES: ReadonlyArray<readonly [string, string]> = [
    ['"', '"'],
    ['“', '”'],
    ['‘', '’'],
    ['「', '」'],
    ['『', '』'],
    ['《', '》'],
    ['〈', '〉'],
  ]
  const units: Array<{ text: string; negated: boolean; at: number }> = []
  for (const [open, close] of QUOTES) {
    let cursor = 0
    while (cursor < clause.length) {
      const start = clause.indexOf(open, cursor)
      if (start === -1) break
      const end = clause.indexOf(close, start + open.length)
      if (end === -1) break
      const text = clause.slice(start + open.length, end).trim()
      if (text.length > 0) units.push({ text, negated: isNegatedQuotedText(clause, start), at: start })
      cursor = end + close.length
    }
  }
  return units.sort((a, b) => a.at - b.at).map(({ text, negated }) => ({ text, negated }))
}

/**
 * 逐字约束句的关键词 —— 原文里这类句子往往**不含引号**（如「画面中每一个汉字都必须
 * 逐字准确还原…不得替换、增删、乱码或自造汉字」），单靠「含引号」会漏掉，
 * 而它恰恰是 image2fix 效果最好的那句约束。
 */
const CONSTRAINT_KEYWORDS = [
  '逐字',
  '准确还原',
  '不得替换',
  '不得增删',
  '不得出现',
  '无缺失',
  '无变形',
  '清晰可读',
] as const

/**
 * 占位元素句的关键词 —— 这类句子**不含引号也不含约束词**，但必须保留。
 *
 * 依据正例：「右下角一个正方形细线空白方框，作为二维码占位。」若在抽取时丢掉，
 * 模型可能把这个占位方框一并重绘掉（画面少一个元素 = 版面被改）。判据取窄，
 * 只认「占位」二字。
 */
const PLACEHOLDER_KEYWORDS = ['占位'] as const

/**
 * 从**原始出图 prompt** 里抽出 image2fix 需要的两段内容（CV-218 / D6）。
 *
 * 依据 2026-09-20 的真实成功案例（`docs/api-probe/image2fix-20260920-text-spec/`）：
 * 同一个接口，修复 prompt 的形态决定成败 ——
 * - 喂「文字规格段 + 逐字约束段」（每段文字 **+ 位置/字体/字号/颜色/排版关系**）→ 8 处错字全对、排版零漂移；
 * - 只喂字符清单 → `武仔` 修成 `武传`（仍错）+ 凭空多出两处文字。
 *
 * 规则：**逐句保留**含引号文本的句子 + 含逐字约束关键词的句子，丢掉美术描述句
 * （画幅 / 材质 / 光线 / 配色 / 气质等 —— 它们不含引号、也不含约束词，自然被滤掉）。
 * ⚠️ 刻意**不重写句子文本**：原样保留，避免在抽取阶段引入新的表述偏差。
 */
export interface TextSpec {
  /** 文字规格句（按原序，保留原句文本）。 */
  specLines: string[]
  /** 逐字约束句（按原序）。 */
  constraintLines: string[]
  /** 未被否定的引号文本（去重保序）—— 自动触发判定用它，避免 `不要"水墨"风格` 误触发。 */
  renderableTexts: string[]
}

export function extractTextSpec(prompt: string): TextSpec {
  const specLines: string[] = []
  const constraintLines: string[] = []
  const renderable: string[] = []
  for (const clause of splitClauses(prompt)) {
    const units = quotedUnits(clause)
    const live = units.filter((u) => !u.negated)
    const isPlaceholder = PLACEHOLDER_KEYWORDS.some((k) => clause.includes(k))
    if (live.length > 0 || isPlaceholder) {
      specLines.push(clause)
      for (const u of live) renderable.push(u.text)
    }
    if (CONSTRAINT_KEYWORDS.some((k) => clause.includes(k))) constraintLines.push(clause)
  }
  return {
    specLines: dedupePreserveOrder(specLines),
    constraintLines: dedupePreserveOrder(constraintLines),
    renderableTexts: dedupePreserveOrder(renderable),
  }
}

export interface TextFixDecision {
  needsFix: boolean
  /** 触发修复的引号文本（去重 + 保序）。空数组 = 不触发。 */
  quotedTexts: string[]
}

export function shouldAutoFixText(prompt: string): TextFixDecision {
  const quotedTexts = extractQuotedText(prompt)
  if (quotedTexts.length === 0) return { needsFix: false, quotedTexts: [] }
  // CV-218：判据改用「未被否定的引号文本」—— `不要"水墨"风格` 这类只框住风格词、
  // 并不是要求画面渲染文字的句子不再触发修复。全部引号都被否定时视为无文字诉求。
  const spec = extractTextSpec(prompt)
  const renderable = spec.renderableTexts.length > 0 ? spec.renderableTexts : quotedTexts
  const needsFix = spec.renderableTexts.length > 0 && renderable.some(hasNonAscii)
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

/** 原文没写约束句时的兜底约束（唯一源）。 */
export const DEFAULT_TEXT_CONSTRAINT =
  '画面中每一个汉字都必须逐字准确还原，字形结构完整、笔画无缺失无变形，不得替换、增删、乱码或自造汉字。'

/**
 * 构造 image_fix 用的修复 prompt（CV-212 模板 → **CV-218 原 prompt 直通**）。
 *
 * **正确形态**（2026-09-20 真实成功案例，`api-probe/image2fix-20260920-text-spec/`）：
 * 修复 prompt = 原 prompt 的「**文字规格段**」（每段文字 + 它在画面里的位置 / 字体 /
 * 字号 / 颜色 / 排版关系）+「**逐字约束段**」，**丢掉**画幅 / 材质 / 光线 / 配色 / 气质
 * 等美术描述段。实测该形态把 8 处错字全部修对且排版零漂移；而只喂字符清单会把
 * `武仔` 修成 `武传`（仍错）并凭空多出两处文字。
 *
 * 原文没写逐字约束句时补 `DEFAULT_TEXT_CONSTRAINT` —— 该句是 image2fix 最有效的一条
 * 约束，不能因为 agent 忘了写就缺位。
 *
 * ⚠️ 刻意**不加开场祈使句**（旧模板的「确保画面中以下文字字符正确渲染」）：
 * 正例里没有这句，且该措辞会被读成「把这些字渲染出来」，反而诱发凭空增字。
 *
 * ⚠️ 刻意**不保留「字符清单」回退形态**：该分支实际不可达 —— `shouldAutoFixText`
 * 只有在原文存在**未被否定的引号文本**时才放行，而那种句子本身就是规格句 ⇒
 * `specLines` 必非空。留着它只会多一份永不执行的第二实现（本仓对死代码的态度：
 * 同一规则只准一份实现）。返回空串表示「原文没有文字诉求，调用方不该走到这里」。
 */
export function buildTextFixPrompt(originalPrompt: string): string {
  const spec = extractTextSpec(originalPrompt)
  if (spec.specLines.length === 0) return ''
  const constraints = spec.constraintLines.length > 0 ? spec.constraintLines : [DEFAULT_TEXT_CONSTRAINT]
  return [...spec.specLines, ...constraints].join('\n')
}