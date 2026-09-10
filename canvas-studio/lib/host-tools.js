/**
 * Canvas Studio P3 媒体生成工具（Host 侧）。
 *
 * `ctx.tools` 是 Host 服务，因此工具定义必须注册在 Host（浏览器客户端没有
 * `tools` 服务，之前在客户端注册正是桌面闪退的根因）。每个工具的 `execute`
 * 从会话工作区解析绑定的项目（`exec.agent.session.header.cwd`，即项目拥有的
 * 目录），再调用 Host 的 `generateAsset` —— 外部 API 调用与落盘都在 Host 完成，
 * 既规避浏览器 CORS，也避免跨进程 HTTP 往返。
 */
import { randomUUID } from 'node:crypto';
import { sep } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { normalizeWorkflow } from './contracts/project.js';
import { isActiveShot, shotStatusOf } from './shot-versions.js';
import { BRIEF_NODE_TOOL, AUDIO_COMPOSITION_LABELS } from './contracts/canvas.js';
import { findNodeByRef, parseRefTokens } from './reference-token.js';
import { newAssetId } from './config.js';
import { runShotQc, renderQcText, DEFAULT_QC_BUDGET } from './quality-check.js';
import { generateAsset, assetKeyFromUrl, promoteAssetFile, uploadImage, enhancePrompt, analyzeImage, splitStoryboard, generateCharacterSheet, generateMusic, setRuntimeConfig, deriveNodePlacement, clampDuration } from './generate.js';
import { assertH3IrPrompt } from './h3-ir-validate.js';
import { extractLastFrame } from './video-frames.js';
import { composeStudioVideo, appendComposedVideoNode } from './compose.js';
/** 产物结果 schema（工具返回给模型的结构）。 */
const resultSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        url: { type: 'string', description: '产物托管 URL，可在画布中直接引用' },
        width: { type: 'integer', description: '宽度（像素）' },
        height: { type: 'integer', description: '高度（像素）' },
        duration: { type: 'number', description: '视频时长（秒）；图片无此项' },
        filename: { type: 'string', description: 'Drama Backend 服务器文件名（图片类产物；供下游 image_generate / video_generate / video_composite / storyboard_split 以 filename 链式引用）' },
        warnings: { type: 'array', items: { type: 'string' }, description: '占坑参数提示（可选）：本次请求中暂未接入后端的参数（model/resolution/generateAudio）说明' },
        nodeId: { type: 'string', description: '本次产物落到的画布节点 id；可填进 compose_video 的 clipIds 精确指定拼接范围，或填进 video_generate / video_composite 的 replaces 声明「这版取代哪版」' },
        superseded: { type: 'array', items: { type: 'string' }, description: '本次产物取代掉的旧节点 id（同一镜位出了新版时非空；旧版自动失效，不再进默认合成）' },
        clipCount: { type: 'integer', description: '成片合成专用：本次纳入拼接的片段数' },
        skippedCount: { type: 'integer', description: '成片合成专用：被跳过的失效片段数（已作废 / 被新版取代）' },
    },
};
/** 把产物结果渲染成模型可读的文本块。 */
function renderResult(_args, value) {
    const result = value;
    const duration = result.duration !== undefined ? `, ${result.duration}s` : '';
    const name = result.filename !== undefined ? `, Drama 文件名: ${result.filename}` : '';
    const warnings = result.warnings !== undefined && result.warnings.length > 0 ? `；注意: ${result.warnings.join('；')}` : '';
    const nodeId = result.nodeId !== undefined ? `；画布节点 id: ${result.nodeId}` : '';
    const superseded = result.superseded !== undefined && result.superseded.length > 0
        ? `；已取代 ${result.superseded.length} 个旧版本（不再进默认合成）`
        : '';
    return [{ type: 'text', text: `已生成产物: ${result.url} (${result.width}x${result.height}${duration}${name})${warnings}${nodeId}${superseded}` }];
}
/** 分镜卡标题（节点血缘里 toolName=submit_storyboard_for_approval 的祖先）。 */
function shotCardTitleOf(nodes, node) {
    for (const id of node.sourceIds) {
        const found = nodes.find((candidate) => candidate.id === id);
        if (found?.toolName === 'submit_storyboard_for_approval')
            return found.title;
    }
    return undefined;
}
/** CV-108：成片合成结果——补上「纳入 / 跳过」片段数，让「哪些镜进了成片」可核对。 */
function renderComposeResult(args, value) {
    const blocks = renderResult(args, value);
    const v = value;
    if (v.clipCount === undefined)
        return blocks;
    const skipped = v.skippedCount === undefined || v.skippedCount === 0 ? '' : `，跳过 ${v.skippedCount} 段失效片段`;
    // CV-143：把音轨构成写进结果——agent 需要知道环境声是留是丢，才能向用户解释听感。
    const audio = v.audioComposition === undefined ? '' : `，音轨 ${AUDIO_COMPOSITION_LABELS[v.audioComposition]}`;
    const first = blocks[0];
    const base = first !== undefined && first.type === 'text' ? first.text : '';
    const lines = [`${base}（纳入 ${v.clipCount} 段${skipped}${audio}）`];
    // CV-138 / CV-141：降级与「成片无声」这类事实不能被吞掉——模型看不见就等于用户不知道。
    for (const warning of v.warnings ?? [])
        lines.push(`⚠️ ${warning}`);
    return [{ type: 'text', text: lines.join('\n') }];
}
/** CV-108：给模型看的镜头清单（id / 版本 / 状态），供 replaces 与 clipIds 精确引用。 */
function renderShotList(_args, value) {
    const v = value;
    if (v.shots.length === 0)
        return [{ type: 'text', text: '画布上还没有视频片段。' }];
    const lines = v.shots.map((shot) => {
        const tag = shot.status === 'active' ? `v${shot.version}` : `v${shot.version}（${shot.status === 'retired' ? '已作废' : '已失效'}）`;
        const duration = shot.duration === undefined ? '' : ` ${shot.duration}s`;
        const card = shot.shotCard === undefined ? '' : ` · ${shot.shotCard}`;
        return `- ${shot.title || '未命名片段'}${card} · ${tag}${duration} · id=${shot.id}`;
    });
    return [{ type: 'text', text: `当前镜头清单（${v.shots.length} 段）：\n${lines.join('\n')}\n\n重出某镜时把旧版 id 传给 video_generate / video_composite 的 replaces；精确合成时把要用的 id 传给 compose_video 的 clipIds。` }];
}
/** 把上传结果渲染成模型可读的文本块。 */
function renderUploadResult(_args, value) {
    const v = value;
    return [{ type: 'text', text: `已上传到 Drama Backend: ${v.filename}` }];
}
/** 把 character_sheet 结果渲染成模型可读的文本块（含 SAME 块注入纪律提示）。 */
function renderCharacterSheetResult(_args, value) {
    const v = value;
    return [{
            type: 'text',
            text: [
                `已建立一致性资产卡「${v.name}」（id=${v.assetId}）。`,
                `四视图拼图（资产卡唯一锚点）: ${v.url}`,
                `锚点 Drama filename: ${v.filename}（可直接用于 image_generate 的 filenames / video_composite 的 filenames；四视图拼图整图作参考，官方 reference-sheet 用法，拼图自带视角/身份标签）。`,
                '后续所有含该角色的镜头，prompt 必须以该角色的锁定描述开头逐字节复用，参考图使用该锚点 filename。',
            ].join('\n'),
        }];
}
/** 把 music_generation 结果渲染成模型可读的文本块（含 compose 接入指引）。 */
function renderMusicResult(_args, value) {
    const v = value;
    const lines = [
        `BGM 已生成并落到画布（节点 id=${v.nodeId}）。`,
        `音频: ${v.url}（Drama 文件名 ${v.filename}）`,
        // CV-127：回显规格，供后续分镜按拍拆镜 / 成片时长对齐（bpm 是请求值，实际会 ±2 浮动）。
        `规格: ${v.duration}s / ${v.bpm} BPM`,
        `成片合成时传 compose_video 的 bgmNodeId=${v.nodeId} 即可混音（自动淡入淡出）；不要把音频节点传给 clipIds（clipIds 只收视频片段）。`,
    ];
    // CV-130：歌词随节点落盘，回显首行让模型确认「唱的就是这份词」；纯器乐不刷屏。
    if (v.lyrics !== '[Instrumental]') {
        const firstLine = v.lyrics.split('\n').map(line => line.trim()).find(line => line.length > 0) ?? '';
        lines.push(`歌词已随节点上画布（双击节点打开播放器窗口看全文）${firstLine.length > 0 ? `；首行：${firstLine}` : ''}。`
            + '若用户要求改词，重新调用 music_generation 并传入新的 lyrics，不要在对话里贴词交差。');
    }
    // CV-127b：降级必须显式告知——否则模型会以为自己拿到了指定调性/拍号/速度的曲子。
    if (v.degradedFields.length > 0) {
        lines.push(`⚠️ 后端未接受 ${v.degradedFields.join(' / ')}，本次已忽略该参数生成（曲目不受它约束）。`
            + '不要向用户声称「已按该调性/拍号生成」；若该参数很关键，可改写法后重新生成。');
    }
    if (v.attempts > 1) {
        lines.push(`（首次请求失败，共尝试 ${v.attempts} 次后成功——后端偶发 500，非参数问题。）`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
}
/** 把文本结果渲染成模型可读的文本块。 */
function renderTextResult(_args, value) {
    const v = value;
    return [{ type: 'text', text: v.text }];
}
/**
 * CR-001：compose_video 缺省选片——只取「逐镜视频片段」并按生成顺序排序，
 * 排除成片节点（toolName='compose'）。否则二次合成会把上一版成片当片段再拼
 * 一次，递归叠加。
 *
 * CV-108：再排除失效版本（被新版取代 / 已作废）——返工、重复生成的旧片段
 * 不再混入成片（此前一段镜头出 2~3 版时全部被拼进去）。
 * 纯函数便于单测；显式传 clipIds 时不经过此逻辑。
 */
export function defaultComposeClips(nodes) {
    return nodes
        .filter(node => node.kind === 'video' && node.toolName !== 'compose' && isActiveShot(node))
        .sort((left, right) => left.createdAt - right.createdAt)
        .map(node => node.id);
}
/**
 * 暂不可用（disabled）的工具集合。这些工具仍注册（避免上游 skill 流程因
 * "tool not found" 中断），但调用时抛「暂不可用」错误，提示模型改用替代路径。
 * 后端端点与 generate.ts 的分支代码全部保留，恢复时只需把工具名移出本集合。
 */
const DISABLED_TOOLS = new Set(['style_transfer', 'inpaint']);
/** 工具「暂不可用」时的统一守卫：命中即抛错，否则放行。 */
function guardDisabledTool(name) {
    if (DISABLED_TOOLS.has(name)) {
        throw new Error(`工具 ${name} 当前暂不可用（功能保留、待后续接入）。请改用替代方案：inpaint 的图像编辑需求暂缓；style_transfer 的风格统一改用 image_generate 传参考图或 character_generate。`);
    }
}
/**
 * 单条画布文本节点的截断上限（字符）。write_script 文案可能上千字且对白需要
 * 被逐字引用，400 会砍掉关键信息；2000 能完整容纳绝大多数便签/文案/分镜表，
 * 同时防止粘贴的超长文本节点撑爆工具结果。截断时显式标注剩余长度。
 */
const NOTE_TEXT_LIMIT = 2000;
/** 最多返回的画布文本节点条数（按创建时间倒序取最新）。 */
const MAX_NOTES_RETURNED = 10;
function clipNoteText(text) {
    return text.length > NOTE_TEXT_LIMIT
        ? `${text.slice(0, NOTE_TEXT_LIMIT)}…（已截断，全文 ${text.length} 字符）`
        : text;
}
/** 把参考图列表与画布文本节点渲染成模型可读的文本块。 */
function renderReferenceList(_args, value) {
    const v = value;
    const parts = [];
    // 资产卡优先：它是跨镜头一致性的权威锚点，agent 读到这里就该拿 lockedPrompt
    // 与锚点分图，而不是临场回忆或改用别的参考图。
    if (v.assets.length > 0) {
        const lines = v.assets.map((a) => {
            const anchors = a.anchors.length > 0
                ? a.anchors.map((p) => (p.filename !== null ? p.filename : `${p.title}（需 upload_image）`)).join('、')
                : '无分图（锚点缺失）';
            const negative = a.negativePrompt !== null ? `\n   负面约束：${a.negativePrompt}` : '';
            return `- [${a.role}] ${a.name}（id=${a.id}）\n   lockedPrompt（逐字节复用）：${a.lockedPrompt}\n   锚点分图 filename：${anchors}${negative}`;
        });
        parts.push(`一致性资产卡（${v.assets.length}）：\n${lines.join('\n')}`);
    }
    if (v.references.length === 0) {
        parts.push('当前项目没有标记为参考图的素材。可先用上传图片功能添加参考，或生成一张图后它默认成为参考。');
    }
    else {
        const lines = v.references.map((r, i) => {
            const name = r.filename !== null ? `filename=${r.filename}` : '需先 upload_image(url) 取文件名';
            return `${i + 1}. [${r.role}] ${r.title}（强度 ${r.strength}，${name}）`;
        });
        parts.push(`可用参考图（${v.references.length}）：\n${lines.join('\n')}`);
    }
    if (v.notes.length > 0) {
        const lines = v.notes.map((n, i) => `${i + 1}. 【${n.source}】${n.title}：${n.text}`);
        parts.push(`画布文本节点（${v.notes.length}）：\n${lines.join('\n')}`);
    }
    return [{ type: 'text', text: parts.join('\n\n') }];
}
/**
 * 从会话工作区目录解析绑定的 Canvas Studio 项目 id。
 * 项目的工作区目录即 `project.dir`；精确匹配优先，否则取最长前缀匹配
 * （会话 cwd 落在项目目录内的子路径时也能命中）。
 */
async function resolveProjectId(registry, cwd) {
    if (!cwd) {
        throw new Error('当前会话未绑定工作区，请先在左侧打开或创建一个 Canvas Studio 项目');
    }
    const projects = await registry.list();
    let match = null;
    let bestLength = -1;
    for (const project of projects) {
        const dir = project.dir;
        if (dir === cwd || cwd.startsWith(dir + sep)) {
            if (dir.length > bestLength) {
                bestLength = dir.length;
                match = project.id;
            }
        }
    }
    if (match === null) {
        throw new Error('当前会话工作区未绑定任何 Canvas Studio 项目，请先在左侧打开或创建一个项目');
    }
    return match;
}
/**
 * 把 `@ref[显示名]` token 解析成对应的 Drama Backend 文件名。
 * 匹配池：参考托盘节点（isReference）优先，其次是未标记参考的普通素材节点
 * （对话附件旁路落卡即普通节点，isReference 只是托盘展示语义，引用句柄以
 * title + filename 为准）。
 * 2026-09-05 两段式上传：命中的节点还没有 filename（后台 Drama 提升未完成）
 * 时，若其 url 指向项目 assets 落盘文件，则现场读盘上传 Drama（惰性兜底）并
 * 回写 canvas.json——正确性与后台上传进度解耦；已提升则直接复用（Host 侧
 * in-flight 去重防与后台预热并发重复上传）。
 */
async function resolveRefFilenames(registry, projectId, tokens) {
    if (tokens.length === 0)
        return [];
    const nodes = (await registry.readCanvas(projectId)).nodes;
    const references = nodes.filter((node) => node.isReference === true);
    const plainAssets = nodes.filter((node) => node.isReference !== true
        && typeof node.filename === 'string' && node.filename.length > 0);
    // CV-114：匹配池沿用「参考优先、普通素材节点兜底」，句柄按 id 精确匹配、
    // 标题兜底（findNodeByRef）——重名/改名不再让引用指错或失效。
    const pool = [...references, ...plainAssets];
    const out = [];
    for (const token of tokens) {
        const node = findNodeByRef(pool, token);
        if (node === undefined) {
            throw new Error(`参考图 @ref[${token}] 在当前项目画布中未找到（或该素材尚未取得 Drama 文件名）。请确认素材已在画布上；参考图需在节点详情面板点「标记为参考」（或用 list_references 查看可用参考）。`);
        }
        if (node.filename === undefined || node.filename === null || node.filename.length === 0) {
            // 惰性兜底：节点已落盘（有项目资产 url）但 Drama 提升未完成 → 现场提升并回写。
            const assetKey = node.url === undefined ? null : assetKeyFromUrl(node.url);
            if (assetKey === null || !assetKey.startsWith(`${projectId}/`)) {
                throw new Error(`参考图 @ref[${token}] 尚未上传到 Drama Backend（缺少 filename），且该节点不是画布资产。请先调 upload_image(url="${node.url ?? ''}") 取得文件名，或直接在参数里粘贴该文件名。`);
            }
            const filename = await promoteAssetFile(registry, projectId, assetKey.slice(projectId.length + 1));
            const doc = await registry.readCanvas(projectId);
            await registry.writeCanvas(projectId, doc.nodes.map((entry) => (entry.id === node.id ? { ...entry, filename } : entry)));
            out.push(filename);
            continue;
        }
        out.push(node.filename);
    }
    return out;
}
/** 解析单个 filename 参数：含 @ref token 时解析为 Drama 文件名，否则原样返回。 */
async function resolveRefValue(registry, projectId, value) {
    const tokens = parseRefTokens(value);
    if (tokens.length === 0)
        return value;
    // CR-031：单值参数内出现多个 @ref 是歧义（一个 filename 只能解析一个参考），
    // 显式报错而非静默取第一个（此前 resolved[0] 会静默丢弃其余 token）。
    if (tokens.length > 1) {
        throw new Error(`参数 "${value}" 包含多个 @ref 引用（${tokens.join('、')}）；单个 filename 参数只能引用一个参考，请拆分后分别传入。`);
    }
    const resolved = await resolveRefFilenames(registry, projectId, tokens);
    return resolved[0];
}
/** 解析 filenames 数组参数：逐元素尝试 @ref 解析。 */
async function resolveRefValues(registry, projectId, values) {
    return Promise.all(values.map((value) => resolveRefValue(registry, projectId, value)));
}
/** 解析项目后调用 Host 的 generateAsset 执行一次生成。 */
function runGeneration(registry, tool, params, signal, cwd) {
    return resolveProjectId(registry, cwd).then(async (projectId) => {
        // P7 硬门禁：逐步确认模式下，分镜/视频生成必须先经 submit_storyboard_for_approval
        // 获得用户批准（state=executing）。放手跑模式（auto）不受限。门禁只约束 agent 的
        // 工具调用；画布上用户手动发起的节点重试走 /generate 路由，不经此处。
        const workflow = normalizeWorkflow((await registry.getProject(projectId))?.workflow);
        if (GATED_TOOLS.has(tool) && workflow.mode === 'confirm' && workflow.state !== 'executing') {
            if (workflow.state === 'script_review') {
                throw new Error('剧本正在等待用户批准（画布上方审批条）。请停止生成，等待用户点击「批准」；若用户给出修改意见，按意见修改剧本并重新 submit_screenplay_for_approval。不要自行重试。');
            }
            if (workflow.state === 'keyframe_review') {
                throw new Error('关键帧正在等待用户确认（画布上方确认条）。请停止视频生成，等待用户点击「确认关键帧」；用户可能在画布上二次编辑关键帧，编辑完成后仍需再次确认。确认后用户会发送「继续」恢复流程，不要自行重试。');
            }
            throw new Error(workflow.state === 'awaiting_approval'
                ? '分镜表正在等待用户批准（画布上方审批条）。请停止生成，等待用户点击「批准」并在对话中发送「继续」后再执行；不要自行重试。'
                : '当前项目为「逐步确认」模式：请先完成需求澄清与剧本创作（write_screenplay → submit_screenplay_for_approval），再规划分镜并用 submit_storyboard_for_approval 提交；用户批准分镜前不能调用分镜/视频生成工具（概念图 image_generate 允许）。');
        }
        if (tool === 'storyboard_split') {
            const sp = params;
            return splitStoryboard(registry, projectId, {
                filename: sp.filename ?? '',
                ...(sp.gridnum !== undefined ? { gridnum: sp.gridnum } : {}),
                ...(sp.sourceUrls !== undefined ? { sourceUrls: sp.sourceUrls } : {}),
            }, signal);
        }
        return generateAsset(registry, tool, projectId, params, signal);
    });
}
/** P7 门禁覆盖的生成类工具：正式流程的入口动作。 */
const GATED_TOOLS = new Set(['storyboard_generate', 'video_generate', 'video_composite', 'storyboard_split']);
/** renderResult 在无真实分辨率时的兜底尺寸（成片探测失败时）。 */
const COMPOSED_FALLBACK = { width: 1280, height: 720 };
/**
 * ask_user_choice 的等待上限（毫秒）：比最长视频超时更宽，到点按推荐项继续。
 */
const QUESTION_WAIT_MS = 600_000;
function sleep(ms) {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
}
/**
 * 解析分镜表 markdown 表格为逐镜单元格行。容错策略：
 * - 只认含 `|` 的行；行首尾 `|` 可省略；
 * - 丢弃分隔行（`---`）与表头行（首列为「镜号」）；少于 3 列的行丢弃；
 * - 解析不出任何数据行时返回空数组（调用方回退整表单节点落盘）。
 */
export function parseStoryboardShots(storyboard) {
    const rows = storyboard
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.includes('|'));
    const dataRows = rows
        .map((line) => line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim()))
        .filter((cells) => cells.length >= 3)
        .filter((cells) => !cells.every((cell) => cell.length === 0 || /^:?-+:?$/.test(cell)))
        .filter((cells) => cells[0] !== '镜号');
    return dataRows;
}
/** CV-142：H3 输出的声明帧率（实测 24fps）——把分镜表的秒值换算成帧数用。 */
export const DECLARED_FPS = 24;
/**
 * CV-142：从分镜表「时长」单元格解析秒数（纯函数）。解析不出返回 0。
 *
 * 容错写入形式：`5s` / `5 秒` / `约 5 秒` / `5.5s` / `00:05`（时间码按 mm:ss 或
 * mm:ss:ff）。取第一个数字；时间码优先判定，避免 `00:05` 被读成 0。
 */
export function parseShotDurationSeconds(text) {
    const trimmed = text.trim();
    if (trimmed.length === 0)
        return 0;
    const clock = /^(\d+):(\d{1,2})(?::(\d{1,2}))?/u.exec(trimmed);
    if (clock !== null) {
        const total = Number(clock[1]) * 60 + Number(clock[2]) + (clock[3] === undefined ? 0 : Number(clock[3]) / DECLARED_FPS);
        return total > 0 ? total : 0;
    }
    const match = /(\d+(?:\.\d+)?)/u.exec(trimmed);
    if (match === null)
        return 0;
    const value = Number(match[1]);
    return Number.isFinite(value) && value > 0 ? value : 0;
}
/** 把一行分镜单元格格式化为逐镜卡片正文（缺失列自动跳过）。 */
export function formatStoryboardShot(cells) {
    const [no = '', scene = '', move = '', duration = ''] = cells;
    const rest = cells.slice(4);
    const sound = rest.length >= 2 ? rest[rest.length - 1] : '';
    const visual = rest.length >= 2 ? rest.slice(0, -1).join(' | ') : (rest[0] ?? '');
    const meta = [scene, move, duration].filter((part) => part.length > 0).join(' · ');
    const title = `分镜 ${no || '?'}${scene.length > 0 ? ` · ${scene}` : ''}`;
    const lines = [
        `【镜 ${no || '?'}】${meta}`,
        ...(visual.length > 0 ? [`画面：${visual}`] : []),
        ...(sound.length > 0 ? [`声音：${sound}`] : []),
    ];
    return { title, text: lines.filter((line) => line.trim().length > 0).join('\n') };
}
/** CV-026/027：构建逐镜卡片节点（血缘指向 sourceIds，每行 3 卡横向排列）。 */
function buildShotCards(existing, sourceIds, shots) {
    const base = deriveNodePlacement(existing, sourceIds, 360, 220);
    const createdAt = Date.now();
    return shots.map((cells, index) => {
        const shot = formatStoryboardShot(cells);
        // CV-142：把「时长」列解析成结构化数字落卡——合成时据此校验「分镜表声明」
        // 与「实际生成请求」是否一致（此前这个数只以文本形式躺在卡片正文里，
        // 没有任何工程校验，agent 传错 duration 也没人发现）。
        const declared = parseShotDurationSeconds(cells[3] ?? '');
        const column = index % 3;
        const row = Math.floor(index / 3);
        return {
            id: newAssetId(),
            kind: 'text',
            title: shot.title,
            text: shot.text,
            x: base.x + column * (360 + 40),
            y: base.y + row * (220 + 40),
            width: 360,
            height: 220,
            createdAt: createdAt + index,
            toolName: 'submit_storyboard_for_approval',
            origin: 'agent',
            sourceIds: [...sourceIds],
            operationType: 'storyboard',
            ...(declared > 0
                ? { declaredDuration: declared, declaredFrames: Math.round(declared * DECLARED_FPS) }
                : {}),
        };
    });
}
/**
 * C4：质检判定基准的缺省来源 —— 项目一致性资产卡的 lockedPrompt 全量拼接。
 * 没有资产卡时返回空串（调用方据此要求显式传 expect，避免无基准瞎判）。
 */
function defaultQcExpect(assets) {
    if (assets === undefined || assets.length === 0)
        return '';
    return assets
        .map((asset) => `[${asset.name}] ${asset.lockedPrompt}${asset.negativePrompt !== undefined && asset.negativePrompt.length > 0 ? `（禁止：${asset.negativePrompt}）` : ''}`)
        .join('\n');
}
/** 给模型看的分镜卡清单（标题 + id），随 submit 工具结果回流供 shotRefs 引用。 */
function describeShotCards(cards) {
    return cards.map((node) => `${node.title}（id=${node.id}）`).join('、');
}
/**
 * CV-027：解析 shotRefs 为分镜卡节点 id。接受三种写法：节点 id 精确匹配、
 * 卡片标题精确匹配（如「分镜 1 · 特写」）、镜号简写（如「分镜 1」——按标题
 * 前缀匹配该镜号，不会误命中「分镜 10」）。找不到时抛可操作报错，模型可
 * 依据提示修正后重试。
 */
async function resolveShotRefs(registry, projectId, refs) {
    const cards = (await registry.readCanvas(projectId)).nodes
        .filter((node) => node.toolName === 'submit_storyboard_for_approval');
    const out = [];
    for (const ref of refs) {
        const raw = String(ref).trim();
        if (raw.length === 0)
            continue;
        const byNumber = /^分镜\s*(\d+)$/.exec(raw);
        const hit = cards.find((node) => node.id === raw)
            ?? cards.find((node) => node.title === raw)
            ?? (byNumber !== null
                ? cards.find((node) => new RegExp(`^分镜 ${byNumber[1]}(?:\\s|·|$)`).test(node.title ?? ''))
                : undefined);
        if (hit === undefined) {
            throw new Error(`分镜卡「${raw}」未找到：请用提交分镜后工具结果里列出的卡片标题（如「分镜 1 · 特写」）或节点 id 作为 shotRefs`);
        }
        if (!out.includes(hit.id))
            out.push(hit.id);
    }
    return out;
}
/**
 * CV-031b：upload_image 上传的是画布资产 URL 时，把 Drama 新 filename 回写
 * 到对应节点。生成产物落盘自带初始 filename，但模型按 skill 第 7 步重新
 * upload 拿到的是新名字——不回写的话，下游 video_generate 用新 filename
 * 反查不中关键帧，视频就会只连分镜卡、漏连关键帧（VideoOut 项目实测）。
 * 按资产 URL 末段文件名精确匹配节点 url；非画布资产（外部图）不处理。
 */
async function backfillUploadFilename(registry, projectId, imageUrl, filename) {
    const file = imageUrl.split('/').pop();
    if (!file)
        return;
    const doc = await registry.readCanvas(projectId);
    const target = doc.nodes.find((node) => node.url !== undefined && node.url.split('/').pop() === file);
    if (target === undefined || target.filename === filename)
        return;
    await registry.writeCanvas(projectId, doc.nodes.map((node) => (node.id === target.id ? { ...node, filename } : node)));
}
export function createStudioTools(registry, port, cfg) {
    // 运行时配置写入 generate.ts 模块级 current，供 Drama 调用读取；未提供时
    // 不写入（测试直连场景由 generate.ts 的编译期默认值兜底）。
    if (cfg !== undefined)
        setRuntimeConfig(cfg);
    return [
        defineTool({
            name: 'image_generate',
            description: '根据提示词生成一张图片。可传 filename（单参考图生图）或 filenames（最多 3 张参考图，多参考融合图生图），两者都来自 upload_image 拿到的 Drama Backend 文件名；都不传则为纯文生图。返回图片的托管 URL 与尺寸。画风由 style 控制：realistic=写实（默认，走 txt2image 文生 / image2image 图生），anime=卡通/日式动漫（走 txt2imageanime，仅纯文生图；若同时传了参考图则回退写实图生图）。参考图也可来自画布参考托盘：对话里用 @ref[参考图显示名] 直接引用（取其 Drama filename），或先调 list_references 列出当前项目可用参考及其 filename/role。若 filename/filenames 直接传 @ref[显示名]，Host 会自动解析为对应 Drama 文件名，无需手动 upload_image。',
            parameters: {
                prompt: { type: 'string', required: true, description: '生成提示词' },
                aspectRatio: { type: 'string', enum: ['16:9', '9:16', '1:1'], description: '宽高比，默认 16:9' },
                style: { type: 'string', enum: ['realistic', 'anime'], description: '画风模式：realistic=写实（默认），anime=卡通/日式动漫（仅纯文生图）' },
                filename: { type: 'string', description: '可选单参考图：已上传的 Drama Backend 文件名（来自 upload_image 工具，用于图生图）' },
                filenames: { type: 'array', description: '可选多参考图（最多 3 张，来自 upload_image 工具）；与 filename 二选一，多参考融合图生图' },
                negativePrompt: { type: 'string', description: '反向提示词' },
                sourceUrls: { type: 'array', description: '本图参考的画布产物 URL 数组（此前工具结果里的 url），用于在画布上画出流程箭头；没有参考图可省略' },
                shotRefs: { type: 'array', description: '可选：要关联的分镜卡（「分镜 N · 景别」标题、「分镜 N」镜号或节点 id，来自提交分镜的工具结果）。画布会把本图连到对应分镜卡并排在其右侧' },
            },
            output: { schema: resultSchema, render: renderResult },
            async execute(args, exec) {
                const a = args;
                const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd);
                const params = { prompt: a.prompt };
                if (a.aspectRatio !== undefined)
                    params.aspectRatio = a.aspectRatio;
                if (a.style !== undefined)
                    params.style = a.style;
                if (a.filename !== undefined)
                    params.filename = await resolveRefValue(registry, projectId, a.filename);
                if (Array.isArray(a.filenames) && a.filenames.length > 0)
                    params.filenames = await resolveRefValues(registry, projectId, a.filenames);
                if (a.negativePrompt !== undefined)
                    params.negativePrompt = a.negativePrompt;
                if (a.sourceUrls !== undefined)
                    params.sourceUrls = a.sourceUrls;
                if (Array.isArray(a.shotRefs) && a.shotRefs.length > 0)
                    params.shotNodeIds = await resolveShotRefs(registry, projectId, a.shotRefs);
                return runGeneration(registry, 'image_generate', params, exec.signal, exec.agent?.session.header.cwd);
            },
        }),
        defineTool({
            name: 'character_generate',
            description: '基于一张角色设计图生成角色立绘图（多视角 / 三视图）。必须提供 filename（角色设计图，来自 upload_image 工具返回的 Drama Backend 文件名）。返回角色立绘的托管 URL 与尺寸。设计图也可来自画布参考托盘：对话里用 @ref[显示名] 引用，或先调 list_references 列出（role=character 的参考即角色设计图）。filename 也可直接传 @ref[显示名]，Host 会自动解析为对应 Drama 文件名。',
            parameters: {
                filename: { type: 'string', required: true, description: '角色设计图：已上传的 Drama Backend 文件名（来自 upload_image 工具）' },
                aspectRatio: { type: 'string', enum: ['16:9', '9:16', '1:1'], description: '宽高比，默认 16:9' },
                sourceUrls: { type: 'array', description: '设计图对应的画布产物 URL 数组（此前工具结果里的 url），用于画布流程箭头' },
                shotRefs: { type: 'array', description: '可选：要关联的分镜卡（「分镜 N · 景别」标题、「分镜 N」镜号或节点 id，来自提交分镜的工具结果）' },
            },
            output: { schema: resultSchema, render: renderResult },
            async execute(args, exec) {
                const a = args;
                const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd);
                const params = { prompt: '', filename: await resolveRefValue(registry, projectId, a.filename) };
                if (a.aspectRatio !== undefined)
                    params.aspectRatio = a.aspectRatio;
                if (a.sourceUrls !== undefined)
                    params.sourceUrls = a.sourceUrls;
                if (Array.isArray(a.shotRefs) && a.shotRefs.length > 0)
                    params.shotNodeIds = await resolveShotRefs(registry, projectId, a.shotRefs);
                return runGeneration(registry, 'character_generate', params, exec.signal, exec.agent?.session.header.cwd);
            },
        }),
        defineTool({
            name: 'character_sheet',
            description: '基于角色设计图/定妆照建立项目级一致性资产卡：调 Drama image2character 生成白底四视图立绘（正面特写/侧面全身/背面全身），整图直接作为资产卡唯一锚点（官方 reference-sheet 用法：拼图自带角色/视角标签，下游直接整图作参考，不再切分）。返回资产卡 id 与拼图的 Drama filename（可直接用于 image_generate 的 filenames / video_composite 的 filenames，作角色一致性锚点）。filename 为设计图的 Drama Backend 文件名（来自 upload_image，支持 @ref[显示名] 自动解析）；name 为资产卡显示名；lockedPrompt 为该角色冻结的外貌/发型/服装/配色/光感固定描述（SAME 块）——必须先与用户确认后再传入，冻结后所有含该角色的镜头 prompt 都以它开头逐字节复用。需要多角色时逐个角色分别调用本工具。**同名资产卡会整体覆盖**——重调时传相同 name 即更新 lockedPrompt 与锚点（冻结描述写错时的纠正路径），因此 name 取稳定角色名（如「女主」），不要带序号或版本号。',
            parameters: {
                filename: { type: 'string', required: true, description: '角色设计图/定妆照的 Drama Backend 文件名（来自 upload_image 工具）' },
                name: { type: 'string', required: true, description: '资产卡显示名（如「女主」「侦探」）' },
                lockedPrompt: { type: 'string', required: true, description: '冻结 SAME 块：该角色外貌/发型/服装/配色/光感的固定描述，已与用户确认；后续镜头 prompt 逐字节复用' },
                negativePrompt: { type: 'string', description: '可选负面约束（如「不更换服装」「不摘眼镜」）' },
                sourceUrls: { type: 'array', description: '设计图对应的画布产物 URL 数组（此前工具结果里的 url），用于画布流程箭头；没有可省略' },
            },
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        url: { type: 'string', description: '四视图拼图的画布托管 URL（资产卡唯一锚点）' },
                        assetId: { type: 'string', description: '建立的资产卡 id' },
                        name: { type: 'string', description: '资产卡显示名' },
                        filename: { type: 'string', description: '四视图拼图的 Drama 文件名（可直接作生成工具的参考 filenames）' },
                    },
                },
                render: renderCharacterSheetResult,
            },
            async execute(args, exec) {
                const a = args;
                const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd);
                const resolvedFilename = await resolveRefValue(registry, projectId, a.filename);
                const result = await generateCharacterSheet(registry, projectId, {
                    filename: resolvedFilename,
                    assetName: a.name,
                    lockedPrompt: a.lockedPrompt,
                    ...(a.negativePrompt !== undefined ? { negativePrompt: a.negativePrompt } : {}),
                    ...(Array.isArray(a.sourceUrls) && a.sourceUrls.length > 0 ? { sourceUrls: a.sourceUrls } : {}),
                }, exec.signal);
                return result;
            },
        }),
        defineTool({
            name: 'inpaint',
            description: '【暂不可用】图像修复 / 编辑（Inpainting）：按 prompt 描述移除不需要的元素、智能填充背景，或添加新元素。当前功能保留但未开放，调用会返回「暂不可用」错误，请勿调用；图像编辑需求请暂缓或改用 image_generate 传参考图。',
            parameters: {
                prompt: { type: 'string', required: true, description: '修复/编辑描述（描述需要移除或添加的内容）' },
                filename: { type: 'string', required: true, description: '要修复的图像：已上传的 Drama Backend 文件名（来自 upload_image 工具）' },
                aspectRatio: { type: 'string', enum: ['16:9', '9:16', '1:1'], description: '宽高比，默认 16:9' },
                sourceUrls: { type: 'array', description: '原图对应的画布产物 URL 数组（此前工具结果里的 url），用于画布流程箭头' },
                shotRefs: { type: 'array', description: '可选：要关联的分镜卡（「分镜 N · 景别」标题、「分镜 N」镜号或节点 id，来自提交分镜的工具结果）' },
            },
            output: { schema: resultSchema, render: renderResult },
            async execute(args, exec) {
                guardDisabledTool('inpaint');
                const a = args;
                const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd);
                const params = { prompt: a.prompt, filename: await resolveRefValue(registry, projectId, a.filename) };
                if (a.aspectRatio !== undefined)
                    params.aspectRatio = a.aspectRatio;
                if (a.sourceUrls !== undefined)
                    params.sourceUrls = a.sourceUrls;
                if (Array.isArray(a.shotRefs) && a.shotRefs.length > 0)
                    params.shotNodeIds = await resolveShotRefs(registry, projectId, a.shotRefs);
                return runGeneration(registry, 'inpaint', params, exec.signal, exec.agent?.session.header.cwd);
            },
        }),
        defineTool({
            name: 'list_shots',
            description: '列出当前项目画布上的视频片段（逐镜产物），含节点 id / 分镜卡 / 版本号 / 状态 / 时长。用户要求「某镜返工」「最后只合成合理的分镜」时必须先调本工具定位节点 id：① 重出某镜时把旧版 id 填进 video_generate / video_composite 的 replaces，旧版自动失效；② 精确合成时把要用的 id 填进 compose_video 的 clipIds。compose 缺省只收有效片段（未被取代、未作废），失效片段需显式指定才会被拼进去。',
            parameters: {
                includeRetired: { type: 'boolean', description: '可选：是否一并列出已失效 / 已作废的片段（默认 false，只列有效片段）' },
            },
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        shots: { type: 'array', description: '视频片段列表（每项含 id / title / status / version / duration / url / shotCard）' },
                    },
                },
                render: renderShotList,
            },
            async execute(args, exec) {
                const a = args;
                const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd);
                const nodes = (await registry.readCanvas(projectId)).nodes;
                const shots = nodes
                    .filter((node) => node.kind === 'video' && node.toolName !== 'compose')
                    .filter((node) => a.includeRetired === true || isActiveShot(node))
                    .sort((left, right) => left.createdAt - right.createdAt)
                    .map((node) => ({
                    id: node.id,
                    title: node.title ?? '',
                    status: shotStatusOf(node),
                    version: node.shotVersion ?? 1,
                    ...(node.duration !== undefined ? { duration: node.duration } : {}),
                    url: node.url ?? '',
                    ...(() => {
                        const card = shotCardTitleOf(nodes, node);
                        return card === undefined ? {} : { shotCard: card };
                    })(),
                    ...(node.supersededBy !== undefined ? { supersededBy: node.supersededBy } : {}),
                }));
                return { shots };
            },
        }),
        defineTool({
            name: 'extract_last_frame',
            description: '抽取画布上某个视频片段的**真实末帧**（该片段的结束画面），用于「同场景连续镜头」的像素级衔接：把上一镜的末帧当作下一镜的首帧输入。传 videoUrl（video_generate / video_composite 返回的 url 字段）；返回末帧图的 url 与 filename —— 该 filename 可直接填进 video_generate 的 filename（首帧）或 video_composite 的 filenames（首尾帧的第一张）。末帧图会落到画布并标记为 frame 参考（可用 @ref 引用）。只在衔接语义为 chain（与上一镜同场景连续）时调用；跨时空硬切（cut）不要链帧。',
            parameters: {
                videoUrl: { type: 'string', required: true, description: '视频片段的同源 URL（video_generate / video_composite 工具返回的 url 字段）' },
            },
            output: { schema: resultSchema, render: renderResult },
            async execute(args, exec) {
                const a = args;
                const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd);
                const result = await extractLastFrame(registry, projectId, a.videoUrl, {}, exec.signal);
                return {
                    url: result.url,
                    ...(result.width !== undefined ? { width: result.width } : {}),
                    ...(result.height !== undefined ? { height: result.height } : {}),
                    duration: result.duration,
                    filename: result.filename,
                };
            },
        }),
        defineTool({
            name: 'qc_shot',
            description: '对单个镜头产物做**一致性质检**：视觉模型对照固定要素描述核对画面（外貌/发型发色/服装/核心道具/配色光感），返回 PASS / FAIL / WARN 与漂移项，结论写回该画布节点。每镜出图后调一次；FAIL 只重跑该镜（同一 shotRefs），不要重跑已 PASS 的镜头。判定基准缺省自动取本项目一致性资产卡的 lockedPrompt（可先调 list_references 查看），也可显式传 expect。WARN=判定不明确，交用户人工确认，不要自动重跑。',
            parameters: {
                filename: { type: 'string', required: true, description: '被检镜头图的 Drama 文件名（生成产物返回的 filename、upload_image 结果，或 @ref[显示名]）' },
                expect: { type: 'string', description: '判定基准：该镜必须保持的固定要素描述。缺省拼接本项目全部一致性资产卡的 lockedPrompt' },
                shotRefs: { type: 'array', description: '该镜所属分镜卡（写法同 image_generate 的 shotRefs：卡片标题 / 「分镜 N」/ 节点 id）。**务必传**——重跑会生成新节点，不传则每次质检都算第 1 次，重跑预算会失效' },
                budget: { type: 'number', description: `重跑预算，默认 ${DEFAULT_QC_BUDGET}。FAIL 次数达到预算时 exhausted=true，应停止自动重跑并把该镜上报用户仲裁` },
            },
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        verdict: { type: 'string', description: 'pass=一致 / fail=漂移 / warn=判定不明确' },
                        drifts: { type: 'array', description: '漂移项列表（fail 时非空）' },
                        reason: { type: 'string', description: '一句话判定理由' },
                        attempts: { type: 'number', description: '该镜第几次质检（跨重跑累计）' },
                        budget: { type: 'number', description: '重跑预算' },
                        exhausted: { type: 'boolean', description: 'FAIL 且已用尽预算：停止自动重跑，交用户仲裁' },
                        nodeId: { type: 'string', description: '结论落盘的画布节点 id（未匹配到时为 null）' },
                    },
                },
                render: (_args, value) => [
                    { type: 'text', text: renderQcText(value) },
                ],
            },
            async execute(args, exec) {
                const a = args;
                const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd);
                const filename = await resolveRefValue(registry, projectId, a.filename);
                const doc = await registry.readCanvas(projectId);
                const expect = (a.expect ?? '').trim().length > 0 ? a.expect.trim() : defaultQcExpect(doc.assets);
                if (expect.length === 0) {
                    throw new Error('缺少质检判定基准：请传 expect（该镜必须保持的固定要素描述），或先用 character_sheet 建立一致性资产卡');
                }
                const shotCardIds = Array.isArray(a.shotRefs) && a.shotRefs.length > 0
                    ? await resolveShotRefs(registry, projectId, a.shotRefs)
                    : [];
                const result = await runShotQc(doc.nodes, filename, {
                    analyze: analyzeImage,
                    expect,
                    shotCardIds,
                    ...(a.budget !== undefined ? { budget: a.budget } : {}),
                    signal: exec.signal,
                });
                if (result.nodeId !== null) {
                    const nodes = doc.nodes.map((node) => (node.id === result.nodeId ? { ...node, qc: result.record } : node));
                    await registry.writeCanvas(projectId, nodes, doc.view, doc.assets);
                }
                return {
                    verdict: result.verdict,
                    drifts: result.drifts,
                    reason: result.reason,
                    attempts: result.attempts,
                    budget: result.budget,
                    exhausted: result.exhausted,
                    ...(result.nodeId !== null ? { nodeId: result.nodeId } : {}),
                };
            },
        }),
        defineTool({
            name: 'upload_image',
            description: '将图片上传到 Drama Backend 服务器，返回服务器上的文件名。该文件名可直接用于其他工具的 filename 或 filenames 参数。所有需要图片作为输入的工具都必须先使用本工具上传图片，拿到服务器文件名后再传入。',
            parameters: {
                imageUrl: { type: 'string', required: true, description: '图片 URL（通常是 image_generate 的产物 URL）' },
            },
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        filename: { type: 'string', description: 'Drama Backend 服务器上的文件名' },
                    },
                },
                render: renderUploadResult,
            },
            async execute(args, exec) {
                const a = args;
                const filename = await uploadImage(a.imageUrl, exec.signal, port, registry);
                // CV-031b：画布资产重上传后回写 filename，保住 filename→节点 的血缘反查。
                const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd);
                await backfillUploadFilename(registry, projectId, a.imageUrl, filename);
                return { filename };
            },
        }),
        defineTool({
            name: 'list_references',
            description: '列出当前项目可复用的参考图（画布上标记为参考的素材节点）。每项含 title（显示名）、url（同源托管地址）、filename（Drama Backend 文件名，为空时需先调 upload_image(url) 取文件名）、role（image/character/style/frame）、strength（0–1 参考强度）。同时返回：① assets —— 项目一致性资产卡（id/name/role/lockedPrompt/negativePrompt + 锚点分图 filename），跨镜头生成同一角色/场景时**必须**先读它，以 lockedPrompt 逐字节复用 + 锚点分图作参考图（这是全片一致性的权威来源，不要临场改写描述或换用别的参考图）；② notes —— 画布上的文本类节点（参考视频上传后的风格归纳便签、write_script 文案、已提交的分镜表），供读取既有创作上下文。当用户要「用参考图/角色图/风格图生成」却没给具体文件名时，调本工具拿可用参考，再按 role 选对应工具：character→image_generate(filename)、style→image_generate(filename 风格参考)、frame→video_generate(filename 首帧)、image→通用参考；项目里上传过参考视频时，先用 notes 读风格归纳便签，再定风格策略。',
            parameters: {},
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        references: { type: 'array', description: '当前项目可用的参考图列表' },
                        assets: { type: 'array', description: '项目一致性资产卡列表（含冻结 lockedPrompt 与锚点分图 filename）' },
                        notes: { type: 'array', description: '画布文本类节点列表（风格归纳便签/文案/分镜表）' },
                    },
                },
                render: renderReferenceList,
            },
            async execute(_args, exec) {
                const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd);
                const document = await registry.readCanvas(projectId);
                const nodes = document.nodes;
                const nodeById = new Map(nodes.map((node) => [node.id, node]));
                const refs = nodes
                    .filter((node) => node.isReference === true && node.kind === 'image')
                    .map((node) => ({
                    title: node.title ?? node.url ?? '',
                    url: node.url ?? '',
                    filename: node.filename ?? null,
                    role: node.referenceRole ?? 'image',
                    strength: node.referenceStrength ?? 1,
                    ...(node.assetId !== undefined ? { assetId: node.assetId } : {}),
                }));
                // 一致性资产卡（C1 数据 / C2 注入纪律的权威来源）：把锚点节点 id 翻译成
                // agent 可直接填进 filenames 的 Drama filename，免去再查一次画布。
                const assets = (document.assets ?? []).map((asset) => ({
                    id: asset.id,
                    name: asset.name,
                    role: asset.role,
                    lockedPrompt: asset.lockedPrompt,
                    negativePrompt: asset.negativePrompt ?? null,
                    anchors: asset.anchorNodeIds.map((id) => nodeById.get(id)).filter((node) => node !== undefined)
                        .map((node) => ({
                        title: node.title ?? node.url ?? '',
                        url: node.url ?? '',
                        filename: node.filename ?? null,
                    })),
                }));
                // 画布文本节点（风格归纳便签 / write_script 文案 / 分镜表）：Agent 唯一
                // 的读回通道。只取最新 MAX_NOTES_RETURNED 条并逐条截断，防止撑爆结果。
                const notes = nodes
                    .filter((node) => (node.kind === 'text' || node.kind === 'sticky' || node.kind === 'prompt')
                    && typeof node.text === 'string' && node.text.trim().length > 0)
                    .sort((left, right) => right.createdAt - left.createdAt)
                    .slice(0, MAX_NOTES_RETURNED)
                    .map((node) => ({
                    title: node.title ?? '文本',
                    source: node.toolName ?? node.kind,
                    text: clipNoteText(node.text.trim()),
                }));
                return { references: refs, assets, notes };
            },
        }),
        defineTool({
            name: 'video_generate',
            description: '根据提示词生成视频，支持两种模式：不传 filename 时为纯文生视频；传入 filename（upload_image 返回的 Drama Backend 文件名）时为「首帧」图生视频。返回视频的托管 URL、尺寸与时长。首帧参考图也可来自画布参考托盘：对话里用 @ref[显示名] 引用，或先调 list_references 列出（role=frame 的参考即首帧图）。若 filename 直接传 @ref[显示名]，Host 会自动解析为对应 Drama 文件名。prompt 若写成 H3-Context-IR 简报格式（含 integrated_multimodal_description 等段名或对齐行），会先做本地格式预检：ERROR 级问题直接报错且不会调用后端，按 h3-prompt-writing 技能修正后重试即可（纯文本提示词不受影响）。视频供应商可在设置页切换（默认 Drama，另有 fal MiniMax H3 需配 Key），也可用 provider 参数对本次生成临时指定——除非用户明确要求切换，否则不要主动询问用哪家。',
            parameters: {
                prompt: { type: 'string', required: true, description: '生成提示词' },
                filename: { type: 'string', description: '可选：已上传的 Drama Backend 文件名（来自 upload_image 工具），用作视频首帧；不传则为纯文生视频' },
                aspectRatio: { type: 'string', enum: ['16:9', '9:16'], description: '宽高比，默认 16:9。视频只有横屏 16:9 与竖屏 9:16 两档' },
                duration: { type: 'number', description: '视频时长（秒），默认 5；上限 15，建议 8–10（更长请拆多段）' },
                model: { type: 'string', enum: ['h3', 'seedance2'], description: '【占坑·待接入】视频模型选择：默认 h3（当前后端统一走 FL2VA，即 H3 技术路线）；seedance2 尚未接入，传了会收到提示并按 h3 生成' },
                resolution: { type: 'string', enum: ['768p', '1080p', '720p', '2k'], description: '分辨率指定：仅对 fal 供应商生效（768p/2k 直通；720p 升档为 768P、1080p 升档为 2K，升档费用更高并会返回提示）；Drama 供应商暂不支持，传入会被忽略' },
                generateAudio: { type: 'boolean', description: '原生音轨开关（对应官方 / 上游 skill 的 generate_audio）。不传则不发该字段，由后端默认行为决定；传 true 请求「随画同步的原生音轨」（H3 的原生音频与画面同一次推理产出，含台词/音效/环境声，不是后期配音），传 false 要求静音。Drama 后端尚未开放该字段——被拒时会自动摘掉并明确提示，不会假装生效' },
                audioRefs: { type: 'array', description: '可选：参考音频（H3 官方 audio reference / audio reuse 通道）。**有序数组，顺序即提示词里 <Audio N> 的引用序**。填画布音频节点的 @ref[显示名] 或 upload_image 得到的文件名。官方硬规格：≤3 段、单段 2–15s、**合计 ≤15s**、WAV/MP3、单段 ≤15MB，且**音频不能是唯一输入**（必须同时有 filename 或参考图）——不合规会在生成前直接报错。带音频时按参考模式（r2v）生成，与首尾帧语义互斥' },
                provider: { type: 'string', enum: ['drama', 'fal'], description: '视频供应商：drama（默认，自架后端）/ fal（MiniMax H3，需在设置 → Canvas Studio 填写 fal API Key）。留空则用设置页的「默认视频供应商」；重试节点时会自动沿用该片原来的供应商' },
                sourceUrls: { type: 'array', description: '首帧图对应的画布产物 URL（此前工具结果里的 url），用于画布流程箭头' },
                shotRefs: { type: 'array', description: '可选：要关联的分镜卡（「分镜 N · 景别」标题、「分镜 N」镜号或节点 id，来自提交分镜的工具结果）。画布会把本段视频连到对应分镜卡并排在其右侧' },
                shotTransition: { type: 'string', enum: ['chain', 'cut', 'bridge'], description: '可选：本镜与上镜的衔接语义（随节点落盘，便于回溯）。chain=与上一镜同场景连续（生成前先对上一镜调 extract_last_frame 取末帧作本镜首帧）；cut=跨时空硬切（默认，不链帧）；bridge=同场景大跨度（首尾帧书挡）' },
                replaces: { type: 'string', description: '可选：本次生成取代哪个已有视频节点（填其画布节点 id，用 list_shots 查）。用于「改了关键帧重出这一镜」——旧版自动失效、不再进默认合成。同关键帧同参数重复生成会自动取代，无需显式传' },
            },
            output: { schema: resultSchema, render: renderResult },
            async execute(args, exec) {
                const a = args;
                const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd);
                const filename = a.filename !== undefined ? await resolveRefValue(registry, projectId, a.filename) : undefined;
                const params = { prompt: a.prompt, ...(filename !== undefined ? { filename } : {}) };
                if (a.aspectRatio !== undefined)
                    params.aspectRatio = a.aspectRatio;
                if (a.duration !== undefined)
                    params.duration = a.duration;
                if (a.model !== undefined)
                    params.model = a.model;
                if (a.resolution !== undefined)
                    params.resolution = a.resolution;
                if (a.generateAudio !== undefined)
                    params.generateAudio = a.generateAudio;
                // 参考音频：逐元素 @ref 解析（与 filename 同一套解析），顺序即 <Audio N> 引用序。
                if (Array.isArray(a.audioRefs) && a.audioRefs.length > 0)
                    params.audioRefs = await resolveRefValues(registry, projectId, a.audioRefs);
                if (a.provider !== undefined)
                    params.provider = a.provider;
                if (a.shotTransition !== undefined)
                    params.shotTransition = a.shotTransition;
                if (a.sourceUrls !== undefined)
                    params.sourceUrls = a.sourceUrls;
                if (Array.isArray(a.shotRefs) && a.shotRefs.length > 0)
                    params.shotNodeIds = await resolveShotRefs(registry, projectId, a.shotRefs);
                if (a.replaces !== undefined)
                    params.replaces = a.replaces;
                // CV-119：prompt 若为 H3-Context-IR 简报，先本地预检（纯文本直接透传）。
                // 模式映射：单首帧图 = I2VA，无图 = T2VA；时长与 videoRequestOf 同一套钳制。
                // 带参考音频 → 官方参考模式（r2v），IR 按 Ref2VA 预检并把 audios 计入
                // `<Audio N>` 的标签上界（否则合法的 <Audio 1> 会被判成越界）。
                const audioCount = Array.isArray(a.audioRefs) ? a.audioRefs.length : 0;
                assertH3IrPrompt(a.prompt, audioCount > 0
                    ? {
                        mode: 'Ref2VA',
                        duration: clampDuration(a.duration, 5),
                        audios: audioCount,
                        ...(filename !== undefined ? { pictures: 1 } : {}),
                    }
                    : {
                        mode: filename !== undefined ? 'I2VA' : 'T2VA',
                        duration: clampDuration(a.duration, 5),
                    });
                return runGeneration(registry, 'video_generate', params, exec.signal, exec.agent?.session.header.cwd);
            },
        }),
        defineTool({
            name: 'video_composite',
            description: '将多张参考图合成一段视频。两张图走首尾帧插值（首帧 + 尾帧）；三张及以上走多参考图合成（Drama 最多 6 张、fal 最多 9 张，超出自动采样保留首尾，后端自动排布保持角色/场景一致性）。必须提供 filenames（upload_image 返回的 Drama Backend 文件名数组）。返回合成视频的托管 URL、尺寸与时长。参考图也可来自画布参考托盘：先调 list_references 列出（role=character/image 的参考即可用），再取其 filename 填入 filenames。filenames 也可直接传 @ref[显示名]，Host 会自动解析为对应 Drama 文件名。prompt 若写成 H3-Context-IR 简报格式（含 subject_definitions / detailed_description 等段名或对齐行），会按参考图数量映射对应模式（2 图=FL2VA、3 图及以上=Ref2VA）做本地预检：ERROR 级问题直接报错且不会调用后端，按 h3-prompt-writing 技能修正后重试即可（纯文本提示词不受影响）。视频供应商可在设置页切换（默认 Drama，另有 fal MiniMax H3 需配 Key），也可用 provider 参数对本次生成临时指定——除非用户明确要求切换，否则不要主动询问用哪家。',
            parameters: {
                prompt: { type: 'string', required: true, description: '生成提示词' },
                filenames: { type: 'array', required: true, description: '已上传的 Drama Backend 文件名数组（来自 upload_image 工具）。上限由供应商决定：Drama 6 张、fal 9 张，超出自动采样（保留首尾）' },
                aspectRatio: { type: 'string', enum: ['16:9', '9:16'], description: '宽高比，默认 16:9。视频只有横屏 16:9 与竖屏 9:16 两档' },
                duration: { type: 'number', description: '视频时长（秒），默认 10；上限 15。两张图走首尾帧插值，三张及以上走多参考图合成。fal 供应商的时长下限是 5 秒，更短会被钳到 5 并提示' },
                model: { type: 'string', enum: ['h3', 'seedance2'], description: '【占坑·待接入】视频模型选择：默认 h3（当前后端统一走 FL2VA/REF2VA，即 H3 技术路线）；seedance2 尚未接入，传了会收到提示并按 h3 生成' },
                resolution: { type: 'string', enum: ['768p', '1080p', '720p', '2k'], description: '分辨率指定：仅对 fal 供应商生效（768p/2k 直通；720p 升档为 768P、1080p 升档为 2K，升档费用更高并会返回提示）；Drama 供应商暂不支持，传入会被忽略' },
                generateAudio: { type: 'boolean', description: '原生音轨开关（对应官方 / 上游 skill 的 generate_audio）。不传则不发该字段，由后端默认行为决定；传 true 请求「随画同步的原生音轨」（H3 的原生音频与画面同一次推理产出，含台词/音效/环境声，不是后期配音），传 false 要求静音。Drama 后端尚未开放该字段——被拒时会自动摘掉并明确提示，不会假装生效' },
                audioRefs: { type: 'array', description: '可选：参考音频（H3 官方 audio reference / audio reuse 通道）。**有序数组，顺序即提示词里 <Audio N> 的引用序**。填画布音频节点的 @ref[显示名] 或 upload_image 得到的文件名。官方硬规格：≤3 段、单段 2–15s、**合计 ≤15s**、WAV/MP3、单段 ≤15MB，且**音频不能是唯一输入**（filenames 至少 1 张图）——不合规会在生成前直接报错。带音频时按参考模式（r2v）生成，与首尾帧插值语义互斥' },
                provider: { type: 'string', enum: ['drama', 'fal'], description: '视频供应商：drama（默认，自架后端）/ fal（MiniMax H3，需在设置 → Canvas Studio 填写 fal API Key）。留空则用设置页的「默认视频供应商」；重试节点时会自动沿用该片原来的供应商' },
                sourceUrls: { type: 'array', description: '输入图对应的画布产物 URL 数组（按 filenames 同序），用于画布流程箭头' },
                shotRefs: { type: 'array', description: '可选：要关联的分镜卡（「分镜 N · 景别」标题、「分镜 N」镜号或节点 id，来自提交分镜的工具结果）。画布会把本段视频连到对应分镜卡并排在其右侧' },
                shotTransition: { type: 'string', enum: ['chain', 'cut', 'bridge'], description: '可选：本镜与上镜的衔接语义（随节点落盘）。chain=与上一镜同场景连续（filenames 首张放上一镜末帧，用 extract_last_frame 取）；cut=跨时空硬切（默认）；bridge=同场景大跨度（首尾帧书挡）' },
                replaces: { type: 'string', description: '可选：本次生成取代哪个已有视频节点（填其画布节点 id，用 list_shots 查）。用于「改了关键帧重出这一镜」——旧版自动失效、不再进默认合成。同关键帧同参数重复生成会自动取代，无需显式传' },
            },
            output: { schema: resultSchema, render: renderResult },
            async execute(args, exec) {
                const a = args;
                const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd);
                const filenames = await resolveRefValues(registry, projectId, a.filenames);
                const params = { prompt: a.prompt, filenames };
                if (a.aspectRatio !== undefined)
                    params.aspectRatio = a.aspectRatio;
                if (a.duration !== undefined)
                    params.duration = a.duration;
                if (a.model !== undefined)
                    params.model = a.model;
                if (a.resolution !== undefined)
                    params.resolution = a.resolution;
                if (a.generateAudio !== undefined)
                    params.generateAudio = a.generateAudio;
                // 参考音频：顺序即 <Audio N> 引用序（官方与 fal 都按 prompt 引用序取素材）。
                if (Array.isArray(a.audioRefs) && a.audioRefs.length > 0)
                    params.audioRefs = await resolveRefValues(registry, projectId, a.audioRefs);
                if (a.provider !== undefined)
                    params.provider = a.provider;
                if (a.shotTransition !== undefined)
                    params.shotTransition = a.shotTransition;
                if (a.sourceUrls !== undefined)
                    params.sourceUrls = a.sourceUrls;
                if (Array.isArray(a.shotRefs) && a.shotRefs.length > 0)
                    params.shotNodeIds = await resolveShotRefs(registry, projectId, a.shotRefs);
                if (a.replaces !== undefined)
                    params.replaces = a.replaces;
                // CV-119：多参考图合成的 IR 预检。模式映射：1 图=I2VA、2 图=FL2VA（首尾帧）、≥3 图=Ref2VA。
                // 带参考音频 → 官方参考模式（r2v）：按 Ref2VA 预检并把 audios 计入
                // `<Audio N>` 的标签上界（否则合法的 <Audio 1> 会被判成越界）。
                const audioCount = Array.isArray(a.audioRefs) ? a.audioRefs.length : 0;
                assertH3IrPrompt(a.prompt, audioCount > 0
                    ? { mode: 'Ref2VA', duration: clampDuration(a.duration, 10), pictures: filenames.length, audios: audioCount }
                    : filenames.length >= 3
                        ? { mode: 'Ref2VA', duration: clampDuration(a.duration, 10), pictures: filenames.length }
                        : filenames.length === 2
                            ? { mode: 'FL2VA', duration: clampDuration(a.duration, 10), pictures: 2 }
                            : { mode: 'I2VA', duration: clampDuration(a.duration, 10), pictures: filenames.length });
                return runGeneration(registry, 'video_composite', params, exec.signal, exec.agent?.session.header.cwd);
            },
        }),
        defineTool({
            name: 'prompt_enhance',
            description: '增强提示词，使生成的图像/视频质量更高。输入原始提示词，返回更丰富、更详细的描述。',
            parameters: {
                prompt: { type: 'string', required: true, description: '原始提示词' },
            },
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        text: { type: 'string', description: '增强后的提示词' },
                    },
                },
                render: renderTextResult,
            },
            async execute(args, exec) {
                const a = args;
                const text = await enhancePrompt(a.prompt, exec.signal);
                return { text };
            },
        }),
        defineTool({
            name: 'image2vl',
            description: '分析一张图片的内容，返回详细的画面描述。必须提供 filename（upload_image 返回的 Drama Backend 文件名，或 @ref[显示名] 引用标记——含对话附件素材）。可用于分析已生成的图片与用户上传的参考素材，为后续视频生成提供参考。注意：你是文本模型，无法直接查看图片——不要尝试读取本地图片文件路径（file_path）、不要直接把图片 URL 当参数传入（会报 model does not declare image input）。',
            parameters: {
                filename: { type: 'string', required: true, description: '已上传的 Drama Backend 文件名（来自 upload_image 工具）' },
                prompt: { type: 'string', required: true, description: '分析提示词，描述需要分析的内容' },
                systemPrompt: { type: 'string', description: '系统提示词，设定分析角色和风格' },
            },
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        text: { type: 'string', description: '画面分析结果' },
                    },
                },
                render: renderTextResult,
            },
            async execute(args, exec) {
                const a = args;
                // 2026-09-05：filename 支持 @ref[标题] token（对话附件素材的 VLM 分析路径）。
                const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd);
                const filename = await resolveRefValue(registry, projectId, a.filename);
                const text = await analyzeImage(filename, a.prompt, a.systemPrompt ?? '你是一个专业的影视镜头分析师。请从电影摄影的角度分析这张画面。', exec.signal);
                return { text };
            },
        }),
        defineTool({
            name: 'style_transfer',
            description: '【暂不可用】将一张图片的风格迁移到另一张图片上。当前功能保留但未开放，调用会返回「暂不可用」错误，请勿调用；风格统一请改用 image_generate 传参考图（图生图）或 character_generate。',
            parameters: {
                filename: { type: 'string', required: true, description: '目标图：已上传的 Drama Backend 文件名（需要改变风格的图片）' },
                styleFilename: { type: 'string', required: true, description: '风格参考图：已上传的 Drama Backend 文件名（提供风格参考的图片）' },
                prompt: { type: 'string', description: '增强提示词，描述期望的风格效果' },
                enhance: { type: 'boolean', description: '是否增强风格迁移效果' },
                aspectRatio: { type: 'string', enum: ['16:9', '9:16', '1:1'], description: '宽高比，默认 16:9' },
            },
            output: { schema: resultSchema, render: renderResult },
            async execute(args, exec) {
                guardDisabledTool('style_transfer');
                const a = args;
                const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd);
                const params = {
                    prompt: a.prompt ?? '',
                    filename: await resolveRefValue(registry, projectId, a.filename),
                    styleFilename: await resolveRefValue(registry, projectId, a.styleFilename),
                };
                if (a.enhance !== undefined)
                    params.enhance = a.enhance;
                if (a.aspectRatio !== undefined)
                    params.aspectRatio = a.aspectRatio;
                return runGeneration(registry, 'style_transfer', params, exec.signal, exec.agent?.session.header.cwd);
            },
        }),
        defineTool({
            name: 'storyboard_generate',
            description: '根据文本描述生成分镜图像（格子分镜）。每行描述一个分镜场景。可传入 filename（upload_image 返回的 Drama Backend 文件名）作为参考图。返回图片的托管 URL 与尺寸。',
            parameters: {
                prompt: { type: 'string', required: true, description: '场景描述，每行描述一个分镜场景' },
                gridnum: { type: 'number', description: '分镜格子数量，默认 4' },
                filename: { type: 'string', description: '可选参考图：已上传的 Drama Backend 文件名（来自 upload_image 工具）' },
                aspectRatio: { type: 'string', enum: ['16:9', '9:16', '1:1'], description: '宽高比，默认 16:9' },
            },
            output: { schema: resultSchema, render: renderResult },
            async execute(args, exec) {
                const a = args;
                const params = { prompt: a.prompt };
                if (a.gridnum !== undefined)
                    params.gridnum = a.gridnum;
                if (a.filename !== undefined)
                    params.filename = a.filename;
                if (a.aspectRatio !== undefined)
                    params.aspectRatio = a.aspectRatio;
                return runGeneration(registry, 'storyboard_generate', params, exec.signal, exec.agent?.session.header.cwd);
            },
        }),
        defineTool({
            name: 'storyboard_split',
            description: '将一张格子分镜图拆分为若干单镜（每个镜头一张独立图）。传入 storyboard_generate 返回的 filename（Drama Backend 文件名）作为分镜网格图，按 gridnum 推导行列（4→2×2、6→2×3、9→3×3）调用 image2splitegrid。拆分后的每张单镜会作为独立 image 节点落到画布，并画出指向原分镜网格节点的血缘箭头。返回首张单镜的 URL 与单镜总数。',
            parameters: {
                filename: { type: 'string', required: true, description: '分镜网格图：storyboard_generate 返回的 Drama Backend 文件名（filename 字段）' },
                gridnum: { type: 'number', description: '格子数量（决定行列拆分），默认 4，仅支持 4 / 6 / 9' },
                sourceUrls: { type: 'array', description: '分镜网格图对应的画布产物 URL（storyboard_generate 结果里的 url），用于画血缘箭头指向该网格节点' },
            },
            output: { schema: resultSchema, render: renderResult },
            async execute(args, exec) {
                const a = args;
                const params = { prompt: '', filename: a.filename };
                if (a.gridnum !== undefined)
                    params.gridnum = a.gridnum;
                if (a.sourceUrls !== undefined)
                    params.sourceUrls = a.sourceUrls;
                return runGeneration(registry, 'storyboard_split', params, exec.signal, exec.agent?.session.header.cwd);
            },
        }),
        defineTool({
            name: 'submit_storyboard_for_approval',
            description: '把分镜表提交给用户确认。「逐步确认」模式下必须在调用 storyboard_generate / video_generate / video_composite 之前使用：提交后本回合结束，等待用户在画布上方点击「批准」。返回文本会说明下一步；收到批准放行的回复后再开始正式生成。',
            parameters: {
                storyboard: { type: 'string', required: true, description: '完整分镜表 markdown 文本（镜号/景别/镜头运动/时长/画面描述/声音）' },
                summary: { type: 'string', description: '一句话概述（如「8 镜 · 竖屏 · 治愈系」），展示在审批提示里' },
            },
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        text: { type: 'string', description: '提交结果与下一步指引' },
                    },
                },
                render: renderTextResult,
            },
            async execute(args, exec) {
                const a = args;
                const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd);
                const workflow = normalizeWorkflow((await registry.getProject(projectId))?.workflow);
                // 分镜表落为画布节点（CV-026/027）：能解析出逐镜表格时按镜拆分为独立
                // 节点（每镜一张卡，血缘指向创意，按行排列便于逐镜对照生成）；解析不
                // 出表格时回退整表单节点。两种模式都落卡（放手跑也需要卡片供 shotRefs
                // 连边），工具结果列出卡片标题 + id 供模型逐镜引用。
                const existing = (await registry.readCanvas(projectId)).nodes;
                const brief = existing.find((node) => node.toolName === BRIEF_NODE_TOOL);
                const sourceIds = brief !== undefined ? [brief.id] : [];
                const shots = parseStoryboardShots(a.storyboard);
                if (workflow.mode === 'auto') {
                    if (workflow.state !== 'executing')
                        await registry.updateWorkflow(projectId, { state: 'executing' });
                    if (shots.length === 0) {
                        return { text: '放手跑模式：分镜表未按逐镜表格返回，未落画布卡片。直接开始执行生成流程；逐镜出图/出视频时用 shotRefs 关联分镜卡（本次无卡可关联）。' };
                    }
                    const cards = buildShotCards(existing, sourceIds, shots);
                    await registry.writeCanvas(projectId, [...existing, ...cards]);
                    return { text: `放手跑模式：分镜表已按 ${shots.length} 镜拆卡落画布：${describeShotCards(cards)}。逐镜出图/出视频时把 shotRefs 设为对应分镜卡标题，画布会把产物连到该分镜卡并排在其右侧。直接开始执行生成流程。` };
                }
                await registry.updateWorkflow(projectId, { state: 'awaiting_approval' });
                if (shots.length === 0) {
                    const placement = deriveNodePlacement(existing, sourceIds, 360, 280);
                    const node = {
                        id: newAssetId(),
                        kind: 'text',
                        title: a.summary ?? '分镜表（待确认）',
                        text: a.storyboard,
                        x: placement.x,
                        y: placement.y,
                        width: 360,
                        height: 280,
                        createdAt: Date.now(),
                        toolName: 'submit_storyboard_for_approval',
                        origin: 'agent',
                        sourceIds,
                        operationType: 'storyboard',
                    };
                    await registry.appendCanvasNode(projectId, node);
                    return { text: '分镜表已落到画布（未识别出逐镜表格，已按整表单节点落盘），本回合到此结束。请等待用户在画布上方点击「批准」并在对话中发送「继续」；未获批准前不要调用任何分镜/视频生成工具。' };
                }
                const cards = buildShotCards(existing, sourceIds, shots);
                await registry.writeCanvas(projectId, [...existing, ...cards]);
                return { text: `分镜表已按 ${shots.length} 个镜头拆分落到画布：${describeShotCards(cards)}。逐镜出图/出视频时把 shotRefs 设为对应分镜卡标题，画布会把产物连到该分镜卡并排在其右侧。本回合到此结束，请等待用户在画布上方点击「批准」并在对话中发送「继续」；未获批准前不要调用任何分镜/视频生成工具。` };
            },
        }),
        defineTool({
            name: 'submit_keyframes_for_approval',
            description: '把全部关键帧生成结果提交给用户确认。「逐步确认」模式下在逐镜出图（image_generate 生成关键帧）完成后必须调用：提交后本回合结束，等待用户在画布上方点击「确认关键帧」；用户可能直接在画布上对关键帧二次编辑（右键重试/修改提示词），此时需等用户再次点击确认后才继续。放手跑模式（auto）直接放行，本工具是空操作。',
            parameters: {
                summary: { type: 'string', description: '一句话概述关键帧完成情况（如「8 镜关键帧已出齐」），展示在确认提示里' },
            },
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        text: { type: 'string', description: '提交结果与下一步指引' },
                    },
                },
                render: renderTextResult,
            },
            async execute(args, exec) {
                const a = args;
                const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd);
                const workflow = normalizeWorkflow((await registry.getProject(projectId))?.workflow);
                if (workflow.mode === 'auto') {
                    if (workflow.state !== 'executing')
                        await registry.updateWorkflow(projectId, { state: 'executing' });
                    return { text: '放手跑模式：关键帧确认已放行，继续执行后续流程（文案 / 逐镜视频 / 成片合成）。' };
                }
                await registry.updateWorkflow(projectId, { state: 'keyframe_review' });
                const summary = a.summary !== undefined && a.summary.trim().length > 0 ? `（${a.summary.trim()}）` : '';
                return { text: `关键帧已全部生成并落到画布${summary}，本回合到此结束。请等待用户在画布上方点击「确认关键帧」；用户可能先对关键帧做二次编辑（右键重试/修改提示词），编辑完成后仍需再次点击确认。未确认前不要调用 video_generate / video_composite / compose_video。` };
            },
        }),
        defineTool({
            name: 'ask_user_choice',
            description: '向用户提出一道点选题：选项卡片会内联显示在对话区（本工具调用卡片下方），用户点击后选择自动作为本工具结果返回（无需用户打字）。需求澄清阶段必须用本工具逐项提问（一次一个问题），不要用文本列表提问。列举类问题（如「需要调整哪些视觉细节？」）传 multiSelect=true 让用户勾选多项，答案以「、」拼接返回。问题会阻塞到用户作答或超时；超时返回提示时，采用带「推荐」标记的选项继续。',
            parameters: {
                question: { type: 'string', required: true, description: '问题文本（简短一句话）' },
                options: {
                    type: 'array',
                    required: true,
                    description: '候选项数组（2–6 个短标签）；推荐的选项末尾加「（推荐）」',
                },
                allowFreeText: { type: 'boolean', description: '自由输入框开关，缺省开启（卡片自带「或输入自定义答案」输入框）；仅想隐藏输入框的纯封闭单选题才显式传 false' },
                multiSelect: { type: 'boolean', description: 'true 时为多选题：选项可勾选多项，确认后答案以「、」拼接为单个字符串返回（适合「需要调整哪些…」类列举问题）' },
            },
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        text: { type: 'string', description: '用户的选择 / 超时或取消说明' },
                    },
                },
                render: renderTextResult,
            },
            async execute(args, exec) {
                const a = args;
                const options = Array.isArray(a.options) ? a.options.map(String).filter((option) => option.length > 0) : [];
                if (a.question.trim().length === 0)
                    throw new Error('question 不能为空');
                if (options.length < 2)
                    throw new Error('options 至少需要两个候选项');
                const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd);
                const pending = {
                    id: randomUUID(),
                    question: a.question.trim(),
                    options,
                    ...(a.allowFreeText === false ? { allowFreeText: false } : {}),
                    ...(a.multiSelect === true ? { multiSelect: true } : {}),
                };
                await registry.setPendingQuestion(projectId, pending);
                try {
                    const deadline = Date.now() + QUESTION_WAIT_MS;
                    while (Date.now() < deadline) {
                        if (exec.signal.aborted)
                            throw exec.signal.reason ?? new DOMException('aborted', 'AbortError');
                        const current = normalizeWorkflow((await registry.getProject(projectId))?.workflow).pendingQuestion;
                        if (current === null || current === undefined) {
                            return { text: '问题已被清除（用户跳过）。请采用推荐项继续，并在回复中说明该要素采用了默认假设。' };
                        }
                        if (current.id === pending.id && typeof current.answer === 'string') {
                            await registry.setPendingQuestion(projectId, null);
                            return { text: `用户的选择：${current.answer}` };
                        }
                        await sleep(1500);
                    }
                    return { text: `用户暂未回答（超过等待上限）。请采用推荐项继续：「${options.find((option) => option.includes('推荐')) ?? options[0]}」，并在回复中说明这是默认假设。` };
                }
                catch (cause) {
                    // 打断 / 出错都要把挂起的问题清掉，避免卡片残留。
                    await registry.setPendingQuestion(projectId, null).catch(() => { });
                    throw cause;
                }
            },
        }),
        defineTool({
            name: 'write_screenplay',
            description: '把完整剧本落为画布节点（标题「剧本」，kind=text）。在需求澄清完成、视觉风格确定并加载对应风格 skill 之后调用；剧本须与风格形态匹配（叙事类含主角动机/节拍链/情感锚点，广告类含叙事主轴与卖点落点），各节拍时长之和 ≈ 目标总时长。重复调用会原地更新已有「剧本」节点（不产生重复节点）。落盘后必须调 submit_screenplay_for_approval 提交审批。上游风格 skill 里的「故事大纲 / story-outline / 叙事主轴」步骤即本节点，禁止另建大纲节点。',
            parameters: {
                screenplay: { type: 'string', required: true, description: '完整剧本（markdown，含结构节拍与各节时长占比；对白/旁白用明确标注）' },
                summary: { type: 'string', description: '一句话概述（如「咖啡馆相遇 · 三幕 · 30s · 受众：都市青年」），展示在审批提示与剧本摘要' },
            },
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        text: { type: 'string', description: '落盘结果说明（含节点 id 与下一步指引）' },
                    },
                },
                render: renderTextResult,
            },
            async execute(args, exec) {
                const a = args;
                const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd);
                const existing = (await registry.readCanvas(projectId)).nodes;
                // CV-100：剧本挂接创意血缘（创意 → 剧本），并排在创意右侧；重写时原地
                // 更新已有「剧本」节点，避免多次打回后画布堆积多个剧本节点。
                const brief = existing.find((node) => node.toolName === BRIEF_NODE_TOOL);
                const sourceIds = brief !== undefined ? [brief.id] : [];
                const previous = existing.find((node) => node.toolName === 'write_screenplay');
                if (previous !== undefined) {
                    const updated = {
                        ...previous,
                        ...(a.summary !== undefined ? { title: a.summary } : {}),
                        text: a.screenplay,
                    };
                    await registry.writeCanvas(projectId, existing.map((node) => (node.id === previous.id ? updated : node)));
                    return { text: `剧本已更新到画布原节点（id=${previous.id}）。下一步调用 submit_screenplay_for_approval 提交审批。` };
                }
                const placement = deriveNodePlacement(existing, sourceIds, 360, 280);
                const node = {
                    id: newAssetId(),
                    kind: 'text',
                    title: a.summary ?? '剧本',
                    text: a.screenplay,
                    x: placement.x,
                    y: placement.y,
                    width: 360,
                    height: 280,
                    createdAt: Date.now(),
                    toolName: 'write_screenplay',
                    origin: 'agent',
                    sourceIds,
                };
                await registry.appendCanvasNode(projectId, node);
                return { text: `剧本已落到画布（节点 id=${node.id}）。下一步调用 submit_screenplay_for_approval 提交审批（逐步确认模式下等待用户批准后才能规划分镜）。` };
            },
        }),
        defineTool({
            name: 'submit_screenplay_for_approval',
            description: '把剧本提交给用户审批。「逐步确认」模式下在 write_screenplay 之后、分镜规划之前必须调用：提交后本回合结束，等待用户在画布上方点击「批准」；批准后回到规划态再输出分镜表。放手跑模式（auto）直接放行进入分镜规划。',
            parameters: {
                summary: { type: 'string', description: '一句话概述剧本（如「深夜外卖惊疑 · 三幕 · 30s」），展示在审批提示里' },
            },
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        text: { type: 'string', description: '提交结果与下一步指引' },
                    },
                },
                render: renderTextResult,
            },
            async execute(args, exec) {
                const a = args;
                const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd);
                const workflow = normalizeWorkflow((await registry.getProject(projectId))?.workflow);
                const existing = (await registry.readCanvas(projectId)).nodes;
                if (!existing.some((node) => node.toolName === 'write_screenplay')) {
                    throw new Error('画布上还没有「剧本」节点：请先调用 write_screenplay 落盘剧本，再提交审批。');
                }
                if (workflow.mode === 'auto') {
                    // CV-100：放行态只有 executing——这里也只能用 executing（GATED_TOOLS
                    // 仅在 state=executing 时放行）。
                    if (workflow.state !== 'executing')
                        await registry.updateWorkflow(projectId, { state: 'executing' });
                    return { text: '放手跑模式：剧本审批已放行。直接进入分镜规划，按目标总时长推导镜头数（总时长 ÷ 单镜 8–10s）。' };
                }
                await registry.updateWorkflow(projectId, { state: 'script_review' });
                return { text: `剧本已提交审批${a.summary !== undefined ? `（${a.summary}）` : ''}，本回合到此结束。请等待用户在画布上方点击「批准」（批准后进入分镜规划）或给出修改意见（按意见修改剧本并重新提交）。未获批准前不要调用任何分镜/视频生成工具。` };
            },
        }),
        defineTool({
            name: 'write_script',
            description: '把成片文案落为画布节点（标题「文案」，kind=text），文案须覆盖：广告词、对白、背景音乐（BGM 说明）、音效（SFX）、字幕等。先写文案，再用其中的对白/BGM/音效去驱动各镜头的 H3 视频提示词（对白→<d>[语言]…</d>，BGM→non_diegetic_music:，音效→overall_soundscape:）；合成成片时把本节点 id 作为 scriptId 传入 compose_video，成片详情即展示该文案。返回节点 id 供后续引用。',
            parameters: {
                script: { type: 'string', required: true, description: '完整文案：广告词 / 对白 / 背景音乐 / 音效 / 字幕等（可分段标题）' },
            },
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        text: { type: 'string', description: '落盘结果说明（含节点 id）' },
                    },
                },
                render: renderTextResult,
            },
            async execute(args, exec) {
                const a = args;
                const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd);
                const existing = (await registry.readCanvas(projectId)).nodes;
                // CV-025：文案同样挂接创意血缘（创意 → 文案），并排在创意右侧。
                const brief = existing.find((node) => node.toolName === BRIEF_NODE_TOOL);
                const sourceIds = brief !== undefined ? [brief.id] : [];
                const placement = deriveNodePlacement(existing, sourceIds, 360, 280);
                const node = {
                    id: newAssetId(),
                    kind: 'text',
                    title: '文案',
                    text: a.script,
                    x: placement.x,
                    y: placement.y,
                    width: 360,
                    height: 280,
                    createdAt: Date.now(),
                    toolName: 'write_script',
                    origin: 'agent',
                    sourceIds,
                };
                await registry.appendCanvasNode(projectId, node);
                return { text: `文案已落到画布（节点 id=${node.id}），合成成片时可作为 scriptId 传入 compose_video。` };
            },
        }),
        defineTool({
            name: 'music_generation',
            description: '生成 BGM 音乐（Drama txt2audio，ACE Step Audio）：按文本描述生成一段音乐/器乐，音频节点自动落画布，可直接作 compose_video 的 bgmNodeId 混音（自动淡入淡出）。prompt 为音频整体描述 tags（情绪/风格/乐器/节奏，如「uplifting electronic pop, bright piano arpeggios」）；lyrics 有歌词时给歌词结构（Verse/Chorus），纯器乐 BGM 留空（自动填 [Instrumental]）并传 language="unknown"；duration 单位秒（BGM 建议与成片时长一致，实测精确生效，≤300 秒稳定）；keyscale 调式（如「Bb major」「A minor」）；timesignature 拍号 2/3/4/6。⚠️ prompt 写法（Caption 维度、Lyrics 结构标记、参数取值边界）见技能 music-prompt-writing——写 BGM 前先加载它，不要凭感觉写「好听的音乐」。上游 skill（如 minimalist-product-ad-generator）中出现的 `music-2.6` 即本工具。⚠️ keyscale / timesignature / bpm 是**尽力而为的软提示**：后端可能不接受某些取值（且一律报无原因的 500），此时本工具会自动忽略该参数重试，并在结果的 degradedFields 中标明——不要假定它们一定生效，更不要向用户声称「已按指定调性生成」；后端另有偶发 500，工具会自动重试，重试成功属正常现象。',
            parameters: {
                // CV-127：纯器乐无需传 lyrics，缺省自动填 [Instrumental]（官方要求，空串语义不明）。
                prompt: { type: 'string', required: true, description: '音频整体描述 tags（情绪/风格/乐器/节奏）；写法见技能 music-prompt-writing' },
                lyrics: { type: 'string', description: '歌词（[Verse]/[Chorus] 结构标记，每行 6–10 音节）；纯器乐 BGM 留空，自动填 [Instrumental]。有歌词时会原样落进音频节点并显示在画布上（卡片首行 + 双击播放器窗口看全文），所以要写完整的成品歌词，不要写占位' },
                duration: { type: 'number', description: '音频时长（秒），默认 30；BGM 建议与成片时长一致（≤300 稳定）' },
                bpm: { type: 'number', description: '每分钟节拍数，默认 128；60–180 最稳（模型只当锚点，实际 ±2）' },
                // CV-127b：软提示——后端可能不接受，被拒时自动忽略并在结果 degradedFields 标明。
                keyscale: { type: 'string', description: '调式（如「C major」「A minor」）。软提示：后端不接受时会被自动忽略，见结果 degradedFields' },
                language: { type: 'string', description: '语言代码（zh/en/ja…；unknown=纯器乐无人声）' },
                timesignature: { type: 'string', description: '拍号：4（=4/4）/ 3 / 6；软提示，不接受时自动忽略' },
                sourceUrls: { type: 'array', description: '可选：关联的画布产物 URL 数组（画血缘箭头）' },
            },
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        url: { type: 'string', description: '音频画布托管 URL' },
                        filename: { type: 'string', description: 'Drama 侧 mp3 文件名' },
                        nodeId: { type: 'string', description: '画布音频节点 id（作 compose_video 的 bgmNodeId）' },
                        duration: { type: 'number', description: '音频时长（秒，请求值；真实音频时长≈该值）' },
                        bpm: { type: 'number', description: '实际使用的 BPM（分镜按拍拆镜的参考值）' },
                        lyrics: { type: 'string', description: 'CV-130：实际提交的歌词（已随画布节点落盘；纯器乐为 [Instrumental]）。不要向用户复述一份与它不同的歌词' },
                        degradedFields: { type: 'array', description: 'CV-127b：被后端拒绝、本次已忽略的参数名（如 keyscale）。非空时必须告知用户该参数未生效，不要声称已按它生成' },
                        attempts: { type: 'number', description: '实际尝试次数（>1 = 首次失败后重试成功）' },
                    },
                },
                render: renderMusicResult,
            },
            async execute(args, exec) {
                const a = args;
                const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd);
                return generateMusic(registry, projectId, {
                    captionPrompt: a.prompt,
                    ...(a.lyrics !== undefined ? { lyricsPrompt: a.lyrics } : {}),
                    ...(a.duration !== undefined ? { duration: a.duration } : {}),
                    ...(a.bpm !== undefined ? { bpm: a.bpm } : {}),
                    ...(a.keyscale !== undefined ? { keyscale: a.keyscale } : {}),
                    ...(a.language !== undefined ? { language: a.language } : {}),
                    ...(a.timesignature !== undefined ? { timesignature: a.timesignature } : {}),
                    ...(Array.isArray(a.sourceUrls) && a.sourceUrls.length > 0 ? { sourceUrls: a.sourceUrls } : {}),
                }, exec.signal);
            },
        }),
        defineTool({
            name: 'compose_video',
            description: '把画布上已有的视频片段拼接成最终成片（Host 侧 ffmpeg concat，可选混 BGM）。这是「成片合成」步骤——严禁再用 video_generate / video_composite 从图片关键帧重新生成视频。clipIds 缺省取时间轴上全部视频片段（按生成顺序）；**只给 1 个片段也合法**（= 一镜整出，此时保留该镜原生环境声）；bgmNodeId 指定 BGM 视频/音频节点；scriptId 指定 write_script 写的「文案」节点，成片详情里展示广告词/对白/字幕。成片会作为 video-composite 节点落到画布（血缘指向各源片段）。返回成片 url / 真实时长 / 分辨率 / 音轨构成。⚠️ 音轨策略：**单镜保留原生环境声，多镜拼接一律丢弃**；BGM 时长必须 ≥ 成片真实时长，否则直接报错（不会产出被截断的残次成片）。',
            parameters: {
                clipIds: { type: 'array', description: '可选：参与拼接的视频片段节点 id；缺省取时间轴全部视频。1 个 = 一镜整出（保留环境声），≥2 个 = 多镜拼接（环境声全丢）' },
                bgmNodeId: { type: 'string', description: '可选：BGM 节点 id（视频/音频文件）。必须不短于成片真实时长，否则合成报错' },
                scriptId: { type: 'string', description: '可选：文案节点 id（write_script 产物），成片详情展示广告词/对白/字幕' },
                colorGrade: { type: 'boolean', description: '可选：统一调色开关（默认开）。各镜统一叠加中性调色 preset 治色调漂移；片段已色调一致时传 false 关闭' },
            },
            output: { schema: resultSchema, render: renderComposeResult },
            async execute(args, exec) {
                const a = args;
                const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd);
                const doc = await registry.readCanvas(projectId);
                // CR-001：缺省选片只取「逐镜视频片段」，排除成片节点（toolName='compose'）。
                const clipIds = Array.isArray(a.clipIds) && a.clipIds.length > 0
                    ? a.clipIds
                    : defaultComposeClips(doc.nodes);
                // CV-141：单片段也放行——「一镜整出」是合法形态（保留原生环境声），
                // 此前硬卡 ≥2 把这条路封死了。
                if (clipIds.length < 1) {
                    throw new Error('没有可合成的视频片段；请先用 video_generate / video_composite 生成逐镜视频片段（不要再回头用图片重新生成）。');
                }
                const script = a.scriptId !== undefined
                    ? doc.nodes.find(node => node.id === a.scriptId)?.text
                    : undefined;
                const result = await composeStudioVideo(registry, projectId, clipIds, a.bgmNodeId, { ...(a.colorGrade === false ? { colorGrade: false } : {}) }, exec.signal);
                const composedNode = await appendComposedVideoNode(registry, projectId, {
                    url: result.url,
                    duration: result.duration,
                    audioComposition: result.audioComposition,
                    ...(result.width !== undefined ? { width: result.width } : {}),
                    ...(result.height !== undefined ? { height: result.height } : {}),
                    sourceIds: clipIds,
                    ...(script !== undefined ? { script } : {}),
                });
                const totalShots = doc.nodes.filter((node) => node.kind === 'video' && node.toolName !== 'compose').length;
                return {
                    url: result.url,
                    width: result.width ?? COMPOSED_FALLBACK.width,
                    height: result.height ?? COMPOSED_FALLBACK.height,
                    duration: result.duration,
                    nodeId: composedNode.id,
                    clipCount: clipIds.length,
                    skippedCount: Math.max(0, totalShots - clipIds.length),
                    audioComposition: result.audioComposition,
                    ...(result.warnings !== undefined ? { warnings: result.warnings } : {}),
                };
            },
        }),
    ];
}
