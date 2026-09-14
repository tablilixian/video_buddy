import type { ReactElement } from 'react';
import type { StudioProject, StudioProjectGroup } from '../contracts/project.js';
export interface ProjectRowMenuProps {
    project: StudioProject;
    /** 全部用户分组（渲染成「移动到分组」的候选）。 */
    groups: readonly StudioProjectGroup[];
    /** 触发按钮的实测视口坐标（由调用方在打开时量好）。 */
    anchor: {
        left: number;
        top: number;
        bottom: number;
    };
    /** 有创建/改名等写操作在飞时，菜单项禁用（避免并发写同一份 registry）。 */
    creating: boolean;
    onClose(): void;
    onMoveToGroup(projectId: string, groupId: string | null): void;
    onDelete(projectId: string): void;
}
export declare function ProjectRowMenu(props: ProjectRowMenuProps): ReactElement;
