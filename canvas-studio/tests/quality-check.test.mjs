/**
 * C4 质检闭环契约测试：parseQcVerdict / 预算累计 / 端到端判定 / 工具落盘。
 *
 * 覆盖方案 §4.5：image2vl 判定镜头是否漂移 → FAIL 只重跑该镜 → 预算耗尽上报用户。
 * 与 C2/C3 一致的取向：Host 只产出「判定 + 计数」的硬事实，重跑决策留给总纲纪律。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildQcPrompt,
  parseQcVerdict,
  pickQcTargetNode,
  nextQcAttempt,
  runShotQc,
  renderQcText,
  DEFAULT_QC_BUDGET,
} from '../lib/quality-check.js'
import { createStudioTools } from '../lib/host-tools.js'

const EXEC = (cwd) => ({ agent: { session: { header: { cwd } } }, signal: AbortSignal.timeout(5000) })

function shotNode(overrides = {}) {
  return {
    id: 'shot-1',
    kind: 'image',
    title: '分镜 1 · 特写',
    url: 'https://x/shot1.png',
    filename: 'shot1.png',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    createdAt: 1,
    origin: 'agent',
    sourceIds: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 1. VLM 输出解析（判定结构化的全部容错路径）
// ---------------------------------------------------------------------------
test('parseQcVerdict：标准 JSON → pass / fail 与漂移项', () => {
  assert.deepEqual(parseQcVerdict('{"verdict":"PASS","drifts":[],"reason":"一致"}'), {
    verdict: 'pass',
    drifts: [],
    reason: '一致',
  })
  assert.deepEqual(parseQcVerdict('{"verdict":"FAIL","drifts":["发色偏棕","风衣变夹克"],"reason":"服装漂移"}'), {
    verdict: 'fail',
    drifts: ['发色偏棕', '风衣变夹克'],
    reason: '服装漂移',
  })
})

test('parseQcVerdict：代码块围栏与前后寒暄都能抠出 JSON', () => {
  const fenced = '好的，结论如下：\n```json\n{"verdict":"FAIL","drifts":["道具消失"],"reason":"手机不见了"}\n```\n希望有帮助。'
  assert.equal(parseQcVerdict(fenced).verdict, 'fail')
  assert.deepEqual(parseQcVerdict(fenced).drifts, ['道具消失'])
  assert.equal(parseQcVerdict('我认为不通过。{"verdict":"不通过","drifts":[],"reason":"换脸了"}').verdict, 'fail')
})

test('parseQcVerdict：不可解析 / 缺 verdict → warn（不自动重跑，交人工确认）', () => {
  const warn = parseQcVerdict('画面太糊，我看不清')
  assert.equal(warn.verdict, 'warn')
  assert.match(warn.reason, /人工确认/)
  assert.equal(parseQcVerdict('{"drifts":[]}').verdict, 'warn', '缺 verdict 字段应降级')
  assert.equal(parseQcVerdict('').verdict, 'warn')
})

test('parseQcVerdict：drifts 非数组/超长都被收敛，reason 兜底', () => {
  const many = { verdict: 'FAIL', drifts: Array.from({ length: 20 }, (_, i) => `d${i}`), reason: 'x'.repeat(500) }
  const parsed = parseQcVerdict(JSON.stringify(many))
  assert.equal(parsed.drifts.length, 5, '漂移项最多 5 条')
  assert.equal(parsed.reason.length, 201, 'reason 截断到 200 字 + 省略号')
  assert.deepEqual(parseQcVerdict('{"verdict":"FAIL","drifts":"不是数组"}').drifts, [])
  // fail 且无 reason 时用漂移项兜底
  assert.equal(parseQcVerdict('{"verdict":"FAIL","drifts":["换装"]}').reason, '换装')
})

test('buildQcPrompt：判定基准原样嵌入提示词（VLM 对照的唯一依据）', () => {
  const prompt = buildQcPrompt('[SAME CHARACTER: 黑色短发，米色风衣]')
  assert.match(prompt, /SAME CHARACTER/)
  assert.match(prompt, /PASS|FAIL/)
  assert.match(prompt, /WARN/)
})

// ---------------------------------------------------------------------------
// 2. 重跑预算累计（跨重跑必须按分镜卡血缘，不能只看当前节点）
// ---------------------------------------------------------------------------
test('pickQcTargetNode：按 filename 命中最新的一张', () => {
  const nodes = [
    shotNode({ id: 'old', createdAt: 1 }),
    shotNode({ id: 'new', createdAt: 2 }),
    shotNode({ id: 'other', filename: 'shot2.png', createdAt: 3 }),
  ]
  assert.equal(pickQcTargetNode(nodes, 'shot1.png').id, 'new')
  assert.equal(pickQcTargetNode(nodes, 'missing.png'), null)
})

test('nextQcAttempt：无历史=1；同节点重检累加', () => {
  assert.equal(nextQcAttempt([shotNode()], shotNode()), 1)
  const checked = shotNode({ qc: { verdict: 'fail', drifts: [], reason: 'x', attempts: 2, checkedAt: 1 } })
  assert.equal(nextQcAttempt([checked], checked), 3)
})

test('nextQcAttempt：重跑生成新节点时按分镜卡血缘累计（否则预算永远归零）', () => {
  const card = 'card-1'
  const first = shotNode({ id: 'shot-a', sourceIds: [card], qc: { verdict: 'fail', drifts: [], reason: 'x', attempts: 1, checkedAt: 1 } })
  const rerun = shotNode({ id: 'shot-b', createdAt: 2, sourceIds: [card] })
  assert.equal(nextQcAttempt([first, rerun], rerun, [card]), 2, '第二次质检应继承同镜历史')
  assert.equal(nextQcAttempt([first, rerun], rerun), 1, '未传分镜卡时只按当前节点计（预算退化，故工具层要求传 shotRefs）')
  // 其他分镜卡的历史不串味
  assert.equal(nextQcAttempt([first, rerun], rerun, ['card-2']), 0 + 1)
})

// ---------------------------------------------------------------------------
// 3. runShotQc 端到端（VLM 注入，不依赖 drama-api）
// ---------------------------------------------------------------------------
async function runWith(verdictJson, nodes, shotCardIds = [], budget) {
  let seenPrompt = ''
  const result = await runShotQc(nodes, 'shot1.png', {
    analyze: async (_filename, prompt) => {
      seenPrompt = prompt
      return verdictJson
    },
    expect: '[SAME CHARACTER: 黑色短发]',
    shotCardIds,
    ...(budget !== undefined ? { budget } : {}),
    now: () => 1000,
  })
  return { result, seenPrompt }
}

test('runShotQc：PASS 不触发重跑建议', async () => {
  const { result, seenPrompt } = await runWith('{"verdict":"PASS","drifts":[],"reason":"一致"}', [shotNode()])
  assert.equal(result.verdict, 'pass')
  assert.equal(result.attempts, 1)
  assert.equal(result.exhausted, false)
  assert.equal(result.nodeId, 'shot-1')
  assert.match(seenPrompt, /SAME CHARACTER/)
  assert.equal(result.record.checkedAt, 1000)
  assert.equal(result.record.expect, '[SAME CHARACTER: 黑色短发]')
})

test('runShotQc：FAIL 未超预算 → exhausted=false；达预算 → 交用户仲裁', async () => {
  const failJson = '{"verdict":"FAIL","drifts":["换装"],"reason":"风衣变夹克"}'
  const first = await runWith(failJson, [shotNode()])
  assert.equal(first.result.attempts, 1)
  assert.equal(first.result.exhausted, false, '预算 2，第 1 次 FAIL 仍可重跑')

  // 同分镜卡的第二次（重跑后的新节点）
  const card = 'card-1'
  const prev = shotNode({ id: 'a', sourceIds: [card], qc: { verdict: 'fail', drifts: [], reason: 'x', attempts: 1, checkedAt: 1 } })
  const rerun = shotNode({ id: 'b', createdAt: 2, sourceIds: [card] })
  const second = await runWith(failJson, [prev, rerun], [card])
  assert.equal(second.result.attempts, 2)
  assert.equal(second.result.exhausted, true, '第 2 次仍 FAIL → 用尽预算')
  assert.equal(second.result.budget, DEFAULT_QC_BUDGET)
})

test('runShotQc：未匹配到画布节点时不落盘（nodeId=null 但判定仍返回）', async () => {
  const { result } = await runWith('{"verdict":"WARN","drifts":[],"reason":"看不清"}', [])
  assert.equal(result.nodeId, null)
  assert.equal(result.verdict, 'warn')
})

test('renderQcText：三种结论给出不同下一步', async () => {
  const pass = await runWith('{"verdict":"PASS"}', [shotNode()])
  assert.match(renderQcText(pass.result), /PASS 一致/)

  const fail = await runWith('{"verdict":"FAIL","drifts":["换装"],"reason":"x"}', [shotNode()])
  assert.match(renderQcText(fail.result), /只重跑该镜/)

  const warn = await runWith('{"verdict":"WARN","reason":"糊"}', [shotNode()])
  assert.match(renderQcText(warn.result), /人工确认/)
  assert.doesNotMatch(renderQcText(warn.result), /只重跑该镜/)
})

// ---------------------------------------------------------------------------
// 4. Host 工具 qc_shot：判定基准缺省取资产卡 + 结论落盘节点
// ---------------------------------------------------------------------------
function stubRegistry(nodes, extra = {}) {
  const writes = []
  return {
    writes,
    list: async () => [{ id: 'p1', name: 'P1', dir: '/tmp/cs-proj', createdAt: 1 }],
    getProject: async () => ({ workflow: { mode: 'auto', state: 'idle' } }),
    assetsDir: () => '/tmp/cs-proj',
    readCanvas: async () => ({ version: 4, nodes, ...extra }),
    writeCanvas: async (_id, next) => {
      writes.push(next)
    },
    appendCanvasNode: async () => {},
  }
}

/** 把 VLM（image2vl）替换成假响应：探针与业务请求都走同一个假的 fetch。 */
async function withFakeVlm(output, fn) {
  const original = globalThis.fetch
  const posts = []
  globalThis.fetch = async (_url, init) => {
    const body = init?.body !== undefined ? JSON.parse(String(init.body)) : null
    if (body !== null) posts.push(body)
    return {
      ok: true,
      status: 200,
      json: async () => ({ output }),
      text: async () => JSON.stringify({ output }),
    }
  }
  try {
    return await fn(posts)
  } finally {
    globalThis.fetch = original
  }
}

test('qc_shot：结论写回被检节点，判定基准缺省取资产卡 lockedPrompt', async () => {
  // 分镜卡节点（qc_shot 的 shotRefs 按 toolName 定位，与 image_generate 同源）
  const card = {
    id: 'card-1',
    kind: 'note',
    title: '分镜 1 · 特写',
    toolName: 'submit_storyboard_for_approval',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    createdAt: 0,
    origin: 'agent',
    sourceIds: [],
  }
  const node = shotNode({ sourceIds: ['card-1'] })
  const registry = stubRegistry([card, node], {
    assets: [{
      id: 'asset-1',
      name: '女主',
      role: 'character',
      anchorNodeIds: [],
      lockedPrompt: '[SAME CHARACTER: 黑色短发，米色风衣]',
      negativePrompt: '不更换服装',
      createdAt: 1,
    }],
  })
  await withFakeVlm('{"verdict":"FAIL","drifts":["风衣变夹克"],"reason":"换装"}', async (posts) => {
    const tools = createStudioTools(registry, 3005)
    const qc = tools.find((t) => t.name === 'qc_shot')
    const res = await qc.execute({ filename: 'shot1.png', shotRefs: ['card-1'] }, EXEC('/tmp/cs-proj'))
    assert.equal(res.verdict, 'fail')
    assert.deepEqual(res.drifts, ['风衣变夹克'])
    assert.equal(res.attempts, 1)
    assert.equal(res.exhausted, false)
    assert.equal(res.nodeId, 'shot-1')
    // 判定基准 = 资产卡 lockedPrompt + 负面约束
    const sent = posts.find((p) => typeof p.prompt === 'string' && p.prompt.includes('SAME CHARACTER'))
    assert.match(sent.prompt, /SAME CHARACTER: 黑色短发，米色风衣/)
    assert.match(sent.prompt, /不更换服装/)
    // 落盘
    assert.equal(registry.writes.length, 1)
    const written = registry.writes[0].find((n) => n.id === 'shot-1')
    assert.equal(written.qc.verdict, 'fail')
    assert.equal(written.qc.attempts, 1)
    assert.deepEqual(written.qc.drifts, ['风衣变夹克'])
    assert.match(written.qc.expect, /SAME CHARACTER/)
  })
})

test('qc_shot：没有判定基准时报错（无资产卡且未传 expect）', async () => {
  const registry = stubRegistry([shotNode()])
  const tools = createStudioTools(registry, 3005)
  const qc = tools.find((t) => t.name === 'qc_shot')
  await assert.rejects(
    () => qc.execute({ filename: 'shot1.png' }, EXEC('/tmp/cs-proj')),
    /缺少质检判定基准/,
  )
})
