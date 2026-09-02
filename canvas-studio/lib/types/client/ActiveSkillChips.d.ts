/**
 * work 态「已装载技能」chip 行（CV-066 Phase D）。
 *
 * 展示当前项目 activeSkills 里装载的 skill（标题取 catalog 元数据，未收录
 * 时显示注册名 —— 新增 skill 忘补表不空白）。每个 chip 带 × 可卸载，空态
 * 隐藏整行（调用方条件渲染，本组件不做空态占位）。
 */
import type { ReactElement } from 'react';
export interface ActiveSkillChipsProps {
    /** 已装载的 skill 注册名（顺序即装载顺序）。 */
    skills: readonly string[];
    /** 卸载一个 skill。 */
    onRemove: (name: string) => void;
}
/** work 态工作流条下方一行：已装载技能 chips。 */
export declare function ActiveSkillChips(props: ActiveSkillChipsProps): ReactElement;
