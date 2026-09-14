/**
 * DD-09 审批提交文案（approval-notice.ts）结构守卫 + `concludeTurn` 接线守卫。
 *
 * ## 为什么文案要有一条结构测试
 *
 * 事故（2026-09-14，同一模型同一天）两次审批的结果文本：
 *
 * | 工具 | 文本长度 | 「本回合到此结束」的位置 | 模型行为 |
 * | --- | --- | --- | --- |
 * | `submit_screenplay_for_approval` | 152 字符 | 第 74 字符（49%） | 停住了 |
 * | `submit_storyboard_for_approval` | **1080 字符** | 第 **1023** 字符（95%） | 继续跑了 |
 *
 * 差别不在"写没写停止指令"，而在**位置**：分镜那条的前 1000 字符全是 16 张分镜卡
 * 的标题 + UUID +「逐镜出图时把 shotRefs 设为…」，对模型来说那是一份"下一步清单"。
 *
 * 所以本文件钉的**不是字面**（字面改了不该红），而是**结构**：
 * 停手必须第一行、获批后才用的材料必须隔到围栏之后、围栏之前的正文必须短。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { approvalNotice, APPROVAL_HOLD, DEFERRED_FENCE } from '../lib/approval-notice.js'

const GATES = ['screenplay', 'storyboard', 'keyframes']

/** 围栏之前（= 模型一定会读完的部分）允许的长度上限。 */
const PREAMBLE_LIMIT = 320

const DEFERRED_SAMPLE = '已按 16 个镜头拆卡：分镜 1 · 特写（id=abc）、分镜 2 · 全景（id=def）。'

test('停手指令必须是返回文本的第一行（位置就是这条文案存在的理由）', () => {
  for (const gate of GATES) {
    const text = approvalNotice({ gate, mode: 'confirm' })
    assert.ok(text.startsWith(APPROVAL_HOLD), `${gate}：停手指令不在第一行——它会被前面的内容埋掉`)
  }
})

test('放手跑模式不得出现停手横幅（否则自动流程会自己把自己拦下）', () => {
  for (const gate of GATES) {
    const text = approvalNotice({ gate, mode: 'auto' })
    assert.ok(!text.includes(APPROVAL_HOLD), `${gate}：auto 模式出现停手指令`)
    assert.ok(!text.includes(DEFERRED_FENCE), `${gate}：auto 模式不该有"获批后才需要"的围栏——它本来就直接放行`)
    assert.ok(text.includes('放行'), `${gate}：auto 模式要说清已放行`)
  }
})

test('围栏之前的正文必须短：获批后才用的材料一律隔到围栏之后', () => {
  for (const gate of GATES) {
    const text = approvalNotice({ gate, mode: 'confirm', summary: '8 镜 · 竖屏', deferred: DEFERRED_SAMPLE })
    const fenceAt = text.indexOf(DEFERRED_FENCE)
    assert.ok(fenceAt > 0, `${gate}：传了 deferred 就必须有围栏`)
    const preamble = text.slice(0, fenceAt)
    assert.ok(
      preamble.length <= PREAMBLE_LIMIT,
      `${gate}：停手段前面堆了 ${preamble.length} 字符（上限 ${PREAMBLE_LIMIT}）——`
      + '实测分镜那条把停止指令压到 95% 就是因为卡清单排在了它前面',
    )
    // 反向锚点：这条断言不能因为「deferred 整段被丢掉」而假绿。
    assert.ok(text.slice(fenceAt).includes(DEFERRED_SAMPLE), `${gate}：deferred 内容必须原样出现在围栏之后`)
  }
})

test('围栏本身要说明"现在不要据此行动"', () => {
  assert.match(DEFERRED_FENCE, /不要据此行动/, '围栏文案必须显式禁止模型拿 deferred 当下一步的行动依据')
})

test('停手时会明说「不要读文件 / 不要加载 skill」——等待期不是准备期', () => {
  for (const gate of GATES) {
    const text = approvalNotice({ gate, mode: 'confirm' })
    assert.ok(text.includes('不要读文件'), `${gate}：没说清等待期不能读文件`)
    assert.ok(text.includes('加载 skill'), `${gate}：没说清等待期不能加载 skill`)
  }
})

test('驳回后的改写路径必须留着（用户可能不点驳回按钮，只在对话里说意见）', () => {
  for (const gate of GATES) {
    const text = approvalNotice({ gate, mode: 'confirm' })
    assert.ok(text.includes('修改意见'), `${gate}：缺少「若用户给出修改意见」的路径——驳回后流程会卡死`)
    assert.ok(text.includes('重新提交'), `${gate}：改写后要明说重新提交本工具`)
  }
})

test('三道门的文案各不相同（复制粘贴式复用会让模型搞混在等哪一项）', () => {
  const texts = GATES.map((gate) => approvalNotice({ gate, mode: 'confirm' }))
  assert.equal(new Set(texts).size, GATES.length, '三道门的文案必须互不相同')
})

test('summary 为空/空白时不留空括号', () => {
  for (const gate of GATES) {
    assert.ok(!approvalNotice({ gate, mode: 'confirm', summary: '   ' }).includes('（）'))
    assert.ok(!approvalNotice({ gate, mode: 'confirm' }).includes('（）'))
    assert.ok(approvalNotice({ gate, mode: 'confirm', summary: ' 8 镜 ' }).includes('（8 镜）'))
  }
})

test('三个 submit 工具必须在确认分支调用 exec.concludeTurn()（提交即结束回合）', () => {
  // dsh 官方机制：带 concludesTurn 的工具结果在本步末尾终止 agent 回合，不看
  // 模型意愿。事故里旧实现只有一段"请结束回合"的文本，模型直接忽略了它。
  const src = readSource('../src/host-tools.ts')
  for (const tool of ['submit_screenplay_for_approval', 'submit_storyboard_for_approval', 'submit_keyframes_for_approval']) {
    const start = src.indexOf(`name: '${tool}'`)
    assert.ok(start >= 0, `找不到工具 ${tool}`)
    const block = src.slice(start, src.indexOf('defineTool({', start + 1))
    assert.ok(block.includes('exec.concludeTurn()'), `${tool} 没有调 exec.concludeTurn()——审批门拦不住"模型不听话"`)
    assert.ok(block.includes("mode: 'confirm'"), `${tool} 没有走 approvalNotice 的确认分支`)
    // 停回合只能发生在**确认模式**的路径上：auto 分支若也停，放手跑就变成一步一停。
    const concludeAt = block.indexOf('exec.concludeTurn()')
    const lastAutoAt = block.lastIndexOf("mode: 'auto'")
    assert.ok(
      concludeAt > lastAutoAt,
      `${tool} 的 concludeTurn 出现在 auto 分支之前——放手跑模式会被拦停`,
    )
  }
})

/**
 * 只剥块注释与整行注释：本文件的注释里就会出现 `exec.concludeTurn()` 这些字面量，
 * 不剥注释的守卫会被一句正确的注释骗过，然后被人删掉。
 */
function readSource(rel) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}
