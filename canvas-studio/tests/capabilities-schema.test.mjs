/**
 * CV-445 S4 能力地图 schema 校验（rea-video A5 吸收）。
 *
 * 三道闸（capability map 的纪律，见 capabilities/README.md）：
 *   1. schema：必填字段 / 枚举 / limits 形状 / id=文件名且全库唯一；
 *   2. 来源：limits 里每个结构化数字字段必须能对应 verified.basis（basis 必填且非空）；
 *   3. **90 天过期**：verified.date 超过 90 天即红 —— 模型规格漂移快，过期条目必须复核。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const MODELS_DIR = fileURLToPath(new URL('../capabilities/models/', import.meta.url))
const STATUSES = new Set(['ga', 'preview', 'limited', 'placeholder', 'shutdown'])
const CONFIDENCES = new Set(['high', 'medium', 'low'])
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000

function loadModels() {
  const files = readdirSync(MODELS_DIR).filter((f) => f.endsWith('.json')).sort()
  return files.map((file) => ({
    file,
    model: JSON.parse(readFileSync(join(MODELS_DIR, file), 'utf8')),
  }))
}

test('S4：能力地图 —— schema 必填字段与枚举', () => {
  const models = loadModels()
  assert.ok(models.length >= 3, `首批应登记 ≥3 个模型，实得 ${models.length}`)
  const seen = new Set()
  for (const { file, model } of models) {
    assert.equal(model.id, file.replace(/\.json$/, ''), `${file}: id 必须等于文件名`)
    assert.ok(!seen.has(model.id), `模型 id 重复：${model.id}`)
    seen.add(model.id)
    assert.ok(typeof model.name === 'string' && model.name !== '', `${model.id}: name 必须非空字符串`)
    assert.ok(STATUSES.has(model.status), `${model.id}: status 非法（${model.status}）`)
    assert.ok(Array.isArray(model.channels), `${model.id}: channels 必须是数组`)
    assert.ok(Array.isArray(model.primitives), `${model.id}: primitives 必须是数组`)
    const primSet = new Set(model.primitives)
    assert.equal(primSet.size, model.primitives.length, `${model.id}: primitives 不得重复`)
    assert.ok(model.limits !== null && typeof model.limits === 'object', `${model.id}: limits 缺失`)
    assert.ok(model.cost !== null && typeof model.cost === 'object', `${model.id}: cost 缺失`)
    assert.ok(typeof model.license === 'string' && model.license !== '', `${model.id}: license 必须非空`)
    assert.ok(model.verified !== null && typeof model.verified === 'object', `${model.id}: verified 缺失`)
    assert.equal(typeof model.verified.basis, 'string')
    assert.ok(model.verified.basis.length >= 10, `${model.id}: verified.basis 必须写明事实来源（≥10 字符）`)
    assert.ok(CONFIDENCES.has(model.verified.confidence), `${model.id}: confidence 非法`)
  }
})

test('S4：能力地图 —— ga 模型的结构化 limits 必须完整（placeholder 豁免）', () => {
  for (const { file, model } of loadModels()) {
    if (model.status !== 'ga') continue
    const duration = model.limits?.duration
    assert.ok(duration !== null && typeof duration === 'object', `${file}: ga 模型必须有 duration`)
    assert.equal(typeof duration.max, 'number', `${file}: duration.max 必须是数字`)
    assert.ok(duration.max > 0, `${file}: duration.max 必须 >0`)
    const refs = model.limits?.refs
    assert.ok(refs !== null && typeof refs === 'object', `${file}: ga 模型必须有 refs`)
    assert.equal(typeof refs.totalFiles, 'number', `${file}: refs.totalFiles 必须是数字（跨模态合计上限）`)
    assert.equal(typeof model.capabilities?.multi_shot, 'boolean', `${file}: ga 模型必须显式声明 capabilities.multi_shot（规划层消费）`)
  }
})

test('S4：能力地图 —— 90 天复核闸（过期即红，防规格静默漂移）', () => {
  const now = Date.now()
  for (const { file, model } of loadModels()) {
    const verified = model.verified ?? {}
    const date = Date.parse(`${verified.date}T00:00:00Z`)
    assert.ok(!Number.isNaN(date), `${file}: verified.date 非法（${verified.date}，需 ISO 日期）`)
    const ageDays = Math.floor((now - date) / (24 * 60 * 60 * 1000))
    assert.ok(
      now - date <= NINETY_DAYS_MS,
      `${file}: 规格已 ${ageDays} 天未复核（>90 天）—— 模型规格会漂移，请重新核对 verified.basis 列出的来源后更新 verified.date；不确认就先把 verified.confidence 降级`,
    )
  }
})
