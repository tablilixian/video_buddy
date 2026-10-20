/**
 * REQ-034 · O-12：素材分辨率 vs 交付分辨率（`checkManifestResolution`）。
 *
 * 守的是「什么时候该报上采样、什么时候不该报」——阈值错了会退化成 ML-10 那种
 * 恒真噪声（agent 学会无视整份体检），所以这条既要正向也要反向。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkManifestResolution, UPSAMPLE_TOLERANCE } from '../lib/remotion/resolution-check.js'

const VID = '/canvas-studio/assets/p1/shot1.mp4'
const VID2 = '/canvas-studio/assets/p1/shot2.mp4'

function manifest(tracks, meta = {}) {
  return {
    id: 'comp-res',
    meta: { title: '分辨率', width: 1280, height: 720, fps: 30, durationInFrames: 300, lint: 'off', ...meta },
    tracks,
  }
}

const VIDEO = (id, src = VID) => ({ id, type: 'video', src, startFrame: 0, durationInFrames: 90 })

test('864×480 素材进 1280×720 成片 ⇒ 报上采样（真机症状）', () => {
  const warnings = checkManifestResolution(manifest([VIDEO('S1')]), { [VID]: { width: 864, height: 480 } })
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /素材只有 864×480/)
  // 取两轴的**较大**倍率：1280/864 = 1.481，720/480 = 1.5 ⇒ 报 1.50（短板在纵向）。
  assert.match(warnings[0], /上采样约 1\.50×/)
})

test('素材与成片同分辨率 ⇒ 不报（1.05 容差内，否则正常档位会恒报）', () => {
  assert.deepEqual(
    checkManifestResolution(manifest([VIDEO('S1')]), { [VID]: { width: 1280, height: 720 } }),
    [],
  )
  // 1280×736（736p 档）进 1280×720 成片：宽相等、高更大 ⇒ 上采样倍数 1。
  assert.deepEqual(
    checkManifestResolution(manifest([VIDEO('S1')]), { [VID]: { width: 1280, height: 736 } }),
    [],
  )
  // 轻微奇数像素差异（1280×720 vs 1280×718）不该报。
  assert.deepEqual(
    checkManifestResolution(manifest([VIDEO('S1')]), { [VID]: { width: 1280, height: 719 } }),
    [],
  )
  assert.ok(UPSAMPLE_TOLERANCE > 1 && UPSAMPLE_TOLERANCE < 1.1)
})

test('draft 档按半分辨率判：640×360 成片配 864×480 素材 ⇒ 不报', () => {
  assert.deepEqual(
    checkManifestResolution(manifest([VIDEO('S1')]), { [VID]: { width: 864, height: 480 } }, 'draft'),
    [],
  )
  // 同一份素材在 standard 档才报。
  assert.equal(checkManifestResolution(manifest([VIDEO('S1')]), { [VID]: { width: 864, height: 480 } }, 'standard').length, 1)
})

test('同一素材被两条轨引用 ⇒ 只报一次（列首个轨 id）', () => {
  const warnings = checkManifestResolution(
    manifest([VIDEO('S1'), VIDEO('S1-again')]),
    { [VID]: { width: 864, height: 480 } },
  )
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /轨「S1」/)
})

test('无尺寸信息 / 非 video 轨 ⇒ 静默跳过（探测失败不制造噪声）', () => {
  assert.deepEqual(checkManifestResolution(manifest([VIDEO('S1')]), {}), [])
  assert.deepEqual(
    checkManifestResolution(
      manifest([{ id: 'img', type: 'image', src: VID2, startFrame: 0, durationInFrames: 90 }]),
      { [VID2]: { width: 320, height: 180 } },
    ),
    [],
  )
})
