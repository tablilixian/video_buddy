const GATE_COPY = {
    screenplay: {
        submitted: '剧本已提交到画布',
        waiting: '等用户在画布上方点「批准剧本」或「驳回，继续修改」',
        next: '读 references/shot-format.md 后输出分镜表并调 submit_storyboard_for_approval',
        autoNext: '直接进入分镜规划：按目标总时长推导镜头数（总时长 ÷ 单镜 8–10s）后输出分镜表并调用 submit_storyboard_for_approval。',
    },
    storyboard: {
        submitted: '分镜表已拆卡落到画布',
        waiting: '等用户点「批准并开始制作」或「驳回，继续修改」',
        next: '按标准工作流第 4→5→6 步继续（一致性资产卡 → 定妆锚点 → 逐镜出图）',
        autoNext: '直接开始执行生成流程：第 4→5→6 步（一致性资产卡 → 定妆锚点 → 逐镜出图）。',
    },
    keyframes: {
        submitted: '关键帧已全部生成并落到画布',
        waiting: '等用户点「确认关键帧」（用户可能先在画布上二次编辑关键帧，编辑完成后仍需再次确认）',
        next: '按标准工作流第 8→9→10 步继续（文案 → 逐镜视频 → 成片合成）',
        autoNext: '关键帧确认已放行，继续第 8→9→10 步（文案 → 逐镜视频 → 成片合成）。',
    },
};
/**
 * 停手首行。**必须是返回文本的第一个字符起** —— 位置就是这个模块存在的理由，
 * 不要把它挪到任何陈述之后。
 */
export const APPROVAL_HOLD = '⛔ 停手：本回合到此结束，不要再调用任何工具。';
/** `deferred` 段的围栏标题。 */
export const DEFERRED_FENCE = '—— 以下是获批后才需要的信息，现在不要据此行动 ——';
/**
 * 产出提交审批的工具结果文本。
 *
 * `mode === 'auto'`（放手跑）返回放行文案（无停手）；逐步确认模式返回停手文案，
 * 并把 `deferred` 隔到围栏之后。
 */
export function approvalNotice(input) {
    const copy = GATE_COPY[input.gate];
    const summary = input.summary !== undefined && input.summary.trim().length > 0
        ? `（${input.summary.trim()}）`
        : '';
    const parts = [];
    if (input.mode === 'auto') {
        parts.push(`${copy.submitted}${summary}（放手跑模式，已直接放行）。${copy.autoNext}`);
    }
    else {
        parts.push(APPROVAL_HOLD);
        parts.push(`${copy.submitted}${summary}，${copy.waiting}。获批后用户会发「继续」，届时再${copy.next}。`
            + '停手期间不要读文件、不要加载 skill、也不要做任何"准备工作" ——'
            + '那些是获批后的下一步，不是可以并行做的事。');
        // 「若用户给出修改意见」这条必须留着：驳回后用户可能直接在对话里说意见而不点
        // 驳回按钮，此时 state 仍停在审阅态，agent 必须照做（`approval-gate.ts` 只管
        // 产出类工具，写作类是放行的）。
        parts.push('若用户给出修改意见，按意见修改后重新提交本工具。');
    }
    const deferred = input.deferred?.trim();
    if (deferred !== undefined && deferred.length > 0) {
        parts.push(DEFERRED_FENCE);
        parts.push(deferred);
    }
    return parts.join('\n');
}
