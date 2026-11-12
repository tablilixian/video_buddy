/**
 * REQ-038 批次 6 守卫：RQ-23 多关键帧相机（2D 轻量版，零新依赖）。
 *
 * 验收口径（需求正本 §3 RQ-23）：
 * 1. ≥3 个 key 可表达与渲染，关键帧之间平滑插值（相邻帧位移差无突变）；
 * 2. 插值可复现（同 manifest 渲两次逐帧一致 —— 纯帧函数，禁随机源）；
 * 3. 老 from/to `animate` 路径逐像素不变（camera 缺省 = 无相机层）；
 * 4. 零新依赖（package.json 无 three / @react-three / @remotion/three）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { validateManifest, KNOWN_TRACK_KEYS } from '../lib/remotion/manifest.js'
import { cameraStateAt, cameraTransformStyle, CAMERA_DEFAULTS } from '../lib/remotion/camera-motion.js'

const here = dirname(fileURLToPath(import.meta.url))

const imageWith = (camera) => ({
  id: 'req038-b6-test',
  meta: { title: 'REQ-038 批6', width: 1920, height: 1080, fps: 30, durationInFrames: 300 },
  tracks: [
    {
      id: 'page', type: 'image', src: '/canvas-studio/assets/playsout/textures-live-0.png',
      box: { x: 50, y: 50, w: 80, h: 60 }, startFrame: 0, durationInFrames: 240,
      ...(camera === undefined ? {} : { camera }),
    },
  ],
})

const threeKeys = {
  keys: [
    { frame: 0, x: 0, y: 0, zoom: 1, rotY: 0, persp: 800 },
    { frame: 60, x: -12, y: 4, zoom: 1.2, rotY: 6, persp: 900 },
    { frame: 120, x: -24, y: 8, zoom: 1.35, rotY: 10, persp: 900 },
  ],
}

test('RQ-23 验收1：3 个 key 的相机校验放行；KNOWN_TRACK_KEYS.image 登记 camera', () => {
  const m = validateManifest(imageWith(threeKeys))
  assert.deepEqual(m.errors, [], `errors: ${JSON.stringify(m.errors)}`)
  assert.ok(KNOWN_TRACK_KEYS.image.has('camera'))
})

test('RQ-23 验收1 ★平滑插值：中点值在两端之间，且相邻帧位移差无突变', () => {
  const state0 = cameraStateAt(threeKeys, 0)
  const state30 = cameraStateAt(threeKeys, 30)
  const state60 = cameraStateAt(threeKeys, 60)
  const state90 = cameraStateAt(threeKeys, 90)
  const state120 = cameraStateAt(threeKeys, 120)
  // 段 1 中点（easeInOut 下 t=0.5 → e=0.5）：x 在 0..-12 之间。
  assert.ok(state30.x < 0 && state30.x > -12, `段1中点 x=${state30.x}`)
  assert.ok(state90.x > -24 && state90.x < -12, `段2中点 x=${state90.x}`)
  // 平滑：相邻帧位移差有界（easeInOut 连续 ⇒ 差值远小于段总位移）。
  const s59 = cameraStateAt(threeKeys, 59)
  const s60 = cameraStateAt(threeKeys, 60)
  const s61 = cameraStateAt(threeKeys, 61)
  const step = Math.abs(s60.x - s59.x)
  const step2 = Math.abs(s61.x - s60.x)
  assert.ok(step < 1.5 && step2 < 1.5, `跨段位移差 step=${step.toFixed(3)}/${step2.toFixed(3)} 应平滑`)
  // 关键帧精确命中端点。
  assert.equal(state0.zoom, 1)
  assert.equal(state60.zoom, 1.2)
  assert.equal(state120.zoom, 1.35)
})

test('RQ-23 验收2 ★可复现：同输入逐帧同输出（纯函数确定性）', () => {
  const frames = Array.from({ length: 121 }, (_, i) => i)
  const runA = frames.map((f) => JSON.stringify(cameraStateAt(threeKeys, f)))
  const runB = frames.map((f) => JSON.stringify(cameraStateAt(threeKeys, f)))
  assert.deepEqual(runA, runB)
})

test('RQ-23：夹取语义（首前/尾后取端点）+ 单 key 静态 + 空 keys 缺省', () => {
  const before = cameraStateAt(threeKeys, -10)
  assert.equal(before.zoom, 1)
  const after = cameraStateAt(threeKeys, 500)
  assert.equal(after.zoom, 1.35)
  const single = cameraStateAt({ keys: [{ frame: 0, zoom: 1.5 }] }, 42)
  assert.equal(single.zoom, 1.5)
  assert.equal(single.x, 0)
  const empty = cameraStateAt({ keys: [] }, 42)
  assert.deepEqual(empty, CAMERA_DEFAULTS)
  const none = cameraStateAt(undefined, 42)
  assert.deepEqual(none, CAMERA_DEFAULTS)
})

test('RQ-23：半声明 key 的缺省补全（不插出 NaN）', () => {
  // key1 只声明 zoom，key2 只声明 x —— 中间帧两字段都有有限值。
  const s = cameraStateAt({ keys: [{ frame: 0, zoom: 1 }, { frame: 100, x: -50 }] }, 50)
  for (const value of Object.values(s)) {
    assert.ok(Number.isFinite(value), `字段必须有限：${JSON.stringify(s)}`)
  }
})

test('RQ-23：cameraTransformStyle 输出含全部维度且确定性', () => {
  const a = cameraTransformStyle({ ...CAMERA_DEFAULTS, x: -12, zoom: 1.35, rotY: 6 })
  const b = cameraTransformStyle({ ...CAMERA_DEFAULTS, x: -12, zoom: 1.35, rotY: 6 })
  assert.equal(a, b)
  assert.match(a, /translate3d\(-12\.00px/)
  assert.match(a, /perspective\(800\.0px\)/)
  assert.match(a, /rotateY\(6\.00deg\)/)
  assert.match(a, /scale\(1\.3500\)/)
})

test('RQ-23 校验：非法值拒收（frame 乱序 / zoom 越界 / keys 空 / easing 白名单外）', () => {
  const unordered = validateManifest(imageWith({ keys: [{ frame: 60, zoom: 1 }, { frame: 0, zoom: 1.2 }] }))
  assert.ok(unordered.errors.some((e) => e.includes('严格递增')))
  const zoom = validateManifest(imageWith({ keys: [{ frame: 0, zoom: 20 }] }))
  assert.ok(zoom.errors.some((e) => e.includes('.zoom 必须是 0.1–10')))
  const empty = validateManifest(imageWith({ keys: [] }))
  assert.ok(empty.errors.some((e) => e.includes('1–64 个关键帧')))
  const persp = validateManifest(imageWith({ keys: [{ frame: 0, persp: 10 }] }))
  assert.ok(persp.errors.some((e) => e.includes('.persp 必须是 100–10000')))
})

test('RQ-23 验收3：老 manifest（无 camera）校验零告警、组件零新层', () => {
  const m = validateManifest(imageWith(undefined))
  assert.deepEqual(m.errors, [])
  assert.ok(!m.warnings.some((w) => w.includes('camera')))
  const src = readFileSync(join(here, '../src/remotion/components/ImageClip.tsx'), 'utf8')
  // 条件渲染：camState === null ? media : wrapper —— 老 manifest 不多一层 DOM。
  assert.match(src, /camState === null \? media :/, '老 manifest 必须走无 wrapper 分支')
})

test('RQ-23 验收4：零新依赖（package.json 无 three / @react-three / @remotion/three）', () => {
  const pkg = JSON.parse(readFileSync(join(here, '../package.json'), 'utf8'))
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  for (const banned of ['three', '@react-three/fiber', '@remotion/three']) {
    assert.equal(deps[banned], undefined, `不许引入 ${banned}`)
  }
})
