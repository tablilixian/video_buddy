/**
 * REQ-034 · B2 组件根：`<Composition id="studio-composition">` + `calculateMetadata`
 * 从 `inputProps.manifest.meta` 动态取 `durationInFrames / fps / width / height`（§7.3）。
 *
 * 路线 B（CSR）约束：层叠一律靠 DOM 顺序（不用 `z-index`）；`transition` 轨由
 * `transitionOverride`（`../timing.js` 纯函数）折算成各轨的可见性覆盖。
 */
import type React from 'react'
import { AbsoluteFill, Composition, Sequence, useCurrentFrame } from 'remotion'
import type { CompositionManifest, CompositionTrack } from '../manifest.js'
import { trackTransitionWindows, transitionOverride } from '../timing.js'
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

function isContentTrack(track: CompositionTrack): boolean {
  return track.type !== 'transition'
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
    case 'transition':
      return null
  }
}

export const StudioComposition: React.FC<{ manifest: CompositionManifest }> = ({ manifest }) => {
  const frame = useCurrentFrame()
  return (
    <AbsoluteFill style={{ backgroundColor: manifest.meta.backgroundColor ?? '#000' }}>
      {manifest.tracks.filter(isContentTrack).map((track) => (
        <Sequence key={track.id} from={track.startFrame} durationInFrames={Math.max(1, track.durationInFrames)}>
          <TransitionShell override={transitionOverride(frame, trackTransitionWindows(manifest, track.id))}>
            <TrackBody track={track} />
          </TransitionShell>
        </Sequence>
      ))}
    </AbsoluteFill>
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
