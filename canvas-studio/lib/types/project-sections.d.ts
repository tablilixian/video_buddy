import type { StudioProject, StudioProjectGroup } from './contracts/project.js';
/**
 * CV-181 / E-2：左栏分区分桶的唯一实现。
 *
 * 起因是一次真实的数据丢失。原来的投影写在 `ProjectList.tsx` 里：
 *
 *     const ungrouped = projects.filter(p => p.groupId === undefined || p.groupId === null)
 *     const sections  = groups.map(g => ({ ..., items: projects.filter(p => p.groupId === g.id) }))
 *
 * 两行都只看「等不等于」，于是 `groupId` 指向一个**已不存在的分组**时，
 * 项目两个桶都不收 —— 既不在任何分组段，也不在未分组段，
 * **卡片在左栏彻底消失**（数据好好的，只是没人渲染它）。
 *
 * 什么时候会悬空：`groups.json` 被删除/回滚、或切换资产库根之后
 * （两个根各有一份 `groups.json`，项目记录却可能来自另一份）。
 * 表现为「项目有记录但看不见」，用户只会觉得「我的项目丢了」。
 *
 * 现在的口径：**分组认不出来就回落未分组**。未分组桶是常驻兜底，
 * 宁可让用户在一个显眼的地方看到它，也不要静默吞掉。
 *
 * 顺序约定：`groups` 的先后由调用方决定（store 已按 `order` 升序给出），
 * 本函数**原样保持**，不在这里二次排序 —— 排序口径只有一处。
 */
export interface ProjectSection {
    readonly key: string;
    readonly title: string;
    readonly groupId: string;
    readonly items: readonly StudioProject[];
}
export interface ProjectSections {
    /** 未分组桶的内容（含 groupId 悬空的回落项）。 */
    readonly ungrouped: readonly StudioProject[];
    /** 各用户分组（顺序同入参）。 */
    readonly sections: readonly ProjectSection[];
}
/** 把项目分成「未分组桶 + 各分组段」，悬空 groupId 回落未分组。 */
export declare function resolveVisibleSections(projects: readonly StudioProject[], groups: readonly StudioProjectGroup[]): ProjectSections;
