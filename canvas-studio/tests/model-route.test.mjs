/**
 * R-P1-03：模型路由统一决策点（routeImageModel）单测。
 *
 * 覆盖：
 *  - 路由表每一行至少一个理由码用例（t2i 默认 / 文字渲染 / 图生图 / 改字 / 角色卡）；
 *  - C-12 回归：同一条链路两次提交现算改道（含中文 → Qwen；删掉中文 → Krea2）；
 *  - 设置显式指定优先级；否定引号不触发文字渲染（CV-218 判据复用）；
 *  - 路由表 endpoint 与 DRAMA_ENDPOINTS 常量同源（防手写字符串漂移）。
 *
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MODEL_ROUTE_TABLE, normalizeImageModelOverride, routeImageModel } from '../lib/model-route.js'
import { DRAMA_ENDPOINTS } from '../lib/config.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, '..', rel), 'utf8')

const route = (overrides) => routeImageModel({
  tool: 'image_generate',
  prompt: '一只白猫坐在窗台上',
  hasReferences: false,
  ...overrides,
})

test('路由表与 DRAMA_ENDPOINTS 常量同源（不得手写端点字符串）', () => {
  assert.equal(MODEL_ROUTE_TABLE.t2iDefault, DRAMA_ENDPOINTS.txt2image)
  assert.equal(MODEL_ROUTE_TABLE.textRender, DRAMA_ENDPOINTS.txt2imageWithtxt)
  assert.equal(MODEL_ROUTE_TABLE.imageEdit, DRAMA_ENDPOINTS.image2image)
  assert.equal(MODEL_ROUTE_TABLE.textFix, DRAMA_ENDPOINTS.image2fix)
  assert.equal(MODEL_ROUTE_TABLE.character4v, DRAMA_ENDPOINTS.character)
})

test('拍板第一版：纯文生图无文字 → Krea2（default-t2i）', () => {
  assert.deepEqual(route(), { endpoint: MODEL_ROUTE_TABLE.t2iDefault, reason: 'default-t2i' })
})

test('拍板第一版：提示词含未被否定的引号文字 → Qwen 文字渲染（text-render）', () => {
  assert.deepEqual(
    route({ prompt: '生成一张海报，片名「剑归江湖」用大字竖排' }),
    { endpoint: MODEL_ROUTE_TABLE.textRender, reason: 'text-render' },
  )
  assert.equal(route({ prompt: '价格标签写 "SALE 50% OFF"' }).reason, 'text-render')
})

test('否定引号不触发文字渲染（复用 CV-218 判据）：不要"水墨"风格 → Krea2', () => {
  assert.equal(route({ prompt: '生成山水画，不要"水墨"风格' }).reason, 'default-t2i')
})

test('带参考图 → 图生图（i2i-references），引号文字不改变结果', () => {
  assert.deepEqual(
    route({ hasReferences: true, prompt: '把这张图改成片名「剑归江湖」的版本' }),
    { endpoint: MODEL_ROUTE_TABLE.imageEdit, reason: 'i2i-references' },
  )
})

test('C-12 回归：withtxt 工具两次提交现算改道（含中文 → Qwen；删掉中文 → Krea2）', () => {
  const withText = route({ tool: 'image_generate_withtxt', prompt: '海报，标题《剑归江湖》' })
  assert.equal(withText.endpoint, MODEL_ROUTE_TABLE.textRender)
  const textRemoved = route({ tool: 'image_generate_withtxt', prompt: 'a misty mountain poster' })
  assert.equal(textRemoved.endpoint, MODEL_ROUTE_TABLE.t2iDefault)
  assert.equal(textRemoved.reason, 'default-t2i')
})

test('设置显式指定覆盖 t2i 两条判据（explicit-setting），但不覆盖改图 / 角色卡 / 图生图', () => {
  assert.deepEqual(
    route({ setting: MODEL_ROUTE_TABLE.textRender }),
    { endpoint: MODEL_ROUTE_TABLE.textRender, reason: 'explicit-setting' },
  )
  assert.equal(
    route({ setting: MODEL_ROUTE_TABLE.t2iDefault, prompt: '海报，标题《剑归江湖》' }).reason,
    'explicit-setting',
  )
  assert.equal(route({ tool: 'image_fix', setting: MODEL_ROUTE_TABLE.textRender }).reason, 'text-fix')
  assert.equal(
    route({ tool: 'character_generate', setting: MODEL_ROUTE_TABLE.textRender }).reason,
    'character-4v',
  )
  assert.equal(
    route({ hasReferences: true, setting: MODEL_ROUTE_TABLE.textRender }).reason,
    'i2i-references',
  )
})

test('image_fix / character_generate 按工具语义固定路由', () => {
  assert.deepEqual(
    route({ tool: 'image_fix', prompt: '把标题 "SALLE" 改成 "SALE"' }),
    { endpoint: MODEL_ROUTE_TABLE.textFix, reason: 'text-fix' },
  )
  assert.deepEqual(
    route({ tool: 'character_generate', prompt: '' }),
    { endpoint: MODEL_ROUTE_TABLE.character4v, reason: 'character-4v' },
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
    { endpoint: MODEL_ROUTE_TABLE.textRender, reason: 'node-override-text-render' },
  )
  assert.deepEqual(
    route({ tool: 'image_generate', prompt: '含文字 "标题" 的提示词', hasReferences: false, override: 'krea2' }),
    { endpoint: MODEL_ROUTE_TABLE.t2iDefault, reason: 'node-override-krea2' },
  )
  // 带参考车道不受覆盖影响（图生图不是「默认生图模型」能指配的语义）。
  assert.deepEqual(
    route({ tool: 'image_generate', prompt: 'x', hasReferences: true, override: 'textRender' }),
    { endpoint: MODEL_ROUTE_TABLE.imageEdit, reason: 'i2i-references' },
  )
  // fix / 角色车道不受影响。
  assert.deepEqual(
    route({ tool: 'image_fix', prompt: 'x', override: 'krea2' }),
    { endpoint: MODEL_ROUTE_TABLE.textFix, reason: 'text-fix' },
  )
})

test('REQ-029：normalizeImageModelOverride 兜底纪律（不认识的值一律未指定）', () => {
  assert.equal(normalizeImageModelOverride('textRender'), 'textRender')
  assert.equal(normalizeImageModelOverride('krea2'), 'krea2')
  assert.equal(normalizeImageModelOverride('seeddance'), undefined)
  assert.equal(normalizeImageModelOverride(undefined), undefined)
})
