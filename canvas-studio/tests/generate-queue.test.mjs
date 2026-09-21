/**
 * CV-220 生成队列（`generate-queue.ts`）+ 视图投影（`queue-view.ts`）+ 接线守卫。
 *
 * ## 这套断言防的是什么
 *
 * Drama 后端是**同步单任务**：同刻只处理一个请求，并发提交只排队、墙钟不变。
 * 宿主此前没有任何队列，`/canvas-studio/generate` 收到即发 ⇒ 客户端连点节点重试、
 * 打回重出、模型同回合发多个调用，都会把多个请求同时压给后端。
 *
 * 真正的代价不是「慢」而是**误判**：客户端占位节点的结算上限 `PENDING_TIMEOUT_MS
 * = 660s` 从占位落地起算，而 `DRAMA_TIMEOUT_MS.video = 600s` —— 只剩 60s 余量。
 * 只要请求重叠一次，排在后面的请求「还没轮到」就被判成「生成超时」。
 *
 * 所以本文件守三件事：
 *
 * 1. **队列语义逐条**（真并发跑一遍：同刻最多 1 个在飞 + 严格 FIFO）；
 * 2. **最危险的失败模式**：等待中被取消必须出队 —— 不清理就锁死整条队列；
 *    `run()` 抛错必须释放槽位 —— 同理；
 * 3. **接线真的在**：接入点唯一且在 `callDrama` 内、慢端点（上传/探活/文本）不排队、
 *    路由是只读 GET、客户端轮询真的顺延了占位截止。判定对了但忘了接，行为与
 *    「没做」完全一样 —— 这是最容易静默失效的一环。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  generateQueueSnapshot,
  resetGenerateQueue,
  withGenerateSlot,
} from '../lib/generate-queue.js'
import {
  generationQueueNote,
  generationQueueStateOf,
  normalizeGenerateQueueSnapshot,
} from '../lib/queue-view.js'
import { generationLabelOf } from '../lib/generate.js'
import { DRAMA_ENDPOINTS } from '../lib/config.js'

/** 一次事件循环的让出（本模块全程不用定时器，setImmediate 足够推进 promise 链）。 */
const tick = () => new Promise((resolve) => { setImmediate(resolve) })

/**
 * 给「队列本该继续前进」的等待加一道短闸。
 *
 * 队列一旦不再推进（槽位没释放、被取消的条目没出队），等待方会**永久挂住** ——
 * 在 CI 上那就是整轮测试超到被砍，看不到是哪条断言坏了。这里 800ms 就报一句
 * 说清原因的红，把「挂死」换成「可读的失败」。
 */
async function beforeStall(promise, label, ms = 800) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}：队列没有继续前进（槽位未释放 / 条目未出队？）`)), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** 手动闸门：用来把「第一个请求」按住在执行中，以便观察排队态。 */
function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

/**
 * 读源码并**剥掉注释**再断言。
 *
 * 只剥块注释与整行注释（与 approval-gate / visual-tokens 同一理由）：本仓的注释
 * 里长着大量「不要这样做」的叮嘱，不剥注释的守卫会被一句正确的注释骗过，然后被
 * 人删掉。不剥行内注释是为了不误吃 `https://`。
 */
function readSource(rel) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

// ─────────────────────────── 队列语义 ───────────────────────────

test('同刻最多一个在执行，且严格 FIFO', async () => {
  resetGenerateQueue()
  const started = []
  const events = []
  let concurrent = 0
  let maxConcurrent = 0
  const job = (label) => async () => {
    concurrent += 1
    maxConcurrent = Math.max(maxConcurrent, concurrent)
    started.push(label)
    events.push(`+${label}`)
    await tick()
    await tick()
    events.push(`-${label}`)
    concurrent -= 1
    return label
  }

  const results = await beforeStall(Promise.all([
    withGenerateSlot('a', undefined, job('a')),
    withGenerateSlot('b', undefined, job('b')),
    withGenerateSlot('c', undefined, job('c')),
  ]), '三个请求依次跑完')

  assert.equal(maxConcurrent, 1, '后端同步单任务：宿主侧同刻只能有一个在飞')
  assert.deepEqual(started, ['a', 'b', 'c'], '必须按入队次序授权（严格 FIFO）')
  assert.deepEqual(
    events,
    ['+a', '-a', '+b', '-b', '+c', '-c'],
    '第二个必须等第一个退出后才开始（不是同时进去各跑一半）',
  )
  assert.deepEqual(results, ['a', 'b', 'c'])
  assert.equal(generateQueueSnapshot().active, null, '全部结算后必须空闲')
})

test('快照位次：执行中恒为 0，等待中从 1 递增', async () => {
  resetGenerateQueue()
  const gate = deferred()
  const held = withGenerateSlot('视频生成', undefined, () => gate.promise)
  await tick()
  const first = withGenerateSlot('图片生成', undefined, async () => 'first')
  const second = withGenerateSlot('音乐生成', undefined, async () => 'second')
  await tick()

  const snapshot = generateQueueSnapshot()
  assert.equal(snapshot.active?.label, '视频生成')
  assert.equal(snapshot.active?.position, 0, '执行中的条目位次恒为 0')
  assert.deepEqual(
    snapshot.waiting.map((entry) => [entry.label, entry.position]),
    [['图片生成', 1], ['音乐生成', 2]],
    '等待中的位次必须 1 起且按 FIFO 递增',
  )

  gate.resolve()
  await beforeStall(Promise.all([held, first, second]), '放行后被压住的两个')
  assert.equal(generateQueueSnapshot().waiting.length, 0)
})

test('等待中被取消：出队并拒绝，且不锁死队列', async () => {
  resetGenerateQueue()
  const order = []
  const gate = deferred()
  const held = withGenerateSlot('held', undefined, async () => {
    order.push('held:start')
    await gate.promise
    order.push('held:end')
    return 'held'
  })
  await tick()

  const controller = new AbortController()
  const cancelled = withGenerateSlot('cancelled', controller.signal, async () => {
    order.push('cancelled:ran')
    return 'cancelled'
  })
  const third = withGenerateSlot('third', undefined, async () => {
    order.push('third:ran')
    return 'third'
  })
  await tick()
  assert.deepEqual(
    generateQueueSnapshot().waiting.map((entry) => entry.label),
    ['cancelled', 'third'],
    '两条都应在等待队列里',
  )

  controller.abort()
  await assert.rejects(cancelled, undefined, '被取消的等待必须拒绝')
  assert.deepEqual(
    generateQueueSnapshot().waiting.map((entry) => entry.label),
    ['third'],
    '被取消的条目必须**出队** —— 留着它就把后面的请求永久堵死',
  )

  gate.resolve()
  assert.equal(await beforeStall(held, '被取消者的前一个'), 'held')
  assert.equal(
    await beforeStall(third, '取消掉一个等待者之后'),
    'third',
    '取消掉一个等待者之后，队列必须继续前进',
  )
  assert.deepEqual(order, ['held:start', 'held:end', 'third:ran'], '被取消的那个绝不能被执行')
  assert.equal(generateQueueSnapshot().active, null)
})

test('入队前已取消：直接拒绝，且不占位', async () => {
  resetGenerateQueue()
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(withGenerateSlot('x', controller.signal, async () => 'never'))
  assert.equal(generateQueueSnapshot().active, null)
  assert.equal(generateQueueSnapshot().waiting.length, 0, '不该留下空占位')
})

test('run 抛错也必须释放槽位', async () => {
  resetGenerateQueue()
  const boom = withGenerateSlot('boom', undefined, async () => { throw new Error('boom') })
  const after = withGenerateSlot('after', undefined, async () => 'after')
  await assert.rejects(boom, /boom/)
  assert.equal(
    await beforeStall(after, '前一个抛错之后'),
    'after',
    '前一个抛错不该把队列永久停住',
  )
  assert.equal(generateQueueSnapshot().active, null)
})

// ─────────────────────────── 视图投影 ───────────────────────────

const ENTRY = { id: 'g1', label: '视频生成', position: 0 }
const WAITER = { id: 'g2', label: '图片生成', position: 1 }
const EMPTY = { active: null, waiting: [] }

test('状态投影：只有「真的有等待」才非 null', () => {
  assert.equal(generationQueueStateOf(null), null)
  assert.equal(generationQueueStateOf(EMPTY), null)
  assert.equal(
    generationQueueStateOf({ active: ENTRY, waiting: [] }),
    null,
    '只有自己在跑 ⇒ 不该显示队列痕迹（那是噪音，也是每 2s 一次的白重渲染）',
  )
  assert.equal(
    generationQueueStateOf({ active: null, waiting: [WAITER] }),
    null,
    '形状矛盾（有等待却没有执行者）⇒ 不显示，而不是印一行「等待 1 个」让人猜',
  )
  assert.deepEqual(
    generationQueueStateOf({ active: ENTRY, waiting: [WAITER, { ...WAITER, id: 'g3', position: 2 }] }),
    { active: '视频生成', waiting: 2 },
  )
})

test('遮罩文案：短、带「谁占着槽位」', () => {
  assert.equal(generationQueueNote(null), null)
  const note = generationQueueNote({ active: '视频生成', waiting: 2 })
  assert.match(note, /视频生成/, '必须说清是谁占着唯一那条通道')
  assert.match(note, /2/)
  // 节点体区约 260px，.csNodeOverlayHint 是单行小字 ⇒ 文案过长会溢出卡片。
  assert.ok(note.length <= 22, `文案过长会溢出节点（当前 ${note.length} 字）：${note}`)
})

test('快照归一化：形状不对返回 null，不降级成「空队列」', () => {
  // 空队列是「没有任何生成在跑」的强断言，拿不准时必须是 null。
  assert.equal(normalizeGenerateQueueSnapshot(null), null)
  assert.equal(normalizeGenerateQueueSnapshot('x'), null)
  assert.equal(normalizeGenerateQueueSnapshot({}), null, '缺 waiting 不等于没有生成')
  assert.equal(normalizeGenerateQueueSnapshot({ active: null, waiting: [{}] }), null, '条目形状不对')
  assert.equal(normalizeGenerateQueueSnapshot({ active: 'x', waiting: [] }), null, 'active 形状不对')
  assert.deepEqual(
    normalizeGenerateQueueSnapshot({ active: ENTRY, waiting: [WAITER] }),
    { active: ENTRY, waiting: [WAITER] },
  )
})

// ─────────────────────────── 接线守卫 ───────────────────────────

/**
 * 走 `callDrama` 的端点 → 期望标签。
 *
 * 刻意在测试里**重抄一遍**而不是从源码推：这是产品约束（「哪些端点算生成、
 * 该显示成什么」），实现漏标或标错时这里必须红。
 */
const EXPECTED_LABELS = [
  [DRAMA_ENDPOINTS.txt2image, '图片生成'],
  [DRAMA_ENDPOINTS.txt2imageanime, '图片生成'],
  [DRAMA_ENDPOINTS.image2image, '图片生成'],
  [DRAMA_ENDPOINTS.image2fix, '图内文字修复'],
  [DRAMA_ENDPOINTS.character, '角色四视图'],
  [DRAMA_ENDPOINTS.videoFl2va, '视频生成'],
  [DRAMA_ENDPOINTS.videoRef2va, '视频生成'],
  [DRAMA_ENDPOINTS.txt2audio, '音乐生成'],
]

test('每个走队列的生成端点都有专属标签', () => {
  for (const [endpoint, expected] of EXPECTED_LABELS) {
    assert.equal(generationLabelOf(endpoint), expected, `${endpoint} 的队列标签不对`)
  }
  // 兜底值只该留给未登记的端点：所有生成端点都不许落到它。
  assert.equal(generationLabelOf('/api/v1/nope'), '生成')
})

test('队列接入点唯一，且在 callDrama 内', () => {
  const src = readSource('../src/generate.ts')
  const calls = src.match(/withGenerateSlot\(/g) ?? []
  assert.equal(calls.length, 1, '队列接入点必须唯一——多处接入就是多套口径')

  const callAt = src.indexOf('withGenerateSlot(')
  const enclosing = src.slice(0, callAt).match(/\n(?:export )?(?:async )?function (\w+)/g)?.pop() ?? ''
  assert.match(
    enclosing,
    /callDrama/,
    `队列必须接在 callDrama 内（同步单任务后端的唯一网络入口），实际落在：${enclosing.trim()}`,
  )
})

test('fal 不进队列：provider-aware 是结构保证', () => {
  const fal = readSource('../src/providers/fal.ts')
  assert.ok(!fal.includes('withGenerateSlot'), 'fal 是异步三段式供应商，排队只会无谓串行化它')
  assert.ok(!fal.includes('callDrama'), 'fal 不该走 Drama 的生成入口（那正是「结构保证」的含义）')
  // generate.ts 里也不许出现按 provider 字符串决定排不排队的分支。
  const generate = readSource('../src/generate.ts')
  assert.ok(
    !/provider === 'drama'/.test(generate),
    '排不排队由「接在哪个函数上」决定，不得退化成 provider 字符串分支',
  )
})

test('Host 注册只读的队列快照端点', () => {
  const src = readSource('../src/routes.ts')
  assert.match(
    src,
    /ROUTE_GENERATE_QUEUE = '\/canvas-studio\/generate-queue'/,
    'Host 必须注册 /canvas-studio/generate-queue',
  )
  const at = src.indexOf('path: ROUTE_GENERATE_QUEUE')
  assert.ok(at >= 0, 'R 常量声明了但没人 register')
  const block = src.slice(at, at + 800)
  assert.match(block, /requestAllowed\(req, expectedPort\)/, '只读端点的准入用 requestAllowed')
  assert.ok(!block.includes('mutationAllowed'), '队列快照是只读的，不该要求同源 POST')
  assert.match(block, /req\.method !== 'GET'/, '队列快照只接受 GET')
  assert.match(block, /generateQueueSnapshot\(\)/, '必须下发真实快照而不是空对象')
})

test('客户端：队列非空期间顺延占位截止（不把排队算成超时）', () => {
  const src = readSource('../src/client/index.ts')
  const pollAt = src.indexOf('const pollGenerationQueue = async')
  assert.ok(pollAt >= 0, '轮询函数不见了——660s 假超时会回来')
  const block = src.slice(pollAt, src.indexOf('const ensureQueuePoll', pollAt))
  assert.match(block, /armPendingTimer\(/, '轮询必须重起占位计时器（= 排队时间不计入截止）')
  assert.match(block, /if \(!queuePollNeeded\(\)\)/, '没有生成在飞时必须收工（否则是常驻后台流量）')
  // 客户端侧最主要的并发来源是节点重试，必须计入在飞集合。
  assert.match(
    src,
    /trackClientGeneration\(\(\) => retryStudioNode\(/,
    '节点重试必须计入在飞集合——否则「自己造成的排队」这一半场景完全没对齐',
  )
})
