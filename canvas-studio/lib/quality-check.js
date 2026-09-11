import { LOOK_TOKEN_KEYS, missingLookTokenKeys, parseLookTokens } from './style-tokens.js';
/** 质检系统提示词：强制 JSON 输出，压掉 VLM 的寒暄与解释。 */
export const QC_SYSTEM_PROMPT = '你是影视一致性质检员。只输出 JSON，不要任何解释文字、不要代码块标记。';
/** 每镜默认重跑预算（含首次判定在内，FAIL 达到该次数即交用户仲裁）。 */
export const DEFAULT_QC_BUDGET = 2;
/** 单条 verdict 允许的最大漂移项数（防止 VLM 罗列几十条噪音）。 */
const MAX_DRIFTS = 5;
/** reason 最大字符数。 */
const MAX_REASON = 200;
/**
 * 判定基准里是否带 Look tokens（≥1 个字段可解析即算 —— 角色卡 lockedPrompt
 * 撞上 token 行格式的概率可忽略，且多出的风格核对项对角色判定也无害）。
 */
export function hasLookTokenBaseline(expect) {
    return missingLookTokenKeys(parseLookTokens(expect)).length < LOOK_TOKEN_KEYS.length;
}
/**
 * 构造质检提示词。`expect` 是判定基准（资产卡 lockedPrompt 或调用方显式给出）。
 *
 * CV-152：基准里带 Look tokens（`色彩：…` 等 5 行）时，在角色要素之外追加
 * **4 个单帧可判的风格维度**（色彩 / 光线 / 材质 / 镜头语汇）——「节奏」是跨镜
 * 时间维度，单帧无法判定，显式排除防止 VLM 拿它凑 FAIL。
 */
export function buildQcPrompt(expect) {
    const lines = [
        '对照【期望描述】逐项核对画面中的固定要素：人物外貌（脸型/发型/发色）、服装（款式/颜色）、核心道具、整体配色与光感。',
    ];
    if (hasLookTokenBaseline(expect)) {
        lines.push('期望描述里含【风格基准（Look）】的 5 项 tokens：除角色要素外，再逐项核对 4 个单帧可判的风格维度 —— 色彩与调色是否同调、光线方向与软硬是否一致、材质质感是否同类、镜头语汇（景深/机位感/框景）是否同法。风格漂移项请点名对应的 token 行（如「光线」）。', '注意：「节奏」是跨镜的时间维度，单帧无法判定，不要因它给 FAIL。');
    }
    lines.push('只回答如下 JSON：', '{"verdict":"PASS 或 FAIL","drifts":["漂移项1","漂移项2"],"reason":"一句话理由"}', '规则：全部一致、或仅有可忽略的视角/景别差异 → PASS；任一固定要素明显改变（换脸/换装/换色/道具消失）→ FAIL，并在 drifts 中逐项列出。', '若画面模糊到无法判断，verdict 填 WARN，drifts 留空，reason 说明无法判断。', '', '【期望描述】', expect);
    return lines.join('\n');
}
/**
 * 质检判定基准的缺省来源 —— 项目一致性资产卡的 lockedPrompt 按角色分组拼接。
 *
 * CV-152：角色/场景卡与 Look 卡（role='style'）分组呈现 —— 角色要素要**逐项一致**，
 * 风格是**整体调性**（允许轻微波动、不允许调性反转），混在一起 VLM 会拿逐项标准去
 * 卡风格，把轻微调色差异误判成 FAIL。没有资产卡时返回空串（调用方据此要求显式传
 * expect，避免无基准瞎判）。
 */
export function defaultQcExpect(assets) {
    if (assets === undefined || assets.length === 0)
        return '';
    const fmt = (asset) => `[${asset.name}] ${asset.lockedPrompt}${asset.negativePrompt !== undefined && asset.negativePrompt.length > 0 ? `（禁止：${asset.negativePrompt}）` : ''}`;
    const sections = [];
    const core = assets.filter((asset) => asset.role !== 'style');
    const style = assets.filter((asset) => asset.role === 'style');
    if (core.length > 0) {
        sections.push(`【角色与场景（必须逐项一致）】\n${core.map(fmt).join('\n')}`);
    }
    if (style.length > 0) {
        sections.push(`【风格基准 Look（整体调性，允许轻微波动、不允许调性反转）】\n${style.map(fmt).join('\n')}`);
    }
    return sections.join('\n\n');
}
/**
 * 解析 VLM 输出为结构化判定。容错：代码块围栏、前后寒暄、中文「通过/不通过」。
 * 解析不出结论时降级为 warn（不自动重跑，交人工确认）。
 */
export function parseQcVerdict(raw) {
    const text = typeof raw === 'string' ? raw : '';
    const json = extractJsonObject(text);
    if (json === null) {
        return { verdict: 'warn', drifts: [], reason: `无法解析质检输出，请人工确认：${clip(text, MAX_REASON)}` };
    }
    const verdict = normalizeVerdict(json.verdict);
    const drifts = Array.isArray(json.drifts)
        ? json.drifts.filter((d) => typeof d === 'string' && d.trim().length > 0).map((d) => d.trim()).slice(0, MAX_DRIFTS)
        : [];
    const reason = typeof json.reason === 'string' && json.reason.trim().length > 0
        ? clip(json.reason.trim(), MAX_REASON)
        : (verdict === 'fail' ? drifts.join('；') || '存在一致性漂移' : '无显著漂移');
    return { verdict, drifts, reason };
}
/** 从可能带围栏/前后文本的字符串里抠出第一个 JSON 对象。 */
function extractJsonObject(text) {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
    const candidates = [fenced?.[1] ?? '', text];
    for (const candidate of candidates) {
        const start = candidate.indexOf('{');
        const end = candidate.lastIndexOf('}');
        if (start < 0 || end <= start)
            continue;
        const slice = candidate.slice(start, end + 1);
        try {
            const parsed = JSON.parse(slice);
            if (typeof parsed === 'object' && parsed !== null)
                return parsed;
        }
        catch {
            // 换下一个候选继续尝试（末尾可能缺括号等，直接放弃该候选）
        }
    }
    return null;
}
function normalizeVerdict(value) {
    const v = String(value ?? '').trim().toUpperCase();
    // 先判否定式：中文「不通过」「未通过」都含「通过」，顺序反了会被误判为 PASS。
    if (v.includes('FAIL') || v.includes('不通过') || v.includes('未通过') || v.includes('漂移'))
        return 'fail';
    if (v.includes('WARN') || v.includes('无法') || v.includes('模糊'))
        return 'warn';
    if (v.includes('PASS') || v.includes('通过') || v.includes('一致'))
        return 'pass';
    return 'warn';
}
function clip(text, max) {
    return text.length <= max ? text : `${text.slice(0, max)}…`;
}
/**
 * 选出被质检的画布节点：filename 精确匹配的 image 节点中最新的一张。
 * 找不到返回 null（此时仍可判定，只是结论不落盘）。
 */
export function pickQcTargetNode(nodes, filename) {
    const hits = nodes
        .filter((node) => node.kind === 'image' && node.filename === filename)
        .sort((a, b) => b.createdAt - a.createdAt);
    return hits[0] ?? null;
}
/**
 * 本次质检的序号（1 起）。跨重跑继承：重跑会产出**新节点**，所以要按分镜卡
 * 血缘（shotCardIds）统计该镜历史已质检次数，而不是只看当前节点。
 */
export function nextQcAttempt(nodes, target, shotCardIds = []) {
    const inLineage = (node) => shotCardIds.length === 0
        ? target !== null && node.id === target.id
        : node.sourceIds.some((id) => shotCardIds.includes(id));
    const seen = nodes
        .filter((node) => node.qc !== undefined && inLineage(node))
        .map((node) => node.qc.attempts);
    return (seen.length > 0 ? Math.max(...seen) : 0) + 1;
}
/**
 * 对单个镜头产物做一致性质检。返回结构化判定 + 预算状态 + 待落盘记录。
 * 落盘由调用方完成（Host 工具持有 registry）。
 */
export async function runShotQc(nodes, filename, options) {
    const budget = options.budget ?? DEFAULT_QC_BUDGET;
    const target = pickQcTargetNode(nodes, filename);
    const attempts = nextQcAttempt(nodes, target, options.shotCardIds ?? []);
    const raw = await options.analyze(filename, buildQcPrompt(options.expect), QC_SYSTEM_PROMPT, options.signal);
    const verdict = parseQcVerdict(raw);
    const record = {
        verdict: verdict.verdict,
        drifts: verdict.drifts,
        reason: verdict.reason,
        attempts,
        checkedAt: (options.now ?? Date.now)(),
        expect: options.expect,
    };
    return {
        ...verdict,
        attempts,
        budget,
        exhausted: verdict.verdict === 'fail' && attempts >= budget,
        nodeId: target?.id ?? null,
        record,
        raw,
    };
}
/** 把质检结论渲染给模型看的文本（工具 output.render 用）。 */
export function renderQcText(result) {
    const label = result.verdict === 'pass' ? 'PASS 一致' : result.verdict === 'fail' ? 'FAIL 漂移' : 'WARN 判定不明确';
    const lines = [`质检结论：${label}（第 ${result.attempts}/${result.budget} 次）`, `理由：${result.reason}`];
    if (result.drifts.length > 0)
        lines.push(`漂移项：${result.drifts.join('；')}`);
    if (result.verdict === 'fail') {
        lines.push(result.exhausted
            ? `已用尽重跑预算（${result.budget} 次）→ 停止自动重跑，把该镜与漂移项上报用户仲裁，由用户决定接受/改锚点/改分镜。`
            : '只重跑该镜（同一分镜卡 shotRefs），不要重跑其他已 PASS 的镜头。');
    }
    else if (result.verdict === 'warn') {
        lines.push('判定不明确 → 不要自动重跑，请用户人工确认该镜画面。');
    }
    if (result.nodeId === null)
        lines.push('（未匹配到画布节点，结论未落盘）');
    return lines.join('\n');
}
