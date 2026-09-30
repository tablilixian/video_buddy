/**
 * REQ-003 Step 3 / F5：就地编辑浮层的**内存草稿表**。
 *
 * 与 `lobby-stash.ts`（首页暂存文件）同一手法：**模块级 Map 存草稿本体，
 * 不进 store、不落盘、不进画布契约** —— 草稿是「没保存的东西」，把它写进
 * 持久化状态等于把半截输入当成事实。store 若需要展示「有草稿」这一事实，
 * 由组件在渲染时查本表（`hasEditorDraft`）。
 *
 * 生命周期（方案 §4.10）：
 * - 关闭面板（点空白 / Esc / 切走选中）⇒ **保留**（重开回填 + 「未保存」标记）；
 * - 显式「取消」⇒ 丢弃；
 * - 「仅保存 / 保存并重试」成功 ⇒ 清除；
 * - 切换项目 ⇒ 清空（调用方在 projectId 变化时调 `clearEditorDrafts`）。
 *
 * 放在 `src/` 根而不是 `client/`：它是零 IO 的纯数据表，Host 单测直连
 * （`tests/editor-draft.test.mjs` 从 `../lib/editor-drafts.js` 导入）。
 */

/** 一个节点的编辑草稿：提示词按字段键存（音乐节点有两个字段），参考位预留。 */
export interface NodeEditorDraft {
  readonly prompt: Readonly<Record<string, string>>
  /** 参考位草稿（参考编辑目前是即时提交，预留形状与方案 §4.10 对齐）。 */
  readonly refs?: readonly string[]
}

const drafts = new Map<string, NodeEditorDraft>()

export function hasEditorDraft(nodeId: string): boolean {
  return drafts.has(nodeId)
}

export function getEditorDraft(nodeId: string): NodeEditorDraft | undefined {
  return drafts.get(nodeId)
}

export function setEditorDraft(nodeId: string, draft: NodeEditorDraft): void {
  drafts.set(nodeId, draft)
}

export function deleteEditorDraft(nodeId: string): void {
  drafts.delete(nodeId)
}

/** 切换项目时整体清空（草稿不跨项目存活）。 */
export function clearEditorDrafts(): void {
  drafts.clear()
}
