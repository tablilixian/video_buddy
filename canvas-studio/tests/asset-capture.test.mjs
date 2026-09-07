/**
 * P4 画布产物捕获逻辑的冒烟测试（Node 内置 test runner）。
 *
 * 直连 Host 侧编译产物 lib/asset-capture.js（src/asset-capture.ts 只含
 * type-only 的 @deepseek-ai 导入，产物无运行时 dsh 依赖，可独立加载）。
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isStudioTool,
  extractAssetUrl,
  createAssetCaptureDefinition,
} from '../lib/asset-capture.js'

/** 合成 tool/call 事件。 */
function toolCallEvent(name, callId, args = '{}') {
  return { type: 'tool/call', data: { callId, name, arguments: args } }
}

/** 合成 tool/result 事件。 */
function toolResultEvent(callId, content, surfaceOp = 'append', error) {
  const data = { message: { source: { callId }, content } }
  if (error !== undefined) data.error = error
  return { type: 'tool/result', surfaceOp, data }
}

/** renderResult 产出的真实文本块形态。 */
function renderText(url, sizeText) {
  return [{ type: 'text', text: `已生成产物: ${url} (${sizeText})` }]
}

/**
 * 模拟 assembler 组装后的 ConversationMatch：真实框架把 match(event) 的
 * {id, role} 连同事件本身组装成带 event/location/role 的完整匹配，再交给
 * start / update。
 */
function matchOf(event) {
  return { event, role: event.type === 'tool/call' ? 'start' : 'update' }
}

const IMAGE_URL = 'http://127.0.0.1:8899/canvas-studio/assets/p1/abc.png'
const VIDEO_URL = 'http://127.0.0.1:8899/canvas-studio/assets/p1/xyz.mp4'

test('isStudioTool 认画布媒体工具，不认外部工具', () => {
  assert.equal(isStudioTool('image_generate'), true)
  assert.equal(isStudioTool('video_generate'), true)
  assert.equal(isStudioTool('video_composite'), true)
  assert.equal(isStudioTool('tool-bash'), false)
  assert.equal(isStudioTool(''), false)
})

test('2026-09-07 补漏：character_generate / compose_video / storyboard_split / inpaint 都在媒体白名单', () => {
  // character_generate 不在白名单时，tool/call 不建 start → tool/result 的
  // update 找不到挂载点 → reloadCanvas 永不触发，产物要切窗口才出现。
  for (const name of ['character_generate', 'compose_video', 'storyboard_split', 'inpaint']) {
    assert.equal(isStudioTool(name), true, `${name} 应属于画布媒体工具`)
  }
  const def = createAssetCaptureDefinition({ reloadCanvas: () => {}, getSelectedProjectId: () => null })
  assert.deepEqual(def.match(toolCallEvent('character_generate', 'cg1')), { id: 'cg1', role: 'start' })
  assert.deepEqual(def.match(toolCallEvent('compose_video', 'cv1')), { id: 'cv1', role: 'start' })
})

test('2026-09-07 补漏：剧本 / 文案 / 剧本提交在 WORKFLOW_TOOLS（结算触发 onToolFinished）', () => {
  const finished = []
  const def = createAssetCaptureDefinition({
    reloadCanvas: () => {},
    getSelectedProjectId: () => 'p1',
    onToolFinished: (projectId, toolName) => finished.push({ projectId, toolName }),
  })
  for (const name of ['write_screenplay', 'write_script', 'submit_screenplay_for_approval']) {
    assert.deepEqual(def.match(toolCallEvent(name, 'w1')), { id: 'w1', role: 'start' }, name)
    def.start({}, matchOf(toolCallEvent(name, 'w1')))
    def.update(
      { state: { toolName: name, sourceUrl: '', kind: 'workflow' } },
      matchOf(toolResultEvent('w1', [])),
    )
    assert.deepEqual(finished.at(-1), { projectId: 'p1', toolName: name }, `${name} 结算应回调 onToolFinished`)
  }
})

test('extractAssetUrl 从 renderResult 文本块抽取 URL', () => {
  assert.equal(extractAssetUrl(renderText(IMAGE_URL, '1024x1024')), IMAGE_URL)
  assert.equal(extractAssetUrl(renderText(VIDEO_URL, '1280x720, 5s')), VIDEO_URL)
  assert.equal(extractAssetUrl([{ type: 'reasoning', text: 'thinking' }]), null)
  assert.equal(extractAssetUrl([{ type: 'text', text: '没有链接' }]), null)
  assert.equal(extractAssetUrl(undefined), null)
})

test('match：画布工具 tool/call → start，其它工具 → null', () => {
  const def = createAssetCaptureDefinition({ reloadCanvas: () => {}, getSelectedProjectId: () => null })
  assert.deepEqual(def.match(toolCallEvent('image_generate', 'c1')), { id: 'c1', role: 'start' })
  assert.deepEqual(def.match(toolCallEvent('video_composite', 'c2')), { id: 'c2', role: 'start' })
  assert.equal(def.match(toolCallEvent('tool-bash', 'c3')), null)
})

test('match：画布工具 tool/result（任意 surfaceOp）→ update', () => {
  const def = createAssetCaptureDefinition({ reloadCanvas: () => {}, getSelectedProjectId: () => null })
  assert.deepEqual(
    def.match(toolResultEvent('c1', renderText(IMAGE_URL, '1024x1024'))),
    { id: 'c1', role: 'update' },
  )
  // 非 append / 缺少 surfaceOp 也视为 update（重载幂等，重复无害）
  assert.deepEqual(
    def.match(toolResultEvent('c1', renderText(IMAGE_URL, '1024x1024'), { op: 'replace', start: 1, end: 5 })),
    { id: 'c1', role: 'update' },
  )
  const noOp = {
    type: 'tool/result',
    data: { message: { source: { callId: 'c1' }, content: renderText(IMAGE_URL, '1024x1024') } },
  }
  assert.deepEqual(def.match(noOp), { id: 'c1', role: 'update' })
  // 注：tool/result 不按工具名过滤——框架按 callId 与已 start 的画布工具节点
  // 关联，reload 幂等，误匹配非画布工具结果也不会产生副作用。
})

test('start：toolName 与参考图参数进入 state', () => {
  const def = createAssetCaptureDefinition({ reloadCanvas: () => {}, getSelectedProjectId: () => null })
  const args = JSON.stringify({ imageUrl: IMAGE_URL, duration: 5 })
  const state = def.start(undefined, matchOf(toolCallEvent('video_generate', 'c1', args)))
  assert.equal(state.toolName, 'video_generate')
  assert.equal(state.sourceUrl, IMAGE_URL)
  const noRef = def.start(undefined, matchOf(toolCallEvent('image_generate', 'c1')))
  assert.equal(noRef.toolName, 'image_generate')
  assert.equal(noRef.sourceUrl, '')
})

test('update：选中项目时触发画布重载（无论结果文本是否含 URL）', () => {
  const reloaded = []
  const def = createAssetCaptureDefinition({
    reloadCanvas: (projectId) => reloaded.push(projectId),
    getSelectedProjectId: () => 'p1',
  })
  const state = def.start(undefined, matchOf(toolCallEvent('image_generate', 'c1')))
  def.update({ state }, matchOf(toolResultEvent('c1', renderText(IMAGE_URL, '1024x1024'))))
  assert.deepEqual(reloaded, ['p1'])
  // 即使是「生成失败」文本，只要选中了项目也会触发重载（幂等）
  const def2 = createAssetCaptureDefinition({
    reloadCanvas: (projectId) => reloaded.push(projectId),
    getSelectedProjectId: () => 'p1',
  })
  const s2 = def2.start(undefined, matchOf(toolCallEvent('image_generate', 'c2')))
  def2.update({ state: s2 }, matchOf(toolResultEvent('c2', [{ type: 'text', text: '生成失败' }])))
  assert.deepEqual(reloaded, ['p1', 'p1'])
})

test('update：未选中项目不触发重载', () => {
  const reloaded = []
  const def = createAssetCaptureDefinition({
    reloadCanvas: (projectId) => reloaded.push(projectId),
    getSelectedProjectId: () => null,
  })
  const state = def.start(undefined, matchOf(toolCallEvent('image_generate', 'c2')))
  def.update({ state }, matchOf(toolResultEvent('c2', renderText(IMAGE_URL, '1024x1024'))))
  assert.equal(reloaded.length, 0)
})

test('update：返回原 state（不吞状态）', () => {
  const def = createAssetCaptureDefinition({ reloadCanvas: () => {}, getSelectedProjectId: () => null })
  const state = def.start(undefined, matchOf(toolCallEvent('image_generate', 'c1')))
  const next = def.update({ state }, matchOf(toolResultEvent('c1', renderText(IMAGE_URL, '1024x1024'))))
  assert.equal(next, state)
})

test('start：选中项目时经 onToolCall 放置占位节点（kind/runId/arguments）', () => {
  const calls = []
  const def = createAssetCaptureDefinition({
    reloadCanvas: () => {},
    getSelectedProjectId: () => 'p1',
    onToolCall: (projectId, info) => calls.push({ projectId, info }),
  })
  const args = JSON.stringify({ prompt: '小船', imageUrl: IMAGE_URL, duration: 5 })
  def.start(undefined, matchOf(toolCallEvent('video_generate', 'c9', args)))
  assert.deepEqual(calls, [{
    projectId: 'p1',
    info: { toolName: 'video_generate', runId: 'c9', kind: 'video', arguments: args },
  }])
  // 无参考图参数时 arguments 保留原样（供 generationPrompt 重放）
  const calls2 = []
  const def2 = createAssetCaptureDefinition({
    reloadCanvas: () => {},
    getSelectedProjectId: () => 'p1',
    onToolCall: (projectId, info) => calls2.push(info),
  })
  def2.start(undefined, matchOf(toolCallEvent('image_generate', 'c10')))
  assert.deepEqual(calls2, [{ toolName: 'image_generate', runId: 'c10', kind: 'image', arguments: '{}' }])
})

test('start：未选中项目时不调用 onToolCall', () => {
  const calls = []
  const def = createAssetCaptureDefinition({
    reloadCanvas: () => {},
    getSelectedProjectId: () => null,
    onToolCall: (projectId, info) => calls.push({ projectId, info }),
  })
  def.start(undefined, matchOf(toolCallEvent('image_generate', 'c11')))
  assert.equal(calls.length, 0)
})

test('update：tool/result 携带 data.error 时经 onToolError 标记占位节点错误', () => {
  const errors = []
  const def = createAssetCaptureDefinition({
    reloadCanvas: () => {},
    getSelectedProjectId: () => 'p1',
    onToolError: (projectId, runId, message) => errors.push({ projectId, runId, message }),
  })
  const state = def.start(undefined, matchOf(toolCallEvent('image_generate', 'c12')))
  // 字符串错误
  def.update({ state }, matchOf(toolResultEvent('c12', [{ type: 'text', text: '失败' }], 'append', '生成失败: HTTP 500')))
  // 对象错误（{ message }）
  def.update({ state }, matchOf(toolResultEvent('c12', [{ type: 'text', text: '失败' }], 'append', { message: '超时' })))
  // 非对象错误兜底文案
  def.update({ state }, matchOf(toolResultEvent('c12', [{ type: 'text', text: '失败' }], 'append', 42)))
  assert.deepEqual(errors, [
    { projectId: 'p1', runId: 'c12', message: '生成失败: HTTP 500' },
    { projectId: 'p1', runId: 'c12', message: '超时' },
    { projectId: 'p1', runId: 'c12', message: '生成失败' },
  ])
})

test('update：tool/result 携带 data.error 时不再触发画布重载', () => {
  const reloaded = []
  const errors = []
  const def = createAssetCaptureDefinition({
    reloadCanvas: (projectId) => reloaded.push(projectId),
    getSelectedProjectId: () => 'p1',
    onToolError: (projectId, runId) => errors.push({ projectId, runId }),
  })
  const state = def.start(undefined, matchOf(toolCallEvent('image_generate', 'c13')))
  def.update({ state }, matchOf(toolResultEvent('c13', [{ type: 'text', text: '失败' }], 'append', '网络错误')))
  assert.equal(reloaded.length, 0)
  assert.deepEqual(errors, [{ projectId: 'p1', runId: 'c13' }])
})

test('update：data.error 且未选中项目时不触发任何 hook', () => {
  const reloaded = []
  const errors = []
  const def = createAssetCaptureDefinition({
    reloadCanvas: (projectId) => reloaded.push(projectId),
    getSelectedProjectId: () => null,
    onToolError: (projectId, runId) => errors.push({ projectId, runId }),
  })
  const state = def.start(undefined, matchOf(toolCallEvent('image_generate', 'c14')))
  def.update({ state }, matchOf(toolResultEvent('c14', [{ type: 'text', text: '失败' }], 'append', '网络错误')))
  assert.equal(reloaded.length, 0)
  assert.equal(errors.length, 0)
})
