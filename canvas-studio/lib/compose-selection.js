/**
 * CV-006 / CV-007：合成选择的派生逻辑（纯函数，无 JSX / 无 IO）。
 *
 * 从 `client/StudioFrame.tsx` 抽出到根级（按 `style-grid.ts` 先例）：① Host 侧
 * node --test 可直接单测（client 打包产物是单文件 bundle，测试够不着）；② 客户端
 * 引用根级模块两要件：`tsconfig.client.json` include 追加 + import 带 `.js` 后缀。
 *
 * 职责单一：把「时间轴顺序 + 排除勾选 + BGM 下拉选择」归约成一次 `/compose` 请求
 * 需要的全部输入（clipIds / bgmNodeId / 预计成片时长 / 软提示）。硬校验不在这里做
 * —— BGM 短于成片的精确差额由服务端 CV-138 守卫报错，本模块只出 amber 软提示。
 */
/** BGM 时长与预计成片时长的容差（秒）：差值在此以内不提示，与服务端守卫口径一致。 */
export const BGM_TOLERANCE_SECONDS = 0.05;
/** 片段可参与合成的有效性：作废（retired）与被取代（supersededBy）都不算有效版。 */
export function isComposableClip(node) {
    return node.kind === 'video'
        && node.retired !== true
        && node.supersededBy === undefined;
}
/** BGM 候选有效性：只收存活的音频节点（CV-006 拍板：不列成片节点，少一个歧义源）。 */
export function isValidBgmNode(node) {
    return node !== undefined
        && node.kind === 'audio'
        && node.retired !== true
        && node.supersededBy === undefined;
}
/**
 * 把时间轴 + 勾选态归约成一次合成请求的输入。
 * 纯函数：不读 store、不发请求；排除语义 = 「显式排除优先于一切」，作废片段
 * 在勾选区直接禁用（不进 excluded），所以这里不需要再防两者冲突。
 */
export function resolveComposeSelection(input) {
    const { ordered, excluded } = input;
    const excludedSet = new Set(excluded);
    const clips = ordered.filter(node => isComposableClip(node) && !excludedSet.has(node.id));
    const clipIds = clips.map(node => node.id);
    const estSeconds = clips.reduce((sum, node) => sum + (typeof node.duration === 'number' ? node.duration : 0), 0);
    const warnings = [];
    const bgmCandidate = input.bgmNodeId === undefined
        ? undefined
        : ordered.find(node => node.id === input.bgmNodeId);
    const bgmNode = isValidBgmNode(bgmCandidate) ? bgmCandidate : undefined;
    const bgmInvalid = input.bgmNodeId !== undefined && bgmNode === undefined;
    if (bgmNode !== undefined && typeof bgmNode.duration === 'number'
        && estSeconds > 0 && bgmNode.duration + BGM_TOLERANCE_SECONDS < estSeconds) {
        const shortfall = estSeconds - bgmNode.duration;
        warnings.push(`BGM（${bgmNode.duration.toFixed(2)}s）可能比预计成片（${estSeconds.toFixed(2)}s）短 ≈${shortfall.toFixed(2)}s，合成会被拒绝 —— 建议先让 agent 生成更长的 BGM`);
    }
    return {
        clipIds,
        ...(bgmNode !== undefined ? { bgmNode } : {}),
        estSeconds,
        warnings,
        bgmInvalid,
    };
}
