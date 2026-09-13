import type { ProjectRegistry } from './projects.js';
/** 包络固定桶数：一次解码多处消费（节点卡 28 / 播放器 48 / 时间轴 ~32 都够）。 */
export declare const WAVEFORM_ENVELOPE_BUCKETS: number;
/**
 * 按项目资产白名单解析出磁盘路径（与 promoteAssetFile 同一防穿越规则）：
 * file 必须是纯文件名且落在音频扩展名白名单内，项目必须存在。返回 null
 * 表示参数不可解析（客户端不该为这种请求重试）。
 */
export declare function resolveAudioAssetPath(registry: ProjectRegistry, projectId: string, file: string): Promise<string | null>;
/**
 * 探测音频包络：返回 WAVEFORM_ENVELOPE_BUCKETS 个 0–1 峰值（两位小数）。
 * @param signal 请求中断信号（对齐 runFfmpeg 的 abort 语义）。
 * @param ffmpegPath 显式 ffmpeg 路径（测试替身注入点；缺省走解析链）。
 */
export declare function probeWaveformEnvelope(registry: ProjectRegistry, projectId: string, file: string, signal?: AbortSignal, ffmpegPath?: string): Promise<number[]>;
