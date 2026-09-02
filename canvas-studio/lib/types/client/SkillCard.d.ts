/**
 * 技能广场卡片（CV-065）。
 *
 * 「使用」的语义是**把提示词插进对话输入框**，不是自动发送、也不是把
 * SKILL.md 塞进 system prompt。理由：
 * 1. 不伪造已生效 —— 用户不改、不回车，就什么都没发生（reserved 字段原则）；
 * 2. 不污染 agent 决策 —— 让模型自己决定要不要 `skill(name=X)` 加载正文；
 * 3. 复用画布已验证的 `insertReferenceToken` 通路（@ref 引用走同一条）。
 *
 * CV-070：卡片头图**默认显示**动态演示 GIF（assets/style-demos，路由
 * /canvas-studio/style-demos 托管）——不再依赖 hover 才注入；无 demo 的
 * skill 回退静态渐变。hover 只在缩略图上叠加操作菜单（不切换动图）。
 * CV-071：hover 浮层「查看详情/使用」按钮（详情弹窗由广场承载）。
 * CV-076：左上角 H3 badge（真实信息：该 skill 基于 H3 技术路线）。
 */
import type { ReactElement } from 'react';
import type { SkillCatalogEntry } from '../skill-catalog.js';
export interface SkillCardProps {
    entry: SkillCatalogEntry;
    /** 点「使用」：把技能提示词插入对话输入框。 */
    onActivate: (entry: SkillCatalogEntry) => void;
    /** CV-071：点「查看详情」打开详情弹窗（广场承载；缺省不渲染入口）。 */
    onDetail?: (entry: SkillCatalogEntry) => void;
}
/** 单张技能卡：缩略图（默认动态演示）+ hover 操作菜单 + 标题 + 说明 + 分类 chip + 使用按钮。 */
export declare function SkillCard(props: SkillCardProps): ReactElement;
