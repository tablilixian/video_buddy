/**
 * 段缓存根基守卫（2026-11-27 审查 P1-1 / P1-2 / P2-4）。
 *
 * 三条裂缝都属「不报错、只表现为用户最恨的症状」：
 * - **P1-1**：被跳过的 override（尤其「id 与 manifest 既有轨同名」这个确定场景）的轨 id
 *   混进剔除名单 ⇒ 渲后 `build/manifest.json` 快照把**合法 spec 轨**误删 ⇒
 *   「卡上这一段其实是隔壁那一段」的静默错位复发；
 * - **P1-2**：`rerender_segment` 跳过变换管线 ⇒ 同一手工轨两条路径算出两个段 hash
 *   ⇒ 互不命中、还互删对方缓存；素材类手工轨单段重渲渲出缺图的段；
 * - **P2-4**：`segmentHash` payload 用 `JSON.stringify` ⇒ 轨对象键序抖动让全片 hash
 *   一起变（F2 归一化轨序要消灭的症状换个形态回来）。
 *
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { withoutOverrideTracks, SEGMENT_OVERRIDES_VERSION, SEGMENT_OVERRIDES_DIR } from '../lib/segment-overrides.js'
import { mergeProjectOverrides } from '../lib/segment-overrides-io.js'
import { planSegmentTable } from '../lib/segment-table.js'
import { manifestGlobalsFingerprint, segmentHash } from '../lib/shot-cache.js'
import { prepareRenderManifest } from '../lib/prepare-render-manifest.js'

const FPS = 30

function textCard(id, startFrame, durationInFrames, text = id) {
  return { id, type: 'textCard', variant: 'subtitle', startFrame, durationInFrames, text }
}

function imageTrack(id, startFrame, durationInFrames, src) {
  // box 是中心点语义（x/y 为中心、百分比）——夹具本身必须合法。
  return { id, type: 'image', startFrame, durationInFrames, src, box: { x: 50, y: 50, w: 40, h: 40 } }
}

/** 两段片：s1 = [0,200)、s2 = [200,400)；`meta.segments` 与 spec 都整表对齐。 */
function buildManifest(tracks) {
  return {
    id: 'm1',
    meta: {
      title: 't', fps: FPS, durationInFrames: 400, width: 1920, height: 1080, backgroundColor: '#000',
      segments: [
        { id: 's1', startFrame: 0, frames: 200 },
        { id: 's2', startFrame: 200, frames: 200 },
      ],
    },
    tracks,
  }
}

const SPEC = {
  meta: { fps: FPS, durationSec: 400 / FPS },
  sections: [{ id: 's1', durationSec: 200 / FPS }, { id: 's2', durationSec: 200 / FPS }],
}

function tmpProject() {
  const dir = mkdtempSync(join(tmpdir(), 'cs-pipeline-'))
  mkdirSync(join(dir, 'build'), { recursive: true })
  return dir
}

function writeOverrideFile(projectDir, fileName, doc) {
  const dir = join(projectDir, SEGMENT_OVERRIDES_DIR)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, fileName), JSON.stringify(doc), 'utf8')
}

function hashesOf(manifest) {
  const plan = planSegmentTable({ manifest, spec: SPEC })
  assert.notEqual(plan, null, '夹具必须能切出段')
  const globals = manifestGlobalsFingerprint(manifest)
  return plan.segments.map((segment) => segmentHash(segment, 'standard', globals))
}

// ─────────────────── P1-1：skip 的 override 不许进剔除名单 ───────────────────

test('P1-1：撞名被跳过的 override 不剔轨 —— 同名合法 spec 轮在快照里必须活着', () => {
  const projectDir = tmpProject()
  try {
    // 盘上 manifest 里有一条**合法**的 `hi-1`（spec 产出）；override 又想新增 `hi-1`
    // ⇒ 撞名被跳过（F6 只做新增不覆盖）。此时剔除名单绝不能含 `hi-1`。
    const manifest = buildManifest([textCard('V2', 0, 200), textCard('hi-1', 200, 200)])
    // 另一份合法 override（s1 新增 hi-2）——它已并入，应当被剔。
    writeOverrideFile(projectDir, 'spec-s1.json', {
      version: SEGMENT_OVERRIDES_VERSION, ref: 'spec:s1', anchor: { startFrame: 0, frames: 200 }, updatedAt: 1,
      tracks: [{ id: 'hi-2', type: 'shape', shape: 'circle', color: '#fff', startFrame: 50, durationInFrames: 60 }],
    })
    writeOverrideFile(projectDir, 'spec-s2.json', {
      version: SEGMENT_OVERRIDES_VERSION, ref: 'spec:s2', anchor: { startFrame: 200, frames: 200 }, updatedAt: 1,
      tracks: [{ id: 'hi-1', type: 'shape', shape: 'circle', color: '#fff', startFrame: 210, durationInFrames: 60 }],
    })

    const merged = mergeProjectOverrides({ projectDir, manifest, spec: SPEC })
    assert.deepEqual([...merged.trackIds].sort(), ['hi-2'],
      '剔除名单只含**已并入**的 hi-2；hi-1 那份被跳过，一个字都不能进')

    const snapshot = withoutOverrideTracks(merged.manifest, merged.trackIds)
    const ids = snapshot.tracks.map((track) => track.id)
    assert.ok(ids.includes('hi-1'), '合法 spec 轨 hi-1 必须在快照里活着（此前会被误删 ⇒ 卡位错乱）')
    assert.ok(!ids.includes('hi-2'), '已并入的手工轨 hi-2 必须剔掉（否则成僵尸轨）')
    assert.ok(merged.skipped.some((entry) => entry.ref === 'spec:s2'), '撞名那份要有跳过原因')
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
  }
})

test('P1-1：全部 override 都并入时，轨 id 全进剔除名单（原语义不回退）', () => {
  const projectDir = tmpProject()
  try {
    const manifest = buildManifest([textCard('V2', 0, 200), textCard('V3', 200, 200)])
    writeOverrideFile(projectDir, 'spec-s1.json', {
      version: SEGMENT_OVERRIDES_VERSION, ref: 'spec:s1', anchor: { startFrame: 0, frames: 200 }, updatedAt: 1,
      tracks: [{ id: 'hi-2', type: 'shape', shape: 'circle', color: '#fff', startFrame: 50, durationInFrames: 60 }],
    })
    const merged = mergeProjectOverrides({ projectDir, manifest, spec: SPEC })
    assert.deepEqual([...merged.trackIds], ['hi-2'])
    const snapshot = withoutOverrideTracks(merged.manifest, merged.trackIds)
    assert.deepEqual(snapshot.tracks.map((track) => track.id), ['V2', 'V3'])
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
  }
})

// ─────────────────── P2-4：键序抖动不许换 hash ───────────────────

test('P2-4：轨对象键序不同 ⇒ 段 hash 必须相同（模型重写 manifest 不许触发全片重渲）', () => {
  const a = buildManifest([
    textCard('V2', 0, 200),
    { id: 'hi', type: 'shape', shape: 'circle', color: '#fff', startFrame: 210, durationInFrames: 60 },
  ])
  // 同一内容、键序打乱（模拟模型重写 manifest 时字段顺序变了）。
  const b = buildManifest([
    textCard('V2', 0, 200),
    { color: '#fff', durationInFrames: 60, startFrame: 210, shape: 'circle', type: 'shape', id: 'hi' },
  ])
  assert.deepEqual(hashesOf(a), hashesOf(b), '键序不是内容 —— hash 必须一致')
  // 内容真变了仍然要换 hash（别把守卫做成永不变）。
  const c = buildManifest([
    textCard('V2', 0, 200),
    { id: 'hi', type: 'shape', shape: 'circle', color: '#f00', startFrame: 210, durationInFrames: 60 },
  ])
  assert.notEqual(hashesOf(a)[1], hashesOf(c)[1], '颜色变了就是内容变了')
})

// ─────────────────── P1-2：变换管线幂等 + 两路径接线 ───────────────────

// 1x1 透明 PNG（image 轨的 alpha 探测只读文件头；这里只需文件真实存在且是 PNG）。
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

test('P1-2：prepareRenderManifest 幂等 —— 已变换的快照再跑一遍不改轨（双路径同 hash）', async () => {
  const projectDir = tmpProject()
  const assetsDir = join(projectDir, 'assets')
  mkdirSync(assetsDir, { recursive: true })
  writeFileSync(join(assetsDir, 'hero.png'), TINY_PNG)
  try {
    // 手工轨引用**本地绝对路径**素材 —— 此前 rerender 路径不物化 ⇒ 浏览器把
    // /Users/... 当 URL ⇒ 重渲段缺图。管线必须把它变成同源 URL。
    const manifest = buildManifest([
      textCard('V2', 0, 200),
      imageTrack('hi-img', 210, 60, join(assetsDir, 'hero.png')),
    ])
    const first = await prepareRenderManifest({ manifest, assetsDir, projectId: 'p-test' })
    const src = first.manifest.tracks.find((track) => track.id === 'hi-img').src
    assert.match(String(src), /^\/canvas-studio\/assets\//, `本地绝对路径必须物化成同源 URL，实际：${String(src)}`)

    const second = await prepareRenderManifest({ manifest: first.manifest, assetsDir, projectId: 'p-test' })
    assert.deepEqual(second.manifest.tracks, first.manifest.tracks, '幂等：二次变换不许动轨')
    assert.deepEqual(hashesOf(second.manifest), hashesOf(first.manifest), '幂等 ⇒ 双路径段 hash 相同')
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
  }
})

test('P1-2 接线守卫：两条渲染路径都必须走 prepareRenderManifest（剥注释源码断言）', () => {
  const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
  // 剥注释再读 —— 注释里的示例会把接线断言喂饱（本仓接线守卫的既定手法）。
  const sourceOf = (relative) => readFileSync(join(srcDir, relative), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
  assert.match(sourceOf('host-tools.ts'), /prepareRenderManifest\(\s*\{/,
    'render_composition 必须走共用变换管线')
  assert.match(sourceOf('host-tools-rerender.ts'), /prepareRenderManifest\(\s*\{/,
    'rerender_segment 必须走同一变换管线 —— 跳过变换 = 段 hash 分裂（P1-2）')
})
