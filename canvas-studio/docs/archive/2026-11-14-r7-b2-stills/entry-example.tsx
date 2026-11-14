// B2 样例静帧 · bundle 入口（一次性渲染脚本，照 2026-11-13-playsout-5min-scripts 先例归档）。
// spec 在 skills/code-driven-explainer/assets/screen-plan-example.json；
// 编译走 src TS（webpack extensionAlias 直吃 .ts），与 host-tools-spec 同口径。
// @ts-nocheck
import React from 'react'
import { Composition, registerRoot } from 'remotion'
import { StudioComposition } from '../../../src/remotion/components/Root.js'
import { planFromSpec } from '../../../src/remotion/content-spec.js'
import { resolveTheme } from '../../../src/remotion/themes.js'
import spec from '../../../skills/code-driven-explainer/assets/screen-plan-example.json'

const total = Math.round(spec.meta.durationSec * spec.meta.fps)
const plan = planFromSpec(spec, total)
const { theme } = resolveTheme(spec.meta.theme)
const manifest = {
  id: 'comp-screen-plan-example',
  meta: {
    title: spec.meta.title,
    width: 1920,
    height: 1080,
    fps: spec.meta.fps,
    durationInFrames: total,
    backgroundColor: theme.backgroundColor,
    generatedBy: 'spec:content-spec',
  },
  tracks: plan.tracks,
}

const Root = () => (
  <Composition
    id="studio-composition"
    component={StudioComposition}
    durationInFrames={manifest.meta.durationInFrames}
    fps={manifest.meta.fps}
    width={manifest.meta.width}
    height={manifest.meta.height}
    defaultProps={{ manifest }}
  />
)
registerRoot(Root)
