/**
 * S1 · `fx:'metal'` 银色金属渐变字的契约守卫。
 *
 * #16 能力基准已给像素证据：`background-clip:text` 在 web-renderer 4.0.535 下真出
 * 银色渐变；同一探针里 CSS radial-gradient 平铺被忽略（dotGrid 改走 SVG pattern）。
 * 这里守住「契约有值 → 折算有值 → 校验放行 → 老 fx 不受影响」这条链。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fxStyles } from '../lib/remotion/timing.js'
import { validateManifest } from '../lib/remotion/manifest.js'

function withTrack(track) {
  return {
    id: 'fx-metal-test',
    meta: { title: '金属字', width: 1920, height: 1080, fps: 30, durationInFrames: 60 },
    tracks: [
      { id: 'bg', type: 'shape', shape: 'gradient', color: '#0b1220', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: 0, durationInFrames: 60 },
      track,
    ],
  }
}

const textTrack = (fx) => ({
  id: 'metal',
  type: 'textCard',
  variant: 'title',
  text: '47',
  box: { x: 50, y: 50, w: 60, h: 20 },
  startFrame: 0,
  durationInFrames: 60,
  fadeFrames: 0,
  ...(fx === undefined ? {} : { fx }),
})

test('S1：fxStyles("metal") 给出银色渐变 + 透明填充', () => {
  const style = fxStyles('metal')
  assert.match(style.textBackground, /^linear-gradient\(180deg,/)
  assert.match(style.textBackground, /#ffffff/, '要有白色高光带')
  assert.match(style.textBackground, /#8fa1bf/, '要有灰色暗带（金属感来源）')
  assert.equal(style.textFill, 'transparent', '必须透明才能让渐变透出来')
  assert.ok(style.textShadow)
})

test('S1：老 fx 与缺省不受影响（零契约回归）', () => {
  assert.deepEqual(fxStyles(undefined), {})
  assert.deepEqual(fxStyles('unknown'), {})
  assert.equal(fxStyles('outline').textFill, 'transparent')
  assert.equal(fxStyles('blur').filter, 'blur(3px)')
  assert.equal(fxStyles('metal').maskImage, undefined, '金属字不许顺手带遮罩')
})

test('S1 ★校验：fx:"metal" 放行，未知 fx 仍拒收', () => {
  assert.deepEqual(validateManifest(withTrack(textTrack('metal'))).errors, [])
  const bad = validateManifest(withTrack(textTrack('chrome'))).errors
  assert.ok(bad.some((e) => e.includes('fx 非法')), '白名单不能被放宽成任意字符串')
  assert.ok(bad.some((e) => e.includes('/ metal')), '报错文案要列出新档位')
})

test('S1 ★反向变异锚点：把 metal 折算改成空对象必须变红', () => {
  const style = fxStyles('metal')
  assert.notDeepEqual(style, {}, 'metal 不能退化成「什么都没写」')
  assert.ok(style.textBackground !== undefined && style.textFill !== undefined)
})
