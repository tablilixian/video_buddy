#!/usr/bin/env node
/**
 * 思考强度 A/B 转录一键对比（P0 任务 2 的取数工具；只读日志，不改产品代码）。
 *
 * 用法：
 *   node scripts/compare-reasoning-ab.mjs <基线.jsonl> <关闭思考.jsonl> [--turn 2] [--json]
 *
 * 内部复用 analyze-storyboard-latency.mjs --json，保证两侧口径完全一致。
 * 只给「可比事实 + 提示」，**不自动决定默认档位** —— 默认值仍需人拍板。
 *
 * 退出码：0 = 对比完成；1 = 参数或解析错误。
 */
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ANALYZER = join(dirname(fileURLToPath(import.meta.url)), 'analyze-storyboard-latency.mjs')

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

const argv = process.argv.slice(2)
const turnIndex = argv.indexOf('--turn')
const turn = turnIndex === -1 ? '2' : argv[turnIndex + 1]
const asJson = argv.includes('--json')
const paths = []
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--turn') { i += 1; continue }
  if (argv[i].startsWith('--')) continue
  paths.push(argv[i])
}
if (paths.length !== 2) {
  fail('用法: node scripts/compare-reasoning-ab.mjs <基线.jsonl> <关闭思考.jsonl> [--turn 2] [--json]')
}
if (!/^[0-9]+$/.test(String(turn))) fail(`--turn 必须是数字，收到 ${turn}`)

function analyze(path) {
  try {
    const out = execFileSync('node', [ANALYZER, path, '--turn', String(turn), '--json'], {
      encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    })
    return JSON.parse(out)
  } catch (error) {
    fail(`分析 ${path} 失败：${String(error.message ?? error).slice(0, 300)}`)
  }
  return undefined
}

const [basePath, variantPath] = paths
const base = analyze(basePath)
const variant = analyze(variantPath)

/** 指标：名称 / 取值 / 方向（lower = 越小越好，higher = 越大越好，text = 只展示）。 */
const FIELDS = [
  ['有 reasoning 的步', s => s.context.reasoningSteps, 'lower'],
  ['reasoning 总字符', s => s.reasonChars, 'lower'],
  ['单步 reasoning P95', s => s.context.reasonCharsP95, 'lower'],
  ['步数', s => s.steps, 'lower'],
  ['墙钟秒', s => s.wallSeconds, 'lower'],
  ['出片前压缩', s => s.context.preDeliveryCompactions, 'lower'],
  ['读产品源码 bash', s => s.context.sourceReadCalls, 'lower'],
  ['「现在写 spec」复述步', s => s.context.restatementSteps, 'lower'],
  ['请求头工具清单 P95 KB', s => s.context.headerP95Kb ?? 0, 'lower'],
  ['inputTokens', s => s.context.inputTokens, 'lower'],
  ['render_composition 次数', s => s.renders.total, 'neutral'],
  ['成片已交付', s => s.renders.budget.delivered ? 1 : 0, 'higher'],
  ['探针规则通过', s => s.renders.probeRulePass ? 1 : 0, 'higher'],
  ['上下文治理 gate', s => s.gatePass ? 1 : 0, 'higher'],
  ['请求里的思考档位', s => s.context.reasoningEfforts.length === 0 ? '—' : s.context.reasoningEfforts.join(','), 'text'],
]

const rows = FIELDS.map(([label, read, direction]) => {
  const a = read(base)
  const v = read(variant)
  let delta
  if (direction === 'text') delta = a === v ? '持平' : `${a} → ${v}`
  else {
    const diff = Number(v) - Number(a)
    delta = diff === 0 ? '持平' : `${diff > 0 ? '+' : '−'}${Math.abs(diff)}`
  }
  return { label, baseline: a, variant: v, delta, direction }
})

/** 只提示可观察事实，不替产品拍板默认值。 */
const hints = []
if (base.context.reasoningSteps > 0 && variant.context.reasoningSteps === 0) {
  hints.push('✅ 关闭思考那条已不再返回 reasoning 块：开关对服务端生效。')
} else if (variant.context.reasoningSteps > 0) {
  hints.push('⚠️ 关闭思考那条仍返回 reasoning 块：档位没进 wire 或服务端不认，需抓请求确认字段拼写。')
} else {
  hints.push('ℹ️ 两条都没有 reasoning 块，无法判断开关效果（检查 --turn 是否选对）。')
}
if (variant.context.reasoningEfforts.length === 0) {
  hints.push('ℹ️ 关闭思考那条的 request/header.config 里没读到 reasoningEffort；档位可能只存在于 wire。')
} else {
  hints.push(`✅ 请求头读到档位 ${variant.context.reasoningEfforts.join(',')}（配置侧已生效）。`)
}
if (!variant.renders.budget.delivered) {
  hints.push('⚠️ 关闭思考那条没有真全片渲染 ⇒ 没成片，先别拍板默认档位。')
}
if (variant.steps > base.steps) {
  hints.push(`⚠️ 关思考后步数反而更多（${base.steps} → ${variant.steps}），多步规划质量可能下降。`)
}
if (variant.context.preDeliveryCompactions > base.context.preDeliveryCompactions) {
  hints.push('⚠️ 关思考后出片前压缩次数增加，上下文收益为负。')
}
hints.push('ℹ️ 默认值仍需人工 A/B 拍板；本工具只给可比事实。')

if (asJson) {
  console.log(JSON.stringify({
    turn: Number(turn), baselinePath: basePath, variantPath: variantPath,
    rows, hints,
  }, null, 2))
} else {
  console.log(`# 思考强度 A/B · turn ${turn}`)
  console.log(`基线    ${basePath}`)
  console.log(`关闭思考 ${variantPath}`)
  console.log('')
  const width = Math.max(...rows.map(r => [...r.label].length)) + 2
  console.log(`${'指标'.padEnd(width)} ${'基线'.padStart(12)} ${'关闭思考'.padStart(12)}  差异`)
  console.log('─'.repeat(width + 40))
  for (const row of rows) {
    const fmt = value => typeof value === 'number' ? value.toLocaleString() : String(value)
    console.log(`${row.label.padEnd(width)} ${fmt(row.baseline).padStart(12)} ${fmt(row.variant).padStart(12)}  ${row.delta}`)
  }
  console.log('\n## 判读提示')
  for (const hint of hints) console.log(`  ${hint}`)
}
