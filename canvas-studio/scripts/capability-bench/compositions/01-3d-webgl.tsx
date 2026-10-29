/**
 * #01 3D / WebGL —— R3F 场景：金属环面自转 + 轨道推近 + 图片/视频贴图（L0，C 级三项之一）。
 *
 * 对标官方：`three-basic` / `three-html`。
 *
 * 这条回答两个此前悬空的问题：
 *   1. web-renderer 默认模式（不开 html-in-canvas）能不能把 <canvas>（WebGL 内容）画进成片？
 *      —— #03 里 WebGL 立方体在全量捕获模式下都没出画（纯紫色填充），默认模式是未知数；
 *   2. @remotion/three 的 useVideoTexture（帧精确 seek）在 CSR 里能不能跑？
 *
 * 全部动画用 useCurrentFrame 纯帧函数驱动（不用 useFrame 的 rAF 循环）⇒ H4 可复现。
 * 相机轨道 = 三角函数；贴图加载用 delayRender 挡首帧（照 #06 模式）。
 */

import React, { useEffect, useState } from 'react'
import { AbsoluteFill, continueRender, delayRender, useCurrentFrame } from 'remotion'
import { ThreeCanvas } from '@remotion/three'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Badge, BenchFrame, FONT_FAMILY, POOL } from './shared.js'

export const meta = {
  id: '01',
  axis: '3d-webgl',
  title: '3D / WebGL（R3F 场景 + 贴图）',
  reference: 'three-basic · three-html',
  durationInFrames: 360, // 12s @30fps：P1 金属 4s → P2 图片贴图 4s → P3 视频贴图 4s
  expect: { videoCodec: 'h264', audioCodec: 'aac', hasAudio: false, minMotion: true },
  stills: [60, 179, 299],
  assets: ['image', 'clip'],
} as const

const PHASE2 = 120
const PHASE3 = 240

/** 相机轨道推近：每帧从 useCurrentFrame 算位姿（确定性）。 */
const CamRig: React.FC = () => {
  const frame = useCurrentFrame()
  const { camera } = useThree()
  const t = frame / 30
  const angle = t * 0.42
  const radius = 6.6 - (frame / 360) * 2.4
  camera.position.set(Math.sin(angle) * radius, 1.0 + Math.sin(t * 0.32) * 0.5, Math.cos(angle) * radius)
  camera.lookAt(0, 0, 0)
  return null
}

/** 图片贴图：TextureLoader 异步加载，delayRender 挡住首帧（同 #06 的解码模式）。 */
function useImageTexture(url: string): THREE.Texture | null {
  const [tex, setTex] = useState<THREE.Texture | null>(null)
  const [handle] = useState(() => delayRender('01: 加载图片贴图'))
  useEffect(() => {
    let alive = true
    new THREE.TextureLoader().load(
      url,
      (t) => {
        if (!alive) return
        t.colorSpace = THREE.SRGBColorSpace
        setTex(t)
        continueRender(handle)
      },
      undefined,
      () => continueRender(handle),
    )
    return () => {
      alive = false
    }
  }, [url, handle])
  return tex
}

const Scene: React.FC<{ imageTex: THREE.Texture | null }> = ({ imageTex }) => {
  const frame = useCurrentFrame()
  const t = frame / 30

  // ⚠️ 降级记录：原设计 P3 用 useVideoTexture 做视频贴图，实测在 web-renderer 下
  // 其内部 <video> 的 loaded 事件永不触发（delayRender 28s 超时，重试同样失败）⇒
  // 按行为契约降级：P3 改图片贴图 + 自发光脉冲，显式标注 degraded。
  const useVideoMap = frame >= PHASE3
  const emissivePulse = useVideoMap ? 0.35 + 0.35 * Math.sin(t * Math.PI * 2 * 0.5) : 0

  return (
    <>
      <color attach="background" args={['#05070d']} />
      <fog attach="fog" args={['#05070d', 8, 16]} />
      <ambientLight intensity={0.32} />
      <directionalLight position={[6, 6, 6]} intensity={2.6} color="#cfe8ff" />
      <pointLight position={[-7, -3, -5]} intensity={110} color="#ff8a5c" />
      <pointLight position={[0, 5, -8]} intensity={70} color="#5ad2ff" />
      <CamRig />
      <mesh rotation={[t * 0.55, t * 0.78, t * 0.11]}>
        <torusKnotGeometry args={[1.28, 0.44, 260, 40]} />
        {/* P2 贴图段降金属度（metal 0.9 无环境贴图时 albedo 不可见 ⇒ 贴图看不出来） */}
        <meshStandardMaterial
          metalness={useVideoMap ? 0.9 : 0.18}
          roughness={useVideoMap ? 0.24 : 0.42}
          map={imageTex}
          color={imageTex ? '#ffffff' : '#8fb8d8'}
          emissive={useVideoMap ? '#5ad2ff' : '#000000'}
          emissiveIntensity={emissivePulse}
          envMapIntensity={1.2}
        />
      </mesh>
      {/* 地面网格：给"轨道推近"一个参照系 */}
      <gridHelper args={[24, 24, '#1d3350', '#122238']} position={[0, -2.4, 0]} />
    </>
  )
}

export const Composition: React.FC = () => {
  const frame = useCurrentFrame()
  const imageTex = useImageTexture(POOL.image)
  const phase = frame >= PHASE3 ? 3 : frame >= PHASE2 ? 2 : 1
  const phaseLabel = phase === 1 ? 'P1 金属材质 · 轨道推近' : phase === 2 ? 'P2 图片贴图' : 'P3 视频贴图 → 降级：自发光脉冲'

  return (
    <BenchFrame title="01 · 3D / WebGL —— R3F 环面 + 贴图三段" footer={`frame ${frame} / 359`}>
      {/* WebGL 画布铺满（这一层能不能进成片 = 本片的第一问） */}
      <AbsoluteFill>
        <ThreeCanvas width={1920} height={1080} style={{ width: '100%', height: '100%' }}>
          <Scene imageTex={imageTex} />
        </ThreeCanvas>
      </AbsoluteFill>

      <div style={{ position: 'absolute', left: 96, top: 150 }}>
        <Badge title="3D · WEBGL" sub={phaseLabel} color="#ffb454" />
      </div>
      <div style={{ position: 'absolute', left: 96, bottom: 150, fontFamily: FONT_FAMILY, fontSize: 24, color: 'rgba(232,238,252,0.8)', maxWidth: 700, lineHeight: 1.5 }}>
        three@0.170 · @react-three/fiber@8.18（peer &lt;19）· @remotion/three@4.0.535
        <br />
        动画 = useCurrentFrame 纯帧函数（相机轨道 / 环面自转）
      </div>
      <div style={{ position: 'absolute', left: 96, right: 96, bottom: 62, height: 8, background: 'rgba(255,255,255,0.14)', borderRadius: 4 }}>
        <div style={{ width: `${(frame / 359) * 100}%`, height: '100%', background: '#ffb454', borderRadius: 4 }} />
      </div>
    </BenchFrame>
  )
}
