/**
 * REQ-034 · B2 组件根：`<Composition id="studio-composition">` + `calculateMetadata`
 * 从 `inputProps.manifest.meta` 动态取 `durationInFrames / fps / width / height`（§7.3）。
 *
 * 路线 B（CSR）约束：层叠一律靠 DOM 顺序（不用 `z-index`）；`transition` 轨由
 * `transitionOverride`（`../timing.js` 纯函数）折算成各轨的可见性覆盖。
 *
 * 三期新增（都在本文件，因为它们是「全片级」而不是「轨级」）：
 * - **W2-4 `meta.look`**：色彩 `filter` + 暗角 + 颗粒三层，全部逐帧确定性；
 *   缺省 ⇒ 三层都不挂（老 manifest 逐像素不变）。
 * - **W3-4 素材预取**：首帧前 `fetch` 一遍全部素材（`delayRender` 闸门，8s 兜底放行），
 *   消灭「前几帧黑、后面正常」这类只在慢机器上出现的缺陷。
 */
import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { AbsoluteFill, Composition, Sequence, continueRender, delayRender, useCurrentFrame } from 'remotion'
import { fontFamilyStack, resolveFonts } from '../fonts.js'
import { chartDataFromTimeline } from '../chart-data.js'
import {
  anchorRefsOf,
  applyAnchorResolution,
  envelopeWordWindows,
  explicitWordWindows,
  groupWordsByPhrase,
  type PhraseTiming,
} from '../anchor.js'
import type { CompositionManifest, CompositionTrack, CaptionTrack } from '../manifest.js'
import { duckWindowsFromSubtitles, lookStyles, trackTransitionWindows, transitionOverride } from '../timing.js'
import { throwError } from '../../error-system.js'
import '../../errors/catalog.js'
import { useEnvelope } from './audio-envelope.js'
import { AudioTrack } from './AudioTrack.js'
import { AudioViz } from './AudioViz.js'
import { Caption } from './Caption.js'
import { Chart } from './Chart.js'
import { FontFamilyContext } from './font-context.js'
import { ImageClip } from './ImageClip.js'
import { Shape } from './Shape.js'
import { TextCard } from './TextCard.js'
import { TransitionShell } from './Transition.js'
import { VideoClip } from './VideoClip.js'
import { Callout } from './Callout.js'
import { RevealShell } from './RevealShell.js'

/** `<Composition>` 的缺省 props（会被 `calculateMetadata` 覆盖，但仍必须给，§7.3）。 */
export const EMPTY_MANIFEST: CompositionManifest = {
  id: 'empty',
  meta: { title: '', width: 1280, height: 720, fps: 30, durationInFrames: 1 },
  tracks: [],
}

/**
 * 三期 W2-4：颗粒 tile 的同源地址（`assets/remotion/grain.png`，路由 `/canvas-studio/remotion/grain`）。
 *
 * 为什么是静态 PNG + 整数偏移，而不是 SVG `feTurbulence`：后者每帧都要栅格化滤镜，
 * 成本不可控（D-06 选 A）。静态图 + 按帧整数偏移的确定性天然成立。
 */
export const GRAIN_TILE_URL = '/canvas-studio/remotion/grain'

/** 预取兜底超时：卡住也要放行，不能把整条渲染挂在 delayRender 上。 */
const PREFETCH_TIMEOUT_MS = 8000

function isContentTrack(track: CompositionTrack): boolean {
  return track.type !== 'transition'
}

/** 收集 manifest 里所有需要预取的素材 URL（去重，音频/字体不参与 —— 它们自行按需加载）。 */
function collectPrefetchUrls(manifest: CompositionManifest): string[] {
  const seen = new Set<string>()
  const urls: string[] = []
  for (const track of manifest.tracks) {
    if (track.type !== 'video' && track.type !== 'image' && track.type !== 'audioViz') continue
    const src = (track as { src?: unknown }).src
    if (typeof src !== 'string' || src.length === 0 || seen.has(src)) continue
    seen.add(src)
    urls.push(src)
  }
  return urls
}

/**
 * 三期 W2-4：把颗粒 tile **解码进 CSS 图像缓存**。
 *
 * 为什么不能用 `fetch` 代替：`fetch` 只把字节放进 HTTP 缓存，`background-image` 的首帧仍可能
 * 走一次异步解码 ⇒ 先拍到的几帧没有颗粒、后拍的有，而拍到几帧取决于机器快慢 —— 同一 manifest
 * 渲两次不一样，直接违反确定性铁律。`new Image().decode()` 走的是 CSS 图像管线本身，
 * 解码完成即代表「背景图随时可用」。
 */
async function preloadBackgroundImage(url: string): Promise<void> {
  try {
    const image = new Image()
    image.src = url
    if (typeof image.decode === 'function') {
      await image.decode()
      return
    }
    await new Promise<void>((resolve) => {
      image.onload = () => { resolve() }
      image.onerror = () => { resolve() }
    })
  } catch {
    // 静默降级：缺 tile 只是没颗粒，不能因此让整条片子渲不出来。
  }
}

/**
 * 三期 W3-4：首帧前预取全部素材。
 *
 * 为什么必须 `delayRender`：CSR 逐帧截图不看「画面有没有加载好」，只看帧号。素材没就绪时
 * 前几帧拍到的是空白，而拍到几帧取决于机器快慢 ⇒ 同一 manifest 渲两次不一样。
 * 预取把「就绪」变成渲染前置条件，确定性才有保证。
 */
function usePrefetchMedia(manifest: CompositionManifest): void {
  const [handle] = useState(() => delayRender('预取成片素材'))
  const released = useRef(false)
  const urls = collectPrefetchUrls(manifest)
  // 颗粒 tile 不是轨道素材（它是 CSS 背景图），但同样必须在首帧前就绪 —— 见 preloadBackgroundImage。
  const hasGrain = (manifest.meta.look?.grain ?? 0) > 0
  const key = `${urls.join('\u0000')}|grain:${String(hasGrain)}`
  useEffect(() => {
    let cancelled = false
    const release = (): void => {
      if (released.current) return
      released.current = true
      continueRender(handle)
    }
    if (urls.length === 0 && !hasGrain) {
      release()
      return () => { cancelled = true }
    }
    const timer = setTimeout(release, PREFETCH_TIMEOUT_MS)
    const run = async (): Promise<void> => {
      try {
        await Promise.all([
          ...urls.map(async (url) => {
            try {
              // `cache: 'force-cache'` 让第二次渲染直接命中内存/磁盘缓存（迭代提速）。
              await fetch(url, { cache: 'force-cache' })
            } catch {
              // 单条失败不阻断：真正的失败留给渲染器报（否则这里会变成一条无上下文的失败）。
            }
          }),
          ...(hasGrain ? [preloadBackgroundImage(GRAIN_TILE_URL)] : []),
        ])
      } finally {
        clearTimeout(timer)
        if (!cancelled) release()
      }
    }
    void run()
    return () => {
      cancelled = true
      clearTimeout(timer)
      release()
    }
    // 依赖素材集合（key）；manifest 其余字段变化不影响预取。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, handle])
}

const TrackBody: React.FC<{ track: CompositionTrack; manifest: CompositionManifest }> = ({ track, manifest }) => {  switch (track.type) {
    case 'video':
      return <VideoClip track={track} />
    case 'image':
      return <ImageClip track={track} />
    case 'textCard':
      return <TextCard track={track} />
    case 'shape':
      return <Shape track={track} />
    case 'audioViz':
      return <AudioViz track={track} />
    case 'chart':
      // A2：source:'timeline' 时由 manifest 真值推导数据（组件本身不接触 manifest）
      return <Chart track={track} timelineData={track.source === 'timeline' ? chartDataFromTimeline(manifest, track) : undefined} />
    case 'caption':
      return <Caption track={track} />
    case 'callout':
      // P3（2026-11-03）：引线标注 —— 锚点 + 引线 + 标签一条轨。
      return <Callout track={track} />
    case 'transition':
      return null
  }
}

/**
 * REQ-036 C4（CV-400）：**组合期锚定解析**（hook）。
 *
 * manifest 无锚字段时零开销原样返回（逐像素同路）；有锚字段时：被锚 caption 轨的
 * 词级 timing 先算（显式 `words` 同步可得；能量谷要等音频解码 —— `useEnvelope` 内部
 * delayRender 闸住首帧拍摄），就绪后经 `applyAnchorResolution` 把锚字段折算成数值
 * startFrame（绝对帧 − 轨道起点，animate/draw/colorShift 都是轨内相对帧口径）。
 *
 * 与 Caption 组件会各自解码同一份音频（2× 短 TTS 解码）—— 换取「解析逻辑不进
 * 组件树」（Caption 不知道 anchor 的存在，渲染顺序零改动）。
 */
function useAnchorResolution(manifest: CompositionManifest): { resolved: CompositionManifest | null; errors: string[] } {
  const refs = anchorRefsOf(manifest.tracks)
  // hooks 稳定性：同一 manifest 的 ref 集合渲染间恒定（models 锚哪些轨是静态声明）。
  const needsEnvelope: CaptionTrack[] = []
  for (const ref of refs) {
    const track = manifest.tracks.find((t) => t.id === ref)
    if (track !== undefined && track.type === 'caption' && !Array.isArray(track.words)) {
      needsEnvelope.push(track)
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- needsEnvelope 随 manifest 派生，长度渲染间稳定
  const envelopes: Array<number[] | null> = needsEnvelope.map((track) => useEnvelope(track.src))
  if (refs.length === 0) return { resolved: manifest, errors: [] }

  const timings = new Map<string, readonly PhraseTiming[]>()
  for (const ref of refs) {
    const track = manifest.tracks.find((t) => t.id === ref)
    if (track === undefined || track.type !== 'caption') continue
    const explicit = explicitWordWindows(track.words, track.text, track.startFrame)
    if (explicit !== null) {
      timings.set(ref, groupWordsByPhrase(track.text, explicit))
      continue
    }
    const envelopeIndex = needsEnvelope.indexOf(track)
    const envelope = envelopeIndex >= 0 ? envelopes[envelopeIndex] ?? null : null
    if (envelope === null) return { resolved: null, errors: [] } // 解码未就绪（delayRender 闸着）或解码失败
    const derived = envelopeWordWindows(envelope, track.text, manifest.meta.fps, track.startFrame)
    if (derived === null) {
      return { resolved: null, errors: [`anchor 无法解析：轨「${ref}」没有可用的词级 timing（无显式 words 且包络推导失败）。`] }
    }
    timings.set(ref, groupWordsByPhrase(track.text, derived))
  }
  const { tracks, errors } = applyAnchorResolution(manifest as unknown as Parameters<typeof applyAnchorResolution>[0], timings)
  if (errors.length > 0) return { resolved: null, errors }
  return { resolved: { ...manifest, tracks: tracks as CompositionTrack[] }, errors: [] }
}

export const StudioComposition: React.FC<{ manifest: CompositionManifest }> = ({ manifest: inputManifest }) => {
  const frame = useCurrentFrame()
  usePrefetchMedia(inputManifest)
  const { resolved, errors: anchorErrors } = useAnchorResolution(inputManifest)
  // fail-fast（REQ §4.3）：ref 轨不存在 / 越界 / 无 src —— 渲染体检硬失败，不静默回退 0 帧
  //（锚错帧的成片 = 时机全错但「渲染成功」，比报错贵得多）。
  if (anchorErrors.length > 0) {
    throwError('CS-USER-ERR', { message: `锚定（anchor）解析失败：${anchorErrors.join('；')}`, detail: 'anchor resolution failed' })
  }
  // 词级 timing 就绪前不进入正式渲染（useEnvelope 的 delayRender 闸住首帧拍摄，
  // 这里只是渲染占位 —— 与预取闸同语义，不产出任何帧）。
  if (resolved === null) {
    return <AbsoluteFill style={{ backgroundColor: inputManifest.meta.backgroundColor ?? '#000' }} />
  }
  const manifest = resolved
  const hasNativeAudio = manifest.tracks.some((track) => track.type === 'video')
  // R1：字体族在这里解析一次，经 context 下发给所有文本节点（缺省＝随包中文字体）。
  const fontStack = fontFamilyStack(resolveFonts(manifest).defaultFamily)
  const look = lookStyles(manifest.meta.look, frame)
  const duckWindows = duckWindowsFromSubtitles(manifest)
  return (
    <FontFamilyContext.Provider value={fontStack}>
      <AbsoluteFill
        style={{
          backgroundColor: manifest.meta.backgroundColor ?? '#000',
          ...(look.filter === null ? {} : { filter: look.filter }),
        }}
      >
        {manifest.tracks.filter(isContentTrack).map((track) => (
          <Sequence key={track.id} from={track.startFrame} durationInFrames={Math.max(1, track.durationInFrames)}>
            {/* P3：分区揭示壳在 TransitionShell 外 —— clip 按轨内容自身坐标系求值。 */}
            <RevealShell reveal={track.reveal} trackDurationInFrames={track.durationInFrames}>
              <TransitionShell override={transitionOverride(frame, trackTransitionWindows(manifest, track.id))}>
                <TrackBody track={track} manifest={manifest} />
              </TransitionShell>
            </RevealShell>
          </Sequence>
        ))}
        {/* 三期 W2-4：暗角。`multiply` 只压暗不自发光，比单独一层黑色 opacity 更像镜头。 */}
        {look.vignetteBackground === null ? null : (
          <AbsoluteFill
            style={{
              background: look.vignetteBackground,
              mixBlendMode: 'multiply',
              pointerEvents: 'none',
            }}
          />
        )}
        {/* 三期 W2-4：颗粒。整数偏移 + 固定 tile ⇒ 逐帧确定、不闪烁。 */}
        {look.grainOpacity <= 0 ? null : (
          <AbsoluteFill
            style={{
              backgroundImage: `url(${GRAIN_TILE_URL})`,
              backgroundRepeat: 'repeat',
              backgroundPosition: `${look.grainOffsetX}px ${look.grainOffsetY}px`,
              opacity: look.grainOpacity,
              mixBlendMode: 'overlay',
              pointerEvents: 'none',
            }}
          />
        )}
        {manifest.audio ? (
          <AudioTrack
            audio={manifest.audio}
            hasNativeAudio={hasNativeAudio}
            durationInFrames={manifest.meta.durationInFrames}
            fps={manifest.meta.fps}
            duckWindows={duckWindows}
            tracks={manifest.tracks}
          />
        ) : null}
      </AbsoluteFill>
    </FontFamilyContext.Provider>
  )
}

export const Root: React.FC = () => (
  <Composition
    id="studio-composition"
    component={StudioComposition}
    // 四个元数据是「注册期缺省值」——会被 calculateMetadata 覆盖，但仍必须给。
    durationInFrames={EMPTY_MANIFEST.meta.durationInFrames}
    fps={EMPTY_MANIFEST.meta.fps}
    width={EMPTY_MANIFEST.meta.width}
    height={EMPTY_MANIFEST.meta.height}
    defaultProps={{ manifest: EMPTY_MANIFEST }}
    calculateMetadata={({ props }) => {
      const { meta } = props.manifest
      return {
        durationInFrames: Math.max(1, Math.round(meta.durationInFrames)),
        fps: meta.fps,
        width: meta.width,
        height: meta.height,
      }
    }}
  />
)
