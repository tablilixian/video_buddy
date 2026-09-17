/** 用户在等决策的三个状态（与 `workflow-stage.ts` 的 APPROVAL_STATES 同一集合）。 */
const REVIEW_STATES = new Set([
    'script_review', 'awaiting_approval', 'keyframe_review',
]);
/**
 * 需要「分镜已获批」才能调用的正式产线动作。
 *
 * 收敛过的教训：`compose_video` / `extract_last_frame` / `music_generation` 过去也
 * 不在表内 —— 它们分别能拼片、抽帧、出 BGM，都是第 8~10 步的动作。它们单靠自己
 * 出不了新关键帧，但放行它们等于允许「没批分镜就先出 BGM/拼一版看看」。
 */
const FORMAL_TOOLS = new Set([
    'video_generate',
    'video_composite',
    'compose_video',
    'extract_last_frame',
    'character_sheet',
    'qc_shot',
    'music_generation',
]);
/**
 * 审阅态下要一并拦住的**产出类**动作 —— 在正式动作之外，还包括不绑分镜的
 * `image_generate` / `character_generate`（Look 样张、定妆照这类）。它们在
 * `drafting` 阶段是合法动作，所以不能进 FORMAL_TOOLS。
 */
const PRODUCING_TOOLS = new Set([
    ...FORMAL_TOOLS,
    'image_generate',
    'character_generate',
]);
/** 各审阅态的拒绝文案：说清「在等什么」+「不要做什么」。 */
const REVIEW_MESSAGES = {
    script_review: '剧本正在等待用户批准（画布上方审批条）。请停止一切动作，等待用户点击「批准剧本」或给出修改意见；批准后用户会发「继续」。不要重试，也不要把等待时间用来做后续步骤的准备（加载 skill、读分册、出定妆照、建资产卡都属于「批准后才做」）。',
    awaiting_approval: '分镜表正在等待用户批准（画布上方审批条）。请停止一切动作，等待用户点击「批准并开始制作」或给出修改意见；批准后用户会发「继续」。不要重试，也不要把等待时间用来做第 4~6 步的准备（建资产卡 / 出定妆照 / 逐镜出图都属于「批准后才做」）。',
    keyframe_review: '关键帧正在等待用户确认（画布上方确认条）。请停止一切动作，等待用户点击「确认关键帧」或「打回重出」；用户可能先在画布上二次编辑关键帧，编辑完成后仍需再次确认。确认后用户会发「继续」；在此之前不要重试。（用户点「打回重出」后你会收到带意见的重做指令，那才是重出的信号。）',
};
/** 未获批时的拒绝文案（drafting：还没走到分镜批准）。 */
const DRAFTING_MESSAGE = '当前项目为「逐步确认」模式且尚未获批分镜：请先完成需求澄清与剧本创作（write_screenplay → submit_screenplay_for_approval），用户批准剧本后再规划分镜并用 submit_storyboard_for_approval 提交。分镜获批前不能调用产线生成工具（Look 阶段的基调样张 / 定妆照不受限）。';
/**
 * 判定一次调用是否被门禁拦下。返回 `null` = 放行；返回字符串 = 拒绝理由
 * （调用方 `throw new Error(该字符串)`）。
 */
export function approvalGateMessage(input) {
    const { tool, mode, state, shotBound } = input;
    // 放手跑：用户已授权一路跑完，审批提交本身就是放行。
    if (mode !== 'confirm')
        return null;
    // 已获批：产线开着。
    if (state === 'executing')
        return null;
    if (REVIEW_STATES.has(state)) {
        return PRODUCING_TOOLS.has(tool) ? (REVIEW_MESSAGES[state] ?? null) : null;
    }
    // 到这里 state 只可能是 drafting（五个取值已穷尽）。
    if (FORMAL_TOOLS.has(tool))
        return DRAFTING_MESSAGE;
    if (shotBound && (tool === 'image_generate' || tool === 'character_generate')) {
        return DRAFTING_MESSAGE;
    }
    return null;
}
