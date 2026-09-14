/**
 * 侧栏项目卡副行（DD-08 / R3）——「这个项目做到哪了」的**唯一组装实现**。
 *
 * 三样信息全部来自**已在 wire 上**的字段，零契约改动、零数据迁移：
 * - `workflow.state` → 阶段词（经 workflow-stage 的 STATE_FLOOR，与底部六段轨道同源）；
 * - `plan.aspectRatio` / `plan.targetDuration` → 产出规格（CV-099 创建时锁定）；
 * - `updatedAt` → 相对时间（relative-time.ts）。
 *
 * 纯函数、无 DOM、无 React：`node --test` 可直连。组件只做 JSX 拼接，不做判断 ——
 * 一旦「什么时候显示哪一段」散到组件里，卡片与列表的取值口径就会分叉。
 */
import type { StudioProject } from './contracts/project.js';
import { type WorkflowStageLabel } from './workflow-stage.js';
/** 副行三段的取值（各自可为空 —— 空的那段不渲染，不留占位）。 */
export interface ProjectRowMeta {
    /** 当前阶段（剧本 / 分镜 / 定妆 / 关键帧 / 镜头 / 成片）。 */
    stage: WorkflowStageLabel;
    /** 产出规格摘要（如 `16:9 · 30s`）；未锁定时为 null。 */
    plan: string | null;
    /** 最后活动时间（如 `3 小时前`）；时间戳非法时为 null。 */
    time: string | null;
}
/**
 * 组装副行。`now` 由调用方传入（理由见 relative-time.ts 的模块注释）。
 *
 * 规格摘要用 `16:9 · 30s` 而不是 `16:9 横屏 · 目标 30 秒`：侧栏 200~280px 宽，
 * 副行与阶段词、时间同处一行，长了就被省略号吃掉后半截 —— 而吃掉的那半
 * 恰好是数字。两项都未锁定时返回 null（而不是空对象拼出的空串）。
 */
export declare function projectRowMeta(project: StudioProject, now: Date): ProjectRowMeta;
