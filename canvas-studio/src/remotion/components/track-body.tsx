/**
 * 轨道组件分派（自 `Root.tsx` 外提，2026-11-11 S1-B）。
 *
 * 为什么外提：`group` 轨（3D 容器）的组件也要渲染子轨 —— 子轨分派与顶层完全同一路径。
 * 放在 Root.tsx 里会让 Group.tsx 反向 import Root.tsx（循环依赖）；提到独立文件后
 * Root 与 Group 都只依赖本模块，单向无环。分派逻辑逐字未动。
 */
import type React from 'react'
import type { CompositionManifest, CompositionTrack } from '../manifest.js'
import { chartDataFromTimeline } from '../chart-data.js'
import { AudioViz } from './AudioViz.js'
import { Caption } from './Caption.js'
import { Chart } from './Chart.js'
import { Group } from './Group.js'
import { ImageClip } from './ImageClip.js'
import { Shape } from './Shape.js'
import { TextCard } from './TextCard.js'
import { VideoClip } from './VideoClip.js'
import { Callout } from './Callout.js'

export const TrackBody: React.FC<{ track: CompositionTrack; manifest: CompositionManifest }> = ({ track, manifest }) => {
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
      // A2：source:'timeline' 时由 manifest 真值推导数据（组件本身不接触 manifest）
      return <Chart track={track} timelineData={track.source === 'timeline' ? chartDataFromTimeline(manifest, track) : undefined} />
    case 'caption':
      return <Caption track={track} />
    case 'callout':
      // P3（2026-11-03）：引线标注 —— 锚点 + 引线 + 标签一条轨。
      return <Callout track={track} />
    case 'group':
      // ≥95% 对齐 S1-B：3D 容器轨 —— 子轨包进一个 div，容器统一做 perspective/rotateY。
      return <Group track={track} manifest={manifest} />
    case 'transition':
      return null
  }
}
