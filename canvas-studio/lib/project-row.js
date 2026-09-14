import { relativeTime } from './relative-time.js';
import { workflowStateStageLabel } from './workflow-stage.js';
/**
 * 组装副行。`now` 由调用方传入（理由见 relative-time.ts 的模块注释）。
 *
 * 规格摘要用 `16:9 · 30s` 而不是 `16:9 横屏 · 目标 30 秒`：侧栏 200~280px 宽，
 * 副行与阶段词、时间同处一行，长了就被省略号吃掉后半截 —— 而吃掉的那半
 * 恰好是数字。两项都未锁定时返回 null（而不是空对象拼出的空串）。
 */
export function projectRowMeta(project, now) {
    const plan = project.plan;
    const parts = [];
    if (plan?.aspectRatio !== undefined)
        parts.push(plan.aspectRatio);
    if (plan?.targetDuration !== undefined)
        parts.push(`${plan.targetDuration}s`);
    return {
        stage: workflowStateStageLabel(project.workflow?.state),
        plan: parts.length === 0 ? null : parts.join(' · '),
        // 用 updatedAt（「最后动过」才是有用的信息）。两份时间戳在契约里都是必填，
        // 故这里不做缺失兜底 —— 真缺了说明记录本身坏了，静默改用 createdAt 会让
        // 「刚建好却显示 3 天前」这种矛盾更难查。
        time: relativeTime(project.updatedAt, now),
    };
}
