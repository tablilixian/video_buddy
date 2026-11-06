/**
 * CV-447（T1-A4）：`render_composition` 阶段二轮次硬闸。
 *
 * 事故签名：真机一次会话里 19 轮 spotFrames + 探针循环，用户叫停前约 50 分钟都在
 * 「渲一张 → 看图 → 改坐标」。规则文本（verification.md T0-A3）写了 ≤3 次，但没有
 * 机器闸，模型可以无限自我说服。
 *
 * 本批修正的旧漏洞（必读）：
 *  1. 旧闸只认 `probe:true`，而事故主路径是 `spotFrames`；
 *  2. 旧闸把任何非 probe 调用（包括 spot）当成「出了全片」并清空计数；
 *  3. 旧闸「进闸就 +1」⇒ 校验失败 / 宿主失联这类**零产出**的失败也吃额度
 *     （2026-11-06 真机：3 次额度里 2 次这么没的，随后连渲 7 次全片硬猜）。
 * 下面第 2/3/4/6 条就是针对这三种绕法/浪费的回归锁。
 *
 * 调用约定：`succeed()` = 前置检查 + 成功记账（等于工具正常返回）；
 * `attempt()` = 只跑前置检查（等于工具抛错，不记账）。
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  guardProbeBudget,
  commitProbeBudget,
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

/** 一次**成功**的调用：前置检查通过后记账。 */
function succeed(args, sessionKey) {
  guardProbeBudget('render_composition', args, sessionKey)
  commitProbeBudget('render_composition', args, sessionKey)
}

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
    assert.doesNotThrow(() => succeed(probe('p1')), `第 ${i} 次应放行`)
  }
  assert.equal(probeUsage('p1'), PROBE_LIMIT)
  const caught = capture(() => guardProbeBudget('render_composition', probe('p1')))
  assert.ok(caught, '第 4 次必须拒收')
  assert.equal(caught.code, 'CS-USER-ERR')
  assert.match(caught.message, /用满 3 次/)
  assert.match(caught.message, /quality:"draft"/, '拒收文案必须指向降级出口，而不是只说"不行"')
  assert.equal(probeUsage('p1'), PROBE_LIMIT, '被拒的那次不记账（它本来就没产出，也进不了 execute）')
})

test('spotFrames 与 probe:true 共用同一个 3 次预算', () => {
  succeed(spot('p1'))
  succeed(probe('p1'))
  succeed(spot('p1'))
  const caught = capture(() => guardProbeBudget('render_composition', spot('p1')))
  assert.equal(caught?.code, 'CS-USER-ERR', '第 4 次 spot 同样被拒')
  assert.equal(probeUsage('p1'), PROBE_LIMIT)
})

test('spot 调用不清零计数（旧实现在这里把额度洗掉）', () => {
  succeed(probe('p1'))
  succeed(spot('p1'))
  assert.equal(probeUsage('p1'), 2, 'spot 之后仍是 2，不是 0')
  assert.equal(hasDelivered('p1'), false, 'spot 不是全片渲染')
  succeed(probe('p1'))
  assert.equal(probeUsage('p1'), 3)
  assert.equal(capture(() => guardProbeBudget('render_composition', spot('p1')))?.code, 'CS-USER-ERR')
})

test('真全片渲染不清零、只开启 1 次成片后批注', () => {
  succeed(probe('p1'))
  succeed(probe('p1'))
  succeed(full('p1'))
  assert.equal(probeUsage('p1'), 2, '出片不清零历史额度')
  assert.equal(hasDelivered('p1'), true)
  assert.doesNotThrow(() => succeed(spot('p1')), '成片后第 1 次批注放行')
  assert.equal(annotationUsage('p1'), ANNOTATION_LIMIT)
  const caught = capture(() => guardProbeBudget('render_composition', probe('p1')))
  assert.equal(caught?.code, 'CS-USER-ERR', '第 2 次批注拒收')
  assert.match(caught.message, /turn\/end/, '文案必须给收口出口')
  assert.match(caught.message, /未决项/)
})

test('全片渲染本身不受闸限制，也不能洗掉批注配额', () => {
  for (let i = 0; i < 4; i += 1) {
    assert.doesNotThrow(() => succeed(full('p1')), '超时续渲不能被闸挡住')
  }
  succeed(spot('p1'))
  for (let i = 0; i < 3; i += 1) succeed(full('p1'))
  assert.equal(capture(() => guardProbeBudget('render_composition', spot('p1')))?.code, 'CS-USER-ERR',
    '反复渲全片换不来新的批注额度')
})

/**
 * 2026-11-06 真机回归（最有价值的一条）：额度只在对图片有产出时扣。
 *
 * 事故：`spotFrames` 先被自己的契约校验拒绝（`box` 与 `animate.x/y` 互斥），
 * 再被宿主失联拒绝（`90s 内 0/8 帧`）⇒ 3 次额度里 2 次零产出，模型只剩 1 次，
 * 于是放弃探针连渲 7 次全片。旧实现把这两次失败都记了账。
 */
test('校验失败 / 宿主失联不消耗探针额度（只判不收）', () => {
  // 5 次失败调用（只跑前置检查，不记账）——额度必须一次都没动
  for (let i = 0; i < 5; i += 1) {
    assert.doesNotThrow(() => guardProbeBudget('render_composition', spot('p1')), '前置检查只判不收')
  }
  assert.equal(probeUsage('p1'), 0, '失败调用不记账')

  // 真正产出图的三次仍然全部可用
  for (let i = 0; i < PROBE_LIMIT; i += 1) succeed(spot('p1'))
  assert.equal(probeUsage('p1'), PROBE_LIMIT)
  assert.equal(capture(() => guardProbeBudget('render_composition', spot('p1')))?.code, 'CS-USER-ERR',
    '用满之后仍然拒收（闸没有被削弱）')
})

test('计数按项目隔离，其它工具完全不参与', () => {
  succeed(probe('p1'))
  succeed(probe('p1'))
  succeed(probe('p1'))
  assert.doesNotThrow(() => succeed(probe('p2')), '另一个项目从 0 开始')
  assert.doesNotThrow(() => guardProbeBudget('read_image', { probe: true }), '非本工具不做任何计数')
  assert.equal(probeUsage(), 0, '非本工具的调用不应产生计数')
  assert.equal(probeUsage('p2'), 1, '另一个项目独立计数')
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

test('接线：execute 抛错的那几次不记账（失败退还额度）', async () => {
  let entered = 0
  const wrapped = wrapStudioToolDefinition({
    name: 'render_composition',
    execute: async () => {
      entered += 1
      throw new Error('manifest 校验失败：模拟器')
    },
  })
  for (let i = 0; i < 5; i += 1) {
    await assert.rejects(() => wrapped.execute(spot('p-fail'), {}))
  }
  assert.equal(entered, 5, '五次都真的进了 execute')
  assert.equal(probeUsage('p-fail'), 0, '抛错的调用一次都不该记账')
  assert.equal(hasDelivered('p-fail'), false, '失败的全片渲染不算出片')
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

/**
 * 真机事故回归（2026-11-06 A/B）：`render_composition` 的契约要求**不传**
 * projectId，旧 `keyOf()` 只认 projectId ⇒ 所有调用落进同一个 `_current` 全局桶。
 * 上一条会话结束时留下 probes=5 / delivered / annotations=1，下一条会话的**第一次**
 * spotFrames 就被拒收「成片后批注已用满 1 次」，全程零探针。
 */
test('无 projectId 时按会话隔离：上一条会话的额度不能带进新会话', () => {
  const noPid = (extra = {}) => ({ probe: true, manifestPath: '/tmp/m.json', ...extra })
  // 会话 A：探针用满 → 出片 → 用掉唯一一次批注 → 再探被拒
  for (let i = 0; i < PROBE_LIMIT; i += 1) succeed(noPid(), 'sess-A')
  succeed({ manifestPath: '/tmp/m.json' }, 'sess-A')
  succeed({ spotFrames: [10], manifestPath: '/tmp/m.json' }, 'sess-A')
  assert.equal(capture(() => guardProbeBudget('render_composition', noPid(), 'sess-A'))?.code, 'CS-USER-ERR')
  assert.equal(probeUsage('sess-A'), PROBE_LIMIT + 1)
  assert.equal(annotationUsage('sess-A'), ANNOTATION_LIMIT)

  // 会话 B：同项目、同 cwd，但预算必须从 0 起（旧实现这里会被 A 的余额拒收）
  assert.doesNotThrow(
    () => succeed({ spotFrames: [10], manifestPath: '/tmp/m.json' }, 'sess-B'),
    '新会话的第一次 spotFrames 必须放行',
  )
  assert.equal(probeUsage('sess-B'), 1)
  assert.equal(hasDelivered('sess-B'), false, '会话 B 还没出过片')
})

test('接线：会话键从 exec.agent.session.header.id 取（删掉即退回全局桶）', async () => {
  let entered = 0
  const wrapped = wrapStudioToolDefinition({
    name: 'render_composition',
    execute: async () => {
      entered += 1
      return { ok: true }
    },
  })
  const execOf = (id) => ({ agent: { session: { header: { id, cwd: '/workspace' } } } })
  // 两个会话各用满 3 次，互不影响；第 4 次各自被拒
  for (const id of ['sess-1', 'sess-2']) {
    for (let i = 0; i < PROBE_LIMIT; i += 1) {
      await wrapped.execute(spot(undefined), execOf(id))
    }
    await assert.rejects(
      () => wrapped.execute(spot(undefined), execOf(id)),
      (error) => error.code === 'CS-USER-ERR',
      `${id} 的第 ${PROBE_LIMIT + 1} 次必须被拒`,
    )
  }
  assert.equal(entered, PROBE_LIMIT * 2)
})
