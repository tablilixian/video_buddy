/**
 * 工具边界（结构化错误出口）单测 —— 打通「错误码穿过 tool/result 到客户端」的关键环节。
 *
 * 直连 `lib/tool-error-boundary.js`（只含 type-only 的 dsh 导入，产物无运行时依赖）。
 *
 * 为什么必须测：
 *  - 框架只对 `HarnessError` 记结构化身份，而本项目里 canvas-studio 与宿主各有一份
 *    `dsh-llm` 实体副本 ⇒ 跨副本 `instanceof` 失效，只能靠本模块注入。这条通路一旦
 *    断了，客户端就退回「靠字符串匹配」（并会像旧实现那样读出 `error.message` 恒
 *    undefined ⇒ 所有失败都显示「生成失败」）。
 *  - `decorateStudioToolResult` 的两条「不写」规则是防回归点：不能被成功结果误用，
 *    更**不能覆盖**框架自己写入的 `TOOL_ABORTED`（否则「用户按了取消」会被当成业务失败）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { throwError } from '../lib/error-system.js'
import '../lib/errors/catalog.js'
import {
  STUDIO_ERROR_INFO_NAME,
  decorateStudioToolResult,
  recordStudioToolFailure,
  takePending,
  wrapStudioToolDefinition,
} from '../lib/tool-error-boundary.js'

/** 造一条工具定义（与 defineTool 的产物同形：普通对象 + execute）。 */
function tool(execute, extra = {}) {
  return { name: 'image_generate', description: 'x', parameters: { a: 1 }, execute, ...extra }
}

test('wrapStudioToolDefinition：保留其余字段（description/parameters/name）', () => {
  const wrapped = wrapStudioToolDefinition(tool(async () => ({ ok: true })))
  assert.equal(wrapped.name, 'image_generate')
  assert.equal(wrapped.description, 'x')
  assert.deepEqual(wrapped.parameters, { a: 1 })
})

test('wrapStudioToolDefinition：成功路径原样透传返回值', async () => {
  const wrapped = wrapStudioToolDefinition(tool(async () => ({ url: 'http://x/y.png' })))
  assert.deepEqual(await wrapped.execute({}, {}), { url: 'http://x/y.png' })
})

test('wrapStudioToolDefinition：抛出的已登记码被保留，并把码暂存给中间件', async () => {
  const exec = {}
  const wrapped = wrapStudioToolDefinition(tool(async () => { throwError('CS-NET-009') }))
  await assert.rejects(
    () => wrapped.execute({}, exec),
    (err) => {
      assert.equal(err.code, 'CS-NET-009')
      // 交给模型看的是 userMessage（已脱敏），不是内部细节。
      assert.equal(err.message, err.userMessage)
      assert.ok(!err.message.includes('http'), 'userMessage 不得含地址')
      return true
    },
  )
  // 中间件拿不到原始异常，只能靠这份暂存 —— 这是两半之间的唯一契约。
  const pending = takePending(exec)
  assert.equal(pending?.code, 'CS-NET-009')
  assert.ok(pending.devDetail.length > 0, 'devDetail 应携带排障细节以便落日志')
})

test('wrapStudioToolDefinition：遗留裸异常收敛为 CS-UNC-000（不是原样外泄）', async () => {
  const exec = {}
  const wrapped = wrapStudioToolDefinition(tool(async () => { throw new Error('ENOENT /Users/secret/path') }))
  await assert.rejects(() => wrapped.execute({}, exec), /操作未完成|内部错误/)
  assert.equal(takePending(exec)?.code, 'CS-UNC-000')
})

test('takePending：同一 exec 只取一次（不重复注入），非对象 exec 安全返回 undefined', () => {
  // `throwError` 是立即抛出（返回类型 never），先捕获实例再交给边界。
  let thrown
  try { throwError('CS-USER-ERR', { message: 'x' }) } catch (err) { thrown = err }
  const exec = {}
  recordStudioToolFailure(thrown, exec)
  assert.equal(takePending(exec)?.code, 'CS-USER-ERR')
  assert.equal(takePending(exec), undefined, '取过一次后应清除，避免下次调用误用同一条')
  assert.equal(takePending(undefined), undefined)
  assert.equal(takePending(null), undefined)
  assert.equal(takePending('not-an-object'), undefined)
})

test('decorateStudioToolResult：给失败结果补 error.info（框架据此填 tool/result 的 data.error）', () => {
  const failure = { isError: true, error: { message: '下载地址不安全' }, content: [] }
  const decorated = decorateStudioToolResult(failure, 'CS-NET-009')
  assert.deepEqual(decorated.error.info, { name: STUDIO_ERROR_INFO_NAME, code: 'CS-NET-009' })
  // 原结果不被就地改写（纯函数）。
  assert.equal(failure.error.info, undefined)
})

test('decorateStudioToolResult：成功结果不加 error', () => {
  const success = { isError: false, value: { url: 'http://x/y.png' }, content: [] }
  assert.deepEqual(decorateStudioToolResult(success, 'CS-USER-ERR'), success)
})

test('decorateStudioToolResult：不覆盖框架自己的结构化身份（用户取消 / 超时）', () => {
  // 站在「用户按了 Esc」这一侧：框架已写入 TOOL_ABORTED，业务码不得把它顶掉，
  // 否则客户端会把主动取消当成业务失败，画布上无端出现红标。
  const aborted = { isError: true, error: { message: 'tool call aborted', info: { name: 'AbortError', code: 'TOOL_ABORTED' } }, content: [] }
  assert.deepEqual(decorateStudioToolResult(aborted, 'CS-USER-ERR'), aborted)
})
