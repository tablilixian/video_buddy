/**
 * AR-07 守卫：**已下线的工具名不得再被注册**，但必须仍被存量节点消费方认识。
 *
 * ## 背景
 *
 * `write_screenplay` / `submit_screenplay_for_approval` / `submit_storyboard_for_approval`
 * 这三个工具都已下线（`prompt_enhance` 随后端 0.7.0，剧本/分镜提交随 REQ-022），
 * 但它们**仍出现在 4 处活代码**里：
 *
 * | 位置 | 为什么还要认识它们 |
 * | --- | --- |
 * | `canvas-view.ts`（泳道映射 `laneOfNode`） | 历史项目已落盘的节点带旧 toolName，按栏排布不能认不出 |
 * | `tool-presentation.ts`（三档展示表） | 老会话里的历史 tool 行仍要显示中文 |
 * | `text-guard.ts`（判「agent 写的正文节点」） | 历史剧本节点要做占位词检查 |
 * | `generate.ts`（fallback 节点白名单） | 同上，历史节点的类型判定 |
 *
 * 「还在处理旧名字」看上去像**仍该注册**。一旦有人重新注册同名工具，泳道与 guard 的
 * 语义会被静默改变。本文件把边界钉成两条：
 *
 *   1. **交集为空**：`LEGACY_NODE_TOOLS` ∩ 真实注册名 = ∅（这是硬不变量）；
 *   2. **存量消费方仍在**：每个 legacy 名字至少仍被泳道映射认识（防止「清理死代码」时
 *      连存量兼容一起删掉，表现为老项目画布按栏错乱）。
 *
 * 从 ../lib/*.js 导入 —— 先 build 再跑。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { LEGACY_NODE_TOOLS, STORYBOARD_NODE_TOOL } from '../lib/contracts/canvas.js'
import { createStudioTools } from '../lib/host-tools.js'
import { createPlaceholderTools } from '../lib/skills/placeholder-tools.js'

const readSrc = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

/** 真实注册面（`list()` 空数组的桩让装配期恢复轮询无事可做）。 */
function registeredToolNames() {
  const stubRegistry = { list: async () => [] }
  return [
    ...createStudioTools(stubRegistry, 0),
    ...createPlaceholderTools(),
  ].map((definition) => definition.name)
}

test('AR-07①：已下线工具名与真实注册名**交集必须为空**', () => {
  const registered = new Set(registeredToolNames())
  const resurrected = LEGACY_NODE_TOOLS.filter((name) => registered.has(name))
  assert.deepEqual(
    resurrected,
    [],
    '以下已下线的工具名被重新注册了 —— 这会让 canvas-view 的泳道语义与 text-guard 的'
    + `节点判定被静默改变。若确要重新上线某工具，请先改 LEGACY_NODE_TOOLS 并复核那 4 处消费方：${resurrected.join(', ')}`,
  )
})

test('AR-07②：常量本身与分镜卡标记保持一致（防两处名单各写一份）', () => {
  assert.ok(
    LEGACY_NODE_TOOLS.includes(STORYBOARD_NODE_TOOL),
    `STORYBOARD_NODE_TOOL（${STORYBOARD_NODE_TOOL}）必须属于 LEGACY_NODE_TOOLS —— `
    + '它就是「提交分镜」旧工具写下的 toolName，随工具下线而只作存量标记',
  )
})

/**
 * 每个 legacy 名字**实际**的代码消费方（2026-10-12 逐个 grep 核对，勿凭印象改）。
 *
 * 空数组 = 该名字**没有代码消费方**，只活在展示表里（老会话的历史 tool 行本地化）。
 * 这不是遗漏：`submit_screenplay_for_approval` 从未被任何前端/后端分支读取过。
 */
const EXPECTED_CONSUMERS = new Map([
  ['write_screenplay', ['src/canvas-view.ts', 'src/text-guard.ts', 'src/generate.ts']],
  ['submit_storyboard_for_approval', ['src/canvas-view.ts', 'src/contracts/canvas.ts']],
  ['submit_screenplay_for_approval', []],
])

test('AR-07③：每个 legacy 名字的存量消费方仍在（防止连兼容逻辑一起被清理）', () => {
  // 先保证「常量里的每个名字都被本表登记」——新增名字必须显式声明消费方
  const declared = [...EXPECTED_CONSUMERS.keys()].sort()
  assert.deepEqual(
    declared,
    [...LEGACY_NODE_TOOLS].sort(),
    'LEGACY_NODE_TOOLS 与 EXPECTED_CONSUMERS 的名单必须一致：新增 legacy 名字时，'
    + '请逐个 grep 它在 src/ 里还剩哪些消费方并登记到本表',
  )

  const forgotten = []
  for (const [name, consumers] of EXPECTED_CONSUMERS) {
    for (const rel of consumers) {
      if (!readSrc(`../${rel}`).includes(`'${name}'`)) forgotten.push(`${rel} 不再引用 '${name}'`)
    }
  }
  assert.deepEqual(
    forgotten,
    [],
    '以下存量消费方已找不到对应的 legacy 名字 —— 历史项目里带旧 toolName 的节点会失去'
    + '泳道归属 / 正文判定（表现为老项目画布按栏错乱、剧本卡不再做占位词检查）。'
    + '若你是**有意重构**（例如把泳道映射改成数据驱动表），请把本表与新实现对齐，'
    + `而不是直接删掉这些分支：\n  ${forgotten.join('\n  ')}`,
  )
})

test('AR-07④：每个 legacy 名字仍能在展示表查到中文（老会话 tool 行不回落英文）', async () => {
  const { TOOL_PRESENTATION } = await import('../lib/tool-presentation.js')
  const untranslated = LEGACY_NODE_TOOLS.filter((name) => TOOL_PRESENTATION[name] === undefined)
  assert.deepEqual(
    untranslated,
    [],
    `以下 legacy 名字已从展示表移除 —— 老会话里的历史 tool 行会回落成英文通用行：${untranslated.join(', ')}`,
  )
})
