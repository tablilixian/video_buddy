/**
 * Shared project-record wire types for the Canvas Studio host registry and
 * the browser client. Pure types plus small pure helpers (normalizeWorkflow /
 * resolveSetModePatch): both halves import them and erase them at build time,
 * so this file never appears in the runtime bundles.
 */
/** 旧记录 / 新建项目的默认工作流。 */
export const WORKFLOW_DEFAULT = { mode: 'confirm', state: 'drafting' };
/**
 * Leniently coerce an unknown parsed workflow into a safe value; invalid or
 * missing fields degrade to their defaults (registry records may predate P7).
 */
export function normalizeWorkflow(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return { ...WORKFLOW_DEFAULT };
    }
    const record = value;
    const workflow = {
        mode: record.mode === 'auto' ? 'auto' : 'confirm',
        state: record.state === 'awaiting_approval' || record.state === 'keyframe_review' || record.state === 'executing'
            ? record.state
            : 'drafting',
    };
    const pending = record.pendingQuestion;
    if (pending !== null && pending !== undefined && typeof pending === 'object' && !Array.isArray(pending)) {
        const question = pending;
        workflow.pendingQuestion = {
            id: typeof question.id === 'string' ? question.id : '',
            question: typeof question.question === 'string' ? question.question : '',
            options: Array.isArray(question.options) ? question.options.map(String) : [],
            ...(question.allowFreeText === true ? { allowFreeText: true } : {}),
            ...(typeof question.answer === 'string' ? { answer: question.answer } : {}),
        };
    }
    return workflow;
}
/**
 * setMode 动作的状态决策（CV-052/CV-056 修复的单一事实源，纯函数可单测）。
 *
 * 三条判据只对「用户真的切换了模式」有意义（切回逐步确认时执行中的流程回到
 * 澄清态、切到放手跑则解除等待）。它们只看 state 与目标 mode —— 若不先比对
 * current.mode，「点了当前已激活的那个按钮」也会被当成切换执行：最严重时
 * （confirm + keyframe_review 点「逐步确认」）state 被翻成 drafting，确认条
 * 随之消失、AI 已结束回合在睡、setMode 又不唤醒，流程直接死锁。故模式未变化
 * 时必须短路，只回写 mode，绝不碰 state。
 */
export function resolveSetModePatch(current, mode) {
    if (current.mode === mode)
        return { mode };
    const patch = { mode };
    if (current.state === 'executing')
        patch.state = mode === 'auto' ? 'executing' : 'drafting';
    if (current.state === 'awaiting_approval' && mode === 'auto')
        patch.state = 'executing';
    if (current.state === 'keyframe_review')
        patch.state = mode === 'auto' ? 'executing' : 'drafting';
    return patch;
}
