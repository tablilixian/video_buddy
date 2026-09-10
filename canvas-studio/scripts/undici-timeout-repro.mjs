/**
 * 复现实验：Node 内置 `fetch`（undici）的 300s 隐形上限**先于 AbortSignal 触发**。
 *
 * 为什么要有这个脚本：CV-133 的排障过程中，我们一度把「请求在 ~301s 失败」误判为
 * 「探针自己的超时」——实际上探针的 `TIMEOUT_MS` 是 900s，**从未触发**；真正掐断请求的
 * 是 undici dispatcher 的默认 `headersTimeout = 300s`（官方文档：Defaults to 300 seconds），
 * 这个上限与传给 fetch 的 AbortSignal **无关且更早生效**。
 *
 * 本脚本用「只接受连接、永不回响应头」的本地服务器把该行为稳定复现，用来：
 *   ① 证明 AbortSignal 触发时抛的是「The operation was aborted due to timeout」且**无** UND_ERR 错误码；
 *   ② 证明请求实际在 ~300s（不是传进去的 900s）被掐断，错误码 `UND_ERR_HEADERS_TIMEOUT`。
 *
 * 影响面（见 docs/av-timeline-plan.md §4.4 / §5 P0-A）：
 *   `DRAMA_TIMEOUT_MS = { image: 360_000, video: 600_000, text: 180_000 }` 里 image / video
 *   两档都超过 300s → **配置值不可达**，有效上限恒为 300s；`src/providers/{generate,fal}.ts`
 *   的所有长请求都受此限，而 `video_composite` 默认 10s 视频的推理已 >301s。
 *
 * 用法：`node scripts/undici-timeout-repro.mjs`
 * 耗时：约 5 分钟（等 undici 自己到 300s，这是实验的一部分，不是卡住）。
 * 退出码：0 = 复现成功（确认 300s 上限生效）；1 = 与预期不符，需复查。
 *
 * 注：不要把它跑在 CI 里（长达 5 分钟）；它是「一次性证据固化」，需要时手动跑。
 */
import net from 'node:net'

/** 传进 fetch 的 AbortSignal 超时——故意设得远大于 undici 的 300s 默认值。 */
const SIGNAL_MS = 900_000
/** undici dispatcher 默认 headersTimeout（官方文档值），用于对照判定。 */
const UNDICI_DEFAULT_HEADERS_MS = 300_000
/** 判定窗口：实测落点应在 300s 附近（undici 用低精度快速定时器，容许 ±20s）。 */
const TOLERANCE_MS = 20_000

// 第二个实验：短信号（2s）观察 AbortSignal **自己**触发时的错误形态，用于对比。
async function signalShapeProbe() {
  const srv = net.createServer(() => { /* 永不响应 */ })
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve))
  const port = srv.address().port
  const started = Date.now()
  try {
    await fetch(`http://127.0.0.1:${port}/never`, { signal: AbortSignal.timeout(2_000) })
    console.log('[②] 意外成功')
  } catch (e) {
    console.log(`[②] AbortSignal(2s) 触发 → 耗时 ${Date.now() - started}ms`)
    console.log(`     message    = ${e.message}`)
    console.log(`     cause.name = ${e.cause?.name ?? '(无)'}`)
    console.log(`     cause.code = ${e.cause?.code ?? '(无)'}`)
    console.log('     判据：应为「The operation was aborted due to timeout」且 cause.code 为空')
    console.log('           —— 说明 AbortSignal 的错误形态**不同于** UND_ERR_HEADERS_TIMEOUT')
  } finally {
    srv.close()
  }
}

async function main() {
  await signalShapeProbe()
  console.log()

  const srv = net.createServer(() => { /* 永不响应：不写任何字节，让 headersTimeout 生效 */ })
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve))
  const port = srv.address().port
  const started = Date.now()
  console.log(`[①] fetch(signal=AbortSignal.timeout(${SIGNAL_MS}ms)) 打「只接不回」服务器 ...`)
  console.log('    预期：~300s 被 undici 掐断（而不是 900s）')

  let elapsed
  let code
  try {
    await fetch(`http://127.0.0.1:${port}/never`, { signal: AbortSignal.timeout(SIGNAL_MS) })
    console.log('[①] 意外成功（不应发生）')
    srv.close()
    process.exit(1)
  } catch (e) {
    elapsed = Date.now() - started
    code = e.cause?.code
    console.log(`[①] 掐断于 ${elapsed}ms（${(elapsed / 1000).toFixed(1)}s）`)
    console.log(`     message    = ${e.message}`)
    console.log(`     cause.name = ${e.cause?.name ?? '(无)'}`)
    console.log(`     cause.code = ${code ?? '(无)'}`)
  } finally {
    srv.close()
  }

  const nearUndici = Math.abs(elapsed - UNDICI_DEFAULT_HEADERS_MS) <= TOLERANCE_MS
  const isHeadersTimeout = code === 'UND_ERR_HEADERS_TIMEOUT'
  if (nearUndici && isHeadersTimeout) {
    console.log()
    console.log(`结论 ✅ 请求在 undici 的 300s 上限处被掐断（非传入的 ${SIGNAL_MS}ms）`)
    console.log('     → AbortSignal 无法把 Node 内置 fetch 的超时放宽到 300s 以上；')
    console.log('       要跑更长的请求必须自建 dispatcher 或改用 node:http。')
    process.exit(0)
  }
  console.log()
  console.log(`结论 ❌ 与预期不符（落点 ${(elapsed / 1000).toFixed(1)}s, code=${code ?? '无'}），需复查`)
  process.exit(1)
}

await main()
