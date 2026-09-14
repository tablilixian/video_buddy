import { relativeTime } from './relative-time.js';
import { workflowStateStageLabel } from './workflow-stage.js';
/**
 * 产出规格摘要（`16:9 · 30s`）——**唯一组装实现**，两处共用：
 * 左栏项目卡副行（DD-08 / R3）与输入区项目上下文条（DD-09 / d）。
 *
 * 抽出来的理由不是复用癖：两个落点都必须同一种写法，否则「改了一处忘了另一处」
 * 会让同一份数据在两条 UI 上说不同的话（CV-160 的教训）。
 *
 * 用 `16:9 · 30s` 而不是 `16:9 横屏 · 目标 30 秒`：左栏只有 200~280px 宽，
 * 长了会被省略号吃掉后半截 —— 而吃掉的那半恰好是数字。
 *
 * 时长的合法性判据与 `suggestShotCount` **同一套**（存在 / 有限 / > 0）：两处
 * 由同一份数据派生，一处显示 `0s`、另一处不显示建议镜头数就是自相矛盾。
 * 契约侧的 `normalizePlan` 会拦非法值，但读路径不该相信上游 —— `NaNs` 这种
 * 字面量比缺一段更糟（它看起来像个值）。
 *
 * @param plan - 项目记录的预置规格（CV-099）；老记录无此字段即未锁定。
 * @returns 摘要串；两项都未锁定时返回 null（而不是拼出空串）。
 */
export function planSummaryOf(plan) {
    const parts = [];
    if (plan?.aspectRatio !== undefined)
        parts.push(plan.aspectRatio);
    const duration = plan?.targetDuration;
    if (duration !== undefined && Number.isFinite(duration) && duration > 0)
        parts.push(`${duration}s`);
    return parts.length === 0 ? null : parts.join(' · ');
}
/**
 * 组装副行。`now` 由调用方传入（理由见 relative-time.ts 的模块注释）。
 *
 * 规格摘要委托 `planSummaryOf`（本批抽出的唯一实现）；两项都未锁定时该段为 null。
 */
export function projectRowMeta(project, now) {
    return {
        stage: workflowStateStageLabel(project.workflow?.state),
        plan: planSummaryOf(project.plan),
        // 用 updatedAt（「最后动过」才是有用的信息）。两份时间戳在契约里都是必填，
        // 故这里不做缺失兜底 —— 真缺了说明记录本身坏了，静默改用 createdAt 会让
        // 「刚建好却显示 3 天前」这种矛盾更难查。
        time: relativeTime(project.updatedAt, now),
    };
}
