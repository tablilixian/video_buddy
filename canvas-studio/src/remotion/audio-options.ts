/**
 * R11 · P1-4（2026-11-16 真机实测）：**音频渲染参数的唯一构造点**。
 *
 * 为什么单独抽出来：段渲染原来写 `audioCodec: muteAudio ? null : 'aac'`，而
 * `@remotion/web-renderer` 内部是 `requestedCodec ?? default` —— `null` 被当成
 * 「没有指定」，于是回落到默认 aac。实测「无声段」产物里真有一条 -91dB 的静音
 * AAC 音轨：容器时长 6.698667s vs 视频流 6.666667s（多 32ms），`concat -c copy`
 * 按容器时长累加 ⇒ 成片在每个拼接点定格 40ms、总时长 20.0667s、avg_frame_rate
 * 变成 9000/301。
 *
 * 真正关断音轨的开关是 `muted: true`（`createAudioSampleSource` 在 muted 时返回
 * null，根本不建音轨）。它必须显式出现，不能靠 `null` 的语义去表达「不要音轨」。
 *
 * 单测：`tests/req038-r11-audio-options.test.mjs`。反向变异——把这里改回
 * `{ audioCodec: null }` 必须立刻红。
 */
export type AudioRenderOptions = { readonly muted: true } | { readonly audioCodec: 'aac' }

export function audioRenderOptions(muteAudio: boolean | undefined): AudioRenderOptions {
  return muteAudio === true ? { muted: true } : { audioCodec: 'aac' }
}
