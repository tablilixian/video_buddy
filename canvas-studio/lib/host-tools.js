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
import { parseRefTokens } from './reference-token.js';
import { newAssetId } from './config.js';
import { generateAsset, uploadImage, enhancePrompt, analyzeImage, splitStoryboard, setRuntimeConfig } from './generate.js';
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
    },
};
/** 把产物结果渲染成模型可读的文本块。 */
function renderResult(_args, value) {
    const result = value;
    const duration = result.duration !== undefined ? `, ${result.duration}s` : '';
    const name = result.filename !== undefined ? `, Drama 文件名: ${result.filename}` : '';
    return [{ type: 'text', text: `已生成产物: ${result.url} (${result.width}x${result.height}${duration}${name})` }];
}
/** 把上传结果渲染成模型可读的文本块。 */
function renderUploadResult(_args, value) {
    const v = value;
    return [{ type: 'text', text: `已上传到 Drama Backend: ${v.filename}` }];
}
/** 把文本结果渲染成模型可读的文本块。 */
function renderTextResult(_args, value) {
    const v = value;
    return [{ type: 'text', text: v.text }];
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
 * 找不到参考节点、或该参考尚未 upload_image（缺 filename）时给出可操作报错。
 */
async function resolveRefFilenames(registry, projectId, tokens) {
    if (tokens.length === 0)
        return [];
    const nodes = (await registry.readCanvas(projectId)).nodes.filter((node) => node.isReference === true);
    const byTitle = new Map(nodes.map((node) => [node.title ?? '', node]));
    const out = [];
    for (const token of tokens) {
        const node = byTitle.get(token);
        if (node === undefined) {
            throw new Error(`参考图 @ref[${token}] 在当前项目参考托盘中未找到。请先确认该素材已上传并在节点详情面板点「标记为参考」（或用 list_references 查看可用参考）。`);
        }
        if (node.filename === undefined || node.filename === null || node.filename.length === 0) {
            throw new Error(`参考图 @ref[${token}] 尚未上传到 Drama Backend（缺少 filename）。请先调 upload_image(url="${node.url ?? ''}") 取得文件名，或直接在参数里粘贴该文件名。`);
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
            throw new Error(workflow.state === 'awaiting_approval'
                ? '分镜表正在等待用户批准（画布上方审批条）。请停止生成，等待用户点击「批准」并在对话中发送「继续」后再执行；不要自行重试。'
                : '当前项目为「逐步确认」模式：请先与用户确认需求（时长/画幅/风格/节奏/受众），再用 submit_storyboard_for_approval 提交分镜表；用户批准前不能调用分镜/视频生成工具（概念图 image_generate 允许）。');
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
export function createStudioTools(registry, port, cfg) {
    // 运行时配置写入 generate.ts 模块级 current，供 Drama 调用读取。
    setRuntimeConfig(cfg);
    return [
        defineTool({
            name: 'image_generate',
            description: '根据提示词生成一张图片。可传 filename（单参考图生图）或 filenames（最多 3 张参考图，多参考融合图生图），两者都来自 upload_image 拿到的 Drama Backend 文件名；都不传则为纯文生图。返回图片的托管 URL 与尺寸。参考图也可来自画布参考托盘：对话里用 @ref[参考图显示名] 直接引用（取其 Drama filename），或先调 list_references 列出当前项目可用参考及其 filename/role。若 filename/filenames 直接传 @ref[显示名]，Host 会自动解析为对应 Drama 文件名，无需手动 upload_image。',
            parameters: {
                prompt: { type: 'string', required: true, description: '生成提示词' },
                aspectRatio: { type: 'string', enum: ['16:9', '9:16', '1:1'], description: '宽高比，默认 16:9' },
                filename: { type: 'string', description: '可选单参考图：已上传的 Drama Backend 文件名（来自 upload_image 工具，用于图生图）' },
                filenames: { type: 'array', description: '可选多参考图（最多 3 张，来自 upload_image 工具）；与 filename 二选一，多参考融合图生图' },
                negativePrompt: { type: 'string', description: '反向提示词' },
                sourceUrls: { type: 'array', description: '本图参考的画布产物 URL 数组（此前工具结果里的 url），用于在画布上画出流程箭头；没有参考图可省略' },
            },
            output: { schema: resultSchema, render: renderResult },
            async execute(args, exec) {
                const a = args;
                const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd);
                const params = { prompt: a.prompt };
                if (a.aspectRatio !== undefined)
                    params.aspectRatio = a.aspectRatio;
                if (a.filename !== undefined)
                    params.filename = await resolveRefValue(registry, projectId, a.filename);
                if (Array.isArray(a.filenames) && a.filenames.length > 0)
                    params.filenames = await resolveRefValues(registry, projectId, a.filenames);
                if (a.negativePrompt !== undefined)
                    params.negativePrompt = a.negativePrompt;
                if (a.sourceUrls !== undefined)
                    params.sourceUrls = a.sourceUrls;
                return runGeneration(registry, 'image_generate', params, exec.signal, exec.agent?.session.header.cwd);
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
                return { filename };
            },
        }),
        defineTool({
            name: 'list_references',
            description: '列出当前项目可复用的参考图（画布上标记为参考的素材节点）。每项含 title（显示名）、url（同源托管地址）、filename（Drama Backend 文件名，为空时需先调 upload_image(url) 取文件名）、role（image/character/style/frame）、strength（0–1 参考强度）。同时返回画布上的文本类节点 notes（参考视频上传后的风格归纳便签、write_script 文案、已提交的分镜表），供读取既有创作上下文。当用户要「用参考图/角色图/风格图生成」却没给具体文件名时，调本工具拿可用参考，再按 role 选对应工具：character→image_generate(filename)、style→style_transfer(styleFilename)、frame→video_generate(filename 首帧)、image→通用参考；项目里上传过参考视频时，先用 notes 读风格归纳便签，再定风格策略。',
            parameters: {},
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        references: { type: 'array', description: '当前项目可用的参考图列表' },
                        notes: { type: 'array', description: '画布文本类节点列表（风格归纳便签/文案/分镜表）' },
                    },
                },
                render: renderReferenceList,
            },
            async execute(_args, exec) {
                const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd);
                const nodes = (await registry.readCanvas(projectId)).nodes;
                const refs = nodes
                    .filter((node) => node.isReference === true && node.kind === 'image')
                    .map((node) => ({
                    title: node.title ?? node.url ?? '',
                    url: node.url ?? '',
                    filename: node.filename ?? null,
                    role: node.referenceRole ?? 'image',
                    strength: node.referenceStrength ?? 1,
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
                return { references: refs, notes };
            },
        }),
        defineTool({
            name: 'video_generate',
            description: '根据提示词生成视频，统一走 FL2VA 接口，支持两种模式：不传 filename 时为纯文生视频；传入 filename（upload_image 返回的 Drama Backend 文件名）时为「首帧」图生视频。返回视频的托管 URL、尺寸与时长。首帧参考图也可来自画布参考托盘：对话里用 @ref[显示名] 引用，或先调 list_references 列出（role=frame 的参考即首帧图）。若 filename 直接传 @ref[显示名]，Host 会自动解析为对应 Drama 文件名。',
            parameters: {
                prompt: { type: 'string', required: true, description: '生成提示词' },
                filename: { type: 'string', description: '可选：已上传的 Drama Backend 文件名（来自 upload_image 工具），用作视频首帧；不传则为纯文生视频' },
                aspectRatio: { type: 'string', enum: ['16:9', '9:16', '1:1'], description: '宽高比，默认 16:9' },
                duration: { type: 'number', description: '视频时长（秒），默认 5；上限 15，建议 8–10（更长请拆多段）' },
                sourceUrls: { type: 'array', description: '首帧图对应的画布产物 URL（此前工具结果里的 url），用于画布流程箭头' },
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
                if (a.sourceUrls !== undefined)
                    params.sourceUrls = a.sourceUrls;
                return runGeneration(registry, 'video_generate', params, exec.signal, exec.agent?.session.header.cwd);
            },
        }),
        defineTool({
            name: 'video_composite',
            description: '将多张参考图合成一段视频。两张图走首尾帧插值（FL2VA，image1 首帧 + image2 尾帧）；三张及以上走多参考图合成（REF2VA，最多 6 张，后端自动排布保持角色/场景一致性）。必须提供 filenames（upload_image 返回的 Drama Backend 文件名数组）。返回合成视频的托管 URL、尺寸与时长。参考图也可来自画布参考托盘：先调 list_references 列出（role=character/image 的参考即可用），再取其 filename 填入 filenames。filenames 也可直接传 @ref[显示名]，Host 会自动解析为对应 Drama 文件名。',
            parameters: {
                prompt: { type: 'string', required: true, description: '生成提示词' },
                filenames: { type: 'array', required: true, description: '已上传的 Drama Backend 文件名数组（来自 upload_image 工具，最多 6 张，超出自动采样）' },
                aspectRatio: { type: 'string', enum: ['16:9', '9:16', '1:1'], description: '宽高比，默认 16:9' },
                duration: { type: 'number', description: '视频时长（秒），默认 10；上限 15。两张图走首尾帧插值（fl2va），三张及以上走多参考图合成（ref2va）' },
                sourceUrls: { type: 'array', description: '输入图对应的画布产物 URL 数组（按 filenames 同序），用于画布流程箭头' },
            },
            output: { schema: resultSchema, render: renderResult },
            async execute(args, exec) {
                const a = args;
                const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd);
                const params = { prompt: a.prompt, filenames: await resolveRefValues(registry, projectId, a.filenames) };
                if (a.aspectRatio !== undefined)
                    params.aspectRatio = a.aspectRatio;
                if (a.duration !== undefined)
                    params.duration = a.duration;
                if (a.sourceUrls !== undefined)
                    params.sourceUrls = a.sourceUrls;
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
            description: '分析一张图片的内容，返回详细的画面描述。必须提供 filename（upload_image 返回的 Drama Backend 文件名）。可用于分析已生成的图片，为后续视频生成提供参考。',
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
                const text = await analyzeImage(a.filename, a.prompt, a.systemPrompt ?? '你是一个专业的影视镜头分析师。请从电影摄影的角度分析这张画面。', exec.signal);
                return { text };
            },
        }),
        defineTool({
            name: 'style_transfer',
            description: '将一张图片的风格迁移到另一张图片上。必须提供 filename（目标图）和 styleFilename（风格参考图），两者均为 upload_image 返回的 Drama Backend 文件名。返回图片的托管 URL 与尺寸。风格参考图也可来自画布参考托盘：对话里用 @ref[显示名] 引用，或先调 list_references 列出（role=style 的参考即风格图）。filename/styleFilename 也可直接传 @ref[显示名]，Host 会自动解析为对应 Drama 文件名。',
            parameters: {
                filename: { type: 'string', required: true, description: '目标图：已上传的 Drama Backend 文件名（需要改变风格的图片）' },
                styleFilename: { type: 'string', required: true, description: '风格参考图：已上传的 Drama Backend 文件名（提供风格参考的图片）' },
                prompt: { type: 'string', description: '增强提示词，描述期望的风格效果' },
                enhance: { type: 'boolean', description: '是否增强风格迁移效果' },
                aspectRatio: { type: 'string', enum: ['16:9', '9:16', '1:1'], description: '宽高比，默认 16:9' },
            },
            output: { schema: resultSchema, render: renderResult },
            async execute(args, exec) {
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
                if (workflow.mode === 'auto') {
                    if (workflow.state !== 'executing')
                        await registry.updateWorkflow(projectId, { state: 'executing' });
                    return { text: '放手跑模式：分镜表已记录到画布，无需等待批准，直接开始执行生成流程。' };
                }
                await registry.updateWorkflow(projectId, { state: 'awaiting_approval' });
                // 分镜表落为画布文本节点：审批条之外，用户还能在画布上直接看到并修改内容。
                const existing = (await registry.readCanvas(projectId)).nodes;
                const index = existing.length;
                const node = {
                    id: newAssetId(),
                    kind: 'text',
                    title: a.summary ?? '分镜表（待确认）',
                    text: a.storyboard,
                    x: 40 + (index % 4) * 300,
                    y: 40 + Math.floor(index / 4) * 240,
                    width: 360,
                    height: 280,
                    createdAt: Date.now(),
                    toolName: 'submit_storyboard_for_approval',
                    origin: 'agent',
                    sourceIds: [],
                    operationType: 'storyboard',
                };
                await registry.appendCanvasNode(projectId, node);
                return { text: '分镜表已提交并落到画布，本回合到此结束。请等待用户在画布上方点击「批准」并在对话中发送「继续」；未获批准前不要调用任何分镜/视频生成工具。' };
            },
        }),
        defineTool({
            name: 'ask_user_choice',
            description: '向用户提出一道点选题：选项卡片会内联显示在对话区（本工具调用卡片下方），用户点击后选择自动作为本工具结果返回（无需用户打字）。需求澄清阶段必须用本工具逐项提问（一次一个问题），不要用文本列表提问。问题会阻塞到用户作答或超时；超时返回提示时，采用带「推荐」标记的选项继续。',
            parameters: {
                question: { type: 'string', required: true, description: '问题文本（简短一句话）' },
                options: {
                    type: 'array',
                    required: true,
                    description: '候选项数组（2–6 个短标签）；推荐的选项末尾加「（推荐）」',
                },
                allowFreeText: { type: 'boolean', description: 'true 时卡片额外提供自由输入框（适合品牌名等开放要素）' },
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
                    ...(a.allowFreeText === true ? { allowFreeText: true } : {}),
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
                const index = existing.length;
                const node = {
                    id: newAssetId(),
                    kind: 'text',
                    title: '文案',
                    text: a.script,
                    x: 40 + (index % 4) * 300,
                    y: 40 + Math.floor(index / 4) * 240,
                    width: 360,
                    height: 280,
                    createdAt: Date.now(),
                    toolName: 'write_script',
                    origin: 'agent',
                    sourceIds: [],
                };
                await registry.appendCanvasNode(projectId, node);
                return { text: `文案已落到画布（节点 id=${node.id}），合成成片时可作为 scriptId 传入 compose_video。` };
            },
        }),
        defineTool({
            name: 'compose_video',
            description: '把画布上已有的视频片段拼接成最终成片（Host 侧 ffmpeg concat，可选混 BGM）。这是「成片合成」步骤——严禁再用 video_generate / video_composite 从图片关键帧重新生成视频。clipIds 缺省取时间轴上全部视频片段（按生成顺序）；bgmNodeId 指定 BGM 视频/音频节点；scriptId 指定 write_script 写的「文案」节点，成片详情里展示广告词/对白/字幕。成片会作为 video-composite 节点落到画布（血缘指向各源片段）。返回成片 url / 时长 / 分辨率。',
            parameters: {
                clipIds: { type: 'array', description: '可选：参与拼接的视频片段节点 id；缺省取时间轴全部视频（≥2 段）' },
                bgmNodeId: { type: 'string', description: '可选：BGM 节点 id（视频/音频文件）' },
                scriptId: { type: 'string', description: '可选：文案节点 id（write_script 产物），成片详情展示广告词/对白/字幕' },
            },
            output: { schema: resultSchema, render: renderResult },
            async execute(args, exec) {
                const a = args;
                const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd);
                const doc = await registry.readCanvas(projectId);
                const clipIds = Array.isArray(a.clipIds) && a.clipIds.length > 0
                    ? a.clipIds
                    : doc.nodes.filter(node => node.kind === 'video').sort((left, right) => left.createdAt - right.createdAt).map(node => node.id);
                if (clipIds.length < 2) {
                    throw new Error('至少需要 2 个视频片段才能合成成片；请先用 video_generate / video_composite 生成逐镜视频片段（不要再回头用图片重新生成）。');
                }
                const script = a.scriptId !== undefined
                    ? doc.nodes.find(node => node.id === a.scriptId)?.text
                    : undefined;
                const result = await composeStudioVideo(registry, projectId, clipIds, a.bgmNodeId, {}, exec.signal);
                await appendComposedVideoNode(registry, projectId, {
                    url: result.url,
                    duration: result.duration,
                    ...(result.width !== undefined ? { width: result.width } : {}),
                    ...(result.height !== undefined ? { height: result.height } : {}),
                    sourceIds: clipIds,
                    ...(script !== undefined ? { script } : {}),
                });
                return { url: result.url, width: result.width ?? COMPOSED_FALLBACK.width, height: result.height ?? COMPOSED_FALLBACK.height, duration: result.duration };
            },
        }),
    ];
}
