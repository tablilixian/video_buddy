/**
 * 2026-11-04 · 科普 0.1 验收 P6：`ask_user_choice` 的**失败兜底**。
 *
 * 事故（A8 收口）：工具报 `Error: 操作未完成（内部错误），请重试或联系开发。`
 * ⇒ **4 个方案全部丢失、turn 直接结束** —— 用户拿到的是"需要你定方向"然后**没有下文**，
 * 整批验收卡死。原实现里 catch 分支清掉挂起问题后直接 `throw cause`，异常冲出工具边界
 * 把整个 turn 带崩。
 *
 * 本文件钉两件事（双向）：
 * ① 非 abort 的内部故障 ⇒ **不得抛异常**，必须回退到"文字列举 + 默认建议"；
 * ② 用户主动打断（abort）⇒ 照旧外抛，**不得**被兜底吞掉（吞了就变成"假装问过"）。
 *
 * 直连 Host tsc 编译产物 lib/host-tools.js。
 * 定向跑：node --test tests/ask-user-choice-fallback.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStudioTools } from '../lib/host-tools.js'

const PROJECT_DIR = '/tmp/cs-ask-fallback'

/**
 * 假 registry：`failAfterFirst` 复刻「挂起问题落库成功、轮询时读工作区失败」这条真实故障路径
 * （第一次 getProject 成功拿 mode，第二次在轮询里抛）。
 */
function makeRegistry(options = {}) {
  const project = {
    id: 'p1',
    name: 'P1',
    dir: PROJECT_DIR,
    createdAt: '1',
    updatedAt: '1',
    workflow: { mode: 'confirm', state: 'planning' },
  }
  let getCalls = 0
  const pending = []
  return {
    list: async () => [project],
    getProject: async () => {
      getCalls += 1
      if (options.failAfterFirst === true && getCalls > 1) throw new Error('模拟宿主内部故障')
      return project
    },
    setPendingQuestion: async (_id, value) => { pending.push(value) },
    _pending: pending,
  }
}

const exec = (overrides = {}) => ({
  agent: { session: { header: { cwd: PROJECT_DIR } } },
  signal: { aborted: false, reason: undefined },
  concludeTurn: () => {},
  ...overrides,
})

const askTool = (registry) => {
  const tool = createStudioTools(registry, 3000).find((t) => t.name === 'ask_user_choice')
  assert.ok(tool, 'ask_user_choice 工具应存在')
  return tool
}

const ARGS = { question: '成片要什么节奏？', options: ['紧凑快剪（推荐）', '舒缓长镜'] }

test('P6：内部错误不得把 turn 带崩 —— 回退到默认项并继续', async () => {
  const registry = makeRegistry({ failAfterFirst: true })
  const tool = askTool(registry)
  let result
  try {
    result = await tool.execute(ARGS, exec())
  } catch (error) {
    assert.fail(`内部错误不得外抛（事故里它把 turn 带崩、4 个方案全丢）：${String(error)}`)
  }
  assert.equal(typeof result?.text, 'string', '必须回一段文本给模型')
  assert.match(result.text, /提问失败/, '文案要说清是提问失败')
  assert.match(result.text, /紧凑快剪（推荐）/, '必须把推荐项交回给模型，让它照默认假设继续')
  assert.match(result.text, /默认假设/, '必须提示模型在回复里说明这是默认假设')
})

test('P6：挂起的问题仍要被清掉（不能留残卡片）', async () => {
  const registry = makeRegistry({ failAfterFirst: true })
  const tool = askTool(registry)
  await tool.execute(ARGS, exec())
  // 首轮落挂起 + 失败后清空 ⇒ 最后一次写入必须是 null（画布上不留残卡片）
  assert.equal(registry._pending.length >= 2, true, '应先落挂起、失败后再清一次')
  assert.equal(registry._pending.at(-1), null, '挂起的问题必须被置空')
})

test('P6：用户主动打断（abort）照旧外抛，不得被兜底吞掉', async () => {
  const registry = makeRegistry()
  const tool = askTool(registry)
  const reason = new DOMException('aborted', 'AbortError')
  await assert.rejects(
    () => tool.execute(ARGS, exec({ signal: { aborted: true, reason } })),
    (error) => error === reason || (error?.name === 'AbortError'),
    '用户主动打断是用户意图，必须外抛而不是伪装成"已按默认项继续"',
  )
})
