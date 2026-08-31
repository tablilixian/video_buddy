/**
 * Shared project-record wire types for the Canvas Studio host registry and
 * the browser client. Pure types only: both halves import them and erase
 * them at build time, so this file never appears in the runtime bundles.
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
