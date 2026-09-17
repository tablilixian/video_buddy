/** Props for the prompt editor (the three-stage editor). */
export interface PromptEditorProps {
    /** 节点 id —— 切换节点时用它重置草稿（同 CV-001 的 `key` 手法）。 */
    nodeId: string;
    /** 字段标签（音乐节点有两个字段：音乐描述 / 歌词）。 */
    label: string;
    /** 已保存的值（外部真相；提交后由上层回写再流回来）。 */
    value: string;
    /** 提交新值。**只在内容真的变了时**才被调用。 */
    onCommit(next: string): void;
    /** 编辑中禁用（例如该节点正在生成）。 */
    disabled?: boolean;
}
/**
 * 提示词编辑器 —— **三档**，按改动规模逐级升格：
 *
 * | 档 | 形态 | 适合 |
 * |---|---|---|
 * | 一档 · 就地 | 点只读文本 → 原位变自增高 textarea，失焦提交 | 改几个词 |
 * | 二档 · 展开 | 编辑器升格占满右栏，带保存 / 取消 | 重写一段 |
 * | 三档 · 聚焦 | 居中大窗，左「已保存基准」右「编辑」并排 | 整篇重写 |
 *
 * 为什么不直接把单行 input 换成大 textarea：单行框的毛病不是「小」，而是**看不见
 * 自己在改什么也要一次改到位**。分档之后常见操作（改个词）留在原位、零跳转；只有
 * 真的要大改时才让界面让位。
 *
 * ## 两条语义（2026-09-16 拍板）
 *
 * 1. **编辑 = 写本地字段**：`onCommit` 只写回 `generationPrompt`，**不触发任何生成**。
 * 2. 要真的重跑，用户改完再点「重试」—— 于是「改完后悔」不需要付一次生成的钱。
 */
export declare function PromptEditor(props: PromptEditorProps): import("react").JSX.Element;
