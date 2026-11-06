#!/usr/bin/env node
/**
 * 会话耗时归因（B4 / CV-447 A9 埋点侧 + P1-2 上下文治理判据；只读会话日志，不改产品代码）。
 *
 * 事件时间戳本就落在 session.jsonl 里，不需要在 Host 侧再加计时埋点：
 *   step/start → assistant/message  = LLM 推理
 *   tool/call  → tool/result        = 工具 / 人工等待
 *
 * 用法：
 *   node scripts/analyze-storyboard-latency.mjs <session.jsonl> [--turn 2] [--json] [--gate]
 *
 * 输出：分段耗时表 + 分类汇总（P95 而非均值）+ 轮次预算判定（≤5 步 / 禁复述）
 *       + 阶段二渲染轮次 / 每帧成本 / 图片上下文 / 中断信号（A9）
 *       + 上下文治理判据（P1-2：源码复读 / 复述步 / 出片前压缩）。
 * 退出码：0 = 分析完成；--gate 且任一判据 FAIL = 2；1 = 参数或解析错误。
 *
 * 口径修正（2026-11-06，会话 18 复盘）：
 *   ① `compaction/start|summary|end` 是**一次**压缩的三条事件，且 data 里没有 step：
 *      旧版按 step 分组 + startsWith('compaction') ⇒ 要么漏计要么三倍计。改为全 rows 按
 *      turn 筛 `compaction/start`，时间戳归属 step。
 *   ② 真实日志的 `tool/call.data.arguments` 是 **JSON 字符串**（不是对象），fixture 里才是
 *      对象。旧版直接读 `input.probe` 恒为 undefined ⇒ render_composition 探针判定失效。
 *      统一走 toolArgs() 归一。
 */
import { readFileSync } from 'node:fs'

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

const argv = process.argv.slice(2)
function arg(name, fallback) {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? fallback : argv[i + 1]
}
// 位置参数要跳过 `--turn 2` 的 "2"，否则 `--turn 2 <path>` 会把 "2" 当输入路径。
let input
for (let i = 0; i < argv.length && input === undefined; i += 1) {
  if (argv[i] === '--turn') { i += 1; continue }
  if (argv[i].startsWith('--')) continue
  input = argv[i]
}
if (!input) fail('用法: node scripts/analyze-storyboard-latency.mjs <session.jsonl> [--turn 2] [--json] [--gate]')
const turnFilter = Number(arg('turn', '1'))
const asJson = argv.includes('--json')
const asGate = argv.includes('--gate')

const rows = []
for (const [index, line] of readFileSync(input, 'utf8').split('\n').entries()) {
  if (!line.trim()) continue
  try {
    rows.push(JSON.parse(line))
  } catch {
    fail(`第 ${index + 1} 行不是合法 JSON`)
  }
}
const timeOf = row => row.time ?? row.createdAt ?? 0
const stamp = ms => new Date(ms).toTimeString().slice(0, 8)
const human = sec => `${sec.toFixed(1)}s`

/** 工具 → 归因类别。未登记的一律算 local，避免悄悄漏账。 */
function category(name) {
  if (name === 'ask_user_choice' || name === 'confirm_intent_card') return '人工等待'
  if (name === 'bash' || name === 'exec' || name === 'curl' || name === 'python') return '联网/脚本'
  if (name === 'write_storyboard') return '故事板写入'
  if (name === 'read' || name === 'skill') return '读文档'
  return '本地工具'
}

/** `tool/call` 的入参在真实日志里是 JSON 字符串、在 fixture 里是对象。 */
function toolArgs(call) {
  const raw = call?.data?.args ?? call?.data?.arguments ?? call?.data?.input ?? {}
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch { return {} }
  }
  return {}
}
function toolCommand(args) {
  return typeof args.command === 'string' ? args.command : ''
}

/** 读产品源码的 bash（会话 18 反复回去查契约的路径；读 references/ 分册不算）。 */
const SOURCE_READ_RE = /src\/remotion\/|src\/client\/styles|manifest-builder|components\//
/** 「信息齐了，现在写 spec」式复述步：说了却没落盘，是上下文膨胀的主因之一。 */
const RESTATE_RE = /(now i have (everything|all|enough|the)|i (now )?have all (the )?(information|details)|let me (now )?(author|write|design|build|draft|compose).{0,40}(manifest|spec)|ready to (write|author).{0,20}(manifest|spec))/i

/** 从工具回执里取 `report.msPerFrame`（回执形状随宿主版本变，按文本兜底）。 */
function msPerFrameOf(resultRow) {
  const text = JSON.stringify(resultRow?.data ?? {})
  const m = /"msPerFrame"\s*:\s*([0-9.]+)/.exec(text)
  return m === null ? null : Number(m[1])
}

function percentile(values, p) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]
}

const steps = new Map()
for (const row of rows) {
  const data = row.data ?? {}
  if (data.turn !== turnFilter || typeof data.step !== 'number') continue
  const key = data.step
  if (!steps.has(key)) steps.set(key, [])
  steps.get(key).push(row)
}

const result = []
/** 首次「真全片渲染」调用时刻；null = 本窗口内没有成片（会话 18 即如此）。 */
let deliveryAt = null
for (const [step, events] of [...steps].sort((a, b) => a[0] - b[0])) {
  const start = events.find(e => e.type === 'step/start')
  const end = events.find(e => e.type === 'step/end')
  if (!start) continue
  const finish = end ?? events.at(-1)
  const assistant = events.find(e => e.type === 'assistant/message')
  const calls = events.filter(e => e.type === 'tool/call')
  const results = events.filter(e => e.type === 'tool/result')
  const messages = events.filter(e => e.type === 'assistant/message')
  const reasonChars = messages.reduce((sum, e) => sum +
    ((e.data?.message?.content ?? []).filter(c => c?.type === 'reasoning')
      .reduce((n, c) => n + (c.text?.length ?? 0), 0)), 0)
  const reasoningSteps = messages.filter(e =>
    (e.data?.message?.content ?? []).some(c => c?.type === 'reasoning')).length
  const usage = messages.reduce((acc, e) => {
    const u = e.data?.usage ?? {}
    acc.input += Number(u.inputTokens ?? 0)
    acc.output += Number(u.outputTokens ?? 0)
    return acc
  }, { input: 0, output: 0 })
  const messageTexts = messages.map(e =>
    (e.data?.message?.content ?? []).map(c => c?.text ?? '').join('\n'))
  const restated = messageTexts.some(text => RESTATE_RE.test(text)) ? 1 : 0
  const tools = {}
  for (const [i, call] of calls.entries()) {
    const matched = results[i]
    const duration = matched ? (timeOf(matched) - timeOf(call)) / 1000 : 0
    const name = call.data?.name ?? '?'
    tools[name] = (tools[name] ?? 0) + duration
  }
  const byCategory = {}
  for (const [name, duration] of Object.entries(tools)) {
    const key = category(name)
    byCategory[key] = (byCategory[key] ?? 0) + duration
  }
  // CV-447（A9）：渲染轮次埋点。口径与 Host 硬闸一致 —— `probe:true` 与
  // `spotFrames:[...]` 都算探针类，两者共占出片前 3 次额度；全片渲染不计数。
  const renders = []
  for (const [i, call] of calls.entries()) {
    if ((call.data?.name ?? '') !== 'render_composition') continue
    const input = toolArgs(call)
    const matched = results[i]
    const probeOnly = input.probe === true
    const hasSpot = Array.isArray(input.spotFrames) && input.spotFrames.length > 0
    const probeLike = probeOnly || hasSpot
    if (!probeLike && deliveryAt === null) deliveryAt = timeOf(call)
    renders.push({
      probe: probeOnly,
      probeLike,
      quality: typeof input.quality === 'string' ? input.quality : 'standard',
      spotFrames: hasSpot ? input.spotFrames.length : 0,
      rejected: (matched?.data?.error?.code ?? matched?.data?.code) === 'CS-USER-ERR',
      seconds: matched ? (timeOf(matched) - timeOf(call)) / 1000 : 0,
      msPerFrame: msPerFrameOf(matched),
    })
  }
  // P1-2：源码复读。按 bash 命令命中 + 对应 tool/result 的体积计，单位是字符。
  let sourceReadCalls = 0
  let sourceReadBytes = 0
  for (const [i, call] of calls.entries()) {
    if ((call.data?.name ?? '') !== 'bash') continue
    if (!SOURCE_READ_RE.test(toolCommand(toolArgs(call)))) continue
    sourceReadCalls += 1
    const matched = results[i]
    if (matched) sourceReadBytes += JSON.stringify(matched.data ?? {}).length
  }
  // A9：上下文膨胀与中断信号（阶段二 P2-03 / P2-04 的判据来源）。
  // 按**事件**计数而不是按字符串出现次数：同一次 offload 会同时落在 tool/result
  // 与 assistant/attempt 上。基线口径（方案 §1）取 `assistant/attempt.code`，故排除 tool/result。
  const eventTexts = events.map(e => JSON.stringify(e.data ?? {}))
  const offloads = events.filter((e, i) => e.type !== 'tool/result' && eventTexts[i].includes('IMAGE_OFFLOAD_REQUIRED')).length
  const authFailures = eventTexts.filter(text => /unauthenticated|invalid access token/.test(text)).length
  result.push({
    step,
    start: timeOf(start),
    wall: (timeOf(finish) - timeOf(start)) / 1000,
    llm: assistant ? (timeOf(assistant) - timeOf(start)) / 1000 : 0,
    reasonChars,
    reasoningSteps,
    usage,
    restated,
    sourceReadCalls,
    sourceReadBytes,
    byCategory,
    tools: calls.map(c => c.data?.name ?? '?'),
    resultBytes: results.reduce((n, r) => n + JSON.stringify(r.data ?? {}).length, 0),
    renders,
    offloads,
    authFailures,
  })
}

if (result.length === 0) fail(`turn ${turnFilter} 没有可分析的 step/start 事件`)

const windowStart = result[0].start
const windowEnd = result.at(-1).start + result.at(-1).wall * 1000
/** 压缩 / 请求头事件没有 step，按 data.turn 或时间戳归属本 turn。 */
function belongsToTurn(row) {
  const turn = row.data?.turn
  if (typeof turn === 'number') return turn === turnFilter
  const time = timeOf(row)
  return time >= windowStart && time <= windowEnd
}
function stepAtTime(time) {
  const hit = result.find(r => time >= r.start && time <= r.start + r.wall * 1000)
  if (hit !== undefined) return hit.step
  // 压缩常落在 step/end 与下一步 step/start 之间的间隙：归到「刚刚结束的那一步」。
  const before = [...result].reverse().find(r => r.start <= time)
  return before?.step ?? null
}
// 一次压缩 = 一条 compaction/start（summary / end 是同一次的后两条，不能重复计）。
const compactionStarts = rows.filter(r => r.type === 'compaction/start' && belongsToTurn(r))
const compactionAt = compactionStarts.map(r => ({
  at: stamp(timeOf(r)), step: stepAtTime(timeOf(r)), time: timeOf(r),
}))
const preDeliveryCompactions = compactionStarts.filter(r =>
  deliveryAt === null || timeOf(r) < deliveryAt).length

// request/header 里的工具清单每次请求都重注，是 turn2 开局就顶窗口的固定开销。
const headers = rows.filter(r => r.type === 'request/header' && belongsToTurn(r))
const headerKb = headers.map(r => JSON.stringify(r.data ?? {}).length / 1024)
const headerTools = headers.map(r => (r.data?.header?.tools ?? []).length)
/** 设置页「思考强度」若被写进请求配置，A/B 时这里能直接看到档位；没写就是 null。 */
function reasoningEffortOf(row) {
  const cfg = row.data?.header?.config ?? {}
  const def = row.data?.header?.adapterDefaults ?? {}
  const text = JSON.stringify({ cfg, def })
  const m = /"reasoningEffort"\s*:\s*"([^"]+)"/.exec(text)
  return m === null ? null : m[1]
}
const reasoningEfforts = [...new Set(headers.map(reasoningEffortOf).filter(v => v !== null))]

const total = Object.fromEntries(
  ['LLM 推理', ...new Set(result.flatMap(r => Object.keys(r.byCategory)))]
    .map(key => [key, key === 'LLM 推理'
      ? result.reduce((n, r) => n + r.llm, 0)
      : result.reduce((n, r) => n + (r.byCategory[key] ?? 0), 0)]),
)
const wall = (windowEnd - windowStart) / 1000
const reasonTotal = result.reduce((n, r) => n + r.reasonChars, 0)
const replanSteps = result.slice(3).filter(r => r.reasonChars > 5000).map(r => r.step)
const allRenders = result.flatMap(r => r.renders)
const msPerFrameValues = allRenders.map(r => r.msPerFrame).filter(v => typeof v === 'number' && Number.isFinite(v))
const byQuality = {}
for (const r of allRenders) (byQuality[r.quality] ??= []).push(r.seconds)
const qualityP95 = Object.fromEntries(
  Object.entries(byQuality).map(([quality, values]) => [quality, Number(percentile(values, 0.95).toFixed(1))]),
)
/** 按调用顺序重放硬闸状态机（含被拒收的调用，与 guardProbeBudget 同口径）。 */
const budget = { preDeliveryProbes: 0, annotations: 0, delivered: false, pass: true }
for (const r of allRenders) {
  if (!r.probeLike) {
    budget.delivered = true
    continue
  }
  if (budget.delivered) {
    budget.annotations += 1
    if (budget.annotations > 1) budget.pass = false
  } else {
    budget.preDeliveryProbes += 1
    if (budget.preDeliveryProbes > 3) budget.pass = false
  }
}
const renderSummary = {
  total: allRenders.length,
  probes: allRenders.filter(r => r.probeLike).length,
  probeTrue: allRenders.filter(r => r.probe).length,
  drafts: allRenders.filter(r => r.quality === 'draft').length,
  rejected: allRenders.filter(r => r.rejected).length,
  spotFrames: allRenders.reduce((n, r) => n + r.spotFrames, 0),
  seconds: Number(allRenders.reduce((n, r) => n + r.seconds, 0).toFixed(1)),
  msPerFrameP95: msPerFrameValues.length === 0 ? null : Number(percentile(msPerFrameValues, 0.95).toFixed(1)),
  qualityP95,
  probeRulePass: budget.pass,
  budget,
}

const sourceReadCalls = result.reduce((n, r) => n + r.sourceReadCalls, 0)
const sourceReadKb = Number((result.reduce((n, r) => n + r.sourceReadBytes, 0) / 1024).toFixed(1))
const restatementSteps = result.reduce((n, r) => n + r.restated, 0)
const reasoningSteps = result.reduce((n, r) => n + r.reasoningSteps, 0)
const stepLimit = turnFilter === 1 ? 5 : 15
const contextSummary = {
  offloads: result.reduce((n, r) => n + r.offloads, 0),
  compactions: compactionStarts.length,
  compactionAt,
  preDeliveryCompactions,
  authFailures: result.reduce((n, r) => n + r.authFailures, 0),
  p95StepResultKb: Number((percentile(result.map(r => r.resultBytes), 0.95) / 1024).toFixed(1)),
  sourceReadCalls,
  sourceReadKb,
  restatementSteps,
  reasoningSteps,
  reasonCharsP95: Number(percentile(result.map(r => r.reasonChars), 0.95).toFixed(0)),
  inputTokens: result.reduce((n, r) => n + r.usage.input, 0),
  outputTokens: result.reduce((n, r) => n + r.usage.output, 0),
  headerCount: headers.length,
  headerP95Kb: headerKb.length === 0 ? null : Number(percentile(headerKb, 0.95).toFixed(1)),
  headerToolsMax: headerTools.length === 0 ? null : Math.max(...headerTools),
  reasoningEfforts,
}
const verdict = {
  noCompactionBeforeDelivery: preDeliveryCompactions === 0,
  stepsWithinBudget: result.length <= stepLimit,
  sourceReadsBounded: sourceReadCalls <= 5,
  noRestatement: restatementSteps === 0,
}
const gatePass = Object.values(verdict).every(Boolean)
const summary = {
  turn: turnFilter,
  window: `${stamp(windowStart)} → ${stamp(windowEnd)}`,
  wallSeconds: Number(wall.toFixed(1)),
  steps: result.length,
  budget: { limit: 5, pass: result.length <= 5, replanSteps },
  reasonChars: reasonTotal,
  categories: Object.fromEntries(Object.entries(total).map(([k, v]) => [k, Number(v.toFixed(1))])),
  p95LlmSeconds: Number(percentile(result.map(r => r.llm), 0.95).toFixed(1)),
  cumulativeResultKb: Number((result.reduce((n, r) => n + r.resultBytes, 0) / 1024).toFixed(1)),
  renders: renderSummary,
  context: contextSummary,
  verdict,
  gatePass,
  stepsDetail: result.map(r => ({
    step: r.step,
    wall: Number(r.wall.toFixed(1)),
    llm: Number(r.llm.toFixed(1)),
    reasonChars: r.reasonChars,
    reasoningSteps: r.reasoningSteps,
    restated: r.restated === 1,
    sourceReadCalls: r.sourceReadCalls,
    tools: r.tools,
  })),
}

if (asJson) {
  console.log(JSON.stringify(summary, null, 2))
} else {
  console.log(`# 故事板阶段耗时归因 · turn ${turnFilter}`)
  console.log(`窗口 ${summary.window} · 墙钟 ${human(wall)} · ${result.length} 步 · reasoning ${reasonTotal.toLocaleString()} 字符`)
  console.log('\n## 分类汇总')
  const sum = Object.values(total).reduce((a, b) => a + b, 0) || 1
  for (const [key, value] of Object.entries(total).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key.padEnd(12)} ${human(value).padStart(9)}  ${(value / sum * 100).toFixed(1)}%`)
  }
  console.log(`\nP95 LLM 单步 ${human(summary.p95LlmSeconds)} · 累积 tool/result ${summary.cumulativeResultKb} KB`)
  console.log('\n## 最慢 8 步')
  for (const row of [...result].sort((a, b) => b.wall - a.wall).slice(0, 8)) {
    console.log(`  s${String(row.step).padEnd(3)} ${human(row.wall).padStart(8)}  LLM ${human(row.llm).padStart(8)}  reasoning ${String(row.reasonChars).padStart(7)}  ${row.tools.join(',').slice(0, 60)}`)
  }
  console.log('\n## 轮次预算判定')
  console.log(`  step ${result.length} / ≤5 ⇒ ${summary.budget.pass ? 'PASS' : 'FAIL'}`)
  console.log(`  第 3 轮之后 reasoning>5k 的重新规划步: ${replanSteps.length === 0 ? '0（PASS）' : replanSteps.join(', ') + '（FAIL）'}`)
  console.log('\n## 渲染轮次（CV-447 A9）')
  console.log(`  共 ${renderSummary.total} 次 · 探针类 ${renderSummary.probes}（其中 probe:true ${renderSummary.probeTrue}）· draft ${renderSummary.drafts} · 被硬闸拒收 ${renderSummary.rejected} · spot 帧 ${renderSummary.spotFrames} · ${human(renderSummary.seconds)}`)
  console.log(`  msPerFrame P95 ${renderSummary.msPerFrameP95 ?? 'n/a'} · 档位墙钟 P95 ${JSON.stringify(renderSummary.qualityP95)}`)
  console.log(`  出片前探针 ${budget.preDeliveryProbes}/3 · 成片后批注 ${budget.annotations}/1 ⇒ ${budget.pass ? 'PASS' : 'FAIL（规则 T0-A3 / 机器闸 T1-A4）'}`)
  console.log('\n## 上下文与中断（A9）')
  console.log(`  IMAGE_OFFLOAD_REQUIRED ${contextSummary.offloads} · compaction ${contextSummary.compactions}（出片前 ${preDeliveryCompactions}）· AUTH/401 ${contextSummary.authFailures} · 单步 tool/result P95 ${contextSummary.p95StepResultKb} KB`)
  console.log(`  源码复读 bash ${sourceReadCalls} 次 / ${sourceReadKb} KB · 复述步 ${restatementSteps} · 有 reasoning 的步 ${reasoningSteps} · reasoning 单步 P95 ${contextSummary.reasonCharsP95} 字符`)
  console.log(`  请求头 ${contextSummary.headerCount} 次 · 工具清单 P95 ${contextSummary.headerP95Kb ?? 'n/a'} KB / 最多 ${contextSummary.headerToolsMax ?? 'n/a'} 工具 · inputTokens ${contextSummary.inputTokens.toLocaleString()} · 思考档位 ${JSON.stringify(reasoningEfforts)}`)
  console.log('\n## 上下文治理判据（P1-2，交接文档 §9 任务 5）')
  console.log(`  出片前 compaction ${preDeliveryCompactions} / 0 ⇒ ${verdict.noCompactionBeforeDelivery ? 'PASS' : 'FAIL'}${compactionAt.length === 0 ? '' : '  @ ' + compactionAt.map(c => c.at + '(s' + c.step + ')').join(', ')}`)
  console.log(`  turn${turnFilter} 步数 ${result.length} / ≤${stepLimit} ⇒ ${verdict.stepsWithinBudget ? 'PASS' : 'FAIL'}`)
  console.log(`  读产品源码 bash ${sourceReadCalls} / ≤5 ⇒ ${verdict.sourceReadsBounded ? 'PASS' : 'FAIL'}`)
  console.log(`  「现在写 spec」复述步 ${restatementSteps} / 0 ⇒ ${verdict.noRestatement ? 'PASS' : 'FAIL'}`)
  console.log(`  ⇒ GATE ${gatePass ? 'PASS' : 'FAIL'}${asGate ? '' : '（加 --gate 可按此结果给出退出码）'}`)
}
if (asGate && !gatePass) process.exit(2)
