/**
 * P0-1（REQ-038 R11 二轮，2026-11-16）：**工具 output schema 漂移闸**。
 *
 * ## 抓的是什么事故
 *
 * 结果对象里真实存在的键，若未在 output schema 里声明，`additionalProperties:false`
 * 会把**整条回执**判非法（不是丢字段，是全丢）。同类事故已经发生三次：
 *
 * - CV-146：`textFit` 漏声明 ⇒ 字段被静默剥掉；
 * - RQ-19：`recipeDensity` 只加在 TS 类型层，schema 漏声明 ⇒ 8 次成功渲染 8 次回执全丢；
 * - REQ-038 R11：`heightLimited` / `boxHeightPx` 加进了 `TextFitReportEntry`，schema 没跟上
 *   ⇒ 竖屏渲染回执整条被拒（真机二轮 +12:37 实录）。
 *
 * 编译期守卫（`RenderReportSchemaCoverage` 等 `MustBeNever` 类型）只覆盖 report 的**顶层**
 * 键 —— 嵌套对象（`textFit` 条目、`recipeDensity`、`lint` 条目……）漏声明它看不见。
 * 本测试是运行期闸：用**真跑产物**当样本（`auditTextFit` / `deriveRecipeDensity` 都是真函数），
 * 递归检查「样本的每个键 ⊆ schema 声明」。样本来自生产代码 ⇒ 类型加字段而 schema 不跟上
 * 会立刻红，不需要人记得更新本测试。
 *
 * 直连 Host 侧编译产物 `lib/`。定向跑：node --test tests/tool-output-schema-drift.test.mjs。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStudioTools } from '../lib/host-tools.js'
import { auditTextFit } from '../lib/remotion/text-fit-audit.js'
import { deriveRecipeDensity } from '../lib/remotion/render-report.js'

function renderTool() {
  const tool = createStudioTools({}, 3000).find((entry) => entry.name === 'render_composition')
  assert.ok(tool, 'render_composition 必须存在于工具表')
  return tool
}

/** 竖屏 manifest（盒高取竖屏格位投影的真实量级 ⇒ title/bullets 必触发 heightLimited）。 */
function sampleManifest() {
  const track = (id, type, extra) => ({ id, type, box: { x: 50, y: 50, w: 80, h: 20 }, startFrame: 0, durationInFrames: 90, fadeFrames: 0, ...extra })
  return {
    meta: { title: 'schema-drift', width: 1080, height: 1920, fps: 30, durationInFrames: 90 },
    tracks: [
      // h:7.2 ⇒ 盒高 138px < title 满号 149px —— R11 回归（§3.1）的真实触发条件
      track('t-title', 'textCard', { variant: 'title', text: '涨了为什么拿不住', box: { x: 50, y: 22, w: 76, h: 7.2 } }),
      track('t-bullets', 'textCard', { variant: 'bullets', text: '规则先写死\n临场决定', box: { x: 44, y: 52, w: 64, h: 20 } }),
      track('t-data', 'textCard', { variant: 'dataCard', text: '结论', data: [{ k: '规则', v: '99' }], dataRows: 1, box: { x: 50, y: 46, w: 46, h: 42 } }),
      track('t-sub', 'textCard', { variant: 'subtitle', text: '差在规则没写死' }),
      track('t-cap', 'caption', { text: '逐词字幕样本' }),
      track('t-bg', 'shape', { shape: 'rect', color: '#101828' }),
    ],
  }
}

/**
 * 递归检查：schema 里每个 `additionalProperties:false` 的对象节点，
 * 样本在该节点的键都必须 ∈ schema.properties。
 */
function schemaDrift(schema, value, path, problems) {
  if (schema === undefined || value === undefined || value === null) return
  if (Array.isArray(schema.type) === false && schema.type === 'array') {
    if (Array.isArray(value)) for (let i = 0; i < value.length; i++) schemaDrift(schema.items, value[i], `${path}[${i}]`, problems)
    return
  }
  if (schema.type !== 'object' || schema.additionalProperties !== false) return
  if (typeof value !== 'object' || Array.isArray(value)) return
  const declared = new Set(Object.keys(schema.properties ?? {}))
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) continue
    if (!declared.has(key)) problems.push(`${path}.${key}`)
    else schemaDrift(schema.properties[key], value[key], `${path}.${key}`, problems)
  }
}

/** render_composition 全量回执样本（report 嵌套对象全部来自真函数，不手写字段）。 */
function sampleValue(entries) {
  return {
    url: '/canvas-studio/assets/p/final.mp4',
    width: 1080,
    height: 1920,
    duration: 3.0,
    nodeId: 'node-schema-drift',
    clipCount: 1,
    skippedCount: 0,
    audioComposition: 'native+bgm+voiceOver',
    frames: [{ frame: 0, url: '/canvas-studio/assets/p/f-000.png' }],
    report: {
      quality: 'standard',
      frames: 90,
      totalMs: 4200,
      prepareMs: 2100,
      prepareFontMs: 900,
      prepareProbeMs: 300,
      prepareCapabilityMs: 120,
      renderMs: 2100,
      msPerFrame: 23.3,
      encodeDoneAtMs: 2000,
      bytes: 2.4 * 1024 * 1024,
      bitrateKbps: 6400,
      width: 1080,
      height: 1920,
      sampledFrames: 2,
      audio: { mutedVideoTracks: 0, audibleSources: 2 },
      animationWindows: [{ id: 't-title', start: 0, end: 90, kinds: ['opacity'] }],
      lint: [{ code: 'ML-01', at: 't-title', message: '样本体检行' }],
      lintPath: 'build/lint.md',
      loudnessLufs: -14.2,
      textFit: entries,
      recipeDensity: deriveRecipeDensity(sampleManifest()),
    },
  }
}

test('render_composition 回执样本的每个键都在 output schema 里声明（嵌套层也要 closed world）', () => {
  const entries = auditTextFit(sampleManifest(), 1080, 1920)
  assert.ok(entries.length >= 4, `textFit 样本条目太少（${entries.length}）：竖屏下 title/bullets 应都有 heightLimited`)
  assert.ok(entries.some((entry) => entry.heightLimited === true), '竖屏样本必须含 heightLimited=true 的条目（没有它本闸对 R11 回归不设防）')
  assert.ok(entries.some((entry) => entry.boxHeightPx !== undefined), '带 box 的文字轨必须报 boxHeightPx')

  const problems = []
  schemaDrift(renderTool().output?.schema, sampleValue(entries), 'value', problems)
  assert.deepEqual(problems, [], `schema 漏声明的键（加字段必须同步登记 output schema）：\n${problems.join('\n')}`)
})

test('反向变异：从 schema 里删掉 heightLimited ⇒ 闸必须报出（证明不是恒绿）', () => {
  const schema = structuredClone(renderTool().output?.schema)
  delete schema.properties.report.properties.textFit.items.properties.heightLimited
  const problems = []
  schemaDrift(schema, sampleValue(auditTextFit(sampleManifest(), 1080, 1920)), 'value', problems)
  assert.ok(
    problems.some((line) => line.includes('report.textFit') && line.endsWith('.heightLimited')),
    `删掉 heightLimited 后闸没响（实际：${JSON.stringify(problems)}）`,
  )
})

test('P0-1 配套：planTextFit 对外字号取整（浮点尾巴 46.75000000000001 不得进回执）', () => {
  const entries = auditTextFit(sampleManifest(), 1080, 1920)
  for (const entry of entries) {
    assert.ok(Number.isInteger(entry.fontPx), `${entry.id} fontPx=${entry.fontPx} 不是整数（plan 层取整失效）`)
  }
})

test('P0-1 配套：schema 的 fontPx / baseFontPx 是 number 不是 integer（契约不指望恒整型）', () => {
  const textFit = renderTool().output?.schema?.properties?.report?.properties?.textFit
  assert.equal(textFit?.items?.properties?.fontPx?.type, 'number', 'fontPx 声明成 integer 的话，缩号触底出小数的路径会把回执拒掉')
  assert.equal(textFit?.items?.properties?.baseFontPx?.type, 'number', 'baseFontPx 同上')
})
