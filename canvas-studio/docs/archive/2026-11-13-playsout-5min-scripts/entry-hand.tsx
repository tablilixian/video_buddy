// @ts-nocheck
import React from 'react'
import { Composition, registerRoot } from 'remotion'
import { StudioComposition } from '../../../src/remotion/components/Root.js'
import manifest from '/tmp/hand-nosfx.json'

const Root = () => (
  <Composition
    id="hand-compare"
    component={StudioComposition}
    durationInFrames={manifest.meta.durationInFrames}
    fps={manifest.meta.fps}
    width={manifest.meta.width}
    height={manifest.meta.height}
    defaultProps={{ manifest }}
  />
)
registerRoot(Root)
