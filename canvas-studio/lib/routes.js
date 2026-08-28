import { readFile } from 'node:fs/promises';
import { BlockList, isIP } from 'node:net';
import { extname, join, sep, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeWorkflow } from './contracts/project.js';
import { generateAsset, uploadLocalImage } from './generate.js';
import { extractVideoStyle } from './video-style.js';
import { composeStudioVideo } from './compose.js';
import { normalizeCanvasView } from './canvas-view.js';
const ROUTE_PROJECTS = '/canvas-studio/projects';
const ROUTE_GENERATE = '/canvas-studio/generate';
const ROUTE_ASSETS = '/canvas-studio/assets';
const ROUTE_STYLE_DEMOS = '/canvas-studio/style-demos';
const ROUTE_CANVAS = '/canvas-studio/canvas';
const ROUTE_WORKFLOW = '/canvas-studio/workflow';
const ROUTE_UPLOAD = '/canvas-studio/upload';
const ROUTE_UPLOAD_VIDEO = '/canvas-studio/upload-video';
const ROUTE_COMPOSE = '/canvas-studio/compose';
const MAX_BODY_BYTES = 16 * 1024 * 1024;
/** P8.4 参考视频上限：短参考片为主，128MB 已远超风格采样所需。 */
const MAX_VIDEO_BODY_BYTES = 128 * 1024 * 1024;
const MAX_CANVAS_NODES = 2000;
const loopbackAddresses = new BlockList();
loopbackAddresses.addSubnet('127.0.0.0', 8, 'ipv4');
loopbackAddresses.addSubnet('::1', 128, 'ipv6');
/** 包内风格演示 GIF 目录：sync 脚本从 minimax-h3 submodule copy（lib 产物 → 包根 assets/style-demos）。 */
const STYLE_DEMO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'style-demos');
/** 托管资产的扩展名 → Content-Type（P8.4 起包含参考视频容器格式）。 */
const ASSET_CONTENT_TYPES = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
};
/** The request's local authority when it arrives from the loopback device. */
function studioAuthority(context) {
    if (context.remoteAddress === undefined || context.host === undefined)
        return undefined;
    const address = context.remoteAddress.replace(/^\[|\]$/gu, '').split('%', 1)[0];
    const family = isIP(address);
    if (family === 0 || !loopbackAddresses.check(address, family === 4 ? 'ipv4' : 'ipv6'))
        return undefined;
    let authority;
    try {
        authority = new URL(`http://${context.host}`);
    }
    catch {
        return undefined;
    }
    if (authority.protocol !== 'http:'
        || Number(authority.port || '80') !== context.expectedPort
        || authority.hostname !== '127.0.0.1'
        || context.secFetchSite === 'cross-site')
        return undefined;
    return authority;
}
function requestContext(req, expectedPort) {
    const secFetchSite = req.headers['sec-fetch-site'];
    return {
        remoteAddress: req.socket.remoteAddress,
        origin: req.headers.origin,
        host: req.headers.host,
        ...(typeof secFetchSite === 'string' ? { secFetchSite } : {}),
        expectedPort,
    };
}
function requestAllowed(req, expectedPort) {
    return studioAuthority(requestContext(req, expectedPort)) !== undefined;
}
function mutationAllowed(req, expectedPort) {
    const context = requestContext(req, expectedPort);
    const authority = studioAuthority(context);
    if (authority === undefined || context.origin === undefined)
        return false;
    try {
        const origin = new URL(context.origin);
        return origin.protocol === 'http:' && origin.host === authority.host && origin.pathname === '/';
    }
    catch {
        return false;
    }
}
function sendJson(res, status, value) {
    const body = JSON.stringify(value);
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.end(body);
}
/**
 * Parse a single-range `bytes=` header against the asset size. Returns the
 * inclusive byte span, `'invalid'` for an unsatisfiable range (HTTP 416), or
 * `undefined` when the header is absent/malformed (serve the whole file).
 */
function parseByteRange(header, size) {
    if (header === undefined)
        return undefined;
    const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim());
    if (match === null)
        return undefined;
    const [, rawStart, rawEnd] = match;
    if (rawStart === '' && rawEnd === '')
        return undefined;
    let start;
    let end;
    if (rawStart === '') {
        const suffix = Number(rawEnd);
        if (!Number.isInteger(suffix) || suffix <= 0)
            return 'invalid';
        start = Math.max(0, size - suffix);
        end = size - 1;
    }
    else {
        start = Number(rawStart);
        end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || start >= size) {
        return 'invalid';
    }
    return { start, end };
}
/** Read a bounded JSON request body, rejecting on abort, oversize, or invalid JSON. */
function readJson(req, signal) {
    const abortReason = () => signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
    if (signal.aborted)
        return Promise.reject(abortReason());
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let settled = false;
        const cleanup = () => {
            req.off('data', onData);
            req.off('end', onEnd);
            req.off('error', onError);
            req.off('aborted', onRequestAbort);
            signal.removeEventListener('abort', onSignalAbort);
        };
        const finish = (callback) => {
            if (settled)
                return;
            settled = true;
            cleanup();
            callback();
        };
        const onData = (chunk) => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += buffer.length;
            if (size > MAX_BODY_BYTES) {
                const cause = new Error('body too large');
                finish(() => {
                    req.destroy(cause);
                    reject(cause);
                });
                return;
            }
            chunks.push(buffer);
        };
        const onEnd = () => {
            try {
                const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                finish(() => resolve(value));
            }
            catch {
                finish(() => reject(new Error('invalid json')));
            }
        };
        const onError = (cause) => finish(() => reject(cause));
        const onRequestAbort = () => finish(() => reject(abortReason()));
        const onSignalAbort = () => finish(() => reject(abortReason()));
        req.on('data', onData);
        req.once('end', onEnd);
        req.once('error', onError);
        req.once('aborted', onRequestAbort);
        signal.addEventListener('abort', onSignalAbort, { once: true });
    });
}
/** Read a bounded raw (octet-stream) request body, rejecting on abort or oversize. */
function readRawBody(req, signal, maxBytes) {
    const abortReason = () => signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
    if (signal.aborted)
        return Promise.reject(abortReason());
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let settled = false;
        const cleanup = () => {
            req.off('data', onData);
            req.off('end', onEnd);
            req.off('error', onError);
            req.off('aborted', onRequestAbort);
            signal.removeEventListener('abort', onSignalAbort);
        };
        const finish = (callback) => {
            if (settled)
                return;
            settled = true;
            cleanup();
            callback();
        };
        const onData = (chunk) => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += buffer.length;
            if (size > maxBytes) {
                const cause = new Error(`body too large（上限 ${Math.round(maxBytes / 1024 / 1024)}MB）`);
                finish(() => {
                    req.destroy(cause);
                    reject(cause);
                });
                return;
            }
            chunks.push(buffer);
        };
        const onEnd = () => finish(() => resolve(Buffer.concat(chunks)));
        const onError = (cause) => finish(() => reject(cause));
        const onRequestAbort = () => finish(() => reject(abortReason()));
        const onSignalAbort = () => finish(() => reject(abortReason()));
        req.on('data', onData);
        req.once('end', onEnd);
        req.once('error', onError);
        req.once('aborted', onRequestAbort);
        signal.addEventListener('abort', onSignalAbort, { once: true });
    });
}
/** Parse a create-project body into a trimmed display name. */
function asProjectName(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('请求体必须是 JSON 对象');
    }
    const name = value.name;
    if (typeof name !== 'string')
        throw new Error('缺少项目名(name)');
    return name;
}
/**
 * Register the canvas-studio project, generation, and asset routes.
 * @param ctx - active Host context (webServer service injected).
 * @param registry - the project registry this plugin owns.
 * @returns the route disposer (all registered routes).
 */
export function registerStudioRoutes(ctx, registry) {
    const expectedPort = ctx.webServer.port;
    const routes = [
        ctx.webServer.register({ kind: 'exact', path: ROUTE_PROJECTS, handler: async (req, res) => {
                if (!requestAllowed(req, expectedPort)) {
                    sendJson(res, 403, { error: 'canvas-studio request authority rejected' });
                    return;
                }
                if (req.method === 'GET') {
                    try {
                        const projects = await registry.list();
                        if (!res.destroyed)
                            sendJson(res, 200, { projects });
                    }
                    catch (cause) {
                        if (!res.destroyed)
                            sendJson(res, 500, {
                                error: cause instanceof Error ? cause.message : 'project list unavailable',
                            });
                    }
                    return;
                }
                if (req.method === 'DELETE') {
                    if (!mutationAllowed(req, expectedPort)) {
                        sendJson(res, 403, { error: 'canvas-studio delete requires a local same-origin DELETE' });
                        return;
                    }
                    const controller = new AbortController();
                    const stopWatching = () => {
                        req.off('aborted', onRequestAbort);
                        res.off('close', onResponseClose);
                    };
                    const onRequestAbort = () => controller.abort();
                    const onResponseClose = () => {
                        if (!res.writableEnded)
                            controller.abort();
                    };
                    req.once('aborted', onRequestAbort);
                    res.once('close', onResponseClose);
                    try {
                        const body = await readJson(req, controller.signal);
                        if (typeof body.id !== 'string') {
                            sendJson(res, 400, { error: '缺少 id' });
                            return;
                        }
                        await registry.removeProject(body.id);
                        if (!controller.signal.aborted && !res.destroyed)
                            sendJson(res, 200, { ok: true });
                    }
                    catch (cause) {
                        if (!controller.signal.aborted && !res.destroyed) {
                            sendJson(res, 400, { error: cause instanceof Error ? cause.message : 'project delete failed' });
                        }
                    }
                    finally {
                        stopWatching();
                    }
                    return;
                }
                if (req.method !== 'POST' || !mutationAllowed(req, expectedPort)) {
                    sendJson(res, 405, { error: 'project changes require a local same-origin POST' });
                    return;
                }
                const controller = new AbortController();
                const stopWatching = () => {
                    req.off('aborted', onRequestAbort);
                    res.off('close', onResponseClose);
                };
                const onRequestAbort = () => controller.abort();
                const onResponseClose = () => {
                    if (!res.writableEnded)
                        controller.abort();
                };
                req.once('aborted', onRequestAbort);
                res.once('close', onResponseClose);
                try {
                    const name = asProjectName(await readJson(req, controller.signal));
                    const project = await registry.create(name);
                    if (!controller.signal.aborted && !res.destroyed)
                        sendJson(res, 201, { project });
                }
                catch (cause) {
                    if (!controller.signal.aborted && !res.destroyed) {
                        sendJson(res, 400, { error: cause instanceof Error ? cause.message : 'project create failed' });
                    }
                }
                finally {
                    stopWatching();
                }
            } }),
        // P3: media generation. The client tool posts the generation request; the
        // Host calls Drama Backend, downloads the asset, writes it to the project's
        // assets/ directory, and returns the webServer-hosted URL.
        ctx.webServer.register({ kind: 'exact', path: ROUTE_GENERATE, handler: async (req, res) => {
                if (!mutationAllowed(req, expectedPort)) {
                    sendJson(res, 403, { error: 'canvas-studio generate requires a local same-origin POST' });
                    return;
                }
                if (req.method !== 'POST') {
                    sendJson(res, 405, { error: 'generate requires POST' });
                    return;
                }
                const controller = new AbortController();
                const stopWatching = () => {
                    req.off('aborted', onRequestAbort);
                    res.off('close', onResponseClose);
                };
                const onRequestAbort = () => controller.abort();
                const onResponseClose = () => {
                    if (!res.writableEnded)
                        controller.abort();
                };
                req.once('aborted', onRequestAbort);
                res.once('close', onResponseClose);
                try {
                    const body = await readJson(req, controller.signal);
                    if (typeof body.tool !== 'string' || typeof body.projectId !== 'string') {
                        sendJson(res, 400, { error: '缺少 tool 或 projectId' });
                        return;
                    }
                    const params = (body.params ?? {});
                    const result = await generateAsset(registry, body.tool, body.projectId, params, controller.signal);
                    if (!controller.signal.aborted && !res.destroyed)
                        sendJson(res, 200, result);
                }
                catch (cause) {
                    if (!controller.signal.aborted && !res.destroyed) {
                        sendJson(res, 400, { error: cause instanceof Error ? cause.message : 'generate failed' });
                    }
                }
                finally {
                    stopWatching();
                }
            } }),
        // P3: asset serving. The Host writes generated media into each project's
        // assets/ directory; this prefix route streams those files back. Only
        // loopback + same-origin requests are allowed, and path traversal is
        // blocked by verifying the resolved path stays under the project assets dir.
        ctx.webServer.register({ kind: 'prefix', path: ROUTE_ASSETS, handler: async (req, res) => {
                if (!requestAllowed(req, expectedPort)) {
                    sendJson(res, 403, { error: 'canvas-studio request authority rejected' });
                    return;
                }
                if (req.method !== 'GET') {
                    sendJson(res, 405, { error: 'assets only support GET' });
                    return;
                }
                const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${expectedPort}`);
                const relative = decodeURIComponent(requestUrl.pathname.replace(ROUTE_ASSETS, ''));
                const parts = relative.split('/').filter(Boolean);
                if (parts.length !== 2) {
                    sendJson(res, 400, { error: 'asset path must be /<projectId>/<file>' });
                    return;
                }
                const projectId = parts[0];
                const file = parts[1];
                if (!projectId || !file) {
                    sendJson(res, 400, { error: 'asset path must be /<projectId>/<file>' });
                    return;
                }
                const base = registry.assetsDir(projectId);
                const target = join(base, file);
                if (!target.startsWith(base + sep)) {
                    sendJson(res, 403, { error: 'forbidden asset path' });
                    return;
                }
                try {
                    const data = await readFile(target);
                    const contentType = ASSET_CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
                    res.setHeader('content-type', contentType);
                    res.setHeader('cache-control', 'no-store');
                    res.setHeader('x-content-type-options', 'nosniff');
                    // Media elements issue `Range` requests; honor a single byte range so
                    // <video> can stream and seek (206), falling back to the full 200 body.
                    const range = parseByteRange(req.headers.range, data.byteLength);
                    if (range === 'invalid') {
                        res.statusCode = 416;
                        res.setHeader('content-range', `bytes */${data.byteLength}`);
                        res.end();
                        return;
                    }
                    if (range !== undefined) {
                        res.statusCode = 206;
                        res.setHeader('accept-ranges', 'bytes');
                        res.setHeader('content-range', `bytes ${range.start}-${range.end}/${data.byteLength}`);
                        res.end(data.subarray(range.start, range.end + 1));
                        return;
                    }
                    res.statusCode = 200;
                    res.setHeader('accept-ranges', 'bytes');
                    res.end(data);
                }
                catch {
                    sendJson(res, 404, { error: 'asset not found' });
                }
            } }),
        // S3: 风格澄清 GIF 预览。包内静态资源（sync 脚本从 minimax-h3 submodule copy
        // 的 8 张风格 demo），只读 GET + loopback authority；文件名单段 kebab + .gif，
        // join + startsWith 防穿越。静态不变资源用强缓存（与项目资产 no-store 不同）。
        ctx.webServer.register({ kind: 'prefix', path: ROUTE_STYLE_DEMOS, handler: async (req, res) => {
                if (!requestAllowed(req, expectedPort)) {
                    sendJson(res, 403, { error: 'canvas-studio request authority rejected' });
                    return;
                }
                if (req.method !== 'GET') {
                    sendJson(res, 405, { error: 'style-demos only support GET' });
                    return;
                }
                const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${expectedPort}`);
                const file = decodeURIComponent(requestUrl.pathname.replace(ROUTE_STYLE_DEMOS, '').replace(/^\/+/, ''));
                if (!/^[a-z0-9-]+\.gif$/.test(file)) {
                    sendJson(res, 400, { error: 'style demo path must be /<name>.gif' });
                    return;
                }
                const target = join(STYLE_DEMO_DIR, file);
                if (!target.startsWith(STYLE_DEMO_DIR + sep)) {
                    sendJson(res, 403, { error: 'forbidden style demo path' });
                    return;
                }
                try {
                    const data = await readFile(target);
                    res.setHeader('content-type', ASSET_CONTENT_TYPES[extname(file).toLowerCase()] ?? 'image/gif');
                    res.setHeader('cache-control', 'public, max-age=31536000, immutable');
                    res.setHeader('x-content-type-options', 'nosniff');
                    res.statusCode = 200;
                    res.end(data);
                }
                catch {
                    sendJson(res, 404, { error: 'style demo not found' });
                }
            } }),
        // P4+: canvas persistence. The client saves the project's node list so the
        // canvas survives a restart (plan §7.7). Reads require loopback authority;
        // writes add the same-origin check used by the project routes.
        ctx.webServer.register({ kind: 'exact', path: ROUTE_CANVAS, handler: async (req, res) => {
                if (!requestAllowed(req, expectedPort)) {
                    sendJson(res, 403, { error: 'canvas-studio request authority rejected' });
                    return;
                }
                if (req.method === 'GET') {
                    const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${expectedPort}`);
                    const projectId = requestUrl.searchParams.get('projectId');
                    if (!projectId) {
                        sendJson(res, 400, { error: '缺少 projectId' });
                        return;
                    }
                    try {
                        const document = await registry.readCanvas(projectId);
                        if (!res.destroyed) {
                            sendJson(res, 200, { nodes: document.nodes, view: document.view ?? null });
                        }
                    }
                    catch (cause) {
                        if (!res.destroyed)
                            sendJson(res, 500, {
                                error: cause instanceof Error ? cause.message : 'canvas load unavailable',
                            });
                    }
                    return;
                }
                if (req.method !== 'POST' || !mutationAllowed(req, expectedPort)) {
                    sendJson(res, 405, { error: 'canvas changes require a local same-origin POST' });
                    return;
                }
                const controller = new AbortController();
                const stopWatching = () => {
                    req.off('aborted', onRequestAbort);
                    res.off('close', onResponseClose);
                };
                const onRequestAbort = () => controller.abort();
                const onResponseClose = () => {
                    if (!res.writableEnded)
                        controller.abort();
                };
                req.once('aborted', onRequestAbort);
                res.once('close', onResponseClose);
                try {
                    const body = await readJson(req, controller.signal);
                    if (typeof body.projectId !== 'string' || !Array.isArray(body.nodes)) {
                        sendJson(res, 400, { error: '缺少 projectId 或 nodes' });
                        return;
                    }
                    const nodes = body.nodes;
                    if (nodes.length > MAX_CANVAS_NODES) {
                        sendJson(res, 413, { error: 'canvas node count exceeded' });
                        return;
                    }
                    // The view is client-owned UI state; validate leniently (invalid
                    // fields degrade to defaults, absence keeps the previously saved one).
                    const view = normalizeCanvasView(body.view);
                    await registry.writeCanvas(body.projectId, nodes, view);
                    if (!controller.signal.aborted && !res.destroyed)
                        sendJson(res, 200, { ok: true });
                }
                catch (cause) {
                    if (!controller.signal.aborted && !res.destroyed) {
                        sendJson(res, 400, { error: cause instanceof Error ? cause.message : 'canvas save failed' });
                    }
                }
                finally {
                    stopWatching();
                }
            } }),
        // P7: creation-workflow gate face. GET returns a project's workflow
        // (mode + approval state); POST applies user actions (approve / reject /
        // setMode) so the approval bar and mode toggle drive the Host-side gate.
        ctx.webServer.register({ kind: 'exact', path: ROUTE_WORKFLOW, handler: async (req, res) => {
                if (!requestAllowed(req, expectedPort)) {
                    sendJson(res, 403, { error: 'canvas-studio request authority rejected' });
                    return;
                }
                if (req.method === 'GET') {
                    const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${expectedPort}`);
                    const projectId = requestUrl.searchParams.get('projectId');
                    if (!projectId) {
                        sendJson(res, 400, { error: '缺少 projectId' });
                        return;
                    }
                    const project = await registry.getProject(projectId);
                    if (project === null) {
                        sendJson(res, 404, { error: `项目不存在: ${projectId}` });
                        return;
                    }
                    if (!res.destroyed) {
                        const workflow = normalizeWorkflow(project.workflow);
                        sendJson(res, 200, { workflow, pendingQuestion: workflow.pendingQuestion ?? null });
                    }
                    return;
                }
                if (req.method !== 'POST' || !mutationAllowed(req, expectedPort)) {
                    sendJson(res, 405, { error: 'workflow changes require a local same-origin POST' });
                    return;
                }
                const controller = new AbortController();
                const stopWatching = () => {
                    req.off('aborted', onRequestAbort);
                    res.off('close', onResponseClose);
                };
                const onRequestAbort = () => controller.abort();
                const onResponseClose = () => {
                    if (!res.writableEnded)
                        controller.abort();
                };
                req.once('aborted', onRequestAbort);
                res.once('close', onResponseClose);
                try {
                    const body = await readJson(req, controller.signal);
                    if (typeof body.projectId !== 'string' || typeof body.action !== 'string') {
                        sendJson(res, 400, { error: '缺少 projectId 或 action' });
                        return;
                    }
                    let project;
                    if (body.action === 'approve') {
                        project = await registry.updateWorkflow(body.projectId, { state: 'executing' });
                    }
                    else if (body.action === 'reject') {
                        project = await registry.updateWorkflow(body.projectId, { state: 'drafting' });
                    }
                    else if (body.action === 'answer') {
                        if (typeof body.value !== 'string') {
                            sendJson(res, 400, { error: '缺少 value（用户的选择）' });
                            return;
                        }
                        await registry.answerPendingQuestion(body.projectId, body.value);
                        // answerPendingQuestion 成功即项目存在。
                        project = (await registry.getProject(body.projectId));
                    }
                    else if (body.action === 'setMode') {
                        if (body.mode !== 'confirm' && body.mode !== 'auto') {
                            sendJson(res, 400, { error: 'mode 必须是 confirm 或 auto' });
                            return;
                        }
                        const patch = { mode: body.mode };
                        // 切回逐步确认时，执行中的流程回到澄清态；切到放手跑则解除等待。
                        const current = normalizeWorkflow((await registry.getProject(body.projectId))?.workflow);
                        if (current.state === 'executing')
                            patch.state = body.mode === 'auto' ? 'executing' : 'drafting';
                        if (current.state === 'awaiting_approval' && body.mode === 'auto')
                            patch.state = 'executing';
                        project = await registry.updateWorkflow(body.projectId, patch);
                    }
                    else {
                        sendJson(res, 400, { error: `未知 action: ${body.action}` });
                        return;
                    }
                    if (!controller.signal.aborted && !res.destroyed) {
                        sendJson(res, 200, { workflow: normalizeWorkflow(project.workflow) });
                    }
                }
                catch (cause) {
                    if (!controller.signal.aborted && !res.destroyed) {
                        sendJson(res, 400, { error: cause instanceof Error ? cause.message : 'workflow update failed' });
                    }
                }
                finally {
                    stopWatching();
                }
            } }),
        // P8.1: local image upload. The browser encodes a dropped/selected file as
        // base64 (no multipart parser dependency). The Host writes the bytes to the
        // project's assets/ dir (same-origin URL for canvas nodes) and forwards them
        // to Drama's uploadimage to obtain a server filename for generation tools.
        ctx.webServer.register({ kind: 'exact', path: ROUTE_UPLOAD, handler: async (req, res) => {
                if (!requestAllowed(req, expectedPort)) {
                    sendJson(res, 403, { error: 'canvas-studio request authority rejected' });
                    return;
                }
                if (req.method !== 'POST' || !mutationAllowed(req, expectedPort)) {
                    sendJson(res, 405, { error: 'upload requires a local same-origin POST' });
                    return;
                }
                const controller = new AbortController();
                const stopWatching = () => {
                    req.off('aborted', onRequestAbort);
                    res.off('close', onResponseClose);
                };
                const onRequestAbort = () => controller.abort();
                const onResponseClose = () => {
                    if (!res.writableEnded)
                        controller.abort();
                };
                req.once('aborted', onRequestAbort);
                res.once('close', onResponseClose);
                try {
                    const body = await readJson(req, controller.signal);
                    if (typeof body.projectId !== 'string') {
                        sendJson(res, 400, { error: '缺少 projectId' });
                        return;
                    }
                    if (typeof body.dataBase64 !== 'string') {
                        sendJson(res, 400, { error: '缺少 dataBase64' });
                        return;
                    }
                    const name = typeof body.name === 'string' && body.name.length > 0 ? body.name : 'local.png';
                    const result = await uploadLocalImage(registry, body.projectId, name, body.dataBase64, controller.signal);
                    if (!controller.signal.aborted && !res.destroyed) {
                        sendJson(res, 200, { url: result.url, filename: result.filename });
                    }
                }
                catch (cause) {
                    if (!controller.signal.aborted && !res.destroyed) {
                        sendJson(res, 400, { error: cause instanceof Error ? cause.message : 'upload failed' });
                    }
                }
                finally {
                    stopWatching();
                }
            } }),
        // P8.4: reference-video upload. The client POSTs the raw video bytes
        // (octet-stream; no multipart parser and no base64 inflation). The Host
        // saves the file into the project's assets/ dir, extracts frames with
        // ffmpeg, uploads each frame to Drama's uploadimage, and asks image2vl
        // for a style summary. Node creation stays on the client (P8.1 pattern).
        ctx.webServer.register({ kind: 'exact', path: ROUTE_UPLOAD_VIDEO, handler: async (req, res) => {
                if (!requestAllowed(req, expectedPort)) {
                    sendJson(res, 403, { error: 'canvas-studio request authority rejected' });
                    return;
                }
                if (req.method !== 'POST' || !mutationAllowed(req, expectedPort)) {
                    sendJson(res, 405, { error: 'video upload requires a local same-origin POST' });
                    return;
                }
                const controller = new AbortController();
                const stopWatching = () => {
                    req.off('aborted', onRequestAbort);
                    res.off('close', onResponseClose);
                };
                const onRequestAbort = () => controller.abort();
                const onResponseClose = () => {
                    if (!res.writableEnded)
                        controller.abort();
                };
                req.once('aborted', onRequestAbort);
                res.once('close', onResponseClose);
                try {
                    const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${expectedPort}`);
                    const projectId = requestUrl.searchParams.get('projectId');
                    const name = requestUrl.searchParams.get('name') ?? '';
                    if (projectId === null || projectId.length === 0) {
                        sendJson(res, 400, { error: '缺少 projectId' });
                        return;
                    }
                    const bytes = await readRawBody(req, controller.signal, MAX_VIDEO_BODY_BYTES);
                    const result = await extractVideoStyle(registry, projectId, name, bytes, {}, controller.signal);
                    if (!controller.signal.aborted && !res.destroyed) {
                        sendJson(res, 200, {
                            videoUrl: result.videoUrl,
                            duration: result.duration,
                            frames: result.frames,
                            summary: result.summary,
                        });
                    }
                }
                catch (cause) {
                    if (!controller.signal.aborted && !res.destroyed) {
                        sendJson(res, 400, { error: cause instanceof Error ? cause.message : 'video upload failed' });
                    }
                }
                finally {
                    stopWatching();
                }
            } }),
        // P9.2: 成片合成。客户端 POST 选中的分镜视频片段 id（与可选 BGM 节点
        // id）；Host 统一转码 → concat 拼接 → 可选 BGM 混音 → 落 assets 根目录
        // export-<uuid>.mp4，返回同源 URL + 成片时长，由 P9.3 前端回写画布节点。
        ctx.webServer.register({ kind: 'exact', path: ROUTE_COMPOSE, handler: async (req, res) => {
                if (!requestAllowed(req, expectedPort)) {
                    sendJson(res, 403, { error: 'canvas-studio request authority rejected' });
                    return;
                }
                if (req.method !== 'POST' || !mutationAllowed(req, expectedPort)) {
                    sendJson(res, 405, { error: 'compose requires a local same-origin POST' });
                    return;
                }
                const controller = new AbortController();
                const stopWatching = () => {
                    req.off('aborted', onRequestAbort);
                    res.off('close', onResponseClose);
                };
                const onRequestAbort = () => controller.abort();
                const onResponseClose = () => {
                    if (!res.writableEnded)
                        controller.abort();
                };
                req.once('aborted', onRequestAbort);
                res.once('close', onResponseClose);
                try {
                    const body = await readJson(req, controller.signal);
                    if (typeof body.projectId !== 'string') {
                        sendJson(res, 400, { error: '缺少 projectId' });
                        return;
                    }
                    if (!Array.isArray(body.clipIds) || !body.clipIds.every((id) => typeof id === 'string')) {
                        sendJson(res, 400, { error: 'clipIds 必须是字符串数组' });
                        return;
                    }
                    const bgmNodeId = typeof body.bgmNodeId === 'string' ? body.bgmNodeId : undefined;
                    const result = await composeStudioVideo(registry, body.projectId, body.clipIds, bgmNodeId, {}, controller.signal);
                    if (!controller.signal.aborted && !res.destroyed) {
                        sendJson(res, 200, { url: result.url, duration: result.duration, width: result.width, height: result.height });
                    }
                }
                catch (cause) {
                    if (!controller.signal.aborted && !res.destroyed) {
                        sendJson(res, 400, { error: cause instanceof Error ? cause.message : 'compose failed' });
                    }
                }
                finally {
                    stopWatching();
                }
            } }),
    ];
    return () => {
        for (const dispose of routes)
            dispose();
    };
}
