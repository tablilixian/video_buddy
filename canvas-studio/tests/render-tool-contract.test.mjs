/**
 * REQ-034 · 三期：`render_composition` 的**工具契约**回归（W5-3 / W6-1 / W6-2）。
 *
 * 抓的是什么：`defineTool` 会把入参归一成 JSON Schema，而结果 schema 一旦漏声明字段，
 * 在 `additionalProperties: false` 下会被**静默丢弃** —— 工具跑了、报告没回来、没有任何报错。
 * 这类缺口靠人眼 review 不可靠（类型层只保证结果对象里有，不保证 schema 里有）。
 *
 * 直连 Host 侧编译产物 `lib/host-tools.js`。
 * 定向跑：node --test tests/render-tool-contract.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStudioTools } from '../lib/host-tools.js'

function renderTool() {
  const tool = createStudioTools({}, 3000).find((entry) => entry.name === 'render_composition')
  assert.ok(tool, 'render_composition 必须存在于工具表')
  return tool
}

test('入参：quality 已在 JSON Schema 里声明（否则模型传了也会被 schema 丢掉）', () => {
  const params = renderTool().parameters?.properties ?? {}
  assert.ok(Object.prototype.hasOwnProperty.call(params, 'quality'), `实际入参：${Object.keys(params).join(', ')}`)
  assert.deepEqual(params.quality.enum, ['draft', 'standard', 'high'])
  assert.ok(Object.prototype.hasOwnProperty.call(params, 'manifest'))
})

test('结果：frames / report 已在结果 schema 里声明（additionalProperties:false 下漏声明＝静默丢失）', () => {
  const schema = renderTool().output?.schema
  assert.ok(schema, 'render_composition 应声明结果 schema')
  const properties = schema.properties ?? {}
  assert.ok(Object.prototype.hasOwnProperty.call(properties, 'frames'), `实际结果字段：${Object.keys(properties).join(', ')}`)
  assert.ok(Object.prototype.hasOwnProperty.call(properties, 'report'), `实际结果字段：${Object.keys(properties).join(', ')}`)
  // `url` 是既有主产物，不能被新字段挤掉（老调用方按它取成片）
  assert.ok(Object.prototype.hasOwnProperty.call(properties, 'url'))
})

test('结果：report 内部字段与宿主 `RenderJobReport` 对齐（耗时 / 码率 / 抽帧数 / 质量档）', () => {
  const report = renderTool().output?.schema?.properties?.report
  assert.ok(report, 'report 必须有内联结构，否则 agent 读到的是不透明对象')
  const fields = Object.keys(report.properties ?? {})
  for (const key of ['quality', 'frames', 'totalMs', 'msPerFrame', 'encodeMs', 'bytes', 'bitrateKbps', 'sampledFrames', 'warm']) {
    assert.ok(fields.includes(key), `report 缺少字段 ${key}（实际：${fields.join(', ')}）`)
  }
})
