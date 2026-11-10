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
 *
 * 三期 W3-2：音量不再是常数 —— `volume` 传**帧的函数**（`audioVolumeAt` 纯函数），
 * 从而实现淡入淡出与「字幕在屏时 BGM 压低」（D-09 选 A：零音频分析、确定性）。
 */
import type React from 'react'
import { Sequence } from 'remotion'
import { Audio } from '@remotion/media'
import { resolveSfxStartFrame } from '../../audio-timeline.js'
import type { ManifestAudio } from '../manifest.js'
import { audioVolumeAt, sfxVolumeAt, type AudioDuckWindow } from '../timing.js'

/** 与 `compose.ts` 对齐：有原生音轨时 BGM 只作铺底。 */
const BGM_MIX_VOLUME = 0.35
/** 无原生音轨时 BGM 作为主声轨。 */
const BGM_VOLUME = 0.8
const VOICE_VOLUME = 1

/** sfx 锚定解析所需的轨真值（`resolveSfxStartFrame` 的查表来源，窄结构类型）。 */
export type SfxAnchorTrack = {
  id: string
  startFrame: number
  durationInFrames: number
}

export const AudioTrack: React.FC<{
  audio: ManifestAudio
  hasNativeAudio: boolean
  durationInFrames: number
  fps: number
  duckWindows?: readonly AudioDuckWindow[]
  /**
   * sfx 锚定解析用（决策 D-15：渲染器内折算，不在宿主侧回写 manifest）。渲染器拿到的
   * manifest 已归一化（宿主侧 `normalizeManifestTiming` 已跑），`track.startFrame`
   * 必有数字 —— **不要再 normalize**（会二次位移）。
   */
  tracks?: readonly SfxAnchorTrack[]
}> = ({ audio, hasNativeAudio, durationInFrames, fps, duckWindows = [], tracks = [] }) => {
  const bgmVolume = audio.mix?.bgmVolume ?? (hasNativeAudio ? BGM_MIX_VOLUME : BGM_VOLUME)
  const voiceVolume = audio.mix?.voiceVolume ?? VOICE_VOLUME
  // 闪避只作用于 BGM（旁白本身就是被让路的那一路）。
  const duckAmount = audio.duck?.amount ?? 1
  const envelope = {
    durationInFrames,
    fps,
    baseVolume: bgmVolume,
    fadeInSeconds: audio.fadeInSeconds ?? 0,
    fadeOutSeconds: audio.fadeOutSeconds ?? 0,
    duckAmount,
    duckWindows,
  }
  // 0A · CV-460：sfx 锚定解析的查表（`anchor.trackId` → 轨真值）。
  const trackById = new Map(tracks.map((track) => [track.id, track] as const))
  return (
    <>
      {audio.bgmUrl ? (
        <Audio
          src={audio.bgmUrl}
          // `<Audio>` 的 volume 支持 `(frame) => number`；纯函数 ⇒ 逐帧确定。
          volume={(frame: number) => audioVolumeAt(frame, envelope)}
        />
      ) : null}
      {audio.voiceOverUrl ? <Audio src={audio.voiceOverUrl} volume={voiceVolume} /> : null}
      {/*
        O-10：多轨旁白。每句一个 `<Sequence from={startFrame}>` 包一层 `<Audio>` ——
        时间轴由 manifest 决定，不再要求 agent 先拼一条长音轨（终端用户也跑不了 ffmpeg）。
        `layout="none"`：音频不产生视觉盒子，别让它参与布局。
        缺省音量沿用 `mix.voiceVolume`（与单轨口径一致），单句可显式覆盖。
      */}
      {(audio.voiceOver ?? []).map((clip, index) => (
        <Sequence
          key={`voice-over-${String(index)}`}
          from={Math.max(0, Math.floor(clip.startFrame ?? 0))}
          layout="none"
        >
          <Audio src={clip.src} volume={clip.volume ?? voiceVolume} />
        </Sequence>
      ))}
      {/*
        0A · CV-460：音效事件轨（`audio.sfx[]`）。**纯追加** —— 上面的 bgm / voiceOver
        分支一行未动。定位三选一由 `resolveSfxStartFrame` 统一折算（唯一入口，`anchor`
        用 `trackById` 查表）；解析失败**静默跳过** —— 校验层已在 write 时拒收非法定位，
        渲染期 throw 会把整片炸成黑屏，代价远大于少一声响（D-15）。
        音量走 `sfxVolumeAt`（fade-in 线性包络），不接 BGM 的闪避包络 —— 音效是点缀，
        被闪避压住就听不见了。`<Audio>` 在 `<Sequence>` 内的 volume 回调拿到的是
        **相对帧**（0 = 素材起点；remotion 的 `useFrameForVolumeProp` 对正数 from 的
        Sequence 返回 `frame + 0`），换算成绝对帧再进包络。
      */}
      {(audio.sfx ?? []).map((sfx, index) => {
        const startFrame = resolveSfxStartFrame(sfx, { fps, trackById })
        if (startFrame === null) return null
        return (
          <Sequence key={`sfx-${String(index)}`} from={startFrame} layout="none">
            <Audio
              src={sfx.src}
              volume={(frame: number) =>
                sfxVolumeAt(startFrame + frame, {
                  startFrame,
                  fps,
                  gain: sfx.gain ?? 1,
                  fadeInSec: sfx.fadeInSec ?? 0,
                })
              }
            />
          </Sequence>
        )
      })}
    </>
  )
}
