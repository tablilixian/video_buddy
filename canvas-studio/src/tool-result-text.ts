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
 * 深度优先收集**全部**非空 `text`（遍历唯一实现，`firstText` / `touchedStoryboard` 共用）。
 *
 * 同时兼容两种形状：新版（`tool-result` 包一层）与扁平版（直接 `{type:'text'}`）——
 * 上游若改变包装方式，这里退化为仍可读，而不是静默回退兜底文案。
 */
function textBlocks(blocks: unknown, depth = 0): string[] {
  if (!Array.isArray(blocks) || depth > MAX_DEPTH) return []
  const found: string[] = []
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') continue
    const record = block as { type?: unknown; text?: unknown; content?: unknown }
    if (record.type === 'text' && typeof record.text === 'string' && record.text.length > 0) {
      found.push(record.text)
      continue
    }
    found.push(...textBlocks(record.content, depth + 1))
  }
  return found
}

/** 深度优先找第一段非空 `text`。 */
export function firstText(blocks: unknown): string | null {
  return textBlocks(blocks)[0] ?? null
}

/**
 * CV-308：Host 回写故事板后，工具结果文本里的**稳定标记**。
 *
 * 这条链路的顺序是「Host 写盘 → 把附注塞进工具结果 → 客户端据此重载覆盖层」，
 * 而 iframe 不会自己重载。此前客户端是拿 **`tool/call` 入参里有没有 `storyboardRef`**
 * 来猜的 —— CV-306 加了「没传 storyboardRef 时的自动兜底回写」之后，这条猜测立刻
 * 失效：兜底路径按定义就没有那个参数，于是**数据写对了、覆盖层却永不重载**，
 * 用户看不到样张、也就无法拍板（2026-10-12 挖红薯项目实测）。
 *
 * 所以判据改为「Host 自己说它写了」：**写法（Host）与读法（client）共用本常量与
 * `touchedStoryboard`，只准一份实现**。标记只加在**确实写了盘**的附注上 ——
 * 「未找到目标」「故事板不可读」这类没写成的不带标记，不会误触发重载。
 */
export const STORYBOARD_TOUCH_MARKER = '故事板已更新：'

/**
 * 生成一条「故事板已更新」附注 —— **写法唯一实现**（Host 侧三处回写附注共用）。
 *
 * 与读法 `touchedStoryboard` 配对：改标记只需改这个模块，两侧同时跟上；
 * 往返（写→读）有单测钉住。
 */
export function storyboardTouchedNote(detail: string): string {
  return `${STORYBOARD_TOUCH_MARKER}${detail}`
}

/** 结果文本里是否出现「故事板已更新」标记（跨全部文本块）。 */
export function touchedStoryboard(blocks: unknown): boolean {
  return textBlocks(blocks).some((text) => text.includes(STORYBOARD_TOUCH_MARKER))
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
