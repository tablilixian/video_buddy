/**
 * Studio root-frame inject face: the shared store (via the framework's hooks
 * compartment) plus the business callbacks the apply world provides to the
 * frame (plain data and callbacks; no hooks, no ctx).
 */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots';
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client';
import type { EngineStoreInstance, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client';
import type { ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client';
import type { StudioProject } from '../contracts/project.js';
import type { ProjectStoreActions, ProjectStoreState } from './project-store.js';
/** 绑定某 settings 命名空间的响应式作用域（ui-settings 注入，canvas-studio 客户端用）。 */
export interface CanvasStudioSettingsScope {
    bind<T>(spec: {
        namespace: string;
        decode?: (section: unknown) => T | undefined;
    }): SettingsScope<T>;
}
/** 凭据客户端最小结构（设置弹窗保存 / 查询密钥用，值不落明文）。 */
export interface CanvasStudioCredentials {
    set(req: {
        ref: string;
        value: string;
    }): Promise<void>;
    unset(req: {
        ref: string;
    }): Promise<void>;
    describe(req: {
        refs: string[];
    }): Promise<{
        credentials: Record<string, {
            configured: boolean;
            writable: boolean;
        }>;
    }>;
}
/**
 * 模型设置所需的 Host wire 视图/请求最小结构。
 *
 * 直接复用桌面 `dsh-client-ui-settings-models` 的 `ModelsSettingsStore` /
 * `ModelsSection` 不可行——它们包内私有、不导出，且没有打开桌面设置页的命令。
 * 但 dsh 的模型设置本质是一层很薄的前端，背后只有三个 wire 域：
 * `llm.providers`（provider 目录）、`settings`（namespace 视图读写）、
 * `credentials`（密钥）。本面板只取这几个域、调用与 dsh 完全相同的接口，
 * 因此状态与桌面原生「模型」设置**共享同一份存储**，功能对等且无私有 API 依赖。
 * 以下类型按 canvas-studio 实际用到的字段本地收窄，避免引入 dsh 私有依赖。
 */
/** 一个可配置 provider 的目录条目（llm.providers）。 */
export interface ConfigurableProviderView {
    /** 路由 id（deepseek-official / openai / anthropic / 自声明 route 等）。 */
    provider: string;
    /** 配置界面展示名。 */
    displayName: string;
    /** 承载该 provider profile 的 settings 命名空间（如 llm-deepseek / llm-pi-ai）。 */
    settingsNs: string;
    /** 从命名空间根到 profile 对象的路径（空数组 = 整个 section 即 profile）。 */
    settingsPath: string[];
    /** 路由当前是否已注册（模型是否可请求）。 */
    active: boolean;
    /** 仅因配置声明才被 adapter 认识（用于自定义 provider 判定）。 */
    declared?: boolean;
}
/** 一个 settings 命名空间的红acted 视图（settings.describe）。 */
export interface SettingsNamespaceView {
    /** 命名空间键（llm-deepseek / llm-pi-ai …）。 */
    ns: string;
    /** 序列化后的 schemastery schema 信封（本面板不解析，仅占位）。 */
    schema: unknown;
    /** 解析后的红acted 值（schema 默认值 → 组合 base → 用户层）。 */
    value: unknown;
    /** 组合 base 层（provider 预置值）。 */
    base?: unknown;
    /** 用户层原始 section。 */
    user?: unknown;
    /** 宿主何时应用改动。 */
    applies: 'live' | 'restart';
    /** 每个 schema 声明的密钥槽及其已配置态。 */
    secrets: {
        path: string[];
        set: boolean;
    }[];
    /** 读时的用户层单调版本号，写时作为 expectedRevision 回传防并发覆盖。 */
    revision: number;
}
/** settings.mutate 的一条路径编辑。 */
export interface SettingsPathOpView {
    op: 'set' | 'unset';
    path: string[];
    value?: unknown;
}
/** llm.discoverModels 返回的某端点广告的模型。 */
export interface DiscoveredModelView {
    /** 端点接受的模型 id。 */
    id: string;
    /** 端点给出的可读名（可选）。 */
    name?: string;
    /** 披露的最大上下文窗口（可选）。 */
    contextWindow?: number;
    /** 披露的最大输出 token（可选）。 */
    maxTokens?: number;
}
/** wire 调用的统一结果信封。 */
type WireResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: {
        code?: string;
        message: string;
    };
};
/** 模型设置所需的 Host wire 接口（仅取 canvas-studio 实际用到的三个域）。 */
export interface CanvasStudioModelApi {
    llm: {
        providers(req: object): Promise<{
            result: WireResult<{
                providers: ConfigurableProviderView[];
            }>;
        }>;
        discoverModels(req: {
            settingsNs: string;
            provider?: string;
            baseURL?: string;
            api?: string;
            apiKey?: string;
        }, signal?: AbortSignal): Promise<{
            result: WireResult<{
                models: DiscoveredModelView[];
            }>;
        }>;
    };
    settings: {
        describe(req: object): Promise<{
            result: WireResult<{
                writable: boolean;
                hasDocument: boolean;
                namespaces: SettingsNamespaceView[];
            }>;
        }>;
        mutate(req: {
            ns: string;
            ops: SettingsPathOpView[];
            expectedRevision?: number;
        }): Promise<{
            result: WireResult<SettingsNamespaceView>;
        }>;
    };
    credentials: CanvasStudioCredentials;
}
/** The store instance's bound actions (draft stripped by the runtime). */
export type StudioActions = EngineStoreInstance<ProjectStoreState, ProjectStoreActions>['actions'];
/** Inject face of the studio root registration. */
export interface StudioProjectListInjected {
    hooks: {
        /** The shared studio store (selection, registry, per-project canvas nodes). */
        studio: HostObservable<ProjectStoreState>;
    };
    /** The layout service the frame exposes through the standard layout slot. */
    layout: ILayout;
    /**
     * All declared store actions, bound to the shared instance. Components write
     * through these; the apply world owns async fetch/persist orchestration.
     */
    actions: StudioActions;
    /** Re-pull the project registry into the store. */
    refreshProjects(): Promise<void>;
    /** Create a project (registry + disk directory), select it, and open its session. */
    createProject(name: string): Promise<void>;
    /** Select a project and bind the conversation to its workspace session. */
    openProject(project: StudioProject): Promise<void>;
    /** Delete a project (registry record + disk directory + canvas). */
    deleteProject(projectId: string): Promise<void>;
    /** 创建示例项目（建项目 + 预置画布节点，onboarding 欢迎屏入口）。 */
    createSampleProject(): Promise<void>;
    /** Persist the selected project's canvas node list to the Host. */
    persistCanvas(projectId: string): Promise<void>;
    /** 按原生成参数重试一个节点（写回原节点，不产生新边）。 */
    retryNode(projectId: string, nodeId: string): Promise<void>;
    /** 修改提示词后重新生成该节点（原地更新）。 */
    steerNode(projectId: string, nodeId: string, prompt: string): Promise<void>;
    /** 打断当前会话的运行中回合（stop 生成）。 */
    cancelCurrentTurn(): Promise<void>;
    /** P7：拉取某项目的工作流状态进 store（打开项目与审批动作后调用）。 */
    refreshWorkflow(projectId: string): Promise<void>;
    /** P7：批准分镜表（awaiting_approval → executing），并自动发送「继续」唤醒 agent 恢复流程。 */
    approveStoryboard(projectId: string): Promise<void>;
    /** P7：驳回分镜表（回到 drafting），并自动发送修改意见唤醒 agent 重新提交；feedback 非空时定向转述用户的不满意点（R1）。 */
    rejectStoryboard(projectId: string, feedback?: string): Promise<void>;
    /** P7：确认关键帧（keyframe_review → executing），并自动发送「继续」继续视频流程。 */
    confirmKeyframes(projectId: string): Promise<void>;
    /** P7：切换执行模式（confirm / auto），并同步门禁状态。 */
    setWorkflowMode(projectId: string, mode: 'confirm' | 'auto'): Promise<void>;
    /** 一键效果测试：串行跑指定用例（每例建独立项目 → 切放手跑 → 发测试指令 → 等回合空闲）；进度写 store.effectTest。 */
    runEffectTests(round: string, cases: readonly string[]): Promise<void>;
    /** CV-066：装载一个 skill 到项目（store 即时更新 + skills.json 持久化；失败回滚 store）。 */
    activateSkill(projectId: string, name: string): Promise<void>;
    /** CV-066：从项目卸载一个 skill（store 即时更新 + skills.json 持久化；失败回滚 store）。 */
    deactivateSkill(projectId: string, name: string): Promise<void>;
    /** 绑定 'canvas-studio' 命名空间的 settings 作用域（供设置弹窗读写配置）。 */
    settingsScope: CanvasStudioSettingsScope;
    /** 惰性取凭据客户端（密钥写凭据域，不落明文）；凭据服务未就绪时返回 undefined。 */
    getCredentials(): CanvasStudioCredentials | undefined;
    /** 惰性取模型设置所需的 Host wire 接口（llm/settings/credentials 三域）；连接未就绪时返回 undefined。 */
    getModelApi(): CanvasStudioModelApi | undefined;
    /** 惰性取桌面原生目录选择器（设置页「资产库位置」用）；OS chooser 选出的路径 dsh Host 已校验可写。 */
    getDirectoryPicker(): {
        pick: () => Promise<string | null>;
    } | undefined;
    /** 桌面主题运行时（设置页「主题」分区复用，切换全局浅色/深色/跟随系统）。 */
    theme: ThemeRuntime;
}
export {};
