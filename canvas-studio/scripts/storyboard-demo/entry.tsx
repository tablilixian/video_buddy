/**
 * 分镜审阅闸门 · 推演用 bundle 入口
 *
 * 用**产品真实组件** `StudioComposition` 渲染，不是另画一套示意：
 * manifest 由 spec 经 `scaffoldFromSpec` 编译而来，和真机出片是同一份东西。
 */
import React from 'react'
import { Composition, registerRoot } from 'remotion'
import { StudioComposition } from '../../src/remotion/components/Root.js'
import manifestJson from './build/manifest.json'

const manifest = manifestJson as never

const Root: React.FC = () => {
  const meta = (manifestJson as { meta: { durationInFrames: number; fps: number; width: number; height: number } }).meta
  return (
    <Composition
      id="moon"
      component={StudioComposition as never}
      durationInFrames={meta.durationInFrames}
      fps={meta.fps}
      width={meta.width}
      height={meta.height}
      defaultProps={{ manifest }}
    />
  )
}

registerRoot(Root)
