/**
 * Canvas Studio ffmpeg 运行基础设施（P8.4 抽出 / P9 复用）。
 *
 * 解析本机可用的 ffmpeg 可执行文件，并封装一次 ffmpeg 子进程调用（超时强杀、
 * 信号中断、stdout/stderr 收集）。video-style 与 compose 都复用同一套
 * 环境 / ffmpeg-static / PATH 解析顺序。
 *
 * 解析顺序：显式参数 → `FFMPEG_PATH` 环境变量 → ffmpeg-static 包内二进制
 * （仅当二进制真实存在）→ PATH 上的系统 ffmpeg。仓库根 .yarnrc.yml 设了
 * enableScripts: false，ffmpeg-static 的 postinstall 二进制下载会被跳过，
 * 此时自动回退系统 ffmpeg；两者都不可用时抛可操作的中文错误。
 */
import { spawn } from 'node:child_process';
import { accessSync, constants as fsConstants } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
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
/**
 * 解析本机可用的 ffmpeg 可执行路径：显式参数 → FFMPEG_PATH → ffmpeg-static
 * （仅当二进制真实存在）→ PATH。全部落空抛中文可操作错误。
 */
export function resolveFfmpegPath(explicit) {
    const candidates = [];
    if (explicit !== undefined && explicit.length > 0)
        candidates.push(explicit);
    const envPath = process.env.FFMPEG_PATH;
    if (envPath !== undefined && envPath.length > 0)
        candidates.push(envPath);
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
    throw new Error('未找到可用的 ffmpeg。请安装 ffmpeg（macOS: brew install ffmpeg / Ubuntu: apt install ffmpeg）'
        + '或设置环境变量 FFMPEG_PATH 指向可执行文件后重试。');
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
