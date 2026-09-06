/**
 * CV-099：把「创建项目时锁定的产出规格（画幅 / 目标总时长）」注入 system prompt，
 * 让 agent 在需求澄清阶段跳过已预置要素（不再追问画幅 / 时长 / 镜头节奏）。
 *
 * 实现要点：
 * - 小节 text 是**同步** provider（PromptSection.text 的函数形态不允许 async），
 *   而项目解析（registry.list）是异步的 → 用模块级 per-cwd 缓存桥接。
 * - 缓存预热点：`agent/created` 事件（会话发布早于首轮 assemble，正常路径下
 *   首轮就能读到）；provider 内部对未命中 cwd 再做一次兜底自愈刷新（下一轮生效）。
 * - 预置在项目创建后即固定，会话期内不变，无需监听逐次更新。
 *
 * 注意：文本中不得出现 `{{variable}}`——renderPrompt 对未知引用会直接抛错。
 */
import type { ProjectRegistry } from './projects.js';
import type { StudioProjectPlan } from './contracts/project.js';
/** system prompt 小节名（命名空间化防冲突；重名注册会抛错）。 */
export declare const PLAN_SECTION_NAME = "canvas-studio:project-plan";
/**
 * 小节顺序。约定：100–199 为工具使用指引带；skill 路由小节取 150，
 * 本段是其直接下游（先路由到总纲、再看项目预置），取 151。
 */
export declare const PLAN_SECTION_ORDER = 151;
/**
 * 由项目预置生成小节正文。纯函数，可单测。
 * @returns 空串表示该项目无任何预置（调用方跳过注入）。
 */
export declare function planSectionText(plan: StudioProjectPlan | undefined): string;
/**
 * 刷新某 cwd 的预置缓存文本（命中预置则写入，无预置写入空串防止反复重试）。
 * @returns 是否存在有效预置文本。
 */
export declare function refreshPlanPromptCache(registry: ProjectRegistry, cwd: string | undefined): Promise<boolean>;
/** 读取缓存文本（未预热返回空串）。 */
export declare function cachedPlanSectionText(cwd: string | undefined): string;
/**
 * 注册项目预置小节 + `agent/created` 缓存预热。
 * @returns 联合 disposer（同时移除小节与事件监听）。
 */
export declare function registerProjectPlanPrompt(ctx: {
    systemPrompt: {
        section(section: {
            name: string;
            order: number;
            text: string | ((context: unknown) => string);
        }): () => void;
    };
    on(event: 'agent/created', listener: (payload: {
        agent: {
            session?: {
                header?: {
                    cwd?: string;
                };
            };
        };
    }) => void): () => void;
}, registry: ProjectRegistry): () => void;
