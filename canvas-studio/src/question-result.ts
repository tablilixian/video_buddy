/**
 * `ask_user_choice` 工具结果的**解析层**（CV-216）：把 `tool/result` 事件里那团嵌套
 * JSON 读成两样东西 —— ① 卡片底部的结算说明；② 「本回合 Host 到底有没有真的问用户」。
 *
 * ## 为什么要抽成根级纯模块
 *
 * 判定逻辑必须**可单测**，但消费方 `client/question-capture.tsx` 是 `.tsx`（JSX +
 * 框架类型），进不了 `node --test`。所以判定与渲染分家：判定留在这里（Host 侧 tsc
 * 也编译它），渲染只做展示。同一手法见 CV-151 的 `style-grid.ts`。
 *
 * ## 真实事件形状（从会话转录取证，不是推测）
 *
 * ```jsonc
 * {
 *   "turn": 1, "step": 3,
 *   "message": {
 *     "source": { "kind": "tool", "callId": "call_5803…" },
 *     "content": [
 *       { "type": "tool-result", "toolCallId": "call_5803…",
 *         "content": [ { "type": "text", "text": "…答案…" } ],
 *         "isError": false }
 *     ],
 *     "role": "user"
 *   }
 * }
 * ```
 *
 * 文本在 **`message.content[0].content[0].text`** —— 中间隔着 `tool-result` 那一层。
 * 旧实现（写在本模块诞生前）直接遍历 `message.content` 找 `type === 'text'`，外层
 * 恒为 `tool-result` ⇒ **永远匹配不到** ⇒ 所有点选卡片底部恒显示兜底的「已结算」，
 * 包括用户真正作答之后本该显示的「用户的选择：X」。这是 CV-216 的第二个连带缺陷。
 */

import { AUTO_ANSWER_MARKER, AUTO_ANSWER_OPTION_PATTERN } from './studio-defaults.js'
// 工具结果文本读取的唯一实现（嵌套形状与深度上限都在那边，不要在本地再写一份）。
import { firstText } from './tool-result-text.js'

/** 读不出任何文本时的兜底说明（保留旧文案，避免无谓的视觉变更）。 */
export const SETTLED_NOTE = '已结算'

/** 从 `tool/result` 的 `message.content` 提取结算说明（读不到则回退 `SETTLED_NOTE`）。 */
export function extractResultNote(blocks: unknown): string {
  return firstText(blocks, 0) ?? SETTLED_NOTE
}

/**
 * 结果文本属于「放手跑自动应答」时产出窄条文案，否则返回 `null`。
 *
 * 返回非 `null` == Host 本回合**根本没问用户**（`autoAnswerFor` 短路返回）⇒ 客户端
 * 必须把点选卡片降级为**不可交互**窄条：选项 chips、确认按钮、自由输入框一律不渲染。
 * 卡片本身不隐藏 —— 它就是「这里本该提问、但放手跑替你定了」的记录，与画布上其它
 * 节点一样应当可追溯。
 *
 * 判定用 `startsWith` 而非 `includes`：标记必须是**首句前缀**，模型在后续文本里
 * 复述「（放手跑模式）」字样不会造成误判。
 */
export function autoAnswerSummary(text: string): string | null {
  if (!text.startsWith(AUTO_ANSWER_MARKER)) return null
  const raw = text.match(AUTO_ANSWER_OPTION_PATTERN)?.[1]
  const picked = raw === undefined ? '' : raw.replace('（推荐）', '').trim()
  return picked.length > 0
    ? `（放手跑）本回合未提问，已按默认值取「${picked}」`
    : '（放手跑）本回合未提问，已按默认值继续'
}
