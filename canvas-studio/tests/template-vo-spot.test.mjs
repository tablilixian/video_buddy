/**
 * 口播广告模板 `vo-ad/vo-spot-30s` 的结构守卫（2026-11-13，模板通道重开批）。
 *
 * 守四条：
 *  1. 段落节拍（420 帧 @30fps = 14s 信息流口播；六段帧位不漂移）；
 *  2. 10 槽全部带 example、voVideo 之外的 9 槽带缺省（缺省可出样片）；
 *  3. 口播视频轨不静音（口播人声是主体）、vo-dim 压暗 ≤0.3（人脸不闷）；
 *  4. 编译产物 validate 0 error、SFX 6 支全走包内 fx 音效库、同输入确定性。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { listTemplateSummaries, loadTemplateBundle } from '../lib/remotion/template-registry.js'
import { compileTemplate } from '../lib/remotion/template-compile.js'
import { validateManifest } from '../lib/remotion/manifest.js'

const here = dirname(fileURLToPath(import.meta.url))
const ID = 'vo-ad/vo-spot-30s'
const DUR = 420
const FPS = 30

function defaultValues(bundle) {
  return Object.fromEntries(bundle.slots.map((s) => [s.id, s.default ?? s.example]))
}

test('vo-spot：注册表可见、五件套齐全、身份字段正确', () => {
  const { items, problems } = listTemplateSummaries()
  assert.ok(items.some((item) => item.meta.id === ID), 'list_templates 必须列得出新模板')
  assert.deepEqual(problems, [])
  const { bundle, dir } = loadTemplateBundle(ID)
  for (const name of ['meta.json', 'slots.json', 'furniture.json', 'audio.json', 'manifest.template.json', 'README.md']) {
    assert.ok(existsSync(join(dir, name)), `缺 ${name}`)
  }
  assert.equal(bundle.meta.family, 'vo-ad')
  assert.equal(bundle.meta.fps, FPS)
  assert.equal(bundle.meta.durationInFrames, DUR)
  assert.equal(bundle.meta.contractVersion, '1')
  assert.equal(bundle.meta.requiredAssets.length, 1, '口播视频是唯一必需素材')
  assert.ok(bundle.meta.requiredAssets[0].includes('真人'), '素材声明必须写明真人素材红线')
  assert.ok(bundle.meta.furniture.includes('progressBar'))
})

test('vo-spot：9 槽带缺省 + voVideo 必填无缺省（口播视频必须用户提供）', () => {
  const slots = JSON.parse(readFileSync(join(here, '../assets/templates/vo-ad/vo-spot-30s/slots.json'), 'utf8')).slots
  assert.equal(slots.length, 10)
  const vo = slots.find((slot) => slot.id === 'voVideo')
  assert.equal(vo.required, true)
  assert.equal(vo.default, undefined, '口播视频不许有缺省 —— 没有真素材就不该编出假口播')
  for (const slot of slots) {
    if (slot.id === 'voVideo') continue
    assert.ok(slot.default !== undefined && slot.default.length > 0, `${slot.id} 缺省文案必须非空（缺省可出样片）`)
  }
})

test('vo-spot ★编译：0 error、40 轨（11 骨架 + 29 进度条）、6 支 SFX 全走包内 fx 库', () => {
  const { bundle } = loadTemplateBundle(ID)
  const out = compileTemplate(bundle, defaultValues(bundle))
  assert.equal(out.ok, true, `编译失败：${out.errors.join('；')}`)
  const check = validateManifest(out.manifest)
  assert.deepEqual(check.errors, [], `编译产物必须过 validateManifest：${check.errors.join('；')}`)
  assert.equal(out.manifest.meta.durationInFrames, DUR)
  assert.equal(out.stats.sfxCount, 6)
  // SFX 全部走包内音效库路由（不用用户自备音频）。
  for (const sfx of out.manifest.audio.sfx) {
    assert.match(sfx.src, /^\/canvas-studio\/remotion\/fx\//, `SFX 必须走 fx 库：${sfx.src}`)
    assert.ok(existsSync(join(here, '../assets/audio/sfx', `${sfx.type}.mp3`)), `音效文件必须在库：${sfx.type}`)
  }
  // 口播视频轨不静音 + 压暗层 ≤0.3。
  const vo = out.manifest.tracks.find((track) => track.id === 'vo-full')
  assert.equal(vo.muted, undefined, '口播人声是主体，不许静音')
  const dim = out.manifest.tracks.find((track) => track.id === 'vo-dim')
  const alpha = Number(/rgba?\([^)]*,\s*([\d.]+)\)/.exec(dim.color)?.[1] ?? 1)
  assert.ok(alpha <= 0.3, `压暗层不许超过 0.3（人脸会闷）：${dim.color}`)
})

test('vo-spot ★节拍：六段帧位与出退场不漂移', () => {
  const skeleton = loadTemplateBundle(ID).bundle.skeleton
  const byId = Object.fromEntries(skeleton.tracks.map((track) => [track.id, track]))
  // 钩子 6–84（exit 12 帧）；主张 90–168；卖点 1/2/3 = 168/240/312 起；CTA 342 起。
  assert.deepEqual(
    ['s1-hook', 's2-claim', 's4-sell1', 's5-sell2', 's6-sell3', 's7-cta'].map((id) => byId[id].startFrame),
    [6, 90, 168, 240, 312, 342],
  )
  assert.equal(byId['s1-hook'].exit !== undefined, true, '钩子必须有退场（大字不能钉满全片）')
  assert.equal(byId['s-cap'].startFrame, 0, '字幕条全程在场')
  // 帧位总和：CTA 段落必须撑到片尾。
  assert.equal(byId['s7-cta'].startFrame + byId['s7-cta'].durationInFrames, DUR)
})

test('vo-spot ★确定性：同输入两次编译逐字节相同', () => {
  const { bundle } = loadTemplateBundle(ID)
  const values = { ...defaultValues(bundle), voVideo: '/canvas-studio/assets/vo/vo-influencer-42323.mp4' }
  const a = compileTemplate(bundle, values)
  const b = compileTemplate(bundle, values)
  assert.equal(JSON.stringify(a.manifest), JSON.stringify(b.manifest))
})
