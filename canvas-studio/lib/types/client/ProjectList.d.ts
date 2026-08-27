import type { StudioProject } from '../contracts/project.js';
/** Plain props: the store projection plus plain callbacks. */
export interface ProjectListProps {
    projects: readonly StudioProject[];
    selectedProjectId: string | null;
    phase: 'idle' | 'loading' | 'error';
    error: string | null;
    creating: boolean;
    onRefresh(): void;
    onCreate(name: string): Promise<void>;
    onOpen(project: StudioProject): void;
    onDelete(projectId: string): void;
    onOpenSettings(): void;
}
/**
 * The studio project list: an inline create form plus one row per project.
 * Wrapped in an error boundary so crashes surface in the UI instead of being
 * swallowed by the upstream slot boundary.
 */
export declare function ProjectList(props: ProjectListProps): import("react").JSX.Element;
