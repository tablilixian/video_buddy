/**
 * Host 侧真波形包络（C3，唯一带 Host 新能力的一批）。
 *
 * 用既有 ffmpeg 解析链（resolveFfmpegPath）把音频解码成单声道 8kHz s16le
 * PCM，按固定桶数取绝对值峰值，归一化到 0–1 —— 这是「波形与音频实际起伏
 * 相符」的数据源。设计稿的波形是伪随机 sine 公式，这里做成真的，属于
 * 「比设计稿更好」。
 *
 * 为什么不走 ffmpeg-run.runFfmpeg：它的 stdout 按 UTF-8 字符串累计且有 1MB
 * 日志上限（CR-020，为进度文本设计），二进制 PCM 会被字符串化损坏 —— 这里
 * 自带 Buffer 收集的 spawn，超时强杀 / abort 语义与 runFfmpeg 对齐。
 *
 * 失败语义：ffmpeg 缺失 / 解码失败一律抛错，由路由层转成 400 —— 客户端
 * （use-waveform.ts）拿到失败会静默退回确定性降级公式，波形是装饰性信息，
 * 不该打断渲染或播放。
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { resolveFfmpegPath, FFMPEG_TIMEOUT_MS } from './ffmpeg-run.js';
import { WAVE_BARS_MAX } from './waveform.js';
/** 包络固定桶数：一次解码多处消费（节点卡 28 / 播放器 48 / 时间轴 ~32 都够）。 */
export const WAVEFORM_ENVELOPE_BUCKETS = Math.min(WAVE_BARS_MAX, 96);
/** 音频文件扩展名白名单。 */
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac']);
/** 解码采样率：8kHz 单声道足以表达包络，8s 音频 ≈ 128KB PCM。 */
const DECODE_SAMPLE_RATE = 8000;
/** PCM 收集上限：10s @8kHz s16le = 160KB，200KB 已远超最长 BGM 素材。 */
const MAX_PCM_BYTES = 200 * 1024;
/**
 * 按项目资产白名单解析出磁盘路径（与 promoteAssetFile 同一防穿越规则）：
 * file 必须是纯文件名且落在音频扩展名白名单内，项目必须存在。返回 null
 * 表示参数不可解析（客户端不该为这种请求重试）。
 */
export async function resolveAudioAssetPath(registry, projectId, file) {
    if (!/^[A-Za-z0-9._-]+$/u.test(file) || file.includes('..'))
        return null;
    const dot = file.lastIndexOf('.');
    if (dot < 0)
        return null;
    if (!AUDIO_EXTENSIONS.has(file.slice(dot).toLowerCase()))
        return null;
    const project = (await registry.list()).find((entry) => entry.id === projectId);
    if (!project)
        return null;
    return join(registry.assetsDir(projectId), file);
}
/**
 * 探测音频包络：返回 WAVEFORM_ENVELOPE_BUCKETS 个 0–1 峰值（两位小数）。
 * @param signal 请求中断信号（对齐 runFfmpeg 的 abort 语义）。
 * @param ffmpegPath 显式 ffmpeg 路径（测试替身注入点；缺省走解析链）。
 */
export async function probeWaveformEnvelope(registry, projectId, file, signal, ffmpegPath) {
    const audioPath = await resolveAudioAssetPath(registry, projectId, file);
    if (audioPath === null)
        throw new Error(`不是可解析的项目音频资产: ${projectId}/${file}`);
    const ffmpeg = ffmpegPath ?? resolveFfmpegPath();
    const pcm = await decodePcm(ffmpeg, audioPath, signal);
    if (pcm.length < 2)
        throw new Error('音频解码结果为空（文件损坏或不含可解码音轨）');
    const samples = Math.floor(pcm.length / 2);
    const buckets = WAVEFORM_ENVELOPE_BUCKETS;
    const peaks = new Float64Array(buckets);
    for (let index = 0; index < samples; index += 1) {
        // little-endian s16 → 幅值绝对值（符号折叠）。
        const raw = pcm[index * 2] | (pcm[index * 2 + 1] << 8);
        const magnitude = Math.abs(raw < 0x8000 ? raw : raw - 0x10000);
        const bucket = Math.min(buckets - 1, Math.floor((index * buckets) / samples));
        if (magnitude > peaks[bucket])
            peaks[bucket] = magnitude;
    }
    let max = 0;
    for (const peak of peaks)
        if (peak > max)
            max = peak;
    if (max === 0)
        throw new Error('音频全部静音，无法生成波形');
    return Array.from(peaks, (peak) => Math.round((peak / max) * 100) / 100);
}
/** 解码成 s16le 单声道 PCM（Buffer 收集；超时强杀；abort 以 reason 拒绝）。 */
function decodePcm(ffmpegPath, audioPath, signal) {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(ffmpegPath, [
            '-v', 'error', '-i', audioPath, '-vn', '-ac', '1', '-ar', String(DECODE_SAMPLE_RATE), '-f', 's16le', '-',
        ], { stdio: ['ignore', 'pipe', 'pipe'] });
        const chunks = [];
        let bytes = 0;
        let stderr = '';
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
            finish(() => rejectPromise(new Error(`波形解码超时（${Math.round(FFMPEG_TIMEOUT_MS / 1000)}s）`)));
        }, FFMPEG_TIMEOUT_MS);
        signal?.addEventListener('abort', onAbort, { once: true });
        child.stdout?.on('data', (chunk) => {
            // 超上限直接失败而不是静默截断 —— 截断的包络会把后半段画成平线。
            bytes += chunk.length;
            if (bytes > MAX_PCM_BYTES) {
                finish(() => rejectPromise(new Error('音频过长，超出波形解码上限')));
                child.kill('SIGKILL');
                return;
            }
            chunks.push(chunk);
        });
        child.stderr?.on('data', (chunk) => {
            if (stderr.length < 4096)
                stderr += String(chunk);
        });
        child.on('error', (cause) => {
            finish(() => rejectPromise(new Error(`无法启动 ffmpeg：${cause instanceof Error ? cause.message : String(cause)}`)));
        });
        child.on('close', (code) => {
            if (settled)
                return;
            if (code !== 0) {
                finish(() => rejectPromise(new Error(`ffmpeg 波形解码失败（exit ${code}）：${stderr.slice(-400) || '无 stderr'}`)));
                return;
            }
            finish(() => resolvePromise(Buffer.concat(chunks)));
        });
    });
}
