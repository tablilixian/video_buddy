#!/usr/bin/env node
/**
 * 成果判定 · 会话取证探针（计划 v4 §8.4 的配套工具）。
 *
 * 用途：把用户真机跑出来的 `session.v4.jsonl` 解析成**判定报告所需的取证草稿**，
 * 避免每轮把 500KB 原始日志整读进上下文。本脚本只做取证，不下结论：
 * 「优化是否生效 / 判据是否达标」由 agent 对照《成果判定报告模板》逐条判断。
 *
 * 用法：
 *   node scripts/probe-session.mjs <session.v4.jsonl> [输出.md]
 *   node scripts/probe-session.mjs <session.v4.jsonl> --json
 *
 * 输出包含：会话元数据、时间线、调用-结果配对、关键回执摘录、错误与告警计数。
 * 零外部依赖（只用 node: 内置模块）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

const TZ_OFFSET_MS = 8 * 60 * 60 * 1000
const stamp = (ms) => new Date(ms + TZ_OFFSET_MS).toISOString().slice(11, 19)
const textOf = (content) => (Array.isArray(content) ? content : [])
  .filter((c) => c && typeof c === 'object' && c.type === 'text')
  .map((c) => String(c.text ?? '')).join('\n')

const args = process.argv.slice(2)
const input = args.find((a) => !a.startsWith('--'))
if (!input) {
  console.error('用法: node scripts/probe-session.mjs <session.v4.jsonl> [输出.md]')
  process.exit(2)
}
const asJson = args.includes('--json')
const outPath = args.find((a) => !a.startsWith('--') && a !== input)
  ?? `/tmp/session-probe-${basename(input).replace(/[^a-zA-Z0-9.-]/g, '_')}.md`

const lines = readFileSync(input, 'utf8').split('\n').filter((l) => l.trim())
const events = []
for (let i = 0; i < lines.length; i += 1) {
  try { events.push(JSON.parse(lines[i])) } catch { /* 跳过坏行，不因一行毁掉整份取证 */ }
}

const calls = new Map()
for (const e of events) {
  if (e.type === 'tool/call' && e.data?.callId) {
    calls.set(e.data.callId, {
      time: e.time, name: e.data.name ?? '?', args: e.data.arguments ?? '',
    })
  }
}

const KEY_PATTERNS = [
  ['渲染报告', /渲染报告|动画窗口|抽帧 \d+ 张|静帧 \d+ 张/],
  ['体检 lint', /ML-\d+|lint\[\]|编排体检|命中 \d+ 条/],
  ['校验失败', /校验失败|CS-USER|does not declare image input|拒收|fail-fast/],
  ['读图', /read_image|image content block|<type>image<\/type>|未做画面自检/],
  ['VLM 绕行', /image2vl|video2vl|qc_shot|upload_image/],
  ['探针', /spotFrames|spot-check|探针/],
  ['负例', /负例|probe_anchor|故意违规/],
  ['数据', /gistemp|dataSource|baseline|pending|基准/],
]

const timeline = []
const pairs = []
const errors = []
const hits = Object.fromEntries(KEY_PATTERNS.map(([k]) => [k, []]))
let provider = '?', model = '?', responseModel = '?'
let firstTime = Infinity, lastTime = 0
const toolCount = new Map()

for (const e of events) {
  const t = e.type, d = e.data ?? {}
  if (typeof e.time === 'number') { firstTime = Math.min(firstTime, e.time); lastTime = Math.max(lastTime, e.time) }
  const tm = typeof e.time === 'number' ? stamp(e.time) : '??:??:??'

  if (t === 'request/header') {
    provider = d.header?.config?.provider ?? provider
    model = d.header?.config?.model ?? model
  }
  if (t === 'assistant/message' && d.message?.source?.model?.model) responseModel = d.message.source.model.model
  if (d.message?.source?.responseModel) responseModel = d.message.source.responseModel
  if (d.message?.source?.replayState?.response?.responseModel) {
    responseModel = d.message.source.replayState.response.responseModel
  }
  if (d.message?.source?.responseModel) responseModel = d.message.source.responseModel

  if (t === 'user/message') {
    const txt = textOf(d.content).trim()
    if (txt && !txt.startsWith('Current runtime context') && !txt.startsWith('<system-reminder>')) {
      timeline.push(`[${tm}] USER: ${txt.slice(0, 500)}`)
    }
  } else if (t === 'assistant/message') {
    for (const c of d.message?.content ?? []) {
      if (c.type === 'text' && String(c.text ?? '').trim()) timeline.push(`[${tm}] TEXT: ${String(c.text).slice(0, 500)}`)
    }
    if (d.message?.source?.responseModel) responseModel = d.message.source.responseModel
  } else if (t === 'turn/start') timeline.push(`[${tm}] === TURN ${d.turn} START ===`)
  else if (t === 'turn/end') timeline.push(`[${tm}] === TURN ${d.turn} END ===`)
  else if (t === 'tool/result') {
    const m = d.message ?? {}
    const cid = m.toolCallId ?? m.source?.callId
    const call = calls.get(cid)
    const txt = textOf(m.content)
    const name = call?.name ?? '?'
    toolCount.set(name, (toolCount.get(name) ?? 0) + 1)
    timeline.push(`[${stamp(call?.time ?? e.time)}] ${name}: ${txt.slice(0, 260).replace(/\n/g, ' ')}`)
    pairs.push({ time: stamp(call?.time ?? e.time), name, args: String(call?.args ?? '').slice(0, 260), result: txt.slice(0, 1600), isError: m.isError === true })
    if (m.isError === true) errors.push({ name, text: txt.slice(0, 600) })
    for (const [key, re] of KEY_PATTERNS) {
      if (re.test(txt)) hits[key].push({ time: stamp(call?.time ?? e.time), name, text: txt.slice(0, 900) })
    }
  }
}

const summary = {
  file: resolve(input), events: events.length,
  span: Number.isFinite(firstTime) ? `${stamp(firstTime)} → ${stamp(lastTime)}` : '?',
  provider, model, responseModel,
  userTurns: timeline.filter((l) => l.includes('] USER:')).length,
  toolCalls: pairs.length,
  toolBreakdown: Object.fromEntries([...toolCount].sort((a, b) => b[1] - a[1])),
  errors: errors.length,
  keyHits: Object.fromEntries(Object.entries(hits).map(([k, v]) => [k, v.length])),
}

if (asJson) {
  console.log(JSON.stringify({ summary, timeline, pairs, errors, hits }, null, 2))
} else {
  const md = [
    `# 会话取证草稿 · ${basename(input)}`,
    '',
    '> 本文件由 `scripts/probe-session.mjs` 生成，**只做取证、不下结论**。判定请对照《成果判定报告模板》与 L0~L5 判据表。',
    '',
    '## 元数据', '',
    `\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\``, '',
    '## 时间线', '', ...timeline.map((l) => `- ${l}`), '',
    '## 错误回执', '',
    ...(errors.length ? errors.map((e) => `- **${e.name}**: ${e.text.replace(/\n/g, ' ')}`) : ['- （无）']), '',
    ...Object.entries(hits).flatMap(([key, list]) => [
      `## 关键回执 · ${key}（${list.length}）`, '',
      ...(list.length ? list.slice(0, 12).map((h) => `- [${h.time}] ${h.name}: ${h.text.replace(/\n/g, ' ').slice(0, 400)}`) : ['- （无命中）']), '',
    ]),
    '## 调用-结果配对（供逐条取证）', '',
    ...pairs.map((p, i) => `### ${i + 1}. [${p.time}] ${p.name}${p.isError ? ' ❌' : ''}\n\n- ARGS: \`${p.args.replace(/`/g, "'")}\`\n- RESULT:\n\`\`\`\n${p.result}\n\`\`\``),
  ].join('\n')
  writeFileSync(outPath, md, 'utf8')
  console.log(`取证草稿已写入: ${outPath}`)
  console.log(JSON.stringify(summary, null, 2))
}
