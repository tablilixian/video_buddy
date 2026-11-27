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
import { Context } from '@deepseek-ai/cordis'
import { createScope, scopeTarget } from '@deepseek-ai/dsh-scope'
import { throwError } from '../lib/error-system.js'
import '../lib/errors/catalog.js'
import {
  STUDIO_ERROR_INFO_NAME,
  appendClockLine,
  decorateStudioToolResult,
  recordStudioToolFailure,
  registerStudioToolErrorBoundary,
  setSpecGateAutoResolver,
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

/**
 * ⚠️ 这条守的是「注册位置」，不是某段逻辑 —— 它必须是最难被误改的一条。
 *
 * 框架派发 `tools/execute` 用的 carrier 是 `scopeTarget(this, exec.agent)`
 * （`dsh-tools` 的 `dispatchScheduledExecution`），而 `dsh-scope` 的 `scopeTarget`
 * 只放行「无 scope 标签」与「agent scope 本身及其**祖先**」——「events flow up
 * the chain, never down」。canvas-studio 插件的 ctx 带自己的 scope 标签、与 agent
 * scope **平级**，所以 `ctx.on` 版本的中间件一次都不会被调用：码永远到不了客户端，
 * D2 也就无从按受众判断（本该只进日志的错误照样画红标）。
 *
 * 实测（2026-09-23）：`ctx.on` 命中 0 次 / `ctx.root.on` 命中 1 次；
 * 反向对照「把 agent scope 挂成插件 scope 的子」两者都命中 ⇒ 机制理解正确，
 * 不是测试写错。变异验证：把实现改回 `ctx.on` ⇒ 本条精确变红。
 */
test('注册守卫：中间件必须被 agent scope 的 tools/execute 派发命中（不能注册在插件自己的 scope）', async () => {
  const root = new Context()
  // 模拟 desktop 为 canvas-studio 插件 mint 的 scope —— 与 agent scope 平级。
  const pluginCtx = createScope(root, { role: 'canvas-studio plugin scope' }).ctx
  const agentKey = { role: 'agent scope' }
  createScope(root, agentKey)

  registerStudioToolErrorBoundary(pluginCtx)

  // 走真实路径：wrap 包住 execute → 抛错时暂存码 → 框架把异常降级成失败结果。
  const exec = { name: 'image_generate' }
  const wrapped = wrapStudioToolDefinition(
    tool(async () => { throwError('CS-NET-009', { detail: '非法下载地址: placeholder2' }) }),
  )
  let degraded
  try {
    await wrapped.execute({}, exec)
    assert.fail('应当抛出')
  } catch (err) {
    degraded = {
      isError: true,
      error: { message: err.message },
      content: [{ type: 'text', text: `Error: ${err.message}` }],
    }
  }

  const result = await root.waterfall(scopeTarget({}, agentKey), 'tools/execute', exec, () => degraded)
  assert.equal(
    result.error.info?.code,
    'CS-NET-009',
    '错误码没能穿过边界 —— 中间件多半被注册到了插件自己的 scope 上',
  )
  assert.equal(result.error.info?.name, STUDIO_ERROR_INFO_NAME)
})

/**
 * 2026-11-27 超级月亮会话实证的 P0：`write_storyboard` 已落盘（.666 写盘、.677 返回）
 * 却被报成 `CS-UNC-000 内部错误`。
 *
 * 根因是 `appendClockLine` 只会处理**框架形态**（`{content:[...]}`），而闸门提示是在
 * `wrapStudioToolDefinition` 里对**canonical 形态**（`{text}`）调用的 ⇒ `[...undefined]`
 * 抛 TypeError，被外层 catch 收敛成内部错误。
 *
 * 触发条件不是边角：auto（放手跑）模式下首次 `write_storyboard` 未先调意图卡时，
 * `guardSpecGate` 必返回非空提示 —— 也就是**每一次放手跑第一次写故事板都会踩到**，
 * 而那一次恰恰是故事板刚落盘 + 自动落地刚完成的那一笔。
 *
 * 反向变异：把 `appendClockLine` 改回 `[...result.content, block]` ⇒ 本条子测试精确变红。
 */
test('appendClockLine：canonical 形态（{text}）不得抛错，提示行要接在正文后面', () => {
  // ① 框架形态：追加成独立 content block（原行为保持不变）
  const framed = appendClockLine(
    { isError: false, value: null, content: [{ type: 'text', text: '正文' }] },
    'ℹ️ 提示',
  )
  assert.deepEqual(framed.content.map((block) => block.text), ['正文', 'ℹ️ 提示'])

  // ② canonical 形态：本项目工具的 execute 返回值，没有 content 字段
  const canonical = appendClockLine({ text: '故事板已落盘' }, 'ℹ️ 放手跑：意图卡已自动确认')
  assert.equal(canonical.text, '故事板已落盘\nℹ️ 放手跑：意图卡已自动确认')

  // ③ canonical 且正文为空：提示行独占，不要留下前导换行
  assert.equal(appendClockLine({ text: '' }, 'ℹ️ 提示').text, 'ℹ️ 提示')

  // ④ 认不出的形态：原样返回（宁可少一行提示，也不能把成功变失败）
  const shape = { ok: true }
  assert.equal(appendClockLine(shape, 'ℹ️ 提示'), shape)
})

test('放手跑首次 write_storyboard：闸门提示不得把成功结果变成内部错误', async () => {
  setSpecGateAutoResolver(async () => true)
  try {
    const wrapped = wrapStudioToolDefinition({
      name: 'write_storyboard',
      description: 'x',
      parameters: {},
      execute: async () => ({ text: '故事板已落盘（首稿已存为 **v1**）。' }),
    })
    const exec = { name: 'write_storyboard', agent: { session: { header: { id: 'session-append-clock-p0' } } } }

    // 旧实现会在此抛 TypeError（result.content is not iterable）
    const result = await wrapped.execute({}, exec)
    assert.match(String(result.text), /故事板已落盘/)
    assert.match(String(result.text), /放手跑/, '闸门自动代办必须留一行透明说明（看不见的决定等于没做）')
  } finally {
    setSpecGateAutoResolver(() => Promise.resolve(false))
  }
})
