/**
 * REQ-035 真机验收判定器（只读，不改任何状态）
 *
 * 用途：跑完真机用例后，一条命令把应用日志读成「通过 / 不通过 + 证据」。
 * 判据全部来自本次修复希望改变的行为，不是"日志里没报错"这种弱断言。
 *
 * 用法：
 *   node scripts/render-forensics/verify-live.mjs                # 读今天的日志
 *   node scripts/render-forensics/verify-live.mjs --date 2026-10-24
 *   node scripts/render-forensics/verify-live.mjs --log /path/to/dsh-2026-10-24.log
 *
 * 退出码：0 = 全部通过；1 = 有未通过项。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const arg = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  if (hit !== undefined) return hit.slice(name.length + 3)
  const idx = argv.indexOf(`--${name}`)
  return idx >= 0 ? argv[idx + 1] : undefined
}

const date = arg('date') ?? new Date().toISOString().slice(0, 10)
const LOG_DIR = join(homedir(), 'Library/Application Support/VideoBuddy/logs')
const logPath = arg('log') ?? join(LOG_DIR, `dsh-${date}.log`)

const C = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  bad: (s) => `\x1b[31m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[90m${s}\x1b[0m`,
}

if (!existsSync(logPath)) {
  console.error(C.bad(`找不到日志：${logPath}`))
  console.error('提示：应用至少要启动过一次；或用 --log 指定文件。')
  process.exit(1)
}

const log = readFileSync(logPath, 'utf8')
// 只判**本次启动之后**的日志：整天日志里混着修复前的旧记录，拿它统计会得出假红。
const lastRunIdx = log.lastIndexOf('\n--- dsh-plugin-desktop')
const sessionLog = lastRunIdx === -1 ? log : log.slice(lastRunIdx)
const lines = sessionLog.split('\n')
const count = (re) => lines.filter((l) => re.test(l)).length
const samples = (re, n = 3) => lines.filter((l) => re.test(l)).slice(-n).map((l) => l.trim().slice(0, 200))

// ── 0. 客户端是不是新包（最常见的假失败来源）───────────────────────────────
const libPath = join(import.meta.dirname, '..', '..', 'lib', 'client.js')
const libMtime = existsSync(libPath) ? statSync(libPath).mtime : null
const lastRun = [...log.matchAll(/^--- dsh-plugin-desktop .*? run (\d+) ---$/gmu)].pop()
const runAt = lastRun === undefined ? null : new Date(Number(lastRun[1]))

const staleLib = libMtime !== null && runAt !== null && libMtime.getTime() > runAt.getTime() + 1000

// ── 指标 ──────────────────────────────────────────────────────────────────
const timeouts = count(/CS-RENDER-TIMEOUT/u)
const timeoutsWithDiagnosis = count(/CS-RENDER-TIMEOUT.*(工单|从未取走|一帧都没渲染|已渲染)/u)
const oldCopy = count(/请确认画布页面已打开且可见/u)
const takeovers = count(/滞留渲染工单/u)
const takeoverReasons = [...sessionLog.matchAll(/滞留渲染工单 \S+ 已改派隐藏渲染窗口（([^；)]+)/gu)].map((m) => m[1])
const hostCreated = count(/RenderHost 已创建/u)
const hostDisposed = count(/RenderHost 销毁/u)
const restarts = (log.match(/^--- dsh-plugin-desktop/gmu) ?? []).length
const probeRuns = count(/工单：.*探针/u)

const checks = [
  {
    id: 'L-1',
    name: '客户端已加载新包（不是陈旧构建）',
    pass: !staleLib,
    detail: staleLib
      ? `lib/client.js 的 mtime 比本次应用启动更晚 —— **改完代码没重启应用**，先重启再测`
      : libMtime === null
        ? 'lib/client.js 不存在（可能跑的是打包版），请确认加载的是哪份产物'
        : `lib 构建于 ${libMtime.toLocaleString('zh-CN')}，应用启动于 ${runAt?.toLocaleString('zh-CN') ?? '未知'}`,
  },
  {
    id: 'L-2',
    name: '超时文案已带工单诊断（旧口径不再出现）',
    pass: oldCopy === 0,
    detail: oldCopy > 0
      ? `仍出现 ${oldCopy} 条「请确认画布页面已打开且可见」⇒ 跑的是旧代码`
      : `旧口径 0 条；带诊断的超时 ${timeoutsWithDiagnosis}/${timeouts} 条`,
    samples: samples(/CS-RENDER-TIMEOUT/u),
  },
  {
    id: 'L-3',
    name: '改派链路可用（画布页卡住时窗口能接管）',
    // 本次根本没渲过 ⇒ 未触发，不该判红（否则"刚启动"永远是不通过）
    skip: hostCreated === 0 && timeouts === 0,
    pass: takeovers > 0,
    detail: takeovers > 0
      ? `发生 ${takeovers} 次改派；原因：${[...new Set(takeoverReasons)].join(' / ') || '（未记录原因）'}`
      : '本次 0 次改派 —— 若用例 Z-3 没做，这是正常的；做了却没日志说明 F-02a/b 没生效',
    samples: samples(/滞留渲染工单/u),
  },
  {
    id: 'L-4',
    name: '隐藏渲染窗口被正常创建并回收',
    skip: hostCreated === 0 && timeouts === 0,
    pass: hostCreated > 0,
    detail: `创建 ${hostCreated} 次 / 回收 ${hostDisposed} 次 / 应用重启 ${restarts} 次`,
  },
  {
    id: 'L-5',
    name: '没有"渲染到底跑没跑"的黑箱超时',
    pass: timeouts === 0 || timeoutsWithDiagnosis === timeouts,
    detail: timeouts === 0
      ? '本次没有超时'
      : `超时 ${timeouts} 条里 ${timeoutsWithDiagnosis} 条带诊断 —— 剩下的说明还有没接诊断的抛出点`,
  },
]

// ── 输出 ──────────────────────────────────────────────────────────────────
console.log(`\n日志：${logPath}`)
console.log(`窗口：${runAt?.toLocaleString('zh-CN') ?? '未知'} 起${restarts > 1 ? `（本次共 ${restarts} 次启动）` : ''}`)
console.log(`探针渲染：${probeRuns} 次${probeRuns > 0 ? C.dim('（不应产生画布节点）') : ''}\n`)

let failed = 0
let skipped = 0
for (const c of checks) {
  if (c.skip === true) {
    skipped += 1
    console.log(`${C.dim('–')} ${c.id} ${c.name}`)
    console.log(`    ${C.dim('未触发（本次日志里没有任何渲染动作）')}`)
    continue
  }
  if (!c.pass) failed += 1
  console.log(`${c.pass ? C.ok('✓') : C.bad('✗')} ${c.id} ${c.name}`)
  console.log(`    ${c.detail}`)
  for (const s of c.samples ?? []) console.log(C.dim(`    · ${s}`))
}

console.log('')
if (failed === 0 && skipped > 0) {
  console.log(C.ok('判定：前置就绪（新代码已加载），但本次还没有渲染动作 —— 可以开始用例'))
} else if (failed === 0) {
  console.log(C.ok('判定：通过（日志层面）'))
} else {
  console.log(C.bad(`判定：${failed} 项未通过`))
  console.log(C.warn('注意：L-3 只在做过用例 Z-3 时才要求有改派日志。'))
}
process.exit(failed === 0 ? 0 : 1)
