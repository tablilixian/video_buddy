/**
 * 读 `tool/result` 事件里的文本 —— **唯一实现**。
 *
 * 会话事件里工具结果的真实形状（从会话转录取证，见 `question-result.ts` 头部注释）：
 * 文本在 **`message.content[0].content[0].text`**，中间隔着 `tool-result` 那一层；
 * 直接遍历 `message.content` 找 `type === 'text'` 永远匹配不到。CV-216 就踩过这个坑
 * （点选卡片恒显示兜底文案）。
 *
 * 抽成根级模块的原因：消费方既有 `.ts`（`asset-capture.ts`）也有 `.tsx`
 * （`client/question-capture.tsx`，JSX + 框架类型，进不了 `node --test`），
 * 判定与渲染分家后才可单测。
 */

/** 嵌套深度上限：真实形状是 2 层，留出余量但挡住畸形数据里的自引用。 */
const MAX_DEPTH = 4

/**
 * 深度优先找第一段非空 `text`。
 *
 * 同时兼容两种形状：新版（`tool-result` 包一层）与扁平版（直接 `{type:'text'}`）——
 * 上游若改变包装方式，这里退化为仍可读，而不是静默回退兜底文案。
 */
export function firstText(blocks: unknown, depth = 0): string | null {
  if (!Array.isArray(blocks) || depth > MAX_DEPTH) return null
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') continue
    const record = block as { type?: unknown; text?: unknown; content?: unknown }
    if (record.type === 'text' && typeof record.text === 'string' && record.text.length > 0) {
      return record.text
    }
    const nested = firstText(record.content, depth + 1)
    if (nested !== null) return nested
  }
  return null
}

/**
 * 框架把工具异常渲染成 `Error: <message>`（`core/tools` 的 `toolErrorResult`）。
 * 展示给用户前剥掉这个前缀 —— 它是协议措辞，不是给人看的。
 */
export const TOOL_ERROR_TEXT_PREFIX = 'Error: '

/** 剥掉框架的 `Error: ` 前缀（不匹配时原样返回）。 */
export function stripToolErrorPrefix(text: string): string {
  return text.startsWith(TOOL_ERROR_TEXT_PREFIX)
    ? text.slice(TOOL_ERROR_TEXT_PREFIX.length)
    : text
}
