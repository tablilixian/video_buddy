/**
 * REQ-038 R9-P1b（#10）· **离线 manifest 体检**（validate_manifest 工具核心）单测。
 *
 * 四条纪律必须同时成立：
 * ① **一次列全** —— schema 错误全量列出（不是第一处就停），渲染试错的 14s/次成本归零；
 * ② **三件套同屏** —— schema + 编排体检 + 文字容量一段回执（spec 通道同款口径）；
 * ③ **体检段从不抛** —— lint/textFit 内部错误只降级为说明行，schema 结论不受牵连；
 * ④ **拒收口径** —— 文件不存在 / 坏 JSON / 非普通文件 CS-USER-ERR，与 specPath 同判。
 *
 * 直连 Host tsc 编译产物（临时文件）。定向跑：node --test tests/req038-r9-manifest-audit.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { auditManifestFile, formatManifestAudit } from '../lib/manifest-audit.js'

function writeFile(body) {
  const dir = mkdtempSync(join(tmpdir(), 'r9-audit-'))
  const file = join(dir, 'manifest.json')
  writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body, null, 2), 'utf8')
  return file
}

/** 最小合法 manifest（bg 全屏渐变轨）。 */
function goodManifest(extra = {}) {
  return {
    id: 'm-audit',
    meta: { title: '体检样例', width: 1920, height: 1080, fps: 30, durationInFrames: 600, backgroundColor: '#0B1220' },
    tracks: [
      { id: 'bg', type: 'shape', shape: 'gradient', color: '#111827', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: 0, durationInFrames: 600, fadeFrames: 0 },
    ],
    ...extra,
  }
}

test('好 manifest：三段全绿，紧凑一句话 + 下一步指引', () => {
  // lint-clean 需要：时长 <15s（ML-17）+ 动效占比 ≥30%（ML-10）+ 有 opacity 动画（ML-05 只判位移）
  const file = writeFile({
    ...goodManifest({ meta: { ...goodManifest().meta, durationInFrames: 300 } }),
    tracks: [
      { id: 'bg', type: 'shape', shape: 'gradient', color: '#111827', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: 0, durationInFrames: 300, fadeFrames: 0 },
      { id: 't', type: 'textCard', variant: 'title', text: '甲', startFrame: 0, durationInFrames: 300,
        animate: { from: { opacity: 0 }, to: { opacity: 1 }, durationInFrames: 120, easing: 'easeOutCubic' } },
    ],
  })
  const result = auditManifestFile(file)
  assert.equal(result.manifestOk, true)
  assert.deepEqual(result.schemaErrors, [])
  assert.equal(result.lintCount, 0, `lint-clean 夹具仍报：${JSON.stringify(result.lintLines)}`)
  const text = formatManifestAudit(result, file)
  assert.match(text, /schema：通过/)
  assert.match(text, /全绿 → `render_composition/)
})

test('schema 错误一次列全（两处缺 box 同屏出现）', () => {
  // 「必须给 box」是 callout 轨的规则（真机挖掘里的 tracks[67]/[87] 就是 callout）
  const file = writeFile({
    ...goodManifest(),
    tracks: [
      ...goodManifest().tracks,
      { id: 'c1', type: 'callout', anchor: { x: 30, y: 30 }, text: '甲标注', startFrame: 0, durationInFrames: 100 },
      { id: 'c2', type: 'callout', anchor: { x: 60, y: 30 }, text: '乙标注', startFrame: 100, durationInFrames: 100 },
    ],
  })
  const result = auditManifestFile(file)
  assert.equal(result.manifestOk, false)
  assert.ok(result.schemaErrors.length >= 2, `缺 box 的两处必须都列出，实得：${JSON.stringify(result.schemaErrors)}`)
  const text = formatManifestAudit(result, file)
  assert.match(text, /2 条错误/)
  assert.match(text, /渲染试错/)
})

test('编排体检段：20s 无常驻层触发 ML-17（C2 合并形态）', () => {
  const file = writeFile({
    ...goodManifest({ meta: { ...goodManifest().meta, durationInFrames: 600 } }),
    tracks: [
      ...goodManifest().tracks,
      { id: 'a', type: 'textCard', variant: 'title', text: '甲', startFrame: 0, durationInFrames: 300 },
      { id: 'b', type: 'textCard', variant: 'title', text: '乙', startFrame: 300, durationInFrames: 300 },
    ],
  })
  const result = auditManifestFile(file)
  assert.ok(result.lintLines.some((line) => line.includes('ML-17')), JSON.stringify(result.lintLines))
  const text = formatManifestAudit(result, file)
  assert.match(text, /编排体检/)
})

test('文字容量段：窄盒长文案溢出可见', () => {
  const file = writeFile({
    ...goodManifest(),
    tracks: [
      ...goodManifest().tracks,
      { id: 't', type: 'textCard', variant: 'title', text: '这段标题二十几个字塞进一个特别窄的盒子里必然溢出', box: { x: 50, y: 20, w: 14, h: 8 }, startFrame: 0, durationInFrames: 300 },
    ],
  })
  const result = auditManifestFile(file)
  assert.ok(result.textFitLines.length > 0, '窄盒长文案必须出容量告警')
  const text = formatManifestAudit(result, file)
  assert.match(text, /文字容量预估/)
})

test('meta.lint = off：编排体检归零（口径与渲染一致），schema 照常', () => {
  const file = writeFile(goodManifest({ meta: { ...goodManifest().meta, lint: 'off' } }))
  const result = auditManifestFile(file)
  assert.equal(result.lintCount, 0)
  assert.equal(result.manifestOk, true)
})

test('拒收口径：文件不存在 / 坏 JSON / 相对路径外的普通非法输入', () => {
  assert.throws(() => auditManifestFile('/tmp/r9-audit-not-exist.json'), /不存在或不可读/)
  const bad = writeFile('这不是 JSON {{{')
  assert.throws(() => auditManifestFile(bad), /JSON 解析失败/)
})

test('回执对空 manifest / 无轨 manifest 不崩（体检从不抛）', () => {
  const file = writeFile({ id: 'empty', meta: { title: 'x', width: 1920, height: 1080, fps: 30, durationInFrames: 30 }, tracks: [] })
  const result = auditManifestFile(file)
  assert.equal(typeof result.manifestOk, 'boolean')
})
