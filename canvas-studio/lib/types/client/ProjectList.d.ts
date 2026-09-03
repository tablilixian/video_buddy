import type { StudioProject, StudioProjectGroup } from '../contracts/project.js';
import type { EffectTestRunState } from './project-store.js';
/** Plain props: the store projection plus plain callbacks. */
export interface ProjectListProps {
    projects: readonly StudioProject[];
    /** CV-091：用户自定义分组（含 order，渲染前再按 order 排）。 */
    groups: readonly StudioProjectGroup[];
    selectedProjectId: string | null;
    phase: 'idle' | 'loading' | 'error';
    error: string | null;
    creating: boolean;
    /** 受控的新建表单开合（品牌欢迎屏「新建项目」按钮与左侧栏联动，落到未分组）。 */
    createOpen: boolean;
    /** 新建表单开合变化回调（欢迎屏打开 → 这里展开表单）。 */
    onCreateOpenChange(open: boolean): void;
    onRefresh(): void;
    /** 新建项目（groupId 省略/undefined = 未分组）。 */
    onCreate(name: string, groupId?: string | null): Promise<void>;
    onOpen(project: StudioProject): void;
    onDelete(projectId: string): void;
    /** CV-091：把项目移入/移出分组（groupId=null 即归未分组）。 */
    onMoveToGroup(projectId: string, groupId: string | null): void;
    /** CV-091：新建分组。 */
    onCreateGroup(name: string): Promise<void>;
    /** CV-091：重命名分组。 */
    onRenameGroup(groupId: string, name: string): Promise<void>;
    /** CV-091：删除分组（组内项目回落未分组）。 */
    onDeleteGroup(groupId: string): Promise<void>;
    onOpenSettings(): void;
    /** 一键效果测试编排状态（null = 本会话从未跑过）。 */
    effectTest: EffectTestRunState | null;
    /** 启动一轮效果测试（apply 世界串行编排）。 */
    onRunEffectTests(round: string, cases: readonly string[]): void;
}
/**
 * The studio project list: an inline create form plus one row per project.
 * Wrapped in an error boundary so crashes surface in the UI instead of being
 * swallowed by the upstream slot boundary.
 */
export declare function ProjectList(props: ProjectListProps): import("react").JSX.Element;
