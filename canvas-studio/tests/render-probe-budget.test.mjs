/**
 * CV-447（T1-A4）：`render_composition` 阶段二轮次硬闸。
 *
 * 事故签名：真机一次会话里 19 轮 spotFrames + 探针循环，用户叫停前约 50 分钟都在
 * 「渲一张 → 看图 → 改坐标」。规则文本（verification.md T0-A3）写了 ≤3 次，但没有
 * 机器闸，模型可以无限自我说服。
 *
 * 本批修正的旧漏洞（必读）：旧闸只认 `probe:true`，而事故主路径是 `spotFrames`；
 * 且旧闸把任何非 probe 调用（包括 spot）当成「出了全片」并清空计数。
 * 下面第 2/3/4 条就是针对这两个绕法的回归锁。
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  guardProbeBudget,
  probeUsage,
  annotationUsage,
  hasDelivered,
  resetProbeBudget,
  PROBE_LIMIT,
  ANNOTATION_LIMIT,
} from '../lib/render-probe-budget.js'
import { wrapStudioToolDefinition } from '../lib/tool-error-boundary.js'

beforeEach(() => resetProbeBudget())

const probe = (projectId) => ({ projectId, probe: true, manifestPath: '/tmp/m.json' })
const spot = (projectId, frames = [100, 200]) => ({ projectId, spotFrames: frames, manifestPath: '/tmp/m.json' })
const full = (projectId) => ({ projectId, quality: 'draft', manifestPath: '/tmp/m.json' })

/** 捕获拒收错误（node:test 的 rejects 拿不到 code，这里要断言结构化码）。 */
function capture(fn) {
  try {
    fn()
    return null
  } catch (error) {
    return error
  }
}

test('探针前 3 次放行，第 4 次抛 CS-USER-ERR 并给出降级出口', () => {
  for (let i = 1; i <= PROBE_LIMIT; i += 1) {
    assert.doesNotThrow(() => guardProbeBudget('render_composition', probe('p1')), `第 ${i} 次应放行`)
  }
  const caught = capture(() => guardProbeBudget('render_composition', probe('p1')))
  assert.ok(caught, '第 4 次必须拒收')
  assert.equal(caught.code, 'CS-USER-ERR')
  assert.match(caught.message, /用满 3 次/)
  assert.match(caught.message, /quality:"draft"/, '拒收文案必须指向降级出口，而不是只说"不行"')
  assert.equal(probeUsage('p1'), 4, '被拒收的那次也计入（避免靠拒绝循环绕闸）')
})

test('spotFrames 与 probe:true 共用同一个 3 次预算', () => {
  guardProbeBudget('render_composition', spot('p1'))
  guardProbeBudget('render_composition', probe('p1'))
  guardProbeBudget('render_composition', spot('p1'))
  const caught = capture(() => guardProbeBudget('render_composition', spot('p1')))
  assert.equal(caught?.code, 'CS-USER-ERR', '第 4 次 spot 同样被拒')
  assert.equal(probeUsage('p1'), 4)
})

test('spot 调用不清零计数（旧实现在这里把额度洗掉）', () => {
  guardProbeBudget('render_composition', probe('p1'))
  guardProbeBudget('render_composition', spot('p1'))
  assert.equal(probeUsage('p1'), 2, 'spot 之后仍是 2，不是 0')
  assert.equal(hasDelivered('p1'), false, 'spot 不是全片渲染')
  guardProbeBudget('render_composition', probe('p1'))
  assert.equal(probeUsage('p1'), 3)
  assert.equal(capture(() => guardProbeBudget('render_composition', spot('p1')))?.code, 'CS-USER-ERR')
})

test('真全片渲染不清零、只开启 1 次成片后批注', () => {
  guardProbeBudget('render_composition', probe('p1'))
  guardProbeBudget('render_composition', probe('p1'))
  guardProbeBudget('render_composition', full('p1'))
  assert.equal(probeUsage('p1'), 2, '出片不清零历史额度')
  assert.equal(hasDelivered('p1'), true)
  assert.doesNotThrow(() => guardProbeBudget('render_composition', spot('p1')), '成片后第 1 次批注放行')
  assert.equal(annotationUsage('p1'), ANNOTATION_LIMIT)
  const caught = capture(() => guardProbeBudget('render_composition', probe('p1')))
  assert.equal(caught?.code, 'CS-USER-ERR', '第 2 次批注拒收')
  assert.match(caught.message, /turn\/end/, '文案必须给收口出口')
  assert.match(caught.message, /未决项/)
})

test('全片渲染本身不受闸限制，也不能洗掉批注配额', () => {
  for (let i = 0; i < 4; i += 1) {
    assert.doesNotThrow(() => guardProbeBudget('render_composition', full('p1')), '超时续渲不能被闸挡住')
  }
  guardProbeBudget('render_composition', spot('p1'))
  for (let i = 0; i < 3; i += 1) guardProbeBudget('render_composition', full('p1'))
  assert.equal(capture(() => guardProbeBudget('render_composition', spot('p1')))?.code, 'CS-USER-ERR',
    '反复渲全片换不来新的批注额度')
})

test('计数按项目隔离，其它工具完全不参与', () => {
  guardProbeBudget('render_composition', probe('p1'))
  guardProbeBudget('render_composition', probe('p1'))
  guardProbeBudget('render_composition', probe('p1'))
  assert.doesNotThrow(() => guardProbeBudget('render_composition', probe('p2')), '另一个项目从 0 开始')
  assert.doesNotThrow(() => guardProbeBudget('read_image', { probe: true }), '非本工具不做任何计数')
  assert.equal(probeUsage(), 0, '无 projectId 的工具调用不应产生计数')
})

test('接线：wrapStudioToolDefinition 包装后第 4 次 spot 被拒，且 execute 未进入（删接线即红）', async () => {
  let entered = 0
  const wrapped = wrapStudioToolDefinition({
    name: 'render_composition',
    execute: async () => {
      entered += 1
      return { ok: true }
    },
  })
  for (let i = 0; i < PROBE_LIMIT; i += 1) {
    const ok = await wrapped.execute(spot('p-wire'), {})
    assert.deepEqual(ok, { ok: true }, `第 ${i + 1} 次 spot 应到达 execute`)
  }
  assert.equal(entered, PROBE_LIMIT)
  await assert.rejects(
    () => wrapped.execute(spot('p-wire'), {}),
    (error) => error.code === 'CS-USER-ERR' && /用满 3 次/.test(error.message),
    '守卫必须挂在唯一入口：第 4 次在参数校验阶段就被拒',
  )
  assert.equal(entered, PROBE_LIMIT, '被拒的那次绝不能进 execute（零副作用）')
})

test('接线：非 render_composition 工具不受探针闸影响', async () => {
  const wrapped = wrapStudioToolDefinition({
    name: 'read_image',
    execute: async () => ({ ok: true }),
  })
  for (let i = 0; i < 5; i += 1) {
    assert.deepEqual(await wrapped.execute({ probe: true }, {}), { ok: true })
  }
})
