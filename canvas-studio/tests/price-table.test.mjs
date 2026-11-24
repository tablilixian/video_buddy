/**
 * 本地价目表（`src/price-table.ts`）与 `capabilities/pricing.json` 的守卫。
 *
 * 这一层有两个「错了也看不出来」的失效模式，断言就是冲着它们写的：
 *
 * 1. **公式漂移**：表里的 rate 与后端不一致时，兜底值会安静地报错价。所以断言
 *    用的是方案 §1.1 的**实测数字**（21.1354 / 41.7792 / 90 / 30），不是「读表算表」
 *    （后者只能证明代码自己跟自己一致）。
 * 2. **拆解与总数不符**：明细加总 ≠ 总数时用户会以为被多扣。所以既有「加总严格
 *    等于 credits」的断言，也有「quote 与表算不一致就不给拆解」的安全闸断言。
 *
 * 运行：corepack yarn build && corepack yarn test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_TABLE_AGE_DAYS,
  ageDaysOf,
  breakdownOf,
  estimatePrice,
  isTableFresh,
  loadPriceTable,
  parsePriceTable,
  priceTableMeta,
} from '../lib/price-table.js'

/** 直连磁盘的真实表（与本仓 `capabilities/pricing.json` 同源）。 */
const table = loadPriceTable()

const image = (width, height, extra = {}) => ({
  model: 'image.krea2',
  operation: 'txt2image',
  input: { prompt: 'p', width, height, ...extra },
})
const video = (duration, megapixels = 1, operation = 'image2videofl2va') => ({
  model: 'video.minimax_h3',
  operation,
  input: { prompt: 'p', aspect: '16:9', megapixels, duration },
})

test('表能被读到，且 10 个 operation 齐全（缺一条就少一类兜底）', () => {
  assert.notEqual(table, null, 'capabilities/pricing.json 必须可读且结构合法')
  const operations = [...table.rules.keys()].sort()
  assert.deepEqual(operations, [
    'asr2txt',
    'image2character',
    'image2image',
    'image2videofl2va',
    'image2videoref2va',
    'image2vl',
    'txt2audio',
    'txt2image',
    'txt2speech',
    'video2vl',
  ])
  for (const rule of table.rules.values()) {
    assert.ok(Number.isFinite(Date.parse(rule.sampledAt)), `${rule.operation} 缺可解析的 sampledAt`)
  }
})

test('图片按面积复算：720P / 1080P / 小图与实测值一分不差', () => {
  const cases = [
    [1376, 768, 21.1354],
    [1920, 1088, 41.7792],
    [864, 480, 8.2944],
    [1024, 1024, 20.9715],
    [512, 512, 5.2429],
  ]
  for (const [width, height, expected] of cases) {
    const estimate = estimatePrice(image(width, height), table)
    assert.equal(estimate.credits, expected, `${width}×${height} 应为 ${expected}`)
    assert.equal(estimate.basis, 'pixels')
  }
})

test('图片跨模型同价（Krea2 与 Qwen 都是面积价，选错模型不该改价）', () => {
  const krea = estimatePrice(image(1376, 768, { model: 'image.krea2' }), table)
  const qwen = estimatePrice({ ...image(1376, 768), model: 'image.qwen-image-2.1' }, table)
  assert.equal(krea.credits, qwen.credits)
  assert.equal(qwen.modelMatched, true, '采样名单里的模型应精确命中')
})

test('图生图是 operation 级 ×1.25，不是「每张图 +2」', () => {
  const text = estimatePrice(image(1376, 768), table)
  const ref = estimatePrice({ ...image(1376, 768), model: 'image.qwen-image-2.1', operation: 'image2image' }, table)
  assert.equal(ref.credits, 26.4192, '实测：1376×768 图生图 = 26.4192')
  // 用容差而不是等号：先乘再舍入（后端）与先舍入再乘（测试）差 0.00005，等号会假红。
  assert.ok(Math.abs(ref.credits - text.credits * 1.25) <= 0.0001, '价差必须正好是 ×1.25 的量级')
  const labels = ref.lines.map(line => line.label)
  assert.ok(labels.includes('图生图系数'), '系数必须单独成行，否则用户看不懂为什么贵 25%')
})

test('视频只看时长：15s = 90，且三个清晰度同价（旧 UI 的 +6/+14 是凭空加的钱）', () => {
  const prices = [0.4, 1, 2].map(megapixels => estimatePrice(video(15, megapixels), table).credits)
  assert.deepEqual(prices, [90, 90, 90])
  for (const [duration, expected] of [[4, 24], [5, 30], [6, 36], [10, 60], [15, 90]]) {
    assert.equal(estimatePrice(video(duration), table).credits, expected, `${duration}s 应为 ${expected}`)
  }
})

test('视频拆解里「清晰度」必须存在且计 0（这是结论，不是凑数）', () => {
  const estimate = estimatePrice(video(15, 2), table)
  const resolutionLine = estimate.lines.find(line => line.label === '清晰度')
  assert.ok(resolutionLine !== undefined, '没有这一行，用户会继续以为分辨率要加钱')
  assert.equal(resolutionLine.credits, 0)
  assert.match(resolutionLine.detail, /不计价/)
})

test('拆解行加总严格等于总额（差 0.0001 也会让用户以为算错了）', () => {
  const requests = [
    image(1376, 768),
    image(1920, 1088),
    { ...image(1376, 768), model: 'image.qwen-image-2.1', operation: 'image2image' },
    video(15, 2),
    video(4, 0.4),
    { model: 'video.minimax_h3', operation: 'image2videoref2va', input: { prompt: 'p', duration: 10, megapixels: 1 } },
    { model: 'image.krea2', operation: 'image2character', input: {} },
    { model: 'audio.yue2', operation: 'txt2audio', input: { prompt: 'p', duration: 30 } },
  ]
  for (const request of requests) {
    const estimate = estimatePrice(request, table)
    assert.notEqual(estimate, null, `${request.operation} 应可推算`)
    const total = estimate.lines.reduce((sum, line) => sum + line.credits, 0)
    assert.equal(Math.round(total * 10_000) / 10_000, estimate.credits, `${request.operation} 拆解加总必须等于 ${estimate.credits}`)
  }
})

test('固定价项不吃尺寸：角色四视图空 input 也是 30', () => {
  const character = estimatePrice({ model: 'image.krea2', operation: 'image2character', input: {} }, table)
  assert.equal(character.credits, 30)
  assert.equal(character.basis, 'flat')
  for (const [operation, model, expected] of [
    ['image2vl', 'image.qwen3-vl', 4],
    ['video2vl', 'video.qwen3-vl', 8],
    ['txt2speech', 'audio.voxcpm2', 3],
    ['asr2txt', 'audio.fast-whisper', 3],
  ]) {
    assert.equal(estimatePrice({ model, operation, input: {} }, table).credits, expected, `${operation} 应为 ${expected}`)
  }
})

test('不知道就返回 null：未知 operation / 缺时长都不许按 0 算', () => {
  assert.equal(estimatePrice({ model: 'x', operation: 'unknown_op', input: {} }, table), null)
  assert.equal(estimatePrice({ model: 'video.minimax_h3', operation: 'image2videofl2va', input: {} }, table), null, '缺 duration 时不知道多少钱')
  assert.equal(estimatePrice(image(0, 768), table), null, '面积为 0 不是「0 积分」，是参数缺失')
  assert.equal(estimatePrice(image(1376, 768), null), null, '没有表就没有兜底')
})

test('拆解只在与服务端报价一致时给（后端改价后必须闭嘴）', () => {
  const request = image(1376, 768)
  const lines = breakdownOf(request, 21.1354, table)
  assert.ok(Array.isArray(lines) && lines.length > 0)
  assert.equal(breakdownOf(request, 21.14, table), null, '差 0.0046 已经不是舍入误差')
  assert.equal(breakdownOf(request, 30, table), null)
})

test('表龄：>7 天不新鲜、未来时间按 0 天（不许负数把新鲜度关掉）', () => {
  const old = parsePriceTable({
    sampled_at: '2020-01-01T00:00:00.000+08:00',
    rules: [{ operation: 'txt2image', models: ['image.krea2'], basis: 'pixels', rate: 0.00002 }],
  })
  assert.notEqual(old, null)
  assert.equal(isTableFresh(old), false)
  assert.ok(ageDaysOf(old.sampledAt) > MAX_TABLE_AGE_DAYS)

  const future = parsePriceTable({
    sampled_at: '2099-01-01T00:00:00.000+08:00',
    rules: [{ operation: 'txt2image', models: ['image.krea2'], basis: 'pixels', rate: 0.00002 }],
  })
  assert.equal(ageDaysOf(future.sampledAt), 0, '时钟回拨不该让表永远「新鲜」')
  assert.equal(isTableFresh(future), true)
})

test('坏表整体作废、坏规则只丢那条（不许一条脏数据废掉整张表）', () => {
  assert.equal(parsePriceTable({ sampled_at: 'not-a-date', rules: [] }), null)
  assert.equal(parsePriceTable({ rules: [] }), null, '缺 sampled_at 的表无法判新鲜度')
  assert.equal(parsePriceTable({ sampled_at: '2026-11-24T11:20:00.000+08:00', rules: [] }), null, '空表等于没有表')
  const partial = parsePriceTable({
    sampled_at: '2026-11-24T11:20:00.000+08:00',
    rules: [
      { operation: 'txt2image', models: ['image.krea2'], basis: 'pixels', rate: 0.00002 },
      { operation: 'bad', basis: 'pixels', rate: 'free' },
      { operation: 'bad2', basis: 'per-frame', rate: 1 },
    ],
  })
  assert.notEqual(partial, null)
  assert.deepEqual([...partial.rules.keys()], ['txt2image'])
})

test('元信息给 UI 用：采样时间 / 表龄 / 规则数', () => {
  const meta = priceTableMeta(table)
  assert.notEqual(meta, null)
  assert.equal(meta.rules, 10)
  assert.ok(Number.isFinite(meta.ageDays) && meta.ageDays >= 0)
  assert.equal(typeof meta.fresh, 'boolean')
  assert.equal(priceTableMeta(null), null)
})
