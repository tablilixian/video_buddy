/**
 * R-P1-03：模型路由统一决策点（routeImageModel）单测。
 *
 * 覆盖：
 *  - 路由表每一行至少一个理由码用例（t2i 默认 / 文字渲染 / 图生图 / 角色卡）；
 *  - C-12 回归：同一条链路两次提交现算改道（含中文 → Qwen；删掉中文 → Krea2）；
 *  - 设置显式指定优先级；否定引号不触发文字渲染（CV-218 判据复用）；
 *  - 迁移 B3-2（2026-11-22）：路由输出 = 业务 API 模型 code + operation（目录实测
 *    见 docs/api-probe/generation-migration-20261122/report.md）；image_fix（Boogu
 *    改字）下线——路由不再有 text-fix 语义。
 *
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MODEL_ROUTE_TABLE, normalizeDefaultImageModelSetting, normalizeImageModelOverride, routeImageModel } from '../lib/model-route.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, '..', rel), 'utf8')

const route = (overrides) => routeImageModel({
  tool: 'image_generate',
  prompt: '一只白猫坐在窗台上',
  hasReferences: false,
  ...overrides,
})

test('路由表：业务 API 模型 code + operation（探测报告实测值）', () => {
  assert.deepEqual(MODEL_ROUTE_TABLE.t2iDefault, { model: 'image.krea2', operation: 'txt2image' })
  assert.deepEqual(MODEL_ROUTE_TABLE.textRender, { model: 'image.qwen-image-2.1', operation: 'txt2image' })
  assert.deepEqual(MODEL_ROUTE_TABLE.imageEdit, { model: 'image.qwen-image-2.1', operation: 'image2image' })
  assert.deepEqual(MODEL_ROUTE_TABLE.character4v, { model: 'image.krea2', operation: 'image2character' })
  // Boogu 改字特化已下线：路由表不再有 textFix 行。
  assert.ok(!('textFix' in MODEL_ROUTE_TABLE))
})

test('拍板第一版：纯文生图无文字 → Krea2（default-t2i）', () => {
  assert.deepEqual(route(), { model: 'image.krea2', operation: 'txt2image', reason: 'default-t2i' })
})

test('拍板第一版：提示词含未被否定的引号文字 → Qwen 文字渲染（text-render）', () => {
  assert.deepEqual(
    route({ prompt: '生成一张海报，片名「剑归江湖」用大字竖排' }),
    { model: 'image.qwen-image-2.1', operation: 'txt2image', reason: 'text-render' },
  )
  assert.equal(route({ prompt: '价格标签写 "SALE 50% OFF"' }).reason, 'text-render')
})

test('否定引号不触发文字渲染（复用 CV-218 判据）：不要"水墨"风格 → Krea2', () => {
  assert.equal(route({ prompt: '生成山水画，不要"水墨"风格' }).reason, 'default-t2i')
})

test('带参考图 → 图生图（i2i-references），引号文字不改变结果', () => {
  assert.deepEqual(
    route({ hasReferences: true, prompt: '把这张图改成片名「剑归江湖」的版本' }),
    { model: 'image.qwen-image-2.1', operation: 'image2image', reason: 'i2i-references' },
  )
})

test('C-12 回归：withtxt 工具两次提交现算改道（含中文 → Qwen；删掉中文 → Krea2）', () => {
  const withText = route({ tool: 'image_generate_withtxt', prompt: '海报，标题《剑归江湖》' })
  assert.equal(withText.model, MODEL_ROUTE_TABLE.textRender.model)
  const textRemoved = route({ tool: 'image_generate_withtxt', prompt: 'a misty mountain poster' })
  assert.equal(textRemoved.model, MODEL_ROUTE_TABLE.t2iDefault.model)
  assert.equal(textRemoved.reason, 'default-t2i')
})

test('设置显式指定覆盖 t2i 两条判据（explicit-setting），但不覆盖角色卡 / 图生图', () => {
  assert.deepEqual(
    route({ setting: 'image.qwen-image-2.1' }),
    { model: 'image.qwen-image-2.1', operation: 'txt2image', reason: 'explicit-setting' },
  )
  assert.equal(
    route({ setting: 'image.krea2', prompt: '海报，标题《剑归江湖》' }).reason,
    'explicit-setting',
  )
  assert.equal(
    route({ tool: 'character_generate', setting: 'image.qwen-image-2.1' }).reason,
    'character-4v',
  )
  assert.equal(
    route({ hasReferences: true, setting: 'image.qwen-image-2.1' }).reason,
    'i2i-references',
  )
})

test('character_generate 按工具语义固定路由（image_fix 已下线）', () => {
  assert.deepEqual(
    route({ tool: 'character_generate', prompt: '' }),
    { model: 'image.krea2', operation: 'image2character', reason: 'character-4v' },
  )
})

test('守卫：两个图像工具 description 都插值了路由摘要（一处事实两处消费）', () => {
  const hostTools = read('src/host-tools.ts')
  const hits = hostTools.split('ROUTE_SUMMARY').length - 1
  assert.ok(hits >= 2, `image_generate / image_generate_withtxt 描述必须插值 ROUTE_SUMMARY（当前 ${hits} 处）`)
})

test('REQ-029 拍板④（CV-281 Step 4）：节点级模型覆盖只在纯文生车道生效', () => {
  // 覆盖优先于设置页（更具体的作用域），但压不过带参考车道。
  assert.deepEqual(
    route({ tool: 'image_generate', prompt: 'plain prompt', hasReferences: false, override: 'textRender' }),
    { model: 'image.qwen-image-2.1', operation: 'txt2image', reason: 'node-override-text-render' },
  )
  assert.deepEqual(
    route({ tool: 'image_generate', prompt: '含文字 "标题" 的提示词', hasReferences: false, override: 'krea2' }),
    { model: 'image.krea2', operation: 'txt2image', reason: 'node-override-krea2' },
  )
  // 带参考车道不受覆盖影响（图生图不是「默认生图模型」能指配的语义）。
  assert.deepEqual(
    route({ tool: 'image_generate', prompt: 'x', hasReferences: true, override: 'textRender' }),
    { model: 'image.qwen-image-2.1', operation: 'image2image', reason: 'i2i-references' },
  )
})

test('REQ-029：normalizeImageModelOverride 兜底纪律（不认识的值一律未指定）', () => {
  assert.equal(normalizeImageModelOverride('textRender'), 'textRender')
  assert.equal(normalizeImageModelOverride('krea2'), 'krea2')
  assert.equal(normalizeImageModelOverride('seeddance'), undefined)
  assert.equal(normalizeImageModelOverride(undefined), undefined)
})

test('迁移 B3-2：设置页历史值（端点路径）→ 模型 code 双向识别', () => {
  assert.equal(normalizeDefaultImageModelSetting('image.qwen-image-2.1'), 'image.qwen-image-2.1')
  assert.equal(normalizeDefaultImageModelSetting('image.krea2'), 'image.krea2')
  // 旧端点路径设置值迁移。
  assert.equal(normalizeDefaultImageModelSetting('txt2image_withtxt'), 'image.qwen-image-2.1')
  assert.equal(normalizeDefaultImageModelSetting('txt2image'), 'image.krea2')
  assert.equal(normalizeDefaultImageModelSetting(''), undefined)
  assert.equal(normalizeDefaultImageModelSetting('image2image'), undefined, '非 t2i 语义不是「默认生图模型」')
})
