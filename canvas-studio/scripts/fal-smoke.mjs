/**
 * fal (MiniMax H3) 真机烟测脚本 —— 阶段 7 端到端验收用。
 *
 * 直接驱动 `lib/providers/fal.js` 的 submit → poll 协议，绕开 Electron UI，
 * 用真实 FAL_KEY 验证 A1 / A2 / A3 / A9 这几条需要真机的验收项。
 * 自动化测试已用 mock 覆盖全部协议分支，本脚本只在「有真实 Key」时用于真机确认。
 *
 * 用法：
 *   # A3：真实文生视频出片（FAL_API_KEY 必填）
 *   FAL_API_KEY=xxxx node scripts/fal-smoke.mjs
 *
 *   # A1：Key 留空 → 期望报「未配置 fal API Key」（不出片、不崩）
 *   node scripts/fal-smoke.mjs --no-key
 *
 *   # A2：错误 Key → 期望报 fal 401/403 鉴权错误（文案可读）
 *   node scripts/fal-smoke.mjs --wrong-key
 *
 *   # 可选：传时长 / 画幅（A9 钳制：duration<5 会被钳到 5 并回 warning）
 *   FAL_API_KEY=xxxx node scripts/fal-smoke.mjs --duration 3 --aspectRatio 1:1
 *
 * 退出码：0 = 符合预期；1 = 不符合 / 异常。
 */
import { createFalProvider } from '../lib/providers/fal.js'

const args = new Set(process.argv.slice(2))
const MODE = args.has('--no-key') ? 'no-key' : args.has('--wrong-key') ? 'wrong-key' : 'real'
const DURATION = Number(args.has('--duration') ? process.argv[process.argv.indexOf('--duration') + 1] : 5)
const ASPECT = args.has('--aspectRatio') ? process.argv[process.argv.indexOf('--aspectRatio') + 1] : '16:9'
const TIMEOUT_MS = 540_000 // 9 分钟，覆盖 fal 队列排队 + 生成

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function fail(msg) {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

async function main() {
  const provider = createFalProvider()

  // —— Key 来源：real 模式用环境变量；其余模式走构造值以触发对应错误路径。
  let key = ''
  if (MODE === 'real') key = process.env.FAL_API_KEY ?? ''
  else if (MODE === 'wrong-key') key = 'fal_key_invalid_for_testing_0000000000'

  const req = {
    capability: 'text-to-video',
    prompt: '一只橘猫在阳光下的草地上奔跑，镜头缓慢平移，写实风格，电影感',
    duration: Number.isFinite(DURATION) ? DURATION : 5,
    aspectRatio: ASPECT,
  }

  const ctx = { falApiKey: async () => key }

  console.log(`[fal-smoke] mode=${MODE} capability=${req.capability} duration=${req.duration} aspect=${req.aspectRatio}`)

  // A1：Key 留空 —— 期望 submit 抛「未配置 fal API Key」且不发任何请求。
  if (MODE === 'no-key') {
    try {
      await provider.submit(req, ctx)
      fail('A1 失败：未配置 Key 却没有报错（不应到达这里）')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/未配置 fal API Key/.test(msg)) {
        console.log(`✓ A1 通过：未配置 Key 正确报错 → "${msg}"`)
        process.exit(0)
      }
      fail(`A1 失败：抛出的不是预期错误 → "${msg}"`)
    }
    return
  }

  // A2：错误 Key —— 期望 fal 鉴权错误（401/403），文案可读。
  if (MODE === 'wrong-key') {
    try {
      await provider.submit(req, ctx)
      fail('A2 失败：错误 Key 却没有报错')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/40[13]|鉴权|未授权|unauthorized|forbidden/i.test(msg)) {
        console.log(`✓ A2 通过：错误 Key 正确报鉴权错误 → "${msg}"`)
        process.exit(0)
      }
      fail(`A2 失败：抛出的不是鉴权错误 → "${msg}"`)
    }
    return
  }

  // A3（及 A9 钳制观察）：真实出片。
  if (key.length === 0) fail('real 模式需要 FAL_API_KEY 环境变量')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  ctx.signal = controller.signal

  let handle
  try {
    handle = await provider.submit(req, ctx)
  } catch (e) {
    clearTimeout(timer)
    return fail(`A3 失败：submit 抛错 → ${e instanceof Error ? e.message : e}`)
  }
  if (handle.warnings?.length) handle.warnings.forEach((w) => console.log(`  ⚠ ${w}`))
  console.log(`[fal-smoke] submitted, token=${handle.token.slice(0, 60)}…`)

  const deadline = Date.now() + TIMEOUT_MS
  while (true) {
    let poll
    try {
      poll = await provider.poll(handle, ctx)
    } catch (e) {
      clearTimeout(timer)
      return fail(`A3 失败：poll 抛错 → ${e instanceof Error ? e.message : e}`)
    }
    if (poll.done) {
      clearTimeout(timer)
      if (poll.url && poll.url.length > 0) {
        console.log(`✓ A3 通过：出片成功`)
        console.log(`  视频 URL: ${poll.url}`)
        process.exit(0)
      }
      return fail(`A3 失败：完成但没有 video.url`)
    }
    console.log(`  … ${poll.stage ?? '处理中'}`)
    if (Date.now() > deadline) {
      clearTimeout(timer)
      return fail('A3 失败：超过 9 分钟仍未完成（A13 超时边界，请排查 fal 队列）')
    }
    await sleep(4000)
  }
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)))
