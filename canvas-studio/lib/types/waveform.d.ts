/**
 * 波形条统一出口（C3）。
 *
 * 背景：伪波形曾在两处各养了一套公式（CanvasNode `24 + seed*(i+5)%61` 与
 * AudioPlayerModal `18 + seed*(i+7)%83`），同一首曲子在节点卡与播放器里
 * 长得不一样。C3 把「条高数组」的生成收口到这里：
 *
 * - `waveBarsDeterministic(seedText, bars)`：无真包络时的确定性降级 ——
 *   同一 url/id 每次渲染一致（CV-128/CR 语义保留），全仓只有这一套公式；
 * - `waveBarsFromEnvelope(envelope, bars)`：Host 真包络（见 waveform-host.ts，
 *   ffmpeg 解码取峰值）重采样成条高 —— 波形与音频实际起伏相符；
 * - 条数一律经 `clampWaveBars` 收口到 [8, 96]。
 *
 * 本文件被 client bundle（tsdown）与 Host（tsc）同时引用，**禁止 import
 * node 内建模块** —— 采样等 Host 能力走 waveform-host.ts。
 */
/** 波形条数上限（时间轴整条波形 / 播放器大图都不该超过它）。 */
export declare const WAVE_BARS_MAX = 96;
/** 波形条数下限（低于 8 根读不出「起伏」）。 */
export declare const WAVE_BARS_MIN = 8;
/** 把任意条数请求收口到合法区间。 */
export declare function clampWaveBars(bars: number): number;
/**
 * 确定性降级：由 seedText（url 或节点 id）派生 bars 根条高（22–92，单位 %）。
 * 同一 seedText 每次结果一致；不同 seedText 概率上不同 —— 只作「看起来像波形」，
 * 不承诺对应真实响度。真波形由 waveBarsFromEnvelope 承载。
 */
export declare function waveBarsDeterministic(seedText: string, bars: number): number[];
/**
 * 真包络重采样：envelope 是 Host 侧 ffmpeg 解码出的峰值序列（任意长度、
 * 0–1 归一化），线性分桶取 max 压到 bars 根。空包络退回全静音平线（不抛错
 * —— 波形是装饰性信息，失败不该打断播放/渲染）。条高 4–100（单位 %），
 * 保底 4% 让静音段仍是「看得见的平线」而不是消失。
 */
export declare function waveBarsFromEnvelope(envelope: readonly number[], bars: number): number[];
