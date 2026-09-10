/** system prompt 小节名（命名空间化防冲突；重名注册会抛错）。 */
export const PLAN_SECTION_NAME = 'canvas-studio:project-plan';
/**
 * 小节顺序。约定：100–199 为工具使用指引带；skill 路由小节取 150，
 * 本段是其直接下游（先路由到总纲、再看项目预置），取 151。
 */
export const PLAN_SECTION_ORDER = 151;
/** cwd → 预置小节文本（无预置的项目不入表）。字符串很短，项目数有限，不设淘汰。 */
const cache = new Map();
/** 从 assemble 上下文里取会话 cwd（agent 由 dispatch 注入，非 AssembleContext 声明字段）。 */
function agentCwdOf(context) {
    const agent = context.agent;
    return agent?.session?.header?.cwd;
}
/**
 * 由项目预置生成小节正文。纯函数，可单测。
 * @returns 空串表示该项目无任何预置（调用方跳过注入）。
 */
export function planSectionText(plan) {
    if (!plan || (plan.aspectRatio === undefined && plan.targetDuration === undefined))
        return '';
    const lines = [];
    if (plan.aspectRatio !== undefined) {
        lines.push(`- 画幅：${plan.aspectRatio}——生成工具未显式指定 aspectRatio 时按此兜底（视频只支持 16:9 / 9:16 两档，1:1 仅对图片生效）。`);
    }
    if (plan.targetDuration !== undefined) {
        const total = plan.targetDuration;
        // 镜头数：下限按单段上限 15s 切分，上限按单镜 8–10s 的保守值推。
        const minShots = Math.max(1, Math.ceil(total / 15));
        const maxShots = Math.max(minShots, Math.ceil(total / 10));
        const hint = minShots === maxShots ? `${minShots} 镜` : `${minShots}–${maxShots} 镜`;
        lines.push(`- 目标总时长：${total} 秒 → 建议镜头数 ≈ ${hint}（按单镜 8–10 秒估算；单段视频上限 15 秒）。`);
    }
    return `## Canvas Studio 项目预置（本会话绑定的项目）

本项目创建时已锁定以下产出规格，视为用户已确认的事实：

${lines.join('\n')}

规则：
1. 需求澄清**跳过**上述已锁定要素，不要就画幅、总时长或镜头节奏向用户提问。
2. 用户在对话中明确给出不同画幅 / 时长时，以用户最新指示为准。
3. 剧本节拍与分镜数量须与目标总时长对齐（各段时长之和 ≈ 目标总时长）。`;
}
/** 项目目录 → 项目（与 host-tools.resolveProjectId 同规则：精确匹配优先，取最长前缀）。 */
async function projectOf(registry, cwd) {
    const projects = await registry.list();
    let match = null;
    let bestLength = -1;
    for (const project of projects) {
        if (cwd === project.dir || cwd.startsWith(project.dir + '/')) {
            if (project.dir.length > bestLength) {
                bestLength = project.dir.length;
                match = project;
            }
        }
    }
    return match;
}
/**
 * 刷新某 cwd 的预置缓存文本（命中预置则写入，无预置写入空串防止反复重试）。
 * @returns 是否存在有效预置文本。
 */
export async function refreshPlanPromptCache(registry, cwd) {
    if (!cwd)
        return false;
    try {
        const project = await projectOf(registry, cwd);
        const text = planSectionText(project?.plan);
        cache.set(cwd, text);
        return text !== '';
    }
    catch {
        return false;
    }
}
/** 读取缓存文本（未预热返回空串）。 */
export function cachedPlanSectionText(cwd) {
    if (!cwd)
        return '';
    return cache.get(cwd) ?? '';
}
/**
 * 注册项目预置小节 + `agent/created` 缓存预热。
 * @returns 联合 disposer（同时移除小节与事件监听）。
 */
export function registerProjectPlanPrompt(ctx, registry) {
    const disposeSection = ctx.systemPrompt.section({
        name: PLAN_SECTION_NAME,
        order: PLAN_SECTION_ORDER,
        text: (context) => {
            const cwd = agentCwdOf(context);
            if (cwd === undefined)
                return '';
            if (!cache.has(cwd)) {
                // 兜底自愈：预热未覆盖（如测试直连、事件错过）时异步刷新，下一轮生效。
                void refreshPlanPromptCache(registry, cwd);
                return '';
            }
            return cache.get(cwd) ?? '';
        },
    });
    const disposeListener = ctx.on('agent/created', ({ agent }) => {
        void refreshPlanPromptCache(registry, agent?.session?.header?.cwd);
    });
    return () => { disposeSection(); disposeListener(); };
}
