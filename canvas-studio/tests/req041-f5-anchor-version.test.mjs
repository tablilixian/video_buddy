/**
 * REQ-041 · F5（版本号差一档）+ 轨段术语去二义 —— 守卫。
 *
 * 真机事故（2026-11-25，两轮都复发）：
 *
 *   deliver/card.json  version.anchorVersion = 7
 *   build/versions/v8.json                    ← 同一秒落盘的快照
 *
 * 根因：交付卡取的是调用方**写锚点之前**读到的状态（`versions.at(-1)`），而锚点是在
 * 交付卡之后才落的 ⇒ 永远差一档。修法有两层：
 * 1. `writeDeliverable` 直接从 `build/versions/` 读最新版号（本文件守这条）；
 * 2. 调用点把锚点落盘提到交付卡之前（`host-tools.ts` render_composition）。
 *
 * 另一条是术语：漂移回执原先写「段边界相对 v1 变了（33 段 → 26 段）」，而「段」在本
 * 项目里已经指分镜段（s1…sN）与段产物（seg-*.mp4）—— 每轮都要模型额外解释一次。
 * 现在统一叫「轨段」，并在同一句里点名它不是另外两个。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeDeliverable } from '../lib/deliverable.js'
import { currentAnchorVersion, segmentDriftNote, writeRenderAnchor } from '../lib/render-anchor.js'

/** 临时项目：assets/<file> 有一份假成片，deliver/ 由 writeDeliverable 自己建。 */
function withProject(run) {
  const root = mkdtempSync(join(tmpdir(), 'cs-req041-f5-'))
  try {
    const projectDir = join(root, 'p1')
    const assetsDir = join(projectDir, 'assets')
    mkdirSync(assetsDir, { recursive: true })
    const sourceFile = join(assetsDir, 'final.mp4')
    writeFileSync(sourceFile, 'fake-mp4')
    run({ projectDir, sourceFile })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/** 造 N 版快照（只写文件，够 `currentAnchorVersion` 读）。 */
function seedVersions(projectDir, versions) {
  const dir = join(projectDir, 'build', 'versions')
  mkdirSync(dir, { recursive: true })
  for (const version of versions) writeFileSync(join(dir, `v${String(version)}.json`), '{}')
}

const deliverInput = (projectDir, sourceFile, extra = {}) => ({
  projectDir,
  sourceFile,
  url: '/canvas-studio/assets/p1/final.mp4',
  assetFile: 'final.mp4',
  nodeId: null,
  durationSec: 80.02,
  fps: 30,
  quality: 'high',
  manifestHash: 'deadbeefdeadbeef',
  anchorVersion: null,
  targetDurationSec: 60,
  openIssues: '（无）',
  now: 1_760_000_000_000,
  ...extra,
})

const readCard = (projectDir) => JSON.parse(readFileSync(join(projectDir, 'deliver', 'card.json'), 'utf8'))

test('F5：交付卡版本号取磁盘最新快照，不信调用方手里的旧值（真机 v7 vs v8）', () => {
  withProject(({ projectDir, sourceFile }) => {
    seedVersions(projectDir, [7, 8])
    writeDeliverable(deliverInput(projectDir, sourceFile, { anchorVersion: 7 }))
    assert.equal(readCard(projectDir).version.anchorVersion, 8, '同一秒落的是 v8，卡就必须写 v8')
  })
})

test('F5：没有 versions/ 目录时回落到入参（老项目 / 首次交付）', () => {
  withProject(({ projectDir, sourceFile }) => {
    writeDeliverable(deliverInput(projectDir, sourceFile, { anchorVersion: 3 }))
    assert.equal(readCard(projectDir).version.anchorVersion, 3)
  })
})

test('F5：versions/ 为空且入参为 null ⇒ 卡里是 null（不编一个版本号）', () => {
  withProject(({ projectDir, sourceFile }) => {
    mkdirSync(join(projectDir, 'build', 'versions'), { recursive: true })
    writeDeliverable(deliverInput(projectDir, sourceFile, { anchorVersion: null }))
    assert.equal(readCard(projectDir).version.anchorVersion, null)
  })
})

test('F5：真实写入顺序（先锚点后交付卡）⇒ 卡与快照同号', () => {
  withProject(({ projectDir, sourceFile }) => {
    const manifest = {
      meta: { title: 't', width: 1280, height: 720, fps: 30, durationInFrames: 2400, backgroundColor: '#000' },
      tracks: [],
    }
    const written = writeRenderAnchor({ projectDir, manifest, quality: 'high', durationSec: 80.02, trackCount: 0 })
    assert.equal(currentAnchorVersion(projectDir), written.version)
    writeDeliverable(deliverInput(projectDir, sourceFile, { anchorVersion: written.version - 1 }))
    assert.equal(readCard(projectDir).version.anchorVersion, written.version, '顺序对了就不会再差一档')
  })
})

test('F5：轨段漂移文案必须与「分镜段 / 段产物」区分开', () => {
  withProject(({ projectDir }) => {
    const manifest = (windows) => ({
      meta: { title: 't', width: 1280, height: 720, fps: 30, durationInFrames: 600, backgroundColor: '#000' },
      tracks: windows.map(([startFrame, durationInFrames], index) => ({
        id: `V${String(index + 2)}`,
        // `segmentsOf` 只认 caption / textCard 的帧窗（元素轨不算「轨段」）
        type: 'caption',
        startFrame,
        durationInFrames,
      })),
    })
    writeRenderAnchor({ projectDir, manifest: manifest([[0, 120]]), quality: 'draft', durationSec: 4, trackCount: 1 })
    // 只改时长不算「边界变化」（口径是「段的起点身份」）⇒ 这里必须挪起点才出文案。
    const note = segmentDriftNote(projectDir, manifest([[40, 200]]))
    assert.match(note, /轨段/, '术语要用「轨段」')
    assert.match(note, /不是分镜段、也不是段产物/, '同一句里必须点名它不是另外两个「段」')
    assert.match(note, /\d+ 个轨段 → \d+ 个轨段/, '计数也要带量词')
  })
})
