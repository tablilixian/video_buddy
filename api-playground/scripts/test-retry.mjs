// 重试逻辑自测。
//
// 重试是最容易写出「静默灾难」的地方：退避写错会变成忙等、abort 没透传会让
// 「随时停止」失效、异常吞掉会让真失败看起来成功。这里逐条钉住。
//
// 用法：node scripts/test-retry.mjs   （需 Node >= 22.18）

const [maj, min] = process.versions.node.split('.').map(Number)
if (maj < 22 || (maj === 22 && min < 18)) {
  console.error(`✗ 需要 Node >= 22.18，当前 ${process.versions.node}`)
  process.exit(2)
}

const { withRetry, isRetryableStatus, isAbortError } = await import('../src/api.ts')

let pass = 0
const failures = []
function check(name, cond, detail) {
  if (cond) {
    pass++
    console.log(`  [PASS] ${name}`)
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
/** 测试里退避基数取 1ms，别让单测真的等 400ms。 */
const FAST = { baseMs: 1 }

console.log('\n=== 重试逻辑自测 ===\n')

console.log('① 成功路径：')
{
  let calls = 0
  const r = await withRetry(async () => {
    calls++
    return 'ok'
  }, FAST)
  check('首次成功 → attempts=1', r.attempts === 1)
  check('只调用 1 次', calls === 1)
  check('无失败记录', r.failures.length === 0)
  check('值原样返回', r.value === 'ok')
}

console.log('\n② 异常重试：')
{
  let calls = 0
  const r = await withRetry(async (attempt) => {
    calls++
    if (attempt < 3) throw new Error(`boom-${attempt}`)
    return 'recovered'
  }, FAST)
  check('前两次失败第三次成功 → attempts=3', r.attempts === 3, `实际 ${r.attempts}`)
  check('调用 3 次', calls === 3)
  check('记录了 2 条失败原因', r.failures.length === 2, JSON.stringify(r.failures))
  check('失败原因含原始错误文本', r.failures[1].includes('boom-2'))
  check('最终值来自最后一次', r.value === 'recovered')
}
{
  let calls = 0
  let thrown = null
  try {
    await withRetry(async () => {
      calls++
      throw new Error('always')
    }, { ...FAST, times: 2 })
  } catch (e) {
    thrown = e
  }
  check('始终失败 → 抛出最后一次异常', thrown instanceof Error && thrown.message === 'always')
  check('times=2 → 共 3 次尝试（首次 + 2 次重试）', calls === 3, `实际 ${calls}`)
}
{
  let calls = 0
  try {
    await withRetry(async () => {
      calls++
      throw new Error('x')
    }, { ...FAST, times: 0 })
  } catch { /* expected */ }
  check('times=0 → 不重试，仅 1 次尝试', calls === 1, `实际 ${calls}`)
}

console.log('\n③ 返回值层面的重试（HTTP 5xx）：')
{
  const seen = []
  const r = await withRetry(async (attempt) => {
    seen.push(attempt)
    return attempt === 1 ? { status: 500 } : { status: 200 }
  }, { ...FAST, retryOnValue: (v) => isRetryableStatus(v.status) })
  check('500 后重试拿到 200 → attempts=2', r.attempts === 2)
  check('最终值是第二次的', r.value.status === 200)
  check('记了一条「不可信结果」', r.failures.length === 1 && r.failures[0].includes('不可信'))
}
{
  // 坏值一直坏：不能抛（调用点要按 HTTP 状态自己处理），要返回最后一次
  const r = await withRetry(async () => ({ status: 503 }), { ...FAST, retryOnValue: (v) => isRetryableStatus(v.status) })
  check('一直 5xx → 返回最后一次坏值而不是抛异常', r.value.status === 503)
  check('attempts=3（耗尽）', r.attempts === 3, `实际 ${r.attempts}`)
}
{
  let calls = 0
  await withRetry(async () => {
    calls++
    return { status: 422 }
  }, { ...FAST, retryOnValue: (v) => isRetryableStatus(v.status) })
  check('4xx 不触发重试', calls === 1)
}
check('isRetryableStatus 只认 5xx 及以上', isRetryableStatus(500) && isRetryableStatus(503) && !isRetryableStatus(499) && !isRetryableStatus(422))

console.log('\n④ 「随时停止」必须能穿透重试：')
{
  const ctrl = new AbortController()
  let calls = 0
  const p = withRetry(async () => {
    calls++
    if (calls === 1) throw new Error('boom')
    return 'never'
  }, { ...FAST, baseMs: 50, signal: ctrl.signal })
  setTimeout(() => ctrl.abort(), 10)
  let err = null
  try {
    await p
  } catch (e) {
    err = e
  }
  check('退避期间被中止 → 抛出 AbortError', isAbortError(err), String(err))
  check('中止后不再发起新尝试', calls === 1, `实际 ${calls}`)
}
{
  const ctrl = new AbortController()
  ctrl.abort()
  let calls = 0
  let err = null
  try {
    await withRetry(async () => {
      calls++
      throw new DOMException('Aborted', 'AbortError')
    }, { ...FAST, signal: ctrl.signal })
  } catch (e) {
    err = e
  }
  check('AbortError 立即抛出、绝不重试', isAbortError(err) && calls === 1, `calls=${calls}`)
}
check('isAbortError 认 DOMException 与 message 两种形态', isAbortError(new DOMException('Aborted', 'AbortError')) && isAbortError(new Error('The user aborted a request.')))

console.log('\n⑤ 退避是「等」，不是「忙等」：')
{
  const t0 = Date.now()
  try {
    await withRetry(async () => {
      throw new Error('x')
    }, { times: 2, baseMs: 30 })
  } catch { /* 预期耗尽后抛出 */ }
  const dt = Date.now() - t0
  check('退避确实在等（30+60=90ms 量级）', dt >= 80, `实际 ${dt}ms`)
  check('退避不是指数爆炸（<500ms）', dt < 500, `实际 ${dt}ms`)
}

console.log('\n=== 汇总 ===')
console.log(`通过 ${pass}  失败 ${failures.length}`)
if (failures.length > 0) {
  console.log('\n失败项：')
  for (const f of failures) console.log(`  · ${f}`)
}
process.exit(failures.length === 0 ? 0 : 1)
