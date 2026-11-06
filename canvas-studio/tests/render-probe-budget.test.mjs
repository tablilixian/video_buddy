/**
 * CV-447（T1-A4）：`render_composition(probe:true)` 轮次硬闸。
 *
 * 事故签名：真机一次会话里 19 轮 spotFrames + 探针循环，用户叫停前约 50 分钟都在
 * 「渲一张 → 看图 → 改坐标」。规则文本（verification.md T0-A3）写了 ≤3 次，但没有
 * 机器闸，模型可以无限自我说服。这组用例锁死：第 4 次拒收、draft 清零、按项目隔离。
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { guardProbeBudget, probeUsage, resetProbeBudget, PROBE_LIMIT } from '../lib/render-probe-budget.js'

beforeEach(() => resetProbeBudget())

const probe = (projectId) => ({ projectId, probe: true, manifestPath: '/tmp/m.json' })

test('探针前 3 次放行，第 4 次抛 CS-USER-ERR 并给出降级出口', () => {
  for (let i = 1; i <= PROBE_LIMIT; i += 1) {
    assert.doesNotThrow(() => guardProbeBudget('render_composition', probe('p1')), `第 ${i} 次应放行`)
  }
  let caught = null
  try {
    guardProbeBudget('render_composition', probe('p1'))
  } catch (error) {
    caught = error
  }
  assert.ok(caught, '第 4 次必须拒收')
  assert.equal(caught.code, 'CS-USER-ERR')
  assert.match(caught.message, /用满 3 次/)
  assert.match(caught.message, /quality:"draft"/, '拒收文案必须指向降级出口，而不是只说"不行"')
  assert.equal(probeUsage('p1'), 4, '被拒收的那次也计入（避免靠拒绝循环绕闸）')
})

test('非 probe 的全片渲染清零计数（成片后允许批注探针）', () => {
  guardProbeBudget('render_composition', probe('p1'))
  guardProbeBudget('render_composition', probe('p1'))
  guardProbeBudget('render_composition', { projectId: 'p1', quality: 'draft', manifestPath: '/tmp/m.json' })
  assert.equal(probeUsage('p1'), 0, '出草稿即清零')
  assert.doesNotThrow(() => guardProbeBudget('render_composition', probe('p1')))
})

test('计数按项目隔离，其它工具完全不参与', () => {
  guardProbeBudget('render_composition', probe('p1'))
  guardProbeBudget('render_composition', probe('p1'))
  guardProbeBudget('render_composition', probe('p1'))
  assert.doesNotThrow(() => guardProbeBudget('render_composition', probe('p2')), '另一个项目从 0 开始')
  assert.doesNotThrow(() => guardProbeBudget('read_image', { probe: true }), '非本工具不做任何计数')
  assert.equal(probeUsage(), 0, '无 projectId 的工具调用不应产生计数')
})
