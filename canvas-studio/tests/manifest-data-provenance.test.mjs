/**
 * B-4（CV-440，P-01/P-17）数据溯源契约 —— 构造样本验证（不依赖任何具体项目）。
 *
 * RUN-2 事故：折线混基准合法通过 + storyboard pending 事实照样进成片。
 * 观察期（P5 拍板）：全部断言 warning 级，不阻断渲染；反向变异靶见各 test。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateManifest } from '../lib/remotion/manifest.js'
import { validateChartTrack, validateDataCardProvenance } from '../lib/remotion/manifest-track-validate.js'
import { looksLikeNumericFact, pendingFactWarning, readPendingFactWarning } from '../lib/data-provenance.js'
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 构造一份最小合法 manifest（单 image 轨铺底）。 */
function manifest(tracks, extra = {}) {
  return {
    id: 'prov-m',
    meta: { title: '溯源观察期', durationInFrames: 300, fps: 30, width: 1920, height: 1080 },
    tracks,
    ...extra,
  }
}

const baseTrack = { id: 't0', type: 'image', src: '/canvas-studio/assets/a.png', startFrame: 0, durationInFrames: 300, box: { x: 50, y: 50, w: 100, h: 100 } }

function chartTrack(overrides = {}) {
  return {
    id: 'c1', type: 'chart', variant: 'line',
    labels: ['1995', '2005', '2015'], values: [0.45, 0.62, 0.9],
    startFrame: 0, durationInFrames: 120, box: { x: 50, y: 50, w: 60, h: 40 },
    ...overrides,
  }
}

function warningsOf(manifestValue) {
  const { warnings } = validateManifest(manifestValue)
  return warnings.filter((w) => w.includes('B-4 观察期'))
}

// ── chart：内联数值缺 dataSource / baseline ⇒ 各一条观察期 warning ──────────

test('B-4 chart：内联数值缺溯源字段 ⇒ dataSource + baseline 两条 warning（不 error）', () => {
  const { errors, warnings } = validateManifest(manifest([baseTrack, chartTrack()]))
  assert.equal(errors.length, 0, `不应有 error：${errors.join('；')}`)
  const b4 = warnings.filter((w) => w.includes('B-4 观察期'))
  assert.equal(b4.length, 2, `应恰好 2 条（dataSource + baseline），实际：${b4.join('；')}`)
  assert.ok(b4.some((w) => w.includes('dataSource') && w.includes('tracks[1]')))
  assert.ok(b4.some((w) => w.includes('baseline')))
})

test('B-4 chart：补全 dataSource/baseline ⇒ 0 条', () => {
  const { warnings } = validateManifest(manifest([baseTrack, chartTrack({
    dataSource: 'NASA GISTEMP v4（J-D 列），https://data.giss.nasa.gov/gistemp/',
    baseline: '1951–1980 基线距平',
  })]))
  assert.equal(warnings.filter((w) => w.includes('B-4 观察期')).length, 0)
})

test("B-4 chart：source:'timeline'（片内真值）豁免溯源字段", () => {
  const { errors, warnings } = validateManifest(manifest([
    { id: 'v1', type: 'video', src: '/canvas-studio/assets/a.mp4', startFrame: 0, durationInFrames: 300 },
    chartTrack({ source: 'timeline', labels: undefined, values: undefined }),
  ]))
  assert.equal(errors.length, 0, `timeline 模式不应报 error：${errors.join('；')}`)
  assert.equal(warnings.filter((w) => w.includes('B-4 观察期')).length, 0, '片内真值无需外溯源')
})

test('B-4 chart：非字符串 dataSource ⇒ error（类型闸与观察期无关）', () => {
  const { errors } = validateManifest(manifest([baseTrack, chartTrack({ dataSource: 42 })]))
  assert.ok(errors.some((e) => e.includes('dataSource 必须是非空字符串')))
})

// ── dataCard：数值型事实收窄口径 ────────────────────────────────────────────

test('B-4 dataCard：温标 / 百分比 / 量级事实缺 dataSource ⇒ warning 点名具体值', () => {
  for (const v of ['1.10℃', '16%', '45.1亿', '¥3.2万亿', '0.83']) {
    const warnings = []
    validateDataCardProvenance({ data: [{ k: 'x', v }] }, 'tracks[2]', warnings)
    assert.equal(warnings.length, 1, `"${v}" 应触发（可溯源数字），实际：${warnings.join('；')}`)
    assert.match(warnings[0], /"/u, 'warning 必须点名具体值')
    assert.ok(warnings[0].includes('observed'), '要给诚实出口')
  }
})

test('B-4 dataCard：BPM / 时长 / 计数 / 日期等元数据豁免（收窄口径，防诱导编造出处）', () => {
  for (const v of ['58 BPM', '62bpm', '24h', '3 分钟', '90 fps', '44.1kHz', '5 个镜头', '第 3 集', '2024 年', '1951–1980']) {
    const warnings = []
    validateDataCardProvenance({ data: [{ k: 'x', v }] }, 'tracks[2]', warnings)
    assert.equal(warnings.length, 0, `"${v}" 是元数据不应触发，实际：${warnings.join('；')}`)
  }
})

test("B-4 dataCard：dataSource:'observed' / 'inline' 诚实出口豁免", () => {
  for (const ds of ['observed', 'inline']) {
    const warnings = []
    validateDataCardProvenance({ dataSource: ds, data: [{ k: 'x', v: '16%' }] }, 't', warnings)
    assert.equal(warnings.length, 0, `${ds} 应豁免`)
  }
})

test('B-4 dataCard：一张卡多条事实只点名一次（不逐条刷）', () => {
  const warnings = []
  validateDataCardProvenance({ data: [{ k: 'a', v: '16%' }, { k: 'b', v: '1.10℃' }] }, 't', warnings)
  assert.equal(warnings.length, 1)
})

test('B-4 dataCard：非事实 v（纯文案 / 多段乱数字）不触发', () => {
  for (const v of ['全球老龄化', '12abc34']) {
    const warnings = []
    validateDataCardProvenance({ data: [{ k: 'x', v }] }, 't', warnings)
    assert.equal(warnings.length, 0, `"${v}" 不应触发`)
  }
})

test('B-4 全 manifest 路径：dataCard 事实 warning 走 validateManifest 出得来', () => {
  const { warnings } = validateManifest(manifest([
    baseTrack,
    { id: 'd1', type: 'textCard', variant: 'dataCard', text: '全球老龄化', data: [{ k: '60 岁以上', v: '16%' }], startFrame: 0, durationInFrames: 90 },
  ]))
  assert.ok(warnings.some((w) => w.includes('dataSource') && w.includes('B-4 观察期') && w.includes('16%')),
    `应含 dataCard 溯源提醒：${warnings.join('；')}`)
})

// ── storyboard pending 事实桥 ──────────────────────────────────────────────

test('B-4 桥：pending 事实点名（计数 + 前 2 条 + 修法）', () => {
  const w = pendingFactWarning([
    { claim: '本片未在线复核逐年小数', source: '', status: 'pending' },
    { claim: '30 年升温约 0.83℃', source: 'https://…', status: 'pending' },
    { claim: '已核实的事实', source: 'https://…', status: 'verified' },
  ])
  assert.match(w, /2 条 pending/u)
  assert.match(w, /本片未在线复核逐年小数/u)
  assert.match(w, /verified/u, '要给升级路径')
  assert.match(w, /observed/u, '要给诚实出口')
})

test('B-4 桥：全 verified / 空 / 坏形状 ⇒ 空串（不噪声）', () => {
  assert.equal(pendingFactWarning([{ claim: 'x', status: 'verified' }]), '')
  assert.equal(pendingFactWarning([]), '')
  assert.equal(pendingFactWarning(null), '')
  assert.equal(pendingFactWarning('oops'), '')
})

test('B-4 桥 E2E：readPendingFactWarning 回落读 storyboard.json（快照缺失时）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-prov-'))
  try {
    const path = join(dir, 'storyboard.json')
    writeFileSync(path, JSON.stringify({ sections: { '01_facts': { facts: [{ claim: '逐年小数未复核', status: 'pending' }] } } }))
    assert.match(readPendingFactWarning(dir, path), /1 条 pending/)
    assert.equal(readPendingFactWarning(dir, join(dir, 'missing.json')), '', '缺失文件 = 无提醒，不挡渲染')
    writeFileSync(path, '{broken')
    assert.equal(readPendingFactWarning(dir, path), '', '坏 JSON 容错')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CV-447 P1-D：build/fact-snapshot.json 优先于 storyboard（落盘真值覆盖叙述式更新）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-prov-'))
  try {
    mkdirSync(join(dir, 'build'), { recursive: true })
    // 事故签名：agent 口头说"已核实"，storyboard 仍是 pending；快照是真值。
    const storyboard = join(dir, 'storyboard.json')
    writeFileSync(storyboard, JSON.stringify({ sections: { '01_facts': { facts: [{ claim: '未核源', status: 'pending' }] } } }))
    writeFileSync(join(dir, 'build', 'fact-snapshot.json'), JSON.stringify({ facts: [{ claim: '已核源', status: 'verified' }] }))
    assert.equal(readPendingFactWarning(dir, storyboard), '', '快照 verified ⇒ 不再报假警报')
    writeFileSync(join(dir, 'build', 'fact-snapshot.json'), JSON.stringify({ facts: [{ claim: '新发现', status: 'pending' }] }))
    assert.match(readPendingFactWarning(dir, storyboard), /1 条 pending/, '快照 pending ⇒ 照常点名')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('B-4 漂移靶：looksLikeNumericFact 的豁免表必须登记在测试里（新增豁免须过目）', () => {
  // 触发侧最小集（量纲标记）
  for (const v of ['1.10℃', '16%', '45.1亿', '$3.2', '62 kg']) assert.ok(looksLikeNumericFact(v), v)
  // 豁免侧最小集（元数据）
  for (const v of ['58 BPM', '24h', '3 分钟', '5 个镜头', '1951–1980', '纯文案']) assert.equal(looksLikeNumericFact(v), false, v)
})
