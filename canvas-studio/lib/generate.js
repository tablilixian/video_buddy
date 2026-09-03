/**
 * Canvas Studio P3 媒体生成（Host 侧）。
 *
 * 调用 Drama Backend（参考 WL 适配器），下载产物并落盘到项目 `assets/`，
 * 返回 webServer 托管的 URL。浏览器侧工具经 `/canvas-studio/generate` 路由
 * 调用本模块，规避渲染进程的 CORS 限制。
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { DRAMA_ENDPOINTS, newAssetId, sizeForAspectRatio, } from './config.js';
import { DEFAULT_DRAMA_API_BASE } from './host-config.js';
import { previewSizeOf } from './canvas-aspect.js';
/** 运行时配置（由 Host 经 setRuntimeConfig 注入；Drama 调用的基址/时长/密钥均从此读取）。 */
let current = null;
export function setRuntimeConfig(cfg) { current = cfg; }
/**
 * 运行时配置访问器：未注入时（测试直连 lib、或早于插件装配的调用）回退到
 * 编译期默认值（与 host-config.ts schema 的 default 对齐）——否则 `current!`
 * 会在探针的 try 块里抛 TypeError，被统一 catch 误报成「Drama Backend 不可达」。
 * 密钥解析没有安全默认（默认值是凭据引用不是真实密钥），保持显式抛错。
 */
function runtime() {
    // 用 `!= null` 同时挡住 null（未注入）与 undefined（注入了 undefined 的
    // 健壮性兜底），两者都回退编译期默认值。
    if (current != null)
        return current;
    return {
        dramaApiBase: () => DEFAULT_DRAMA_API_BASE,
        maxVideoSeconds: () => 15,
        resolveDramaApiKey: () => Promise.resolve(''), // CR-033：未注入时按「未配置」处理，返回空串（后端无鉴权，不强制 key）
        defaultAspectRatio: () => '16:9',
        workflowMode: () => 'confirm',
        hitlStoryboard: () => true,
        hitlKeyframe: () => false,
        autoRetry: () => true,
        maxParallel: () => 2,
        assetDir: () => '',
        autoSave: () => true,
        autoSaveInterval: () => 30,
    };
}
/** 钳制视频时长：1–maxVideoSeconds() 取整；未提供时用各工具的默认值。maxVideoSeconds 来自设置。 */
export function clampDuration(value, fallback) {
    return Math.min(runtime().maxVideoSeconds(), Math.max(1, Math.round(value ?? fallback)));
}
/** 把参考图列表收敛到最多 max 张：保留首/尾，中间均匀采样，避免超出接口上限。 */
function sliceToMax(images, max) {
    if (images.length <= max)
        return images;
    const step = (images.length - 1) / (max - 1);
    const out = [];
    for (let i = 0; i < max; i++)
        out.push(images[Math.round(i * step)]);
    return out;
}
/** Drama Backend 调用超时（毫秒）：视频生成最慢，文本类最快。 */
const DRAMA_TIMEOUT_MS = { image: 360_000, video: 600_000, text: 180_000 };
// CR-010：产物/参考图下载的硬上限——外部 URL 挂起或返回超大体时不再无限阻塞
// 或整读内存。媒体（视频）上限 512MB、超时 10 分钟；图片（参考图/单镜）上限 32MB、
// 超时 2 分钟。
const MEDIA_DOWNLOAD_MAX_BYTES = 512 * 1024 * 1024;
const MEDIA_DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const IMAGE_DOWNLOAD_MAX_BYTES = 32 * 1024 * 1024;
const IMAGE_DOWNLOAD_TIMEOUT_MS = 2 * 60_000;
/**
 * CR-010：带超时与字节上限的下载。用 AbortSignal.timeout 与调用方 signal 组合，
 * 流式读取并在超限时中止（不再 `arrayBuffer()` 整读内存）。桩环境（测试）可能
 * 不提供 `response.body`，此时回退 `arrayBuffer()` 并仍做大小校验。
 */
async function downloadBytes(url, signal, opts) {
    const timeout = AbortSignal.timeout(opts.timeoutMs);
    const composed = signal !== undefined ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetch(url, { signal: composed });
    if (!response.ok)
        throw new Error(`${opts.label}失败: ${response.status}`);
    const body = response.body;
    if (body === undefined || body === null) {
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.byteLength > opts.maxBytes) {
            throw new Error(`${opts.label}超过大小上限（${opts.maxBytes} 字节）`);
        }
        return bytes;
    }
    const reader = body.getReader();
    const chunks = [];
    let total = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            total += value.byteLength;
            if (total > opts.maxBytes) {
                throw new Error(`${opts.label}超过大小上限（${opts.maxBytes} 字节）`);
            }
            chunks.push(value);
        }
    }
    finally {
        reader.releaseLock();
    }
    return Buffer.concat(chunks);
}
/**
 * CR-011：SSRF 防护——只允许 http/https，且目标地址不得指向受限网段。
 * 覆盖本产品实际可被利用的攻击面：agent 参数诱导 Host 抓取云元数据
 * （169.254.169.254）、本机服务（127.0.0.1 / localhost）、内网（10/8、172.16/12、
 * 192.168/16、链路本地）。hostname 即 IP 字面量时直接判定；主机名只额外拦
 * localhost 族（DNS 级「域名解析到私网」属理论攻击面，桌面本机 app 已有
 * loopback 同源门禁兜底，不做 DNS 解析以免引入网络依赖与延迟）。
 */
async function assertSafeDownloadUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        throw new Error(`非法下载地址: ${url}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`仅支持 http/https 下载地址，收到: ${parsed.protocol}`);
    }
    const hostname = parsed.hostname;
    const lower = hostname.toLowerCase();
    if (lower === 'localhost' || lower.endsWith('.localhost')) {
        throw new Error(`下载地址指向受限网络: ${hostname}`);
    }
    if (isIP(hostname) !== 0 && isBlockedIp(hostname)) {
        throw new Error(`下载地址指向受限网络: ${hostname}`);
    }
}
/** IPv4/IPv6 受限网段判定（环回/私网/链路本地/ULA/保留/组播/广播）。 */
function isBlockedIp(ip) {
    if (ip === '::1' || ip === '::')
        return true;
    const v4 = ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
    const parts = v4.split('.').map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
        const a = parts[0];
        if (a === 0 || a === 127 || a === 10 || a === 255)
            return true; // 保留 / 环回 / A 私网 / 广播
        if (a === 172 && parts[1] >= 16 && parts[1] <= 31)
            return true; // 172.16/12
        if (a === 192 && parts[1] === 168)
            return true; // 192.168/16
        if (a === 169 && parts[1] === 254)
            return true; // 链路本地（含 169.254.169.254 云元数据）
        if (a >= 224)
            return true; // 组播/保留
        return false;
    }
    const lower = ip.toLowerCase();
    // IPv6 ULA fc00::/7、链路本地 fe80::/10。
    return lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe8')
        || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb');
}
/**
 * P10 `/health` 前置探针：所有 Drama 请求先确认后端可达（结果缓存 30s），
 * 宕机时立刻给出中文提示，而不是让用户在长超时里干等。
 */
const HEALTH_CACHE_MS = 30_000;
const HEALTH_TIMEOUT_MS = 10_000;
let healthCache = null;
/** 清空探针缓存（测试钩子；生产代码不需要主动失效）。 */
export function resetDramaProbeCache() {
    healthCache = null;
}
/** 探测失败时的统一中文错误（可操作：指向服务状态而非参数）。 */
function dramaUnreachableError(cause) {
    const detail = cause instanceof Error ? `（${cause.message}）` : '';
    return new Error(`Drama Backend 不可达，请检查服务是否已启动后再试${detail}。`);
}
/**
 * 确认 Drama Backend 可达：GET /api/v1/health（5s 超时），成功与失败都缓存
 * 30s —— 缓存窗口内的后续请求零开销快速通过/快速失败。
 */
export async function ensureDramaReachable(signal) {
    const now = Date.now();
    // 只缓存「成功」；失败不缓存，下一次调用立即重试，避免单次瞬时抖动
    // 被误判为长期不可达（原逻辑会把失败缓存 30s，期间所有请求直接抛错）。
    if (healthCache !== null && healthCache.ok && now - healthCache.checkedAt < HEALTH_CACHE_MS) {
        return;
    }
    let ok = false;
    try {
        const timeout = AbortSignal.timeout(HEALTH_TIMEOUT_MS);
        const composed = signal !== undefined ? AbortSignal.any([signal, timeout]) : timeout;
        const response = await fetch(`${runtime().dramaApiBase()}${DRAMA_ENDPOINTS.health}`, { signal: composed });
        ok = response.ok;
    }
    catch {
        ok = false;
    }
    if (ok) {
        healthCache = { ok: true, checkedAt: Date.now() };
        return;
    }
    healthCache = null;
    throw dramaUnreachableError();
}
/** 带超时与一次性自动重试的 Drama POST（网络错误 / 502/503/504 时重试）。 */
async function dramaPost(endpoint, init, timeoutMs, signal) {
    // 探针前置：宕机时在这里就抛中文错误，不进入生成请求的长超时。
    await ensureDramaReachable(signal);
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const timeout = AbortSignal.timeout(timeoutMs);
        const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;
        try {
            const response = await fetch(`${runtime().dramaApiBase()}${endpoint}`, { ...init, signal: composed });
            if ((response.status === 502 || response.status === 503 || response.status === 504) && attempt === 0) {
                lastError = new Error(`Drama Backend 暂时不可用（HTTP ${response.status}），已自动重试一次`);
                continue;
            }
            return response;
        }
        catch (cause) {
            // 用户主动打断不重试、不改写错误。
            if (signal?.aborted)
                throw cause;
            lastError = cause;
            if (attempt === 0)
                continue;
            throw new Error(`Drama Backend 连接失败（已重试一次）：${cause instanceof Error ? cause.message : String(cause)}。请检查服务是否可达。`);
        }
    }
    throw lastError instanceof Error ? lastError : new Error('生成失败');
}
/**
 * 将相对 URL 解析为 loopback 绝对 URL（Host 端 fetch 用）。
 * 浏览器端 <img src> 能自动解析同源相对路径，但 Node 原生 fetch 不支持，
 * 而 image_generate 返回的产物 URL 是相对路径（/canvas-studio/assets/...），
 * 后续 video_generate / video_composite 作为参考图传入时必须先补全。
 */
function resolveImageUrl(url, port) {
    return url.startsWith('/') ? `http://127.0.0.1:${port}${url}` : url;
}
/**
 * 解析 canvas-studio 资产 URL（`/canvas-studio/assets/<projectId>/<file>` 或
 * `http://127.0.0.1:<port>/canvas-studio/assets/<projectId>/<file>`），
 * 返回 projectId 与 file；非资产 URL 返回 null。
 */
function parseCanvasAsset(source) {
    const m = source.match(/\/canvas-studio\/assets\/([^/]+)\/(.+?)(?:\?.*)?$/);
    return m ? { projectId: m[1], file: m[2] } : null;
}
/**
 * 把来源读成字节 + 扩展名。
 * 1) canvas-studio 资产 URL：host 进程本就有权直读磁盘资产，直接读盘——
 *    本地 webServer 对 loopback 请求返回 403（Electron 安全限制），无需绕经 HTTP。
 * 2) 本地文件路径 / file://：仅当落在 registry 根目录（本项目资产库）内才读盘
 *    （CR-011 白名单）；越权路径拒绝——agent 参数不可诱导 Host 读任意本地文件。
 * 3) 其它 URL：先过 SSRF 防护（禁环回/私网/链路本地/云元数据，CR-011），
 *    再带超时与字节上限下载（CR-010）。
 */
async function readSourceBytes(source, port, signal, registry) {
    // 1) canvas-studio 资产 URL → 直接读磁盘。
    const asset = parseCanvasAsset(source);
    if (asset !== null && registry !== undefined) {
        const localPath = join(registry.assetsDir(asset.projectId), asset.file);
        if (existsSync(localPath)) {
            const ext = extname(asset.file).replace(/^\./, '') || 'png';
            return { bytes: await readFile(localPath), ext };
        }
    }
    // 2) 本地绝对文件路径 / file:// → 仅允许读取项目资产库内的文件（CR-011 白名单）。
    const rawLocal = source.startsWith('file://') ? fileURLToPath(source) : (isAbsolute(source) ? source : '');
    if (rawLocal.length > 0) {
        if (registry === undefined)
            throw new Error('本地文件引用需要 registry 上下文');
        const localPath = resolve(rawLocal);
        const root = resolve(registry.registryRoot);
        if (!(localPath.startsWith(root + sep) || localPath === root)) {
            throw new Error(`本地文件引用超出资产库范围，已拒绝: ${localPath}`);
        }
        if (existsSync(localPath)) {
            const ext = extname(localPath).replace(/^\./, '') || 'png';
            return { bytes: await readFile(localPath), ext };
        }
    }
    // 3) 其它 URL（含非资产匹配的相对路径补全端口后下载）。
    const url = port !== undefined && source.startsWith('/') ? resolveImageUrl(source, port) : source;
    // CR-011：SSRF 防护在下载前执行；相对路径补全成的 loopback 地址同样被拦
    // （这正是「让 Host 抓取本机任意路径」的注入面，与其误读不如显式拒绝）。
    await assertSafeDownloadUrl(url);
    const buf = await downloadBytes(url, signal, {
        maxBytes: IMAGE_DOWNLOAD_MAX_BYTES,
        timeoutMs: IMAGE_DOWNLOAD_TIMEOUT_MS,
        label: '参考图下载',
    });
    let ext = 'png';
    try {
        ext = extname(new URL(url).pathname).replace(/^\./, '') || 'png';
    }
    catch { /* keep png */ }
    return { bytes: buf, ext };
}
/** 上传一张图（本地路径 / canvas 资产 URL / 托管 URL）到 Drama Backend，返回服务器 filename。 */
async function uploadImage(sourceUrl, signal, port, registry) {
    await ensureDramaReachable(signal);
    const { bytes, ext } = await readSourceBytes(sourceUrl, port, signal, registry);
    return uploadBytesToDrama(bytes, ext, signal);
}
/**
 * 把图片字节上传到 Drama Backend（`uploadimage`），返回服务器 filename。
 * P8.1 本地图片与 P8.4 视频抽帧共用；表单文件名沿用唯一安全名约定
 * （只含 [A-Za-z0-9._-]），避免触发后端去重后缀破坏下游。
 */
export async function uploadBytesToDrama(bytes, ext, signal) {
    // 上传走的是裸 fetch（multipart），同样前置探针。
    await ensureDramaReachable(signal);
    const assetId = newAssetId();
    const form = new FormData();
    // new Uint8Array(...) 拷贝进全新 ArrayBuffer（BlobPart 要求非 SharedArrayBuffer 视图）。
    form.append('file', new Blob([new Uint8Array(bytes)]), `ref-${assetId.slice(0, 8)}.${ext}`);
    const upload = await fetch(`${runtime().dramaApiBase()}${DRAMA_ENDPOINTS.uploadimage}`, {
        method: 'POST',
        body: form,
        signal: signal ?? null,
    });
    if (!upload.ok)
        throw new Error(`参考图上传失败: ${upload.status}`);
    const data = await upload.json();
    // 兼容多种响应格式：{ filename } / { name } / { data: { filename } } / { data: { url } }
    const filename = (data.filename
        ?? data.name
        ?? data.data?.filename
        ?? data.data?.url);
    if (!filename)
        throw new Error(`参考图上传成功但未返回 filename（响应: ${JSON.stringify(data)}）`);
    return filename;
}
/**
 * P8.1：把本地图片（base64）落地到项目 assets 目录，并返回可直接供生成工具
 * 使用的两个引用：
 * - `url`：同源相对路径（/canvas-studio/assets/<projectId>/<file>），画布素材节点直接用；
 * - `filename`：经 Drama `uploadimage` 拿到的服务器文件名，供 image_generate /
 *   video_generate / video_composite 的 filename(s) 参数使用。
 */
export async function uploadLocalImage(registry, projectId, name, dataBase64, signal) {
    const project = (await registry.list()).find((entry) => entry.id === projectId);
    if (!project)
        throw new Error(`项目不存在: ${projectId}`);
    if (typeof dataBase64 !== 'string' || dataBase64.length === 0) {
        throw new Error('dataBase64 不能为空');
    }
    let bytes;
    try {
        // CR-015：Buffer.from 对非法 base64 不抛错（`@@!!` 也能解出字节）——用
        // 字符集+填充+round-trip 严格校验，无效 base64 直接拒绝而非以损坏字节写盘。
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64) || dataBase64.length % 4 !== 0) {
            throw new Error('not strict base64');
        }
        bytes = Buffer.from(dataBase64, 'base64');
        if (bytes.length === 0 || bytes.toString('base64') !== dataBase64) {
            throw new Error('base64 round-trip mismatch');
        }
    }
    catch {
        throw new Error('dataBase64 不是有效的 base64');
    }
    // 仅允许常见图片类型；其余按 png 兜底（写盘用，不影响 Drama 侧识别）。
    const ext = /\.(png|jpe?g|webp|gif|bmp)$/iu.test(name) ? name.toLowerCase().replace(/^.*\./u, '') : 'png';
    const assetId = newAssetId();
    const file = `${assetId}.${ext}`;
    const directory = registry.assetsDir(projectId);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, file), bytes);
    const url = `/canvas-studio/assets/${projectId}/${file}`;
    // 同一份字节上传到 Drama，拿到服务器 filename（供后续生成引用）。
    const filename = await uploadBytesToDrama(bytes, ext, signal);
    return { url, filename };
}
/** 统一解析失败响应：优先结构化字段，否则带出响应体片段（便于定位 500 真因）。 */
async function describeError(response) {
    let message = `HTTP ${response.status}`;
    try {
        const text = await response.text();
        if (text.length > 0) {
            try {
                const data = JSON.parse(text);
                message = data.error?.message || data.msg || data.detail || message;
            }
            catch {
                message = text.slice(0, 200);
            }
        }
    }
    catch {
        /* keep default */
    }
    return message;
}
/** 调用 Drama Backend 生成接口，取回产物 URL。 */
async function callDrama(endpoint, body, signal, kind = 'image') {
    const response = await dramaPost(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    }, DRAMA_TIMEOUT_MS[kind], signal);
    if (!response.ok) {
        throw new Error(`生成失败: ${await describeError(response)}`);
    }
    const data = await response.json();
    const url = data.full_url ?? data.data?.[0]?.url;
    if (!url)
        throw new Error('生成响应中未找到产物 URL');
    return data.filename !== undefined ? { url, filename: data.filename } : { url };
}
/**
 * 判断错误是否由「参考图 filename 失效」导致（触发重新上传容错）。
 * 「Internal Server Error / HTTP 500」也在列：实测 Drama 后端把 temp/ 文件
 * 丢失（重启清存储）统一报成笼统 500，与真实服务端 bug 无法区分；误判的
 * 代价只是多一次重传 + 一次重试，重试仍失败时抛出的仍是原始错误。
 */
function isBadReferenceError(e) {
    if (!(e instanceof Error))
        return false;
    return /HTTP 400|HTTP 404|HTTP 5\d\d|not (found|exist)|file (not|doesn')|invalid|no (such|file)|internal server error|参考图|filename|image.*(missing|not)/i.test(e.message);
}
/** 生成工具名 → 画布操作类型（边颜色/标签的语义来源）。 */
export function operationTypeOf(tool, params) {
    if (tool === 'image_generate')
        return params.filename !== undefined ? 'image-to-image' : 'text-to-image';
    if (tool === 'character_generate')
        return 'text-to-image';
    if (tool === 'inpaint')
        return 'image-to-image';
    if (tool === 'video_generate')
        return 'image-to-video';
    if (tool === 'video_composite')
        return 'mkr-video';
    if (tool === 'style_transfer')
        return 'style-transfer';
    if (tool === 'storyboard_generate')
        return 'storyboard';
    return 'import';
}
/** 把生成参数序列化为 generationPrompt（节点重试时原样重放；retryOf 不入档）。 */
export function generationPromptOf(params) {
    const { retryOf: _retryOf, ...rest } = params;
    return JSON.stringify(rest);
}
/** CV-080：提示词摘要（节点标题用）——压平空白后取前 max 字（默认 12）。 */
export function promptSummary(prompt, max = 12) {
    const cleaned = prompt.replace(/\s+/gu, ' ').trim();
    if (cleaned.length === 0)
        return '';
    return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max)}…`;
}
/**
 * CV-080：生成节点标题（图层列表 / 节点头部显示，替代泛化的「图片 / 视频」）。
 * 规则：① 血缘含分镜卡时按镜号命名「分镜 N · 关键帧/视频」；② 否则用提示词
 * 摘要（前 12 字）；③ 两者皆缺返回 undefined，节点保持无 title（渲染层回退
 * 现有泛化标签，行为不变）。纯函数，单测直连。
 */
export function mediaNodeTitle(input) {
    for (const shotTitle of input.shotTitles) {
        const match = /分镜\s*(\d+)/u.exec(shotTitle);
        if (match !== null)
            return `分镜 ${match[1]} · ${input.isVideo ? '视频' : '关键帧'}`;
    }
    const summary = promptSummary(input.prompt);
    return summary.length > 0 ? summary : undefined;
}
/** CV-079：组框内边距（与 client groupSelected 的 12px 一致）。 */
const GROUP_PADDING = 12;
/**
 * CV-079：把新生成的关键帧/视频并入其分镜卡的「素材组」（自动编组）。
 * - 组不存在：新建 kind=group 节点（sourceIds 记住分镜卡 id，后续同镜产物
 *   据此找到组并入），组标题「分镜 N · 素材」；新节点 parentId 指向组。
 * - 组已存在：新节点并入，组框扩到新成员包围盒。
 * 纯函数：返回完整的新节点数组（其余节点原样 + 新节点 + 组），调用方整体
 * 写盘（writeCanvas 替代 appendCanvasNode）。
 */
export function attachShotGroup(nodes, shotCard, newNode) {
    const existing = nodes.find(node => node.kind === 'group' && node.sourceIds.includes(shotCard.id));
    const match = /分镜\s*(\d+)/u.exec(shotCard.title ?? '');
    const groupTitle = match !== null ? `分镜 ${match[1]} · 素材` : (shotCard.title ?? '分镜素材');
    const parentId = existing?.id ?? `grp-${newNode.id}`;
    const members = [...nodes.filter(node => node.parentId === parentId), newNode];
    const minX = Math.min(...members.map(member => member.x));
    const minY = Math.min(...members.map(member => member.y));
    const maxX = Math.max(...members.map(member => member.x + member.width));
    const maxY = Math.max(...members.map(member => member.y + member.height));
    const group = existing !== undefined
        ? {
            ...existing,
            x: minX - GROUP_PADDING,
            y: minY - GROUP_PADDING,
            width: maxX - minX + GROUP_PADDING * 2,
            height: maxY - minY + GROUP_PADDING * 2,
        }
        : {
            id: parentId,
            kind: 'group',
            title: groupTitle,
            x: minX - GROUP_PADDING,
            y: minY - GROUP_PADDING,
            width: maxX - minX + GROUP_PADDING * 2,
            height: maxY - minY + GROUP_PADDING * 2,
            createdAt: Date.now(),
            origin: 'agent',
            sourceIds: [shotCard.id],
            zIndex: -1,
        };
    const withParent = { ...newNode, parentId };
    return [...nodes.filter(node => node.id !== group.id), withParent, group];
}
/**
 * 按画布产物 URL 反查节点 id（血缘 sourceIds 的来源）。URL 兼容两种形态：
 * 工具结果里的同源相对路径（/canvas-studio/assets/...）与早期版本写死的
 * http://127.0.0.1:<port> 绝对路径 —— 都归一化到相对路径后精确匹配。
 */
export function resolveSourceIds(nodes, urls) {
    if (urls === undefined || urls.length === 0)
        return [];
    const relative = (value) => value.replace(/^https?:\/\/127\.0\.0\.1:\d+(\/canvas-studio\/.*)$/, '$1');
    const byUrl = new Map(nodes.map((node) => [node.url !== undefined ? relative(node.url) : '', node.id]));
    const ids = [];
    for (const url of urls) {
        if (typeof url !== 'string' || url.length === 0)
            continue;
        const id = byUrl.get(relative(url));
        if (id !== undefined && !ids.includes(id))
            ids.push(id);
    }
    return ids;
}
/**
 * 按 Drama filename 反查画布节点 id（血缘自动补全）。生成参数里的
 * filename/filenames/styleFilename 都是素材节点落盘时写入的 Drama 文件名，
 * 据此可以确定性地还原「这次生成参考了哪些节点」——不依赖模型自觉填写
 * sourceUrls。与 URL 反查结果取并集后作为节点血缘。
 */
export function resolveSourceIdsByFilename(nodes, filenames) {
    const byFilename = new Map(nodes.map((node) => [node.filename ?? '', node.id]));
    const out = [];
    for (const name of filenames) {
        if (name === undefined || name.length === 0)
            continue;
        const id = byFilename.get(name);
        if (id !== undefined && !out.includes(id))
            out.push(id);
    }
    return out;
}
/** 合并两种血缘来源（URL 反查 + filename 反查），去重保序。 */
export function mergeSourceIds(primary, secondary) {
    return [...primary, ...secondary.filter((id) => !primary.includes(id))];
}
/**
 * CV-031：从已解析的来源节点继承分镜卡血缘。视频经关键帧生成时
 * （video_generate / video_composite），模型常漏传 shotRefs，导致视频只连
 * 关键帧、不连分镜卡。只要关键帧节点已连着所属分镜卡
 * （toolName=submit_storyboard_for_approval），就把该卡并入新节点父集合 ——
 * 「分镜 → 关键帧 → 视频」叙事链不因模型漏参断链。只上溯一层且只认分镜卡，
 * 不扩散到创意等其它上游。
 */
export function inheritShotCardIds(nodes, sourceIds) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const out = [];
    for (const id of sourceIds) {
        const source = byId.get(id);
        if (source === undefined)
            continue;
        for (const parentId of source.sourceIds) {
            const parent = byId.get(parentId);
            if (parent?.toolName !== 'submit_storyboard_for_approval')
                continue;
            if (sourceIds.includes(parent.id) || out.includes(parent.id))
                continue;
            out.push(parent.id);
        }
    }
    return out;
}
/** 落点网格常量（与客户端 project-store 的 LAYOUT 对齐）。 */
const PLACEMENT_GRID = { origin: 40, stepX: 300, stepY: 240, columns: 4 };
/** 血缘落位：新节点与来源节点右缘的间距。 */
const PLACEMENT_GAP = 60;
/** 真实分辨率 → 画布显示框：统一走 src/canvas-aspect.ts 的 previewSizeOf。 */
/**
 * CV-024 落点策略：新节点排在其血缘来源节点的右侧一列（y 取来源最小 y），
 * 形成「创意 → 素材 → 生成物」的左到右流向；与现有节点重叠时逐步右移避让
 * （有界 50 步）。无来源时回退到与客户端一致的网格空位。
 * 必须在写入前用「当前画布节点」调用；splitStoryboard 的多子节点由调用方
 * 在返回值基础上自行做行内偏移。
 */
export function deriveNodePlacement(nodes, sourceIds, width, height) {
    const sources = sourceIds
        .map((id) => nodes.find((node) => node.id === id))
        .filter((node) => node !== undefined);
    if (sources.length === 0) {
        const index = nodes.length;
        return {
            x: PLACEMENT_GRID.origin + (index % PLACEMENT_GRID.columns) * PLACEMENT_GRID.stepX,
            y: PLACEMENT_GRID.origin + Math.floor(index / PLACEMENT_GRID.columns) * PLACEMENT_GRID.stepY,
        };
    }
    const left = Math.max(...sources.map((source) => source.x + source.width));
    const top = Math.min(...sources.map((source) => source.y));
    let x = left + PLACEMENT_GAP;
    for (let step = 0; step < 50; step += 1) {
        const clash = nodes.some((node) => x < node.x + node.width
            && x + width > node.x
            && top < node.y + node.height
            && top + height > node.y);
        if (!clash)
            break;
        x += width + PLACEMENT_GAP;
    }
    return { x, y: top };
}
/** 提示词增强：调用 Drama Backend 的 image2promptenhance 接口。 */
export async function enhancePrompt(prompt, signal) {
    const data = await callDramaRaw(DRAMA_ENDPOINTS.promptEnhance, { prompt }, signal);
    // CR-016：output/msg 都缺时不再把整个对象当字符串（`[object Object]`），
    // 序列化兜底，保证返回的一定是模型可读文本。
    const raw = data.output ?? data.msg;
    return typeof raw === 'string' ? raw : JSON.stringify(raw ?? data);
}
/** 图像分析（VLM）：调用 Drama Backend 的 image2vl 接口，使用已上传的文件名。 */
export async function analyzeImage(filename, prompt, systemPrompt, signal) {
    const data = await callDramaRaw(DRAMA_ENDPOINTS.image2vl, {
        image: filename,
        prompt,
        system_prompt: systemPrompt,
    }, signal);
    return (data.output ?? data.msg ?? JSON.stringify(data));
}
/** 带 raw 响应解析的 callDrama（文本工具用，返回完整 JSON）。 */
async function callDramaRaw(endpoint, body, signal) {
    const response = await dramaPost(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    }, DRAMA_TIMEOUT_MS.text, signal);
    if (!response.ok) {
        throw new Error(`生成失败: ${await describeError(response)}`);
    }
    return response.json();
}
/**
 * 执行一次生成并落盘。
 * @param registry - 项目注册表（提供 assetsDir）。
 * @param tool - 工具名（image_generate / video_generate / video_composite / style_transfer / storyboard_generate）。
 * @param projectId - 目标项目 id。
 * @param params - 生成参数。
 * @param signal - 取消信号。
 */
export async function generateAsset(registry, tool, projectId, params, signal) {
    const projects = await registry.list();
    const project = projects.find((entry) => entry.id === projectId);
    if (!project)
        throw new Error(`项目不存在: ${projectId}`);
    const size = sizeForAspectRatio(params.aspectRatio ?? runtime().defaultAspectRatio());
    // CV-028：画布显示框用预览尺寸；size（媒体分辨率）只进 Drama 请求体、
    // mediaWidth/mediaHeight 与工具返回值。
    const display = previewSizeOf(size);
    const isVideo = tool === 'video_generate' || tool === 'video_composite';
    // 占坑参数提示：model/resolution/generateAudio 尚未接入后端（FL2VA 请求体不携带
    // 这些字段），显式传入时收集提示并随结果返回，避免 agent 误以为已生效。
    const warnings = [];
    if (isVideo) {
        if (params.model === 'seedance2')
            warnings.push('model=seedance2 暂未接入，当前后端统一走 FL2VA（H3 技术路线），本次按 h3 生成');
        if (params.resolution !== undefined)
            warnings.push(`resolution=${params.resolution} 暂未接入，已忽略（以 aspectRatio 与后端默认分辨率输出）`);
        if (params.generateAudio === true)
            warnings.push('generateAudio=true 暂未接入，当前后端版本不生成原生音频轨，成片将无音频');
    }
    let mediaUrl;
    // 生成类节点也要持久化 Drama 服务器文件名（fix: 让生成图可直接被后端链路引用，省掉重复 upload_image）。
    let dramaFilename;
    // storyboard_generate 时捕获 Drama 文件名，透出给 storyboard_split 链式拆分。
    let storyboardName;
    // —— 参考图容错：filename 是 Drama temp/ 里的临时文件名，后端重启清存储
    // 后「名字还在、文件没了」（实测报笼统的 500 Internal Server Error）。
    // 此时不依赖模型自觉，Host 确定性自愈：按文件名反查画布节点的本地资产
    // （readCanvas + assetsDir），重传拿新 filename 并回写节点（与 host-tools
    // 的 backfillUploadFilename 同一不变式：节点 filename 必须是后端当前可用
    // 的名字），再带新名重试一次；反查不中时回退 sourceUrls 逐个重传（旧行为）。
    const collectProvidedNames = () => {
        const names = [];
        if (params.filename)
            names.push(params.filename);
        if (params.styleFilename)
            names.push(params.styleFilename);
        if (params.filenames)
            names.push(...params.filenames);
        return names;
    };
    const reuploadLocalAsset = async (file, sig) => {
        const localPath = join(registry.assetsDir(projectId), file);
        if (!existsSync(localPath))
            throw new Error(`本地资产不存在: ${file}`);
        const bytes = await readFile(localPath);
        const ext = extname(file).replace(/^\./, '') || 'png';
        return uploadBytesToDrama(new Uint8Array(bytes), ext, sig);
    };
    /** 按文件名反查节点重传：返回 旧名 → 新名 映射，并回写节点 filename。 */
    const refreshByCanvasNodes = async (sig) => {
        const mapping = new Map();
        const doc = await registry.readCanvas(projectId);
        const byFilename = new Map(doc.nodes.map((node) => [node.filename ?? '', node]));
        const patchedNodes = new Map();
        for (const name of collectProvidedNames()) {
            if (mapping.has(name))
                continue;
            const node = byFilename.get(name);
            const file = node?.url?.split('/').pop();
            if (node === undefined || file === undefined || file.length === 0)
                continue;
            const fresh = await reuploadLocalAsset(file, sig);
            mapping.set(name, fresh);
            patchedNodes.set(node.id, { ...node, filename: fresh });
        }
        if (patchedNodes.size > 0) {
            await registry.writeCanvas(projectId, doc.nodes.map((node) => patchedNodes.get(node.id) ?? node));
        }
        return mapping;
    };
    /** 兜底：模型显式提供 sourceUrls 时按序重传，按位映射到 provided 名字。 */
    const refreshBySourceUrls = async (sig) => {
        const fresh = [];
        for (const u of params.sourceUrls ?? []) {
            const file = u.split('/').pop();
            if (!file)
                continue;
            try {
                fresh.push(await reuploadLocalAsset(file, sig));
            }
            catch { /* 单个资产缺失跳过，映射不满时上层抛原始错误 */ }
        }
        const mapping = new Map();
        collectProvidedNames().forEach((n, i) => { if (fresh[i] !== undefined)
            mapping.set(n, fresh[i]); });
        return mapping;
    };
    const callWithFallback = async (endpoint, body, kind) => {
        try {
            return await callDrama(endpoint, body, signal, kind);
        }
        catch (cause) {
            if (!isBadReferenceError(cause) || collectProvidedNames().length === 0)
                throw cause;
            let mapping;
            try {
                mapping = await refreshByCanvasNodes(signal);
                if (mapping.size === 0)
                    mapping = await refreshBySourceUrls(signal);
            }
            catch {
                throw cause; // 自愈失败（本地资产缺失 / 上传报错）→ 保留原始错误
            }
            if (mapping.size === 0)
                throw cause;
            let patched = JSON.stringify(body);
            for (const [oldN, newN] of mapping)
                patched = patched.split(oldN).join(newN);
            return callDrama(endpoint, JSON.parse(patched), signal, kind);
        }
    };
    if (tool === 'image_generate') {
        // 画风模式：anime（卡通）→ txt2imageanime（仅纯文生图）；realistic（默认，写实）走原 txt2image/image2image。
        const refs = (params.filenames ?? []).slice(0, 3);
        const hasRef = refs.length > 0 || params.filename !== undefined;
        if (params.style === 'anime' && !hasRef) {
            // 卡通文生图：txt2imageanime（日式动漫风格，z-anime-aio 工作流）。
            const _r = await callWithFallback(DRAMA_ENDPOINTS.txt2imageanime, {
                prompt: params.prompt,
                width: size.width,
                height: size.height,
                ...(params.negativePrompt ? { negative_prompt: params.negativePrompt } : {}),
            }, 'image');
            mediaUrl = _r.url;
            if (_r.filename !== undefined)
                dramaFilename = _r.filename;
        }
        else if (hasRef) {
            // 图生图：image2image（最多 3 张参考，image1~image3）。anime 模式不支持图生图，回退写实。
            const imageKeys = {};
            if (refs.length > 0) {
                refs.forEach((image, i) => { imageKeys[`image${i + 1}`] = image; });
            }
            else if (params.filename !== undefined) {
                imageKeys.image1 = params.filename;
            }
            const _r = await callWithFallback(DRAMA_ENDPOINTS.image2image, {
                prompt: params.prompt,
                width: size.width,
                height: size.height,
                ...imageKeys,
                ...(params.negativePrompt ? { negative_prompt: params.negativePrompt } : {}),
            }, 'image');
            mediaUrl = _r.url;
            if (_r.filename !== undefined)
                dramaFilename = _r.filename;
        }
        else {
            // 写实文生图：txt2image（nunchaku-z-image-turbo 工作流）。
            const _r = await callWithFallback(DRAMA_ENDPOINTS.txt2image, {
                prompt: params.prompt,
                width: size.width,
                height: size.height,
                ...(params.negativePrompt ? { negative_prompt: params.negativePrompt } : {}),
            }, 'image');
            mediaUrl = _r.url;
            if (_r.filename !== undefined)
                dramaFilename = _r.filename;
        }
    }
    else if (tool === 'character_generate') {
        // 基于角色设计图生成角色立绘图（三视图）：image2character（qwen_4view_char_2step 工作流）。
        if (!params.filename) {
            throw new Error('character_generate 需要提供 filename（角色设计图，来自 upload_image 工具）');
        }
        const _r = await callWithFallback(DRAMA_ENDPOINTS.character, { image: params.filename }, 'image');
        mediaUrl = _r.url;
        if (_r.filename !== undefined)
            dramaFilename = _r.filename;
    }
    else if (tool === 'inpaint') {
        // 图像修复/编辑（Inpainting）：image2inpaint（qwen_edit_inpainting 工作流）。
        if (!params.filename) {
            throw new Error('inpaint 需要提供 filename（要修复/编辑的图像，来自 upload_image 工具）');
        }
        const _r = await callWithFallback(DRAMA_ENDPOINTS.inpaint, {
            prompt: params.prompt,
            image: params.filename,
        }, 'image');
        mediaUrl = _r.url;
        if (_r.filename !== undefined)
            dramaFilename = _r.filename;
    }
    else if (tool === 'video_generate') {
        // 单图/文生视频统一走 FL2VA（首尾帧接口，也可纯文生或仅首帧）。
        // 该接口用 aspect + megapixels，仅支持 16:9 / 9:16（1:1 就近落到 16:9）。
        const aspect = params.aspectRatio === '9:16' ? '9:16' : '16:9';
        const _r = await callWithFallback(DRAMA_ENDPOINTS.videoFl2va, {
            prompt: params.prompt,
            aspect,
            megapixels: 0.4,
            // 时长钳制 ≤15s（后端长视频易失败，建议 ~10s）。
            duration: clampDuration(params.duration, 5),
            // 提供 filename 时为「首帧」模式；不提供则为纯文生视频。
            ...(params.filename ? { image1: params.filename } : {}),
        }, 'video');
        mediaUrl = _r.url;
        if (_r.filename !== undefined)
            dramaFilename = _r.filename;
    }
    else if (tool === 'video_composite') {
        const filenames = params.filenames ?? [];
        if (filenames.length < 1)
            throw new Error('video_composite 需要提供 filenames（来自 upload_image 工具）');
        if (filenames.length === 2) {
            // 首尾帧插值优先（image2videofl2va）：两图场景下比 MKR 关键帧插值更稳。
            // 该接口用 aspect + megapixels 而非 width/height，且只支持 16:9 / 9:16
            // （1:1 就近落到 16:9）。
            const aspect = params.aspectRatio === '9:16' ? '9:16' : '16:9';
            const _r = await callWithFallback(DRAMA_ENDPOINTS.videoFl2va, {
                prompt: params.prompt,
                aspect,
                megapixels: 0.4,
                duration: clampDuration(params.duration, 10),
                image1: filenames[0],
                image2: filenames[1],
            }, 'video');
            mediaUrl = _r.url;
            if (_r.filename !== undefined)
                dramaFilename = _r.filename;
        }
        else {
            // 多参考图 REF2VA（image2videoref2va）：最多 6 张（image1–image6），
            // 后端自动排布参考图以保持角色/场景一致性。超过 6 张时保留首尾 +
            // 中间均匀采样。同样用 aspect + megapixels，时长钳制 ≤15s。
            const aspect = params.aspectRatio === '9:16' ? '9:16' : '16:9';
            const duration = clampDuration(params.duration, 10);
            const refs = sliceToMax(filenames, 6);
            const refBody = { prompt: params.prompt, aspect, megapixels: 0.4, duration };
            refs.forEach((image, i) => { refBody[`image${i + 1}`] = image; });
            const _r = await callWithFallback(DRAMA_ENDPOINTS.videoRef2va, refBody, 'video');
            mediaUrl = _r.url;
            if (_r.filename !== undefined)
                dramaFilename = _r.filename;
        }
    }
    else if (tool === 'style_transfer') {
        if (!params.filename || !params.styleFilename) {
            throw new Error('style_transfer 需要提供 filename（目标图）和 styleFilename（风格参考图）');
        }
        const _r = await callWithFallback(DRAMA_ENDPOINTS.styleTransfer, {
            image1: params.filename,
            image2: params.styleFilename,
            ...(params.prompt ? { prompt: params.prompt } : {}),
            ...(params.enhance !== undefined ? { enhance: params.enhance } : {}),
        }, 'image');
        mediaUrl = _r.url;
        if (_r.filename !== undefined)
            dramaFilename = _r.filename;
    }
    else if (tool === 'storyboard_generate') {
        const _r = await callWithFallback(DRAMA_ENDPOINTS.storyboard, {
            prompt: params.prompt,
            gridnum: params.gridnum ?? 4,
            width: size.width,
            ...(params.filename ? { image: params.filename } : {}),
        }, 'image');
        mediaUrl = _r.url;
        storyboardName = _r.filename;
    }
    else {
        throw new Error(`未知的生成工具: ${tool}`);
    }
    const finalFilename = storyboardName ?? dramaFilename;
    // CR-010：产物下载带超时与字节上限（视频最慢，用媒体档参数），不再无限阻塞/整读。
    const bytes = await downloadBytes(mediaUrl, signal, {
        maxBytes: MEDIA_DOWNLOAD_MAX_BYTES,
        timeoutMs: MEDIA_DOWNLOAD_TIMEOUT_MS,
        label: '产物下载',
    });
    const assetId = newAssetId();
    const extension = isVideo ? 'mp4' : 'png';
    const filename = `${assetId}.${extension}`;
    const directory = registry.assetsDir(projectId);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, filename), bytes);
    // 同源相对路径：渲染进程与 webServer 同源，相对 URL 自动解析到当前端口，
    // 桌面重启换端口也不失效（此前写死 127.0.0.1:<port> 在端口变化后会 404）。
    const url = `/canvas-studio/assets/${projectId}/${filename}`;
    // Persist a canvas node the moment the asset lands on disk (Host is the
    // source of truth). The client reloads the canvas document on tool/result,
    // so a successful generation shows on the canvas even if the conversation
    // event's rendered text carries no usable URL.
    // 血缘：sourceUrls（agent 显式提供）与 filename 反查（确定性，不依赖模型
    // 自觉）取并集——生成参数里的 filename(s)/styleFilename 都是素材节点的
    // Drama 文件名，可精确还原参考了哪些画布节点；shotNodeIds 是分镜卡
    // （CV-027），让关键帧/视频连到所属分镜并右侧落位。
    const canvasNodes = (await registry.readCanvas(projectId)).nodes;
    const resolvedSources = mergeSourceIds(mergeSourceIds(resolveSourceIds(canvasNodes, params.sourceUrls), resolveSourceIdsByFilename(canvasNodes, [params.filename, params.styleFilename, ...(params.filenames ?? [])])), params.shotNodeIds ?? []);
    // CV-031：来源节点（关键帧）挂着分镜卡时自动继承——模型漏传 shotRefs 也
    // 不断链（实测各项目视频全部只连关键帧，即此根因）。
    const sourceIds = mergeSourceIds(resolvedSources, inheritShotCardIds(canvasNodes, resolvedSources));
    // 节点级重试（params.retryOf）：原地更新已有节点，保留 id/位置/血缘/编组，
    // 边不增加（plan §7.8 标准 2）。普通生成则追加新节点。
    if (params.retryOf !== undefined) {
        const existing = (await registry.readCanvas(projectId)).nodes;
        const target = existing.find((node) => node.id === params.retryOf);
        if (target === undefined) {
            throw new Error(`重试目标节点不存在: ${params.retryOf}`);
        }
        const { error: _staleError, ...targetRest } = target;
        const updated = {
            ...targetRest,
            url,
            ...(finalFilename !== undefined ? { filename: finalFilename } : {}),
            width: display.width,
            height: display.height,
            mediaWidth: size.width,
            mediaHeight: size.height,
            operationType: operationTypeOf(tool, params),
            toolName: tool,
            generationPrompt: generationPromptOf(params),
            ...(isVideo ? { duration: clampDuration(params.duration, tool === 'video_composite' ? 10 : 5) } : {}),
        };
        await registry.writeCanvas(projectId, existing.map((node) => (node.id === target.id ? updated : node)));
    }
    else {
        // CV-024：落点 = 血缘来源右侧（自动反查的 sourceIds），不再全叠在原点。
        const placement = deriveNodePlacement(canvasNodes, sourceIds, display.width, display.height);
        // CV-080：按血缘里的分镜卡镜号 / 提示词摘要命名（无 title 时渲染层回退泛化标签）。
        const shotCards = sourceIds
            .map((id) => canvasNodes.find((node) => node.id === id))
            .filter((node) => node?.toolName === 'submit_storyboard_for_approval');
        const nodeTitle = mediaNodeTitle({ isVideo, shotTitles: shotCards.map(node => node.title ?? ''), prompt: params.prompt });
        const node = {
            id: assetId,
            kind: isVideo ? 'video' : 'image',
            url,
            ...(finalFilename !== undefined ? { filename: finalFilename } : {}),
            ...(nodeTitle !== undefined ? { title: nodeTitle } : {}),
            // 图片产物默认成为可复用参考（参考托盘 / list_references 来源）；
            // 视频暂不直接作为工具参考图，故不标记。
            ...(isVideo ? {} : { isReference: true, referenceRole: 'image' }),
            x: placement.x,
            y: placement.y,
            width: display.width,
            height: display.height,
            createdAt: Date.now(),
            toolName: tool,
            runId: assetId,
            origin: 'agent',
            sourceIds,
            operationType: operationTypeOf(tool, params),
            generationPrompt: generationPromptOf(params),
            mediaWidth: size.width,
            mediaHeight: size.height,
            ...(isVideo ? { duration: clampDuration(params.duration, tool === 'video_composite' ? 10 : 5) } : {}),
        };
        // CV-079：有分镜卡血缘时并入「分镜 N · 素材」组（不存在则建组）；无
        // 分镜卡保持 appendCanvasNode 旧行为。整体写盘替代单节点追加。
        const shotCard = shotCards[0];
        if (shotCard !== undefined) {
            await registry.writeCanvas(projectId, attachShotGroup(canvasNodes, shotCard, node));
        }
        else {
            await registry.appendCanvasNode(projectId, node);
        }
    }
    const result = { url, width: size.width, height: size.height };
    if (isVideo)
        result.duration = clampDuration(params.duration, tool === 'video_composite' ? 10 : 5);
    if (finalFilename !== undefined)
        result.filename = finalFilename;
    if (warnings.length > 0)
        result.warnings = warnings;
    return result;
}
// 导出供 host-tools.ts 中 upload_image 工具使用。
export { uploadImage, resolveImageUrl };
/**
 * P8.3：把一张格子分镜图（storyboard_generate 产物）拆分为若干单镜。
 * 调用 Drama `image2splitegrid`，按 gridnum 推导行列（4→2×2、6→2×3、9→3×3），
 * 把返回的每个单镜图下载到本地 assets，并逐个 appendCanvasNode 为独立 image
 * 节点，sourceIds 指向传入的分镜网格节点（血缘箭头）。
 */
function gridDims(gridnum) {
    if (gridnum === 6)
        return { row: 2, column: 3 };
    if (gridnum === 9)
        return { row: 3, column: 3 };
    return { row: 2, column: 2 }; // 4 及其它默认 2×2
}
export async function splitStoryboard(registry, projectId, params, signal) {
    const grid = params.gridnum ?? 4;
    const { row, column } = gridDims(grid);
    const data = await callDramaRaw(DRAMA_ENDPOINTS.spliteGrid, { row, column, target_width: 1024, target_height: 768, image: params.filename }, signal);
    const images = data.images ?? [];
    if (images.length === 0)
        throw new Error('分镜拆分未返回任何单镜图像');
    const canvasNodes = (await registry.readCanvas(projectId)).nodes;
    const sourceIds = mergeSourceIds(resolveSourceIds(canvasNodes, params.sourceUrls), resolveSourceIdsByFilename(canvasNodes, [params.filename]));
    const directory = registry.assetsDir(projectId);
    await mkdir(directory, { recursive: true });
    // CV-024：单镜排在来源（分镜网格）节点右侧，按行内等距展开。
    const basePlacement = deriveNodePlacement(canvasNodes, sourceIds, 260, 180);
    // CR-013：先下载全部帧，再统一写盘、再落节点——任一步失败都不留「部分帧已
    // 落盘 + 部分节点已建」的半成品（此前逐帧边下边写边建，第 N 帧失败时前 N-1
    // 帧文件/节点已持久化，画布与磁盘不一致）。
    const frames = [];
    for (let i = 0; i < images.length; i += 1) {
        const img = images[i];
        // CR-010：单镜是图片，带超时与字节上限下载。
        const bytes = await downloadBytes(img.url, signal, {
            maxBytes: IMAGE_DOWNLOAD_MAX_BYTES,
            timeoutMs: IMAGE_DOWNLOAD_TIMEOUT_MS,
            label: `分镜单镜 ${i + 1} 下载`,
        });
        frames.push({ bytes, url: img.url });
    }
    let firstUrl = '';
    // 全部下载成功后统一写盘（写失败时清理已写文件）。
    const written = [];
    try {
        for (let i = 0; i < frames.length; i += 1) {
            const file = `${newAssetId()}.png`;
            await writeFile(join(directory, file), frames[i].bytes);
            written.push(file);
        }
    }
    catch (cause) {
        for (const file of written)
            await rm(join(directory, file)).catch(() => { });
        throw cause;
    }
    // 全部落盘后再追加节点（追加失败时清理已写文件，避免孤儿资产）。
    try {
        for (let i = 0; i < frames.length; i += 1) {
            const assetId = newAssetId();
            const url = `/canvas-studio/assets/${projectId}/${written[i]}`;
            if (i === 0)
                firstUrl = url;
            const node = {
                id: assetId,
                kind: 'image',
                url,
                title: `单镜 ${i + 1}`,
                isReference: true,
                referenceRole: 'image',
                x: basePlacement.x + i * (260 + 40),
                y: basePlacement.y,
                width: 260,
                height: 180,
                createdAt: Date.now(),
                toolName: 'storyboard_split',
                runId: assetId,
                origin: 'agent',
                sourceIds,
                operationType: 'storyboard-split',
                generationPrompt: JSON.stringify({ filename: params.filename, gridnum: grid, index: i + 1, total: images.length }),
            };
            await registry.appendCanvasNode(projectId, node);
        }
    }
    catch (cause) {
        for (const file of written)
            await rm(join(directory, file)).catch(() => { });
        throw cause;
    }
    return { url: firstUrl, width: 260, height: 180, count: images.length };
}
