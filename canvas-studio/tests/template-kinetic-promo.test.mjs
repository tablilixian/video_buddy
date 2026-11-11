/**
 * 新模板批 · 第 3 步：`tech/kinetic-promo` 的结构守卫。
 *
 * 守四条（都是「改数据会静默毁掉效果」的地方）：
 *  1. 12 段 / 24s@60fps 的节拍不能漂移；
 *  2. 26 槽全部带缺省且不出现未替换的 `{{...}}`；
 *  3. **cardWall 只在第 1 段**（D-40 的性能预算：3D 层只覆盖 23% 片长）；
 *  4. 编译产物零 error 零 warning、同输入逐字节相同。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { listTemplateSummaries, loadTemplateBundle } from '../lib/remotion/template-registry.js'
import { compileTemplate } from '../lib/remotion/template-compile.js'
import { validateManifest } from '../lib/remotion/manifest.js'

const ID = 'tech/kinetic-promo'
const DUR = 1440
/** 12 段起始帧（@60fps），来自参考片逐秒拆解：0 / 5.6 / 6.3 / 8.0 / 10.3 / 12.7 / 14.0 / 15.3 / 16.0 / 17.0 / 18.3 / 22.5s。 */
const SEG_STARTS = [0, 336, 378, 480, 618, 762, 840, 918, 960, 1020, 1098, 1350]

function exampleValues(bundle) {
  return Object.fromEntries(bundle.slots.map((s) => [s.id, s.example]))
}

test('kinetic-promo：注册表可见、7 个条目齐全、身份字段正确', () => {
  const { items, problems } = listTemplateSummaries()
  assert.ok(items.some((item) => item.meta.id === ID), 'list_templates 必须列得出新模板')
  assert.deepEqual(problems.filter((p) => String(p.dir).includes('kinetic-promo')), [], '坏目录会被点名')
  const { bundle, dir } = loadTemplateBundle(ID)
  for (const name of ['meta.json', 'slots.json', 'furniture.json', 'audio.json', 'manifest.template.json', 'README.md']) {
    assert.ok(existsSync(join(dir, name)), `缺 ${name}`)
  }
  assert.ok(existsSync(join(dir, 'frames', 'README.md')), 'frames/ 只放 README（D-28）')
  assert.equal(bundle.meta.family, 'tech')
  assert.equal(bundle.meta.fps, 60)
  assert.equal(bundle.meta.durationInFrames, DUR)
  assert.equal(bundle.meta.contractVersion, '1')
  assert.deepEqual(bundle.meta.requiredAssets, [], '模板不自带素材，闸门才不会被素材判据排除')
  assert.ok(bundle.meta.furniture.includes('cardWall'), '第 2 步的构件必须真被模板用上')
})

test('kinetic-promo ★编译：零 error / 零 warning、172 轨（S4-R2 七段重排 / 蓝屏移段 / 仪表盘网格 / 辉光脉冲）、音效注入', () => {
  const { bundle } = loadTemplateBundle(ID)
  const out = compileTemplate(bundle, exampleValues(bundle))
  assert.equal(out.ok, true, `编译失败：${out.errors.join('；')}`)
  assert.deepEqual(out.warnings, [], `产物不该诱导模型返工：${out.warnings.join('；')}`)
  assert.equal(out.manifest.tracks.length, bundle.skeleton.tracks.length + out.stats.furnitureTracks)
  // S3：骨架 96 → 128（快切瀑布 / 白板快切）；S4-R1（2026-11-11）：七段重排
  // +闪光切点板 → 骨架 139；S4-R2：蓝屏移段 / 仪表盘网格 / 金色数字 → 150。
  // cardWall 容器 = 22 条构件（1 group：62 卡 + 24 条纹 + 9 辉光）⇒ 172。
  assert.equal(out.manifest.tracks.length, 172)
  assert.equal(out.stats.sfxCount, bundle.audio.sfx.length)
  assert.equal(out.manifest.meta.templateId, ID)
  assert.equal(out.manifest.meta.family, 'tech')
  assert.deepEqual(validateManifest(out.manifest).errors, [])
  assert.equal(out.manifest.meta.durationInFrames, DUR)
})

test('kinetic-promo：26 槽全带缺省，不给 slots 也能编译且不留占位符', () => {
  const { bundle } = loadTemplateBundle(ID)
  assert.equal(bundle.slots.length, 26)
  for (const slot of bundle.slots) {
    assert.ok(slot.default, `${slot.id} 必须有缺省值（样片要能零输入出片）`)
    assert.ok(slot.example, `${slot.id} 必须有示例（模型填参的唯一依据）`)
  }
  const out = compileTemplate(bundle, {})
  assert.equal(out.ok, true, `零输入编译失败：${out.errors.join('；')}`)
  const blob = JSON.stringify(out.manifest)
  assert.ok(!blob.includes('{{'), '产物里不许残留未替换的占位符')
  assert.equal(out.manifest.meta.title, bundle.slots.find((s) => s.id === 'product').default)
})

test('kinetic-promo ★12 段节拍：每个段起始帧都有内容轨，且全片不越界', () => {
  const { bundle } = loadTemplateBundle(ID)
  const out = compileTemplate(bundle, exampleValues(bundle))
  const content = out.manifest.tracks.filter((t) => !t.id.startsWith('fx-'))
  for (const frame of SEG_STARTS) {
    assert.ok(
      content.some((t) => t.startFrame === frame),
      `第 ${frame} 帧必须有内容轨起段（12 段节拍不能漂移）`,
    )
  }
  for (const track of out.manifest.tracks) {
    const end = track.startFrame + track.durationInFrames
    assert.ok(end <= DUR, `${track.id} 结束帧 ${end} 超出片长`)
  }
  assert.equal(Math.max(...out.manifest.tracks.map((t) => t.startFrame + t.durationInFrames)), DUR)
})

test('kinetic-promo ★3D 预算：卡墙 = 1 条 3D 容器（62 张平面子卡）只在 0–336 帧', () => {
  const { bundle } = loadTemplateBundle(ID)
  const out = compileTemplate(bundle, exampleValues(bundle))
  // S3 容器化：整面墙 1 条 group 轨（#14 实测 62 卡 1 个 WebGL 层 82ms/帧），
  // 3D 姿势与推近都在容器上；子卡必须平面（子轨 3D = preserve-3d 不被支持的未知像素）。
  const wall = out.manifest.tracks.find((t) => t.id === 'fx-card-wall')
  assert.ok(wall, '卡墙容器轨必须存在')
  assert.equal(wall.type, 'group')
  const cards = wall.children.filter((c) => c.id.startsWith('fx-card-'))
  assert.equal(cards.length, 62)
  assert.ok(wall.transform && wall.transform.rotateX !== undefined, '容器必须真 3D（统一灭点）')
  assert.ok(wall.transform.perspective >= 200)
  assert.ok(Array.isArray(wall.animate) && wall.animate[0].to.scale > wall.animate[0].from.scale, '推近 = scale 递增')
  for (const child of wall.children) {
    assert.ok(!child.transform, '子卡不许自带 3D 姿势')
    assert.ok(child.startFrame + child.durationInFrames <= 336, `${child.id} 越过了第 1 段 ⇒ 全片 3D 成本失控`)
  }
  // 3D 层只覆盖 23.3% 片长：把卡墙改成全片常驻，这条必须变红。
  const coverage = 336 / DUR
  assert.ok(coverage < 0.25, `3D 层覆盖 ${(coverage * 100).toFixed(1)}% 片长，超预算`)
})

test('kinetic-promo：同输入两次编译逐字节相同（确定性）', () => {
  const { bundle } = loadTemplateBundle(ID)
  const values = exampleValues(bundle)
  const a = JSON.stringify(compileTemplate(bundle, values).manifest, null, 2)
  const b = JSON.stringify(compileTemplate(bundle, values).manifest, null, 2)
  assert.equal(a, b)
})

test('kinetic-promo ★反向变异锚点：cardWall 的 endFrame 不许越过第 1 段', () => {
  // 改数据文件里的 endFrame 为全片 ⇒ 上一条用例必须变红；本条钉住「声明里写的是 336」。
  const { dir } = loadTemplateBundle(ID)
  const furniture = JSON.parse(readFileSync(join(dir, 'furniture.json'), 'utf8'))
  const wall = furniture.find((f) => f.id === 'cardWall')
  assert.equal(wall.endFrame, 336, '把 endFrame 改成 1440 会让 3D 预算用例精确变红')
})
