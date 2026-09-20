/**
 * 文本产物载荷的「占位内容」判定（CV-217）。
 *
 * ## 为什么需要这个模块
 *
 * 模型有「先落一个占位节点、稍后回填」的坏习惯，实测两次独立复现
 * （2026-09-20，qwen3.8-flash 经 jiyuanlvdong）：
 *
 * | 项目 | 第一次 `write_script` | 第二次（真实文案） | 结果 |
 * | --- | --- | --- | --- |
 * | 北京书市 | `{"script":"占位"}`，16:12:16 | 完整文案，16:29:24 | 画布上**两张**「文案」卡，其一内容只有「占位」二字 |
 * | 测试分辨率拆分 | `{"script":"占位"}` | 完整文案 | 同上 |
 *
 * 两次的模型推理都是「Next, write the screenplay...」，却在流里逐 token 吐出了
 * `{"script": "占位"}`（**不是截断**，`tool-call-chunks` 可见完整分片）。
 * 而 `write_script` 每次调用都 append 新节点 —— 占位那张卡永远没人替换它，于是
 * 永久留在画布上（用户反馈「经常会出现一个占位节点」）。
 *
 * ## 判定口径（只拦「整篇都是占位」，不做子串匹配）
 *
 * 用两把尺子，任一命中即拦：
 * 1. **去装饰后过短**：剥掉 markdown 装饰 / 标点 / 空白后不足 5 字 —— 这个工具的
 *    载荷要求覆盖广告词 / 对白 / BGM / SFX / 字幕，不可能这么短；
 * 2. **剥离占位词后没有残余**：整串由「占位 / 待补充 / TODO / placeholder…」
 *    这类词拼成，去掉它们只剩排版符号或编号。
 *
 * 刻意**不**做「包含占位词即拦」——真实文案里出现「不要写占位」这类叮嘱是合法的，
 * 子串匹配会误伤。误伤的代价是模型多跑一轮，漏判的代价是画布上永久多一张垃圾卡，
 * 所以口径取「整篇级」而非「包含级」。
 *
 * ## 两档口径（写入严、载入稳）
 *
 * | 出口 | 尺子 | 命中后做什么 |
 * | --- | --- | --- |
 * | `stubTextReason` | 两把尺子都要（含「过短」） | Host 侧**拒收**，不落节点 |
 * | `isPlaceholderOnlyText` / `isStubTextNode` | 只用第二把 | 客户端载入清洗**删**历史节点 |
 *
 * 载入侧更窄，是因为它做的是**真删已落盘数据**：用户可能点开 agent 写的「文案」卡
 * 把它清空或改短，那属于「过短」档，但那是用户的笔迹，不能替他删。
 *
 * 放在 `src/` 顶层（非 `src/client/`）：`tsc -p tsconfig.json` 会编译出
 * `lib/text-guard.js`，使 `tests/*.test.mjs` 能直连单测（同 CV-151 `style-grid.ts`
 * 的手法），客户端 bundle（tsdown）引用同一份源码。
 */
import type { StudioCanvasNode } from './contracts/canvas.js'

/**
 * 去装饰后的最短可受理长度。小于等于它即判占位。
 *
 * 取 4：实测的占位载荷是「占位」（2 字），邻居如「test」「xxx」「待填」「略」也都在
 * 4 以内；而任何真实文案（要写清 广告词/对白/BGM/SFX/字幕 的构成）都远超这个数。
 */
const MIN_COMPACT_CHARS = 4

/**
 * 占位词表。**只在「整篇剥离后无残余」这层用**，因此可以放心收录短词。
 */
const PLACEHOLDER_TOKENS: readonly string[] = [
  'placeholder',
  '占位符',
  '占位',
  '待补充',
  '待补齐',
  '待填',
  '待写',
  '待补',
  '待定',
  '暂缺',
  '暂空',
  '暂无',
  'todo',
  'tbd',
  'tba',
  'xxx',
]

/** 剥离装饰后仍有残余时的允许残余长度（编号 / 标点级）。 */
const MAX_TOKEN_RESIDUE_CHARS = 2

/**
 * 把载荷压成「只留实义字符」的形态：去 markdown 装饰、去标点、去空白、统一小写。
 * 只用于占位判定，不改动落盘内容本身。
 */
function compact(text: string): string {
  return text
    .toLowerCase()
    // markdown 装饰与常见分隔符
    .replace(/[`*_#>~\-–—=+·•|]/g, '')
    // 空白（含全角空格与不换行空格）
    .replace(/[\s\u3000\u00a0]+/g, '')
    // 中英文标点与引号括号
    .replace(/[。！？!?,，.、；;：:…'"“”‘’「」『』（）()\[\]【】《》<>]/g, '')
}

/** 反复剥离占位词，返回残余。 */
function stripPlaceholderTokens(compacted: string): string {
  let residue = compacted
  for (;;) {
    const next = PLACEHOLDER_TOKENS.reduce(
      (acc, token) => acc.split(token).join(''),
      residue,
    )
    if (next === residue) return residue
    residue = next
  }
}

/**
 * 判定一段文本产物载荷是否为占位内容。
 *
 * @param text 工具入参里的正文（`write_script` 的 `script` / `write_screenplay` 的 `screenplay`）。
 * @returns 命中时返回可直接拼进错误文案的中文原因；合法内容返回 `null`。
 */
export function stubTextReason(text: string | undefined): string | null {
  if (typeof text !== 'string') return '内容缺失'
  const compacted = compact(text)
  if (compacted.length === 0) return '内容为空'
  if (compacted.length <= MIN_COMPACT_CHARS) {
    return `内容过短（去掉排版装饰后仅 ${compacted.length} 个字）`
  }
  const residue = stripPlaceholderTokens(compacted)
  if (residue.length <= MAX_TOKEN_RESIDUE_CHARS) {
    return '整篇只有「占位 / 待补充」这类词，没有实际内容'
  }
  return null
}

/**
 * 模型可见的纪律句（挂进 `write_script` / `write_screenplay` 的 description）。
 *
 * 与 `stubPayloadMessage` 共用同一份字面量：工具描述是**事前**提示（每回合都在
 * 上下文里），错误文案是**事后**纠正（命中那一刻才出现）——两者必须说同一件事，
 * 否则模型会从描述里学到一套、被错误文案教另一套。
 */
export const STUB_PAYLOAD_RULE =
  '⚠️ **必须一次写完整**：本工具不接受占位 / TODO /「稍后回填」这类内容'
  + '（整篇只有占位词、或去掉排版装饰后过短，会被直接拒收报错）。'
  + '内容还没准备好就先不要调用本工具，写好再调——占位调用不会「先占个位置」，只会白建一张节点。'

/**
 * 构造「拒收占位载荷」的工具错误文案。
 *
 * @param label 载荷名（「文案」/「剧本」），同时用于首尾两处主语。
 * @param required 该载荷必须覆盖的构成，写进纠正指引。
 * @param reason `stubTextReason` 给出的中文原因。
 */
export function stubPayloadMessage(label: string, required: string, reason: string): string {
  return `${label}未落盘：${reason}。${STUB_PAYLOAD_RULE}`
    + `本次请一次写全：${required}。`
    + '如果这确实已经是完整内容（例如单镜无对白），请把构成写明（如「对白：无 · BGM：… · SFX：…」）后重试。'
}

/**
 * 「整篇只有占位词」判定 —— 比 `stubTextReason` **更窄**的一档，
 * 专供**载入清洗删节点**用。
 *
 * 为什么载入侧要更窄：写入守卫拒收是「多跑一轮」的代价，严一点无妨；而载入清洗
 * 是**真删已落盘的节点**，一旦误判就是静默数据丢失。用户完全可能点开 agent 写的
 * 「文案」卡把它清空或改短（`origin` / `toolName` 不会因此改变），此时 `text` 会
 * 落在「过短」那一档里。所以这里两处收紧：
 * 1. **空内容不算占位**（用户清空的卡留着，让人自己决定删不删）；
 * 2. 只认「剥离占位词后没有残余」这一条，不用「过短」那条。
 */
export function isPlaceholderOnlyText(text: string | undefined): boolean {
  if (typeof text !== 'string') return false
  const compacted = compact(text)
  if (compacted.length === 0) return false
  return stripPlaceholderTokens(compacted).length <= MAX_TOKEN_RESIDUE_CHARS
}

/**
 * 是否为「历史遗留的占位文本节点」—— 载入清洗时丢弃用。
 *
 * 只认 **agent 写的 `write_script` / `write_screenplay` 节点**：用户手动建的文本卡
 * 即使正文是「占位」也不动（那是用户自己的笔迹，不是模型的坏习惯）。
 * `origin` / `toolName` 两个限定与 `isTransientNode` 同一思路：宁可漏清，不可误删。
 */
export function isStubTextNode(node: StudioCanvasNode): boolean {
  if (node.kind !== 'text') return false
  if (node.origin !== 'agent') return false
  if (node.toolName !== 'write_script' && node.toolName !== 'write_screenplay') return false
  return isPlaceholderOnlyText(node.text)
}
