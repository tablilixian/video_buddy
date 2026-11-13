// @ts-nocheck
import React from 'react'
import { Composition, registerRoot } from 'remotion'
import { StudioComposition } from '../../../src/remotion/components/Root.js'
import manifest from '/Users/wl/Desktop/job/git/playsout/playsoutapi/ops-dashboard/build-5min/chart-acceptance.json'

const Root = () => (
  <Composition
    id="chart-acceptance"
    component={StudioComposition}
    durationInFrames={manifest.meta.durationInFrames}
    fps={manifest.meta.fps}
    width={manifest.meta.width}
    height={manifest.meta.height}
    defaultProps={{ manifest }}
  />
)
registerRoot(Root)
