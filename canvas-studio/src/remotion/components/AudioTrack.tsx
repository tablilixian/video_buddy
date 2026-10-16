/**
 * REQ-034 · B2：`manifest.audio` → 客户端音频层（BGM / 旁白）。
 *
 * 拍板（2026-10-16）：`manifest.audio` **由组件内直接渲染**，一键出带音轨成片；
 * 宿主 ffmpeg 只保留「探测真值 / 时长守卫」用途，不再负责混音。
 *
 * - 路线 B（CSR）只能用 `@remotion/media` 的 `<Audio>`（§7.6）。
 * - `<Video>`（`@remotion/media`）自带 clip 原声，故有视频轨时 BGM 音量按「铺底」
 *   取 `0.35`；无视频轨时 BGM 取 `0.8`（对齐 `compose.ts` 的 `BGM_MIX_VOLUME` /
 *   `BGM_VOLUME`）。旁白默认 `1.0`。用户可在 `audio.mix` 显式覆盖。
 * - BGM 不做循环 / 拉伸（`compose.ts` 的 `bgmShortfallMessage` 口径：接缝/变调都
 *   「听得出错」，改由守卫提示换更长的 BGM）。
 */
import type React from 'react'
import { Audio } from '@remotion/media'
import type { ManifestAudio } from '../manifest.js'

/** 与 `compose.ts` 对齐：有原生音轨时 BGM 只作铺底。 */
const BGM_MIX_VOLUME = 0.35
/** 无原生音轨时 BGM 作为主声轨。 */
const BGM_VOLUME = 0.8
const VOICE_VOLUME = 1

export const AudioTrack: React.FC<{ audio: ManifestAudio; hasNativeAudio: boolean }> = ({
  audio,
  hasNativeAudio,
}) => {
  const bgmVolume = audio.mix?.bgmVolume ?? (hasNativeAudio ? BGM_MIX_VOLUME : BGM_VOLUME)
  const voiceVolume = audio.mix?.voiceVolume ?? VOICE_VOLUME
  return (
    <>
      {audio.bgmUrl ? <Audio src={audio.bgmUrl} volume={bgmVolume} /> : null}
      {audio.voiceOverUrl ? <Audio src={audio.voiceOverUrl} volume={voiceVolume} /> : null}
    </>
  )
}
