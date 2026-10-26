/**
 * 会话效率优化 2026-10-26（OPT-2）：`box` 区域声明的校验层单测（反向变异靶）。
 *
 * 背景：session.v4 复盘发现模型用 transform 心算分屏布局，错误要等一次真实渲染
 * （分钟级）才暴露。`box`（0–100 画布百分比、x/y 是区域**中心**，与 transform.x/y
 * 同域）让模型声明意图、renderer 算几何；校验层 fail-closed 把错误拦在秒级。
 *
 * 每条规则一个独立 test —— 删掉 manifest.ts 里任一条规则，对应 test 必须变红
 *（铁律：守卫必须能反向变红）。shape 轫**完全豁免**新校验（存量合法写法，
 * 见 manifest.ts 校验区注释），这里同时钉住豁免面本身。
 *
 * 直连 Host tsc 编译产物 lib/remotion/manifest.js（零 Remotion 依赖）。
 * 定向跑：node --test tests/remotion-box-region.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateManifest } from '../lib/remotion/manifest.js'

/** 一份合法基线（与 manifest.test.mjs 同构；video 轨素材 id = 画布节点 id）。 */
function baseManifest() {
  return {
    id: 'comp-1',
    meta: { title: '分屏讲解', width: 1280, height: 720, fps: 30, durationInFrames: 300 },
    tracks: [
      { id: 'node-vid', type: 'video', src: '/canvas-studio/assets/p1/clip.mp4', startFrame: 0, durationInFrames: 300 },
    ],
    audio: {},
  }
}

/** 契约告警过滤（lint 建议不计，与 manifest.test.mjs 同口径）。 */
function contractWarnings(result) {
  return result.warnings.filter((warning) => !warning.startsWith('[编排体检 '))
}

function firstError(result) {
  return result.errors[0] ?? ''
}

test('合法分屏：video 右半区 box 通过且无契约告警', () => {
  const m = baseManifest()
  m.tracks[0].box = { x: 71, y: 50, w: 58, h: 100 }
  const result = validateManifest(m)
  assert.equal(result.ok, true, result.errors.join('；'))
  assert.deepEqual(contractWarnings(result), [], result.warnings.join('；'))
})

test('image / textCard 轨的 box 同样通过（三类新轨生效面）', () => {
  const m = baseManifest()
  m.tracks[0] = { id: 'node-img', type: 'image', src: '/canvas-studio/assets/p1/a.png', startFrame: 0, durationInFrames: 300, fit: 'cover', box: { x: 25, y: 50, w: 50, h: 100 } }
  const r1 = validateManifest(m)
  assert.equal(r1.ok, true, r1.errors.join('；'))

  const m2 = baseManifest()
  m2.tracks[0] = { id: 'tc0', type: 'textCard', variant: 'title', text: '标题', startFrame: 0, durationInFrames: 300, box: { x: 50, y: 20, w: 80, h: 24 } }
  const r2 = validateManifest(m2)
  assert.equal(r2.ok, true, r2.errors.join('；'))
})

test('规则·出画布（水平）：区域 [42,100] 之外 → 拒收且错误带修正指引', () => {
  const m = baseManifest()
  m.tracks[0].box = { x: 90, y: 50, w: 58, h: 100 } // [61, 119]
  const result = validateManifest(m)
  assert.equal(result.ok, false, '出画布 box 必须拒收')
  const err = firstError(result)
  assert.ok(err.includes('出画布'), `错误应点出画布：${err}`)
  assert.ok(err.includes('缩小 w'), `错误应给修正指引：${err}`)
  assert.ok(err.includes('右半区示例'), `错误应带可抄示例：${err}`)
})

test('规则·出画布（垂直）：h 超界 → 拒收', () => {
  const m = baseManifest()
  m.tracks[0].box = { x: 50, y: 90, w: 50, h: 100 } // [40, 140]
  const result = validateManifest(m)
  assert.equal(result.ok, false)
  assert.ok(firstError(result).includes('垂直方向出画布'), firstError(result))
})

test('规则·单位（0–1 比例值）：w=0.58 被点名纠偏', () => {
  const m = baseManifest()
  m.tracks[0].box = { x: 50, y: 50, w: 0.58, h: 100 }
  const result = validateManifest(m)
  assert.equal(result.ok, false, '比例值 0.58 必须拒收（应为 58）')
  const err = firstError(result)
  assert.ok(err.includes('疑似 0–1 比例值'), `错误应点名单位错误：${err}`)
  assert.ok(err.includes('不是 0.58'), `错误应给出正确写法：${err}`)
})

test('规则·单位（0–1 比例值）：h=1（1% 高）同样拒收', () => {
  const m = baseManifest()
  m.tracks[0].box = { x: 50, y: 50, w: 58, h: 1 }
  const result = validateManifest(m)
  assert.equal(result.ok, false)
  assert.ok(firstError(result).includes('全高写 h:100'), firstError(result))
})

test('规则·负宽高：w = -20 → 拒收', () => {
  const m = baseManifest()
  m.tracks[0].box = { x: 50, y: 50, w: -20, h: 100 }
  const result = validateManifest(m)
  assert.equal(result.ok, false)
  assert.ok(firstError(result).includes('box.w'), firstError(result))
})

test('规则·类型：box 给字符串 → 拒收并给正确示例', () => {
  const m = baseManifest()
  m.tracks[0].box = '右半区'
  const result = validateManifest(m)
  assert.equal(result.ok, false)
  const err = firstError(result)
  assert.ok(err.includes('必须是对象'), `错误应说明 box 形态：${err}`)
  assert.ok(err.includes('x/y 是区域中心'), `错误应教中心语义：${err}`)
})

test('规则·缺分量：缺 h → 拒收并指出缺哪个', () => {
  const m = baseManifest()
  m.tracks[0].box = { x: 50, y: 50, w: 58 }
  const result = validateManifest(m)
  assert.equal(result.ok, false)
  assert.ok(firstError(result).includes('box.h 缺失'), firstError(result))
})

test('规则·互斥 transform.x/y：与 box 同现 → 拒收；只给 scale → 放行', () => {
  const m = baseManifest()
  m.tracks[0].box = { x: 71, y: 50, w: 58, h: 100 }
  m.tracks[0].transform = { x: 10, scale: 1.1 }
  const r1 = validateManifest(m)
  assert.equal(r1.ok, false, 'transform.x 与 box 冲突必须拒收')
  assert.ok(firstError(r1).includes('移除 transform 的 x'), firstError(r1))

  const m2 = baseManifest()
  m2.tracks[0].box = { x: 71, y: 50, w: 58, h: 100 }
  m2.tracks[0].transform = { scale: 1.1, rotation: 15 }
  const r2 = validateManifest(m2)
  assert.equal(r2.ok, true, `scale/rotation 与 box 可同用：${r2.errors.join('；')}`)
})

test('规则·互斥 animate.from/to.x/y：与 box 同现 → 拒收；只动 opacity → 放行', () => {
  const m = baseManifest()
  m.tracks[0].box = { x: 71, y: 50, w: 58, h: 100 }
  m.tracks[0].animate = [{ from: { x: 0 }, to: { x: 71 } }]
  const r1 = validateManifest(m)
  assert.equal(r1.ok, false, 'animate 位置维度与 box 冲突必须拒收')
  assert.ok(firstError(r1).includes('animate'), firstError(r1))

  const m2 = baseManifest()
  m2.tracks[0].box = { x: 71, y: 50, w: 58, h: 100 }
  m2.tracks[0].animate = { from: { opacity: 0 }, to: { opacity: 1 } }
  const r2 = validateManifest(m2)
  assert.equal(r2.ok, true, `opacity 动画与 box 可同用：${r2.errors.join('；')}`)
})

test('规则·互斥 exit.to.x/y 与 orbit：与 box 同现 → 拒收', () => {
  const m = baseManifest()
  m.tracks[0].box = { x: 71, y: 50, w: 58, h: 100 }
  m.tracks[0].exit = { type: 'fade-out', to: { x: 130 } }
  const r1 = validateManifest(m)
  assert.equal(r1.ok, false, 'exit.to.x 与 box 冲突必须拒收')

  const m2 = baseManifest()
  m2.tracks[0].box = { x: 71, y: 50, w: 58, h: 100 }
  m2.tracks[0].orbit = { radius: 10, angularVelocity: 15 }
  const r2 = validateManifest(m2)
  assert.equal(r2.ok, false, 'orbit 与 box 冲突必须拒收')
  assert.ok(firstError(r2).includes('orbit'), firstError(r2))
})

test('规则·轨型白名单：transition / audioViz 带 box → 拒收', () => {
  const m = baseManifest()
  m.tracks[0] = { id: 'tr0', type: 'transition', effect: 'fade', fromTrackId: 'a', toTrackId: 'b', startFrame: 0, durationInFrames: 12, box: { x: 50, y: 50, w: 50, h: 50 } }
  const r1 = validateManifest(m)
  assert.equal(r1.ok, false, 'transition 不接受 box')
  assert.ok(firstError(r1).includes('只支持 video / image / textCard / shape'), firstError(r1))

  const m2 = baseManifest()
  m2.tracks[0] = { id: 'av0', type: 'audioViz', src: '/canvas-studio/assets/p1/bgm.mp3', startFrame: 0, durationInFrames: 300, box: { x: 50, y: 50, w: 50, h: 50 } }
  const r2 = validateManifest(m2)
  assert.equal(r2.ok, false, 'audioViz 不接受 box')
})

test('豁免面·shape：animate.x/y 覆盖 box 是存量合法写法，不得被新校验拒掉', () => {
  const m = baseManifest()
  m.tracks[0] = {
    id: 'sh0', type: 'shape', shape: 'rect', color: '#22d3ee',
    startFrame: 0, durationInFrames: 300,
    box: { x: 0, y: 0, w: 100, h: 100 }, // 中心落在画外角落 —— 契约示例本就这么写
    animate: { from: { x: 0, y: 0 }, to: { x: 50, y: 50 } },
  }
  const result = validateManifest(m)
  assert.equal(result.ok, true, `shape 豁免面被破坏（会拒掉历史 manifest）：${result.errors.join('；')}`)
  assert.deepEqual(contractWarnings(result), [], result.warnings.join('；'))
})

test('豁免面·shape:path 铺满画布，box 不生效 → 只给 warning 不报错', () => {
  const m = baseManifest()
  m.tracks[0] = {
    id: 'sh0', type: 'shape', shape: 'path', color: '#f59e0b', d: 'M 10 50 H 90',
    startFrame: 0, durationInFrames: 300,
    box: { x: 71, y: 50, w: 58, h: 100 },
  }
  const result = validateManifest(m)
  assert.equal(result.ok, true, `path + box 不应是错误：${result.errors.join('；')}`)
  assert.ok(
    contractWarnings(result).some((w) => w.includes("shape:'path'") && w.includes('box 不生效')),
    `应有「box 不生效」warning：${result.warnings.join('；')}`,
  )
})
