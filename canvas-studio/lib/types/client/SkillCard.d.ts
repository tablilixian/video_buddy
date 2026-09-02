/**
 * 技能广场卡片（CV-065）。
 *
 * 「使用」的语义是**把提示词插进对话输入框**，不是自动发送、也不是把
 * SKILL.md 塞进 system prompt。理由：
 * 1. 不伪造已生效 —— 用户不改、不回车，就什么都没发生（reserved 字段原则）；
 * 2. 不污染 agent 决策 —— 让模型自己决定要不要 `skill(name=X)` 加载正文；
 * 3. 复用画布已验证的 `insertReferenceToken` 通路（@ref 引用走同一条）。
 */
import type { ReactElement } from 'react';
import type { SkillCatalogEntry } from '../skill-catalog.js';
export interface SkillCardProps {
    entry: SkillCatalogEntry;
    /** 点「使用」：把技能提示词插入对话输入框。 */
    onActivate: (entry: SkillCatalogEntry) => void;
}
/** 单张技能卡：缩略图 + 标题 + 说明 + 分类 chip + 使用按钮。 */
export declare function SkillCard(props: SkillCardProps): ReactElement;
