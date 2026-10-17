/**
 * REQ-034 · B2 组件入口：注册 Remotion 根（Studio 预览用）+ 导出合成与组件。
 *
 * 路线 B（CSR）下，`@remotion/web-renderer` 的 `renderMediaOnWeb` 直接吃
 * `StudioComposition` 组件（不必走 bundle）；`registerRoot` 只服务本地 Studio 预览。
 */
import { registerRoot } from 'remotion'
import { Root, StudioComposition, EMPTY_MANIFEST } from './Root.js'
import { AudioTrack } from './AudioTrack.js'
import { AudioViz } from './AudioViz.js'
import { VideoClip } from './VideoClip.js'
import { ImageClip } from './ImageClip.js'
import { TextCard } from './TextCard.js'
import { Shape } from './Shape.js'
import { TransitionShell } from './Transition.js'

registerRoot(Root)

export {
  Root, StudioComposition, EMPTY_MANIFEST,
  AudioTrack, AudioViz, VideoClip, ImageClip, TextCard, Shape, TransitionShell,
}
