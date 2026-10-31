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
import type { CompositionManifest, CompositionTrack } from '../manifest.js'
import { duckWindowsFromSubtitles, lookStyles, trackTransitionWindows, transitionOverride } from '../timing.js'
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

const TrackBody: React.FC<{ track: CompositionTrack }> = ({ track }) => {
  switch (track.type) {
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
      return <Chart track={track} />
    case 'caption':
      return <Caption track={track} />
    case 'transition':
      return null
  }
}

export const StudioComposition: React.FC<{ manifest: CompositionManifest }> = ({ manifest }) => {
  const frame = useCurrentFrame()
  usePrefetchMedia(manifest)
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
            <TransitionShell override={transitionOverride(frame, trackTransitionWindows(manifest, track.id))}>
              <TrackBody track={track} />
            </TransitionShell>
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
