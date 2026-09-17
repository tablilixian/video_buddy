/**
 * Canvas Studio ffmpeg 运行基础设施（P8.4 抽出 / P9 复用）。
 *
 * 解析本机可用的 ffmpeg 可执行文件，并封装一次 ffmpeg 子进程调用（超时强杀、
 * 信号中断、stdout/stderr 收集）。video-style 与 compose 都复用同一套
 * 环境 / ffmpeg-static / PATH 解析顺序。
 *
 * 解析顺序（CV-201 起）：显式参数 → `FFMPEG_PATH` → **随包二进制**
 * （`<Resources>/ffmpeg/<platform>-<arch>/ffmpeg`，见 `bundledFfmpegCandidates`）
 * → ffmpeg-static 包内二进制（仅当二进制真实存在）→ PATH 上的系统 ffmpeg。
 *
 * 随包档是产品主路径：安装包在**打包期**把二进制放进 `Contents/Resources/ffmpeg/`
 * （Windows 为 `resources/ffmpeg/`），终端用户无需自装 ffmpeg。仓库根 .yarnrc.yml
 * 设了 enableScripts: false，ffmpeg-static 的 postinstall 二进制下载会被跳过，
 * 故那条档在开发态通常落空、自动回退系统 ffmpeg。全部落空时抛面向用户的错误。
 */
import { spawn } from 'node:child_process';
import { accessSync, constants as fsConstants } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
/** 单段 ffmpeg 调用的默认超时（毫秒）。合成整体另有 120s 上限。 */
export const FFMPEG_TIMEOUT_MS = 60_000;
function isExecutableFile(path) {
    try {
        accessSync(path, fsConstants.X_OK);
        return true;
    }
    catch {
        return false;
    }
}
/** 按 PATH 约定枚举候选可执行文件（win32 补 .exe）。 */
function pathCandidates() {
    const base = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    return (process.env.PATH ?? '')
        .split(process.platform === 'win32' ? ';' : ':')
        .filter((dir) => dir.length > 0)
        .map((dir) => join(dir, base));
}
/** 随包 ffmpeg 的目录键（与打包脚本 `build/ffmpeg/<key>/` 同名）。 */
export function bundledFfmpegKey(platform, arch) {
    return `${platform}-${arch}`;
}
/** 向上收集祖先目录（含自身，最多 `depth` 级）。 */
function ancestorDirs(dir, depth) {
    if (dir === undefined || dir.length === 0)
        return [];
    const dirs = [];
    let current = dir;
    for (let level = 0; level <= depth; level += 1) {
        dirs.push(current);
        const parent = dirname(current);
        if (parent === current)
            break;
        current = parent;
    }
    return dirs;
}
/**
 * 随包 ffmpeg 的候选路径（按优先级、去重）。纯函数：不读盘、不看全局状态。
 *
 * 候选根依次：显式覆盖目录 → Electron `resourcesPath` → 模块祖先目录。最后一档
 * 覆盖「代码不在 Electron 主进程、拿不到 `resourcesPath`」的场景——打包后模块位于
 * `<Resources>/app.asar.unpacked/node_modules/canvas-studio/lib/`，向上第三级正是
 * `<Resources>`，于是 `<Resources>/ffmpeg/<key>/ffmpeg` 仍能被命中。
 */
export function bundledFfmpegCandidates(locator) {
    const binary = locator.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const key = bundledFfmpegKey(locator.platform, locator.arch);
    const roots = [];
    if (locator.overrideDir !== undefined && locator.overrideDir.length > 0) {
        roots.push(locator.overrideDir);
    }
    if (locator.resourcesPath !== undefined && locator.resourcesPath.length > 0) {
        roots.push(locator.resourcesPath);
    }
    roots.push(...ancestorDirs(locator.moduleDir, 4));
    const candidates = [];
    const seen = new Set();
    for (const root of roots) {
        const candidate = join(root, 'ffmpeg', key, binary);
        if (seen.has(candidate))
            continue;
        seen.add(candidate);
        candidates.push(candidate);
    }
    return candidates;
}
/** 当前模块所在目录；URL 解析失败时返回 `undefined`（跳过祖先探测）。 */
function currentModuleDir() {
    try {
        return dirname(fileURLToPath(import.meta.url));
    }
    catch {
        return undefined;
    }
}
/** Electron 主进程的 `process.resourcesPath`；纯 Node 下为 `undefined`。 */
function readResourcesPath() {
    const value = process.resourcesPath;
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
/**
 * 解析本机可用的 ffmpeg 可执行路径：显式参数 → FFMPEG_PATH → 随包二进制 →
 * ffmpeg-static（仅当二进制真实存在）→ PATH。全部落空抛面向用户的错误。
 */
export function resolveFfmpegPath(explicit) {
    const candidates = [];
    if (explicit !== undefined && explicit.length > 0)
        candidates.push(explicit);
    const envPath = process.env.FFMPEG_PATH;
    if (envPath !== undefined && envPath.length > 0)
        candidates.push(envPath);
    candidates.push(...bundledFfmpegCandidates({
        platform: process.platform,
        arch: process.arch,
        resourcesPath: readResourcesPath(),
        overrideDir: process.env.DSH_FFMPEG_DIR,
        moduleDir: currentModuleDir(),
    }));
    try {
        // 动态解析避免硬依赖：包缺失/未构建二进制时静默跳过，不阻塞系统回退。
        const required = createRequire(import.meta.url)('ffmpeg-static');
        if (typeof required === 'string' && required.length > 0)
            candidates.push(required);
    }
    catch {
        /* ffmpeg-static 未安装则跳过 */
    }
    for (const candidate of [...candidates, ...pathCandidates()]) {
        if (isExecutableFile(candidate))
            return candidate;
    }
    throw new Error('未找到可用的 ffmpeg：应用内置的 ffmpeg 组件缺失或被移除，请重新安装应用后重试。'
        + '若你自行管理 ffmpeg，可设置环境变量 FFMPEG_PATH 指向可执行文件。');
}
/**
 * 运行一次 ffmpeg，收集 stdout/stderr；超时强杀并报错；`signal` 中断时以
 * `signal.reason` 拒绝（与上游 DOMException 语义一致）。
 */
export function runFfmpeg(ffmpegPath, args, timeoutMs, signal) {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        // CR-019：settled 防重入——error 与 close 可能都触发（error 后 close 仍会
        // 派发），finish 只执行一次（清 timer / 解监听 / 回调）。
        let settled = false;
        const finish = (callback) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            callback();
        };
        const onAbort = () => {
            child.kill('SIGKILL');
            finish(() => rejectPromise(signal?.reason ?? new DOMException('aborted', 'AbortError')));
        };
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            finish(() => rejectPromise(new Error(`ffmpeg 执行超时（${Math.round(timeoutMs / 1000)}s）`)));
        }, timeoutMs);
        signal?.addEventListener('abort', onAbort, { once: true });
        // CR-020：stdout/stderr 累计上限（1MB）——进度日志再长也只留尾部有用信息，
        // 防单次转码输出无界占内存。
        const MAX_LOG_BYTES = 1 * 1024 * 1024;
        child.stdout?.on('data', (chunk) => {
            if (stdout.length < MAX_LOG_BYTES)
                stdout += String(chunk).slice(0, MAX_LOG_BYTES - stdout.length);
        });
        child.stderr?.on('data', (chunk) => {
            if (stderr.length < MAX_LOG_BYTES)
                stderr += String(chunk).slice(0, MAX_LOG_BYTES - stderr.length);
        });
        child.on('error', (cause) => {
            finish(() => rejectPromise(new Error(`ffmpeg 启动失败: ${cause instanceof Error ? cause.message : String(cause)}`)));
        });
        child.on('close', (code) => {
            finish(() => resolvePromise({ code: code ?? -1, stdout, stderr }));
        });
    });
}
export function parseFfmpegStreams(stderr) {
    // 视频流行可能带语言标签（如 `Stream #0:0(und): Video:`），逐行匹配更稳。
    const videoLine = stderr.split('\n').find((line) => /Video:/.test(line));
    const resolution = videoLine === undefined ? null : /(\d{2,5})x(\d{2,5})/u.exec(videoLine);
    const width = resolution === null ? undefined : Number(resolution[1]);
    const height = resolution === null ? undefined : Number(resolution[2]);
    const hasAudio = stderr.split('\n').some((line) => /Audio:/.test(line));
    const info = { hasAudio };
    if (width !== undefined)
        info.width = width;
    if (height !== undefined)
        info.height = height;
    return info;
}
/**
 * 从 `ffmpeg -i` 的 stderr 里解析 `Duration: HH:MM:SS.frac` 为秒。
 * 解析失败返回 0（调用方按「未知时长」处理）。
 */
export function parseFfmpegDuration(stderr) {
    const match = /Duration:\s*(\d+):(\d{2}):(\d{2})\.(\d+)/u.exec(stderr);
    if (match === null)
        return 0;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    const fraction = Number(`0.${match[4]}`);
    return hours * 3600 + minutes * 60 + seconds + fraction;
}
/**
 * 探测一个**本地媒体文件**的真实时长与分辨率，尽力而为。
 *
 * 时长（CV-140）：生成产物落盘后把「请求时长」换成真值。实测 H3 按时长与帧率
 * 量化输出（请求 5s → 5.167s = 124 帧 @24fps），请求值当真值会让下游的时长校验
 * 与音画对齐全部偏一帧量级。
 *
 * 分辨率（CV-188）：**同一个 stderr 里就有**（`parseFfmpegStreams` 早已在解析
 * 它，只是此前只给末帧抽取用）。视频侧的真实产物像素由**供应商**决定——Drama
 * 固定 0.4MP、fal 按档——所以「上游声明的像素」是一句会随后端行为静默失真的
 * 二手话。实测句号：`ffmpeg -i` 说多少就是多少，后端哪天变了也自动跟上。
 *
 * **绝不抛错**：ffmpeg 不可用（未安装 / 未设 FFMPEG_PATH）、文件不存在、格式
 * 不识别、探测超时——一律返回 `{ duration: 0 }`，由调用方按「未知」回退。
 * 生成主路径不能因为一个「顺带的探测」而失败。
 */
export async function probeMediaInfo(path, ffmpegPath, signal) {
    try {
        const resolved = resolveFfmpegPath(ffmpegPath);
        // `ffmpeg -i <file>` 无输出参数时必然非零退出，但 stderr 里带着 Duration 与 Stream 行。
        const probe = await runFfmpeg(resolved, ['-i', path], FFMPEG_TIMEOUT_MS, signal);
        const streams = parseFfmpegStreams(probe.stderr);
        return {
            duration: parseFfmpegDuration(probe.stderr),
            ...(streams.width !== undefined ? { width: streams.width } : {}),
            ...(streams.height !== undefined ? { height: streams.height } : {}),
        };
    }
    catch {
        return { duration: 0 };
    }
}
/** 只要时长时的薄封装（CV-140 既有调用点与测试共用同一实现，不另写一份探测）。 */
export async function probeMediaDuration(path, ffmpegPath, signal) {
    return (await probeMediaInfo(path, ffmpegPath, signal)).duration;
}
