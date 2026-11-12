#!/usr/bin/env node
/**
 * playsout 复刻 · 单镜预览台（迭代用）。
 *
 * 从全片 manifest 里裁出**一个镜头**（按帧区间），时间轴归零，写成独立 manifest，
 * 供取证台快速渲染（150 帧 ≈ 4s，不用等全片 49s）。
 *
 * 用法：node scripts/playsout-replica/preview-shot.mjs open
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SHOTS } from './lib/theme.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')

const FULL = join(REPO, 'build', 'playsout', 'manifest.json')
const OUT_DIR = join(REPO, 'build', 'playsout')

const shotId = process.argv[2]
if (shotId === undefined) {
  console.error('用法：node scripts/playsout-replica/preview-shot.mjs <shotId>')
  console.error(`可选镜头：${SHOTS.map((s) => s.id).join(', ')}`)
  process.exit(1)
}
const shot = SHOTS.find((s) => s.id === shotId)
if (shot === undefined) {
  console.error(`未知镜头：${shotId}`)
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(FULL, 'utf8'))
const from = shot.from
const to = shot.from + shot.duration

/** 保留窗口与镜头相交的轨，并把 startFrame 归零。 */
function clip(track, base) {
  const start = Math.max(0, track.startFrame - base)
  const end = Math.min(track.startFrame + track.durationInFrames, to) - base
  const duration = end - start
  if (duration <= 0) return null
  const next = { ...track, startFrame: start, durationInFrames: duration }
  // 轨内相对帧的动画起点要跟着挪（animate / reveal 的 startFrame 是轨内相对）
  if (Array.isArray(track.animate)) {
    next.animate = track.animate
      .map((seg) => ({ ...seg, startFrame: Math.max(0, seg.startFrame - start) }))
      .filter((seg) => seg.startFrame < duration)
  }
  if (track.reveal && typeof track.reveal.startFrame === 'number') {
    next.reveal = { ...track.reveal, startFrame: Math.max(0, track.reveal.startFrame - start) }
  }
  if (track.type === 'group') {
    const children = track.children.map((c) => clip(c, 0)).filter((c) => c !== null)
    if (children.length === 0) return null
    next.children = children
  }
  return next
}

const tracks = manifest.tracks.map((t) => clip(t, from)).filter((t) => t !== null)
const preview = {
  ...manifest,
  id: `playsout-preview-${shotId}`,
  meta: { ...manifest.meta, title: `PlaysOut · ${shotId} 预览`, durationInFrames: shot.duration },
  tracks,
  audio: manifest.audio === undefined
    ? undefined
    : {
      ...manifest.audio,
      sfx: (manifest.audio.sfx ?? []).filter((s) => typeof s.startFrame !== 'number' || (s.startFrame >= from && s.startFrame < to))
        .map((s) => ({ ...s, startFrame: Math.max(0, (s.startFrame ?? 0) - from) })),
    },
}

mkdirSync(OUT_DIR, { recursive: true })
const out = join(OUT_DIR, `preview-${shotId}.json`)
writeFileSync(out, `${JSON.stringify(preview, null, 2)}\n`, 'utf8')
console.log(`[preview] ${shotId}: ${tracks.length} 轨 / ${shot.duration} 帧 → ${out}`)
