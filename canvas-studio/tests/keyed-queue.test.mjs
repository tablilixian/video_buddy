/**
 * AR-01：`keyed-queue.ts` 的不变量测试（纯函数层）。
 *
 * 队列是「读-改-写」正确性的承重件，它自己错了会让所有写口一起错——所以这里把
 * 五条不变量逐条钉住。尤其是**失败隔离**：一个任务抛错若把链尾变成 rejected
 * promise，后续任务会「静默不执行」，而这类故障在业务层表现为「生成完但画布没动」
 * ——极难归因。`generate-queue.ts` 的头注已经把同款教训写过一次（「等待中被取消
 * 必须出队，否则一个被取消的请求会把整条队列锁死」）。
 *
 * 从 ../lib/*.js 导入 —— 先 build 再跑。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createKeyedQueue } from '../lib/keyed-queue.js'

const tick = (ms = 0) => new Promise((resolve) => { setTimeout(resolve, ms) })

test('AR-01①：同 key 严格 FIFO 串行（任务体不交错）', async () => {
  const queue = createKeyedQueue()
  const order = []
  await Promise.all([1, 2, 3].map((index) => queue.run('k', async () => {
    order.push(`start${String(index)}`)
    await tick(5)
    order.push(`end${String(index)}`)
  })))
  assert.deepEqual(order, ['start1', 'end1', 'start2', 'end2', 'start3', 'end3'])
})

test('AR-01②：单任务失败不阻断后续，且调用方拿到真实错误（不吞错）', async () => {
  const queue = createKeyedQueue()
  const seen = []
  const failing = queue.run('k', async () => {
    seen.push('first')
    throw new Error('boom')
  })
  const following = queue.run('k', async () => {
    seen.push('second')
    return 'ok'
  })
  await assert.rejects(failing, /boom/, '调用方应拿到任务自身的错误')
  assert.equal(await following, 'ok', '前一个任务失败后，后续任务仍必须执行（否则整条链锁死）')
  assert.deepEqual(seen, ['first', 'second'])
})

test('AR-01③：任务体同步抛错同样不断链（`.then(() => task())` 的吸收作用）', async () => {
  const queue = createKeyedQueue()
  const syncThrow = queue.run('k', () => { throw new Error('sync') })
  const after = queue.run('k', async () => 'after')
  await assert.rejects(syncThrow, /sync/)
  assert.equal(await after, 'after')
})

test('AR-01④：不同 key 互不阻塞（key 粒度 = 文件路径，故不同项目天然并行）', async () => {
  const queue = createKeyedQueue()
  let releaseBlocked
  const blocked = new Promise((resolve) => { releaseBlocked = resolve })
  const slow = queue.run('a', async () => { await blocked; return 'a' })
  // b 不应等 a
  assert.equal(await queue.run('b', async () => 'b'), 'b')
  releaseBlocked()
  assert.equal(await slow, 'a')
})

test('AR-01⑤：链尾自清理 —— 排空后不残留 key（防只进不出的缓存）', async () => {
  const queue = createKeyedQueue()
  await queue.run('k', async () => 'x')
  // 让链尾的 release 微任务跑完
  await tick()
  assert.equal(queue.pending('k'), 0)
  assert.equal(queue.activeKeys(), 0, '排空后必须摘除 key，否则队列表会随项目数无限增长')
})

test('AR-01⑥：pending 计数覆盖「排队中 + 执行中」，且随完成递减', async () => {
  const queue = createKeyedQueue()
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const first = queue.run('k', async () => { await gate })
  assert.equal(queue.pending('k'), 1)
  const second = queue.run('k', async () => 'second')
  assert.equal(queue.pending('k'), 2, '排队中的任务也要计入深度')
  release()
  await Promise.all([first, second])
  await tick()
  assert.equal(queue.pending('k'), 0)
  assert.equal(queue.activeKeys(), 0)
})

test('AR-01⑦：同 key 重入被**显式拒绝**（而不是静默死锁）', async () => {
  // 这条是本次开发中被咬出来的：`tests/projects-touch.test.mjs` 的 C-10 原实现
  // 「在 readCanvas 钩子里内联触发 writeCanvas」正是同 key 重入。死锁的 promise
  // 链不是事件循环句柄，Node 会正常退出 → 表现为「测试被 cancelled / 业务没生效」
  // 而没有任何堆栈。所以队列必须把重入变成可读异常。
  const queue = createKeyedQueue()
  const nested = queue.run('k', async () => queue.run('k', async () => 'inner'))
  await assert.rejects(nested, /重入会自锁/, '同 key 重入必须抛错并点名 key')
  // 重入被拒后链不能断：同 key 的后续任务仍要照常执行。
  assert.equal(await queue.run('k', async () => 'after'), 'after')
})

test('AR-01⑧：任务体内对**不同** key 入队是合法的（不是重入）', async () => {
  const queue = createKeyedQueue()
  const outer = queue.run('a', async () => queue.run('b', async () => 'inner-b'))
  assert.equal(await outer, 'inner-b')
})

