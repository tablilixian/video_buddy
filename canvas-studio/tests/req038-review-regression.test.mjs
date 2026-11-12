/**
 * REQ-038 · 自查 review 回归守卫（review 抓到的 4 处链路断裂 + 2 处渲染 bug）。
 *
 * 背景：交付后自查发现「契约/渲染/校验都绿，但链路上有环节不消费新字段」：
 * ① materialize 不物化聚合轨 logos/assets 数组（真机整墙 404）；
 * ② asset-check 不 fail-closed 聚合轨素材（缺盘无人拦）；
 * ③ GROUP_CHILD_TYPES 不收聚合轨型（容器子轨与顶层同权原则被违反）；
 * ④ materialize 不物化 audio.sfx[].src（0A 既有缺口，批 4 消费面顺带修）；
 * ⑤ Ticker 固定三轮在短内容×宽容器时露底；
 * ⑥ ChipRow column 方向 justifyContent:center 与 paddingTop 双重居中。
 * 本文件把六处全部钉死 —— 回退即红。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { materializeManifestSources } from '../lib/remotion/materialize.js'
import { checkManifestAssets } from '../lib/remotion/asset-check.js'
import { validateManifest } from '../lib/remotion/manifest.js'
import { planFromSpec } from '../lib/remotion/content-spec.js'

const here = dirname(fileURLToPath(import.meta.url))

const aggManifest = (logos) => ({
  id: 'review-agg',
  meta: { title: 'review', width: 1920, height: 1080, fps: 30, durationInFrames: 120 },
  tracks: [
    { id: 'wall', type: 'logoWall', logos, box: { x: 50, y: 50, w: 70, h: 30 }, startFrame: 0, durationInFrames: 120 },
  ],
})

test('review ①：materialize 物化 logoWall.logos（本地绝对路径 → 同源 URL）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mat-'))
  try {
    writeFileSync(join(dir, 'logo-x.png'), 'png')
    const manifest = aggManifest(['/this/path/must/be/inside/logo-x.png'])
    // 素材在 assetsDir 内才物化；这里用 manifest 里假的域内路径 —— 需要真实文件，
    // 改成把文件放进临时 assetsDir。
    const assetsDir = dir
    writeFileSync(join(assetsDir, 'logo-real.png'), 'png')
    const m2 = aggManifest([join(assetsDir, 'logo-real.png')])
    const result = materializeManifestSources(m2, assetsDir, 'p1')
    const wall = result.manifest.tracks[0]
    assert.match(wall.logos[0], /^\/canvas-studio\/assets\/p1\//, '本地路径必须被物化成同源 URL')
    assert.ok(result.remapped >= 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('review ②：asset-check 对聚合轨素材 fail-closed（缺盘 → missing）', async () => {
  const manifest = aggManifest(['/canvas-studio/assets/p1/not-exist.png'])
  const dir = mkdtempSync(join(tmpdir(), 'chk-'))
  try {
    const check = await checkManifestAssets(manifest, dir)
    assert.ok(check.missing.some((entry) => entry.includes('wall.logos[0]')), `聚合轨素材缺盘必须进 missing：${JSON.stringify(check.missing)}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('review ③：GROUP_CHILD_TYPES 收聚合轨型（容器子轨与顶层同权）', () => {
  const src = readFileSync(join(here, '../src/remotion/manifest-track-validate.ts'), 'utf8')
  for (const type of ['logoWall', 'assetGrid', 'chipRow', 'codePanel', 'ticker']) {
    assert.ok(src.includes(`'${type}'`), `GROUP_CHILD_TYPES 必须含 ${type}`)
  }
  // 端到端：group 包 logoWall 校验放行。
  const m = validateManifest({
    id: 'g-agg',
    meta: { title: 'g', width: 1920, height: 1080, fps: 30, durationInFrames: 60 },
    tracks: [
      { id: 'g1', type: 'group', children: [
        { id: 'w', type: 'logoWall', logos: ['/canvas-studio/assets/a.png'], startFrame: 0, durationInFrames: 60 },
      ], startFrame: 0, durationInFrames: 60 },
    ],
  })
  assert.deepEqual(m.errors, [], `group 包聚合轨应放行：${JSON.stringify(m.errors)}`)
})

test('review ④：materialize 物化 audio.sfx[].src（0A 既有缺口）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sfx-'))
  try {
    writeFileSync(join(dir, 'impact.mp3'), 'mp3')
    const manifest = {
      id: 'sfx-mat',
      meta: { title: 's', width: 1920, height: 1080, fps: 30, durationInFrames: 60 },
      tracks: [],
      audio: { sfx: [{ src: join(dir, 'impact.mp3'), startSec: 1, startFrom: 55 }] },
    }
    const result = materializeManifestSources(manifest, dir, 'p1')
    assert.match(result.manifest.audio.sfx[0].src, /^\/canvas-studio\/assets\/p1\//, 'sfx.src 必须被物化')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('review ⑤⑥：Ticker 动态轮数 + ChipRow 单一居中（源码级守卫）', () => {
  const agg = readFileSync(join(here, '../src/remotion/components/Aggregates.tsx'), 'utf8')
  assert.ok(agg.includes('Math.ceil(boxW / loopW) + 2'), 'Ticker 轮数必须按容器宽动态')
  assert.ok(!agg.includes('const rounds = [loopText, loopText, loopText]'), '固定三轮必须删除')
  assert.ok(!agg.includes("justifyContent: isColumn ? 'center'"), 'column 双重居中必须删除')
})

test('端到端：spec → planFromSpec → validateManifest 全链 0 error（含聚合轨 + P 卡）', () => {
  const spec = JSON.parse(readFileSync(join(here, '../examples/product-promo/spec-a.json'), 'utf8'))
  const plan = planFromSpec(spec, 1800)
  const manifest = {
    id: 'e2e',
    meta: { title: spec.meta.title, width: 1920, height: 1080, fps: 30, durationInFrames: 1800 },
    tracks: plan.tracks,
  }
  const check = validateManifest(manifest)
  assert.deepEqual(check.errors, [], `全链校验必须 0 error：${JSON.stringify(check.errors.slice(0, 5))}`)
  const types = new Set(plan.tracks.map((t) => t.type))
  for (const expected of ['logoWall', 'chipRow', 'codePanel']) {
    assert.ok(types.has(expected), `骨架必须产出 ${expected}`)
  }
  assert.ok(check.ok)
})
