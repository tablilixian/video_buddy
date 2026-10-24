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

// ── CV-360：manifestPath 传路径通道 + 尾部截断校验必须模型可见 ──

test('入参：manifestPath 已在 JSON Schema 里声明（CV-360 长片传路径通道）', () => {
  const params = renderTool().parameters?.properties ?? {}
  assert.ok(Object.prototype.hasOwnProperty.call(params, 'manifestPath'), `实际入参：${Object.keys(params).join(', ')}`)
  assert.ok(String(params.manifest?.description).includes('二选一'), 'manifest 描述应写明与 manifestPath 二选一')
  assert.ok(String(params.manifestPath?.description).includes('绝对路径'), 'manifestPath 描述应写明绝对路径要求')
})

test('工具描述：manifestPath 与「尾部完整性校验」对模型可见（描述不可见 = 能力不存在）', () => {
  const desc = renderTool().description
  assert.ok(desc.includes('manifestPath'), '描述必须提及 manifestPath 通道')
  assert.ok(desc.includes('尾部完整性校验'), '描述必须提及截断校验（模型据此理解报错并改传完整 manifest）')
  assert.ok(desc.includes('meta.durationInFrames 必须等于全部轨道的最大结束帧'), '描述必须写明判据')
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

// ── REQ-034 O-01：抽帧与渲染报告必须进**模型可见文本** ──
// schema 里有 ≠ 模型读得到。真机上 8 张抽帧已落盘、report 已进 payload，返回文本却只有
// url + 段数 ⇒ agent 自己 ls 资产目录、翻 /tmp、再用 ffmpeg 重抽一遍（白烧 3 次 VL）。
// 这里断言的是 `output.render` 拼出来的字符串，纯文本断言，能反向变红。

/** 一份 render_composition 的成功结果（宿主 `ComposeToolResult` 形状）。 */
function composeResultValue(overrides = {}) {
  return {
    url: '/canvas-studio/assets/p/final.mp4',
    width: 1280,
    height: 720,
    duration: 20.07,
    nodeId: 'node-ebb620b8',
    clipCount: 15,
    skippedCount: 0,
    audioComposition: 'native+bgm+voiceOver',
    ...overrides,
  }
}

function renderText(toolName, value) {
  const tool = createStudioTools({}, 3000).find((entry) => entry.name === toolName)
  assert.ok(tool?.output?.render, `${toolName} 必须声明 output.render`)
  return tool.output.render({}, value).map((block) => block.text ?? '').join('\n')
}

test('O-01：抽帧 url 与帧号必须进返回文本（否则 W6「先看抽帧再汇报」在真机上 100% 失效）', () => {
  const frames = [
    { frame: 0, url: '/canvas-studio/assets/p/f-000.png' },
    { frame: 155, url: '/canvas-studio/assets/p/f-155.png' },
    { frame: 310, url: '/canvas-studio/assets/p/f-310.png' },
  ]
  const text = renderText('render_composition', composeResultValue({ frames }))
  for (const sample of frames) {
    assert.ok(text.includes(sample.url), `返回文本必须含抽帧 url ${sample.url}，实际：\n${text}`)
    assert.ok(text.includes(`第 ${sample.frame} 帧`), `返回文本必须含帧号 ${sample.frame}，实际：\n${text}`)
  }
  assert.match(text, /抽帧 3 张/, `抽帧张数要写清，实际：\n${text}`)
})

test('O-01：渲染报告必须进返回文本（msPerFrame / quality / warm 可据此决策）', () => {
  const report = {
    quality: 'standard',
    frames: 600,
    totalMs: 35_000,
    msPerFrame: 58.3,
    encodeMs: 2100,
    bytes: 3.88 * 1024 * 1024,
    bitrateKbps: 1545,
    width: 1280,
    height: 720,
    sampledFrames: 3,
    warm: false,
  }
  const text = renderText('render_composition', composeResultValue({ frames: [], report }))
  assert.match(text, /渲染报告/, `必须有一行渲染报告，实际：\n${text}`)
  assert.match(text, /msPerFrame=58\.3/, `必须含每帧耗时，实际：\n${text}`)
  assert.match(text, /quality=standard/, `必须含质量档，实际：\n${text}`)
  assert.match(text, /warm=false/, `必须含暖机标记，实际：\n${text}`)
  assert.match(text, /35\.0s/, `必须含总耗时，实际：\n${text}`)
  assert.match(text, /1545kbps/, `必须含码率，实际：\n${text}`)
})

test('O-01：compose_video 没有 frames/report 时不得冒出空段（老调用方文本不变）', () => {
  const text = renderText('compose_video', composeResultValue())
  assert.ok(!text.includes('抽帧'), `没有抽帧就不该出现「抽帧」，实际：\n${text}`)
  assert.ok(!text.includes('渲染报告'), `没有报告就不该出现「渲染报告」，实际：\n${text}`)
  assert.match(text, /纳入 15 段/, `原有信息不能丢，实际：\n${text}`)
})
