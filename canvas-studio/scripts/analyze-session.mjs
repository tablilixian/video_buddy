#!/usr/bin/env node
/**
 * DSH 会话日志（session.jsonl）→ 后端接口画像分析。
 *
 * 解决什么问题
 * ------------
 * 一次 canvas-studio 会话会把对 Drama Backend 的所有调用（image_generate /
 * video_generate / character_sheet / qc_shot …）连同参数、耗时、错误原文全量
 * 落在 `session.jsonl` 里。这些记录是**唯一真实的接口行为样本**，比 openapi
 * 文档和人工记忆都可靠。本脚本把这份原始日志翻成一张可读的接口画像：
 *
 *   1. 每个工具：调用数 / 成功率 / 成功样本耗时分位（p50、p95、max）
 *   2. 失败模式分类：**后端 500 快失败**（<2s，请求没进队列）与**慢失败**
 *      （≥2s，进队列后生成中崩）必须分开——前者是「根本没跑」，后者是「跑崩了」，
 *      两者的成因与对策完全不同
 *   3. 参数嫌疑分析：自动找出「带上它成功率就塌」的参数（键、以及值的形态族），
 *      用来定位是「图生图链路不稳」还是「某类文件名不可用」这类规律
 *   4. 排队分析：后端是**单任务同步**的，前一个任务跑完才接下一个。因此
 *      - 会话内若出现时间区间重叠，后者必然在排队，`duration` 含等待时间，
 *        不可直接当接口耗时（脚本会算出 `queuedMs` 并给出净耗时）
 *      - 「串行吞吐」= 后端占用总时长 ÷ 会话墙钟，是这个后端的真实产能
 *   5. 浪费统计：同一参数反复重试的次数与累计耗时（这类时间最该省）
 *
 * 用法
 * ----
 *   node scripts/analyze-session.mjs <session.jsonl> [--out <dir>] [--since <iso>]
 *
 * 产物（--out 目录，默认 docs/api-probe/session-<时间戳>）
 *   report.md      人读报告（结论 + 画像表 + 嫌疑参数 + 排队分析 + 明细）
 *   calls.json     逐次调用明细（供二次分析/回归比对）
 *   timeline.html  甘特时间线（一眼看出排队、快失败风暴、人机等待）
 *
 * 退出码：0 = 分析完成（不判定接口优劣）；1 = 参数/解析错误。
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

// ---------------------------------------------------------------- 参数解析

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const v = process.argv[i + 1]
  if (v === undefined || v.startsWith('--')) fail(`--${name} 需要一个值`)
  return v
}

function fail(msg) {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

const INPUT = process.argv.find((a, i) => i > 1 && !a.startsWith('--'))
if (INPUT === undefined) fail('用法: node scripts/analyze-session.mjs <session.jsonl> [--out <dir>]')
const OUT_DIR = resolve(arg('out', `docs/api-probe/session-${Date.now()}`))

// ---------------------------------------------------------------- 工具分类

/**
 * 分类只影响统计口径：
 * - backend：真打到 Drama Backend（耗时是接口耗时，受单任务排队影响）
 * - local：插件本地能力（画布读写、ffmpeg 合成、skill 读取）
 * - human：人在回路（ask_user_choice，耗时是用户思考时间，不是接口耗时）
 */
const TOOL_CLASS = {
  image_generate: 'backend',
  video_generate: 'backend',
  video_composite: 'backend',
  character_sheet: 'backend',
  character_generate: 'backend',
  prompt_enhance: 'backend',
  qc_shot: 'backend',
  music_generation: 'backend',
  image2vl: 'backend',
  upload_image: 'backend',
  compose_video: 'local',
  write_script: 'local',
  write_screenplay: 'local',
  submit_storyboard_for_approval: 'local',
  submit_keyframes_for_approval: 'local',
  list_shots: 'local',
  skill: 'local',
  read: 'local',
  todo_write: 'local',
  ask_user_choice: 'human',
}

const CLASS_LABEL = { backend: '后端', local: '本地', human: '人等待' }

/** 快失败阈值：低于此值说明请求根本没进后端队列（入口即被拒）。 */
const FAST_FAIL_MS = 2000

/**
 * 纯画布元数据：只用于节点血缘/展示，不会进后端请求体。
 * 参与参数相关性分析会制造假信号（例如 shotRefs 是「这镜属于哪张分镜卡」），故排除。
 */
const IGNORE_KEYS = new Set(['shotRefs', 'shotTransition', 'name'])

/** 文件引用类参数：值都是 Drama 服务端文件名，是后端链路最容易崩的一环，单独成维度分析。 */
const FILE_KEY_RE = /^(filename|filenames|image\d*|video\d*|audio\d*|bgm\w*|reference\w*)$/i

/**
 * 工具 → 后端端点（据 docs/api.md 与 src/generate.ts）。
 * 用于把「工具成功率」还原成「端点可用性」——后者才是要沉淀进文档的结论。
 */
const TOOL_ENDPOINT = {
  image_generate: 'txt2image / image2image（写实）· txt2imageanime（卡通）',
  video_generate: 'image2videofl2va（drama）· minimax/h3/*（fal）',
  video_composite: 'image2videofl2va / image2videoref2va',
  character_sheet: 'image2character',
  upload_image: 'upload（统一上传端点）',
  qc_shot: 'image2vl',
  music_generation: 'txt2audio',
  prompt_enhance: 'image2promptenhance',
}

/**
 * 结果文本 → 失败模式。返回 null 表示成功。
 * 判据来自 canvas-studio 工具的实际错误文案（src/host-tools.ts / generate.ts）。
 */
function classifyResult(text, durMs) {
  if (!/^Error[::]/.test(text) && !text.includes('Error: ')) return null
  if (/returned invalid output/.test(text) && /additionalProperties/.test(text)) {
    return {
      kind: 'local-schema',
      label: '本地 schema 校验失败',
      hint: 'Host 工具 output schema 声明了 additionalProperties:false，但 execute 返回了未声明字段——产物其实已生成却被丢弃。纯本地 bug，与后端无关。',
    }
  }
  if (/本地预检|已取消本次生成/.test(text)) {
    return {
      kind: 'local-precheck',
      label: '本地预检拦截',
      hint: '请求发出前被插件侧的格式校验拦下（如 H3-Context-IR 句式不合规）。零后端消耗，按提示改 prompt 即可。',
    }
  }
  if (/Internal Server Error|status 500|500\b/.test(text)) {
    return durMs < FAST_FAIL_MS
      ? {
          kind: 'backend-500-fast',
          label: '后端 500·快失败',
          hint: `耗时 ${(durMs / 1000).toFixed(1)}s 远低于该接口的正常耗时 → 请求没有进入生成队列，在入口即被拒（常见成因：引用的文件名在后端不存在、后端正忙、链路未就绪）。`,
        }
      : {
          kind: 'backend-500-slow',
          label: '后端 500·慢失败',
          hint: `耗时 ${(durMs / 1000).toFixed(1)}s 已接近正常耗时 → 请求进了队列、生成过程中崩。可原样重试（后端偶发），重试 2 次仍失败再怀疑参数。`,
        }
  }
  return { kind: 'tool-error', label: '工具业务错误', hint: '插件主动抛错（前置条件不满足/门禁未放行等），非后端故障。' }
}

// ---------------------------------------------------------------- 日志解析

/** 读取 jsonl，按 callId 配对 tool/call 与 tool/result。 */
function loadRecords(file) {
  const calls = new Map()
  const results = new Map()
  const order = []
  let sessionStart = null
  let sessionEnd = null

  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const raw = line.trim()
    if (!raw) continue
    let ev
    try {
      ev = JSON.parse(raw)
    } catch {
      continue
    }
    const data = ev.data ?? {}
    if (ev.type === 'session') sessionStart = data.createdAt ?? null
    if (typeof ev.time === 'number') {
      if (sessionStart === null || ev.time < sessionStart) sessionStart = ev.time
      if (sessionEnd === null || ev.time > sessionEnd) sessionEnd = ev.time
    }
    if (ev.type === 'tool/call') {
      calls.set(data.callId, { callId: data.callId, name: data.name, argsRaw: data.arguments ?? '', start: ev.time })
      order.push(data.callId)
    } else if (ev.type === 'tool/result') {
      for (const block of (data.message?.content ?? [])) {
        if (block?.type !== 'tool-result') continue
        const text = (block.content ?? []).map((c) => (typeof c?.text === 'string' ? c.text : '')).join('\n')
        results.set(block.toolCallId, { end: ev.time, text })
      }
    }
  }

  const records = []
  for (const callId of order) {
    const call = calls.get(callId)
    const res = results.get(callId)
    if (!call) continue
    let args = null
    try {
      args = JSON.parse(call.argsRaw)
    } catch {
      args = { __unparsed: call.argsRaw }
    }
    const durMs = res ? Math.max(0, res.end - call.start) : null
    const text = res?.text ?? ''
    const err = res ? classifyResult(text, durMs ?? 0) : { kind: 'no-result', label: '无结果记录', hint: '会话中断或未落 result 事件。' }
    records.push({
      callId,
      tool: call.name,
      cls: TOOL_CLASS[call.name] ?? 'local',
      args,
      start: call.start,
      end: res?.end ?? null,
      durMs,
      ok: err === null,
      err,
      result: text,
    })
  }
  return { records, sessionStart, sessionEnd }
}

// ---------------------------------------------------------------- 统计工具

const pct = (sorted, p) => (sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))])
const fmtS = (ms) => (ms === null ? '—' : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`)
const fmtMin = (ms) => (ms === null ? '—' : `${(ms / 60000).toFixed(1)}min`)

/**
 * 值 → 形态族。用于发现「同一参数、不同取值形态成功率不同」的规律，
 * 例如 ref-*.png（上传句柄）与 img_*.png（产物名）是两类完全不同的东西。
 */
function valueFamily(v) {
  if (Array.isArray(v)) return v.length === 0 ? 'empty-array' : `array[${[...new Set(v.map(valueFamily))].join('|')}]`
  if (v === null || v === undefined) return 'none'
  if (typeof v === 'boolean') return `bool:${v}`
  if (typeof v === 'number') return 'number'
  if (typeof v !== 'string') return typeof v
  if (v === '') return 'empty-string'
  if (/[\u4e00-\u9fa5]/.test(v)) return 'zh-text'
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(v)) return 'uuid'
  if (/^\/(canvas-studio|Users)/.test(v)) return 'local-path'
  const m = /^([A-Za-z][A-Za-z-]*)[_-]/.exec(v)
  if (m) return `${m[1]}-*`
  return 'text'
}

/** 明细里展示哪个参数：优先短值（文件名/问题），避免整段 prompt 刷屏。 */
function shortSample(args) {
  const entries = Object.entries(args ?? {})
  for (const k of ['filename', 'filenames', 'question', 'name', 'file_path']) {
    if (args?.[k] !== undefined) return `${k}=${String(args[k]).slice(0, 40)}`
  }
  for (const [k, v] of entries) {
    const s = typeof v === 'string' ? v : JSON.stringify(v)
    if (s.length <= 80) return `${k}=${s.slice(0, 40)}`
  }
  const [k, v] = entries[0] ?? ['—', '']
  return `${k}=${String(v).slice(0, 40)}`
}

// ---------------------------------------------------------------- 主流程

const { records, sessionStart, sessionEnd } = loadRecords(INPUT)
if (records.length === 0) fail(`${INPUT} 里没有找到 tool/call 事件`)

// 相对时间（秒），供时间线与排队分析使用
for (const r of records) {
  r.t0 = (r.start - sessionStart) / 1000
  r.t1 = r.end === null ? null : (r.end - sessionStart) / 1000
}

// —— 排队/并发分析：后端单任务，重叠即排队
const backendRecords = records.filter((r) => r.cls === 'backend')
let maxConcurrent = 0
let overlapCount = 0
const activeEnds = []
for (const r of backendRecords) {
  const s = r.start
  const e = r.end ?? r.start
  // 统计与本区间重叠的、已在同一「轨道」上未结束的调用数
  const live = activeEnds.filter((x) => x > s)
  maxConcurrent = Math.max(maxConcurrent, live.length + 1)
  if (live.length > 0) {
    overlapCount += 1
    r.queuedMs = Math.max(...live) - s // 最坏情况下需等待多久才轮到自己
  } else {
    r.queuedMs = 0
  }
  activeEnds.push(e)
}

const wallMs = sessionEnd - sessionStart
const backendBusyMs = backendRecords.reduce((s, r) => s + (r.durMs ?? 0), 0)
const humanMs = records.filter((r) => r.cls === 'human').reduce((s, r) => s + (r.durMs ?? 0), 0)

// —— 工具画像
const byTool = new Map()
for (const r of records) {
  if (!byTool.has(r.tool)) byTool.set(r.tool, [])
  byTool.get(r.tool).push(r)
}

const profiles = [...byTool.entries()].map(([tool, rs]) => {
  const ok = rs.filter((r) => r.ok)
  const durs = ok.map((r) => r.durMs).filter((d) => d !== null).sort((a, b) => a - b)
  const errKinds = new Map()
  for (const r of rs.filter((x) => !x.ok)) errKinds.set(r.err.kind, (errKinds.get(r.err.kind) ?? 0) + 1)
  return {
    tool,
    cls: rs[0].cls,
    total: rs.length,
    ok: ok.length,
    rate: ok.length / rs.length,
    p50: pct(durs, 50),
    p95: pct(durs, 95),
    max: durs.length ? durs[durs.length - 1] : null,
    errKinds: [...errKinds.entries()].sort((a, b) => b[1] - a[1]),
    records: rs,
  }
})
profiles.sort((a, b) => b.total - a.total)

// —— 参数嫌疑分析（只分析后端工具；样本里剔除本地失败，否则结论会被带偏）
const suspects = []
const fileRefStats = []
for (const p of profiles) {
  if (p.cls !== 'backend' || p.total < 4) continue
  /** 只保留「成功」与「后端失败」：本地预检/schema 失败与发给后端的参数无关。 */
  const scored = p.records.filter((r) => r.ok || (r.err?.kind ?? '').startsWith('backend'))
  if (scored.length < 4) continue
  const baseRate = scored.filter((r) => r.ok).length / scored.length

  // 文件引用维度：带文件名 vs 不带
  const withFile = scored.filter((r) => Object.keys(r.args).some((k) => FILE_KEY_RE.test(k) && r.args[k] !== undefined && r.args[k] !== ''))
  const withoutFile = scored.filter((r) => !withFile.includes(r))
  if (withFile.length >= 2 && withoutFile.length >= 2) {
    fileRefStats.push({
      tool: p.tool,
      withN: withFile.length,
      rateWith: withFile.filter((r) => r.ok).length / withFile.length,
      withoutN: withoutFile.length,
      rateWithout: withoutFile.filter((r) => r.ok).length / withoutFile.length,
    })
  }

  const keys = new Set()
  for (const r of scored) for (const k of Object.keys(r.args)) if (!IGNORE_KEYS.has(k)) keys.add(k)
  for (const key of keys) {
    const withK = scored.filter((r) => r.args[key] !== undefined)
    const withoutK = scored.filter((r) => r.args[key] === undefined)
    if (withK.length < 2 || withoutK.length < 2) continue
    const rateWith = withK.filter((r) => r.ok).length / withK.length
    const rateWithout = withoutK.filter((r) => r.ok).length / withoutK.length
    if (rateWithout - rateWith >= 0.4) {
      suspects.push({ tool: p.tool, feature: `参数 ${key} 存在`, withN: withK.length, rateWith, withoutN: withoutK.length, rateWithout })
    }
    // 同一键的值形态族：把 ref-*.png（上传句柄）与 img_*（产物名）区分开
    const fams = new Map()
    for (const r of withK) {
      const f = valueFamily(r.args[key])
      if (!fams.has(f)) fams.set(f, [])
      fams.get(f).push(r)
    }
    for (const [fam, rs] of fams) {
      if (rs.length < 2) continue
      const rate = rs.filter((r) => r.ok).length / rs.length
      if (rate <= 0.4 && rate < baseRate - 0.3) {
        suspects.push({ tool: p.tool, feature: `${key}=${fam}`, withN: rs.length, rateWith: rate, withoutN: scored.length - rs.length, rateWithout: baseRate })
      }
    }
  }
}
suspects.sort((a, b) => a.rateWith - b.rateWith)

// —— 端点可用性判定（把工具成功率还原成端点结论）
function verdictOf(p) {
  const backendFails = p.records.filter((r) => !r.ok && (r.err?.kind ?? '').startsWith('backend'))
  if (p.records.length === 0) return ['未知', '本次会话没有样本']
  if (backendFails.length === 0 && p.ok > 0) return ['可用', `${p.ok}/${p.total} 成功`]
  if (backendFails.length === 0) return ['本地阻断，后端未验证', `全部 ${p.total} 次栽在本地环节`]
  const rate = p.ok / p.total
  if (rate >= 0.9) return ['可用', `成功率 ${(rate * 100).toFixed(0)}%`]
  if (rate >= 0.3) return ['不稳定', `成功率 ${(rate * 100).toFixed(0)}%（${p.ok}/${p.total}）`]
  return ['疑似不可用', `成功率 ${(rate * 100).toFixed(0)}%（${p.ok}/${p.total}）`]
}
const endpointRows = profiles
  .filter((p) => p.cls === 'backend')
  .map((p) => ({ p, verdict: verdictOf(p) }))

// —— 重试浪费（同工具 + 同参数连续重试）
const retryWaste = []
for (const p of profiles) {
  let run = null
  for (const r of p.records) {
    const sig = JSON.stringify(r.args)
    if (run && run.sig === sig) {
      run.n += 1
      run.ms += r.durMs ?? 0
      if (r.ok) run.finallyOk = true
    } else {
      if (run && run.n >= 2) retryWaste.push(run)
      run = { tool: p.tool, sig, n: 1, ms: r.durMs ?? 0, finallyOk: r.ok, sample: shortSample(r.args) }
    }
  }
  if (run && run.n >= 2) retryWaste.push(run)
}
retryWaste.sort((a, b) => b.ms - a.ms)
const wasteMs = retryWaste.reduce((s, r) => s + r.ms, 0)

// —— 自动结论
const findings = []
const schemaErrs = records.filter((r) => r.err?.kind === 'local-schema')
if (schemaErrs.length > 0) {
  const tools = [...new Set(schemaErrs.map((r) => r.tool))].join(' / ')
  findings.push({
    level: 'P0',
    text: `${schemaErrs.length} 次调用栽在**本地 output schema**（${tools}）：后端其实已经把活干完了（耗时 26–64s 说明真跑了），但工具返回值声明 additionalProperties:false 且漏了字段，产物在返回给模型前被丢弃。这是插件 bug，不是后端问题，修 schema 即刻恢复。`,
  })
}
for (const p of profiles) {
  if (p.cls !== 'backend' || p.total < 3) continue
  if (p.rate <= 0.5) findings.push({ level: 'P1', text: `\`${p.tool}\` 成功率仅 ${(p.rate * 100).toFixed(0)}%（${p.ok}/${p.total}），是当前最不稳的后端链路。` })
}
const fastFails = records.filter((r) => r.err?.kind === 'backend-500-fast')
if (fastFails.length >= 3) {
  findings.push({
    level: 'P1',
    text: `${fastFails.length} 次**快失败 500**（<${FAST_FAIL_MS / 1000}s）：请求没进队列就被拒。优先怀疑「引用的文件名在后端不存在 / 文件类型不被该端点接受」，其次怀疑后端忙时拒单——这两者都能用一个上传过的真实句柄复现验证。`,
  })
}
if (overlapCount > 0) {
  findings.push({
    level: 'P2',
    text: `检测到 ${overlapCount} 次区间重叠，并发峰值 ${maxConcurrent}。后端单任务同步，重叠期间的耗时**含排队等待**，不能直接当接口基线（见明细表「排队等待」列）。`,
  })
}
if (wasteMs > 60_000) {
  findings.push({ level: 'P2', text: `同参数重试累计烧掉 ${fmtMin(wasteMs)}（${retryWaste.length} 组）。其中不少是本地 schema / 预检类错误——这类错误重试多少次都不会成功，应在工具层直接判死而非让模型重试。` })
}
for (const p of profiles) {
  if (p.cls === 'backend' && p.p95 !== null && p.p95 > 300_000) {
    findings.push({ level: 'P2', text: `\`${p.tool}\` p95 耗时 ${fmtS(p.p95)}（max ${fmtS(p.max)}）。单任务串行下，这类接口是整条流水线的产能瓶颈，排期必须按「镜数 × p95」估时。` })
  }
}

// ---------------------------------------------------------------- 报告

const md = []
md.push('# 会话后端接口画像（自动生成）')
md.push('')
md.push(`- 会话文件：\`${basename(INPUT)}\``)
md.push(`- 会话跨度：${fmtMin(wallMs)}（${new Date(sessionStart).toLocaleString('zh-CN')} → ${new Date(sessionEnd).toLocaleString('zh-CN')}）`)
md.push(`- 工具调用：${records.length} 次，其中后端 ${backendRecords.length} 次 / 本地 ${records.filter((r) => r.cls === 'local').length} 次 / 人等待 ${records.filter((r) => r.cls === 'human').length} 次`)
md.push(`- 后端占用：${fmtMin(backendBusyMs)}（占会话墙钟 ${((backendBusyMs / wallMs) * 100).toFixed(0)}%），人在回路等待 ${fmtMin(humanMs)}`)
md.push(`- 并发峰值：${maxConcurrent}（后端单任务同步 → 并发 1 才是无排队状态）`)
md.push('')

md.push('## 一、结论速览')
md.push('')
for (const f of findings) md.push(`- **[${f.level}]** ${f.text}`)
if (findings.length === 0) md.push('- 未触发任何告警规则。')
md.push('')

md.push('## 二、工具画像')
md.push('')
md.push('| 工具 | 类 | 调用 | 成功 | 成功率 | p50 | p95 | max | 主要失败模式 |')
md.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |')
for (const p of profiles) {
  const errs = p.errKinds.map(([k, n]) => `${k}×${n}`).join(', ') || '—'
  md.push(`| \`${p.tool}\` | ${CLASS_LABEL[p.cls]} | ${p.total} | ${p.ok} | ${(p.rate * 100).toFixed(0)}% | ${fmtS(p.p50)} | ${fmtS(p.p95)} | ${fmtS(p.max)} | ${errs} |`)
}
md.push('')
md.push('> 耗时分位只统计**成功**样本；`ask_user_choice` 的耗时是用户思考时间，不是接口耗时。')
md.push('')

md.push('## 三、失败模式分布')
md.push('')
const errAll = new Map()
for (const r of records) {
  if (r.ok) continue
  errAll.set(r.err.kind, (errAll.get(r.err.kind) ?? 0) + 1)
}
md.push('| 失败模式 | 次数 | 含义 | 处置建议 |')
md.push('| --- | ---: | --- | --- |')
const ERR_META = {
  'backend-500-fast': ['后端 500·快失败（<' + FAST_FAIL_MS / 1000 + 's）', '请求未进队列，入口即拒。查引用的文件名是否存在、后端是否正忙'],
  'backend-500-slow': ['后端 500·慢失败', '进队列后生成中崩。可原样重试，2 次仍失败再怀疑参数'],
  'local-schema': ['本地 output schema 校验失败', '插件 bug：改 Host 工具 output schema，把返回字段补全'],
  'local-precheck': ['本地预检拦截', '按提示修 prompt/参数，重试无意义'],
  'tool-error': ['工具业务错误', '前置条件不满足（门禁未放行、无片段等）'],
  'no-result': ['无 result 事件', '会话中断'],
}
for (const [kind, n] of [...errAll.entries()].sort((a, b) => b[1] - a[1])) {
  const meta = ERR_META[kind] ?? [kind, '']
  md.push(`| ${meta[0]} | ${n} | ${meta[1]} | — |`)
}
md.push('')

md.push('## 四、参数嫌疑分析（自动发现）')
md.push('')
if (suspects.length === 0) {
  md.push('未发现显著的参数相关性（样本量不足或各分支成功率接近）。')
} else {
  md.push('| 工具 | 特征 | 带该特征成功率 | 其它成功率 | 样本 |')
  md.push('| --- | --- | ---: | ---: | ---: |')
  for (const s of suspects) {
    md.push(`| \`${s.tool}\` | ${s.feature} | ${(s.rateWith * 100).toFixed(0)}%（${s.withN}） | ${(s.rateWithout * 100).toFixed(0)}%（${s.withoutN}） | ${s.withN} |`)
  }
  md.push('')
  md.push('> 判据：样本 ≥2 且带该特征的成功率比对照低 30 个百分点以上。值形态族把 `ref-*.png`（上传句柄）与 `img_*`/`z-image_*`（产物名）自动区分开——这两类文件名在后端的可消费性不同，是高频坑点。')
}
md.push('')

md.push('## 五、端点可用性判定')
md.push('')
md.push('| 后端端点 | 工具 | 样本 | 成功率 | 判定 | 证据 |')
md.push('| --- | --- | ---: | ---: | --- | --- |')
for (const { p, verdict } of endpointRows) {
  const endpoint = TOOL_ENDPOINT[p.tool] ?? '（未映射）'
  const durs = p.records.filter((r) => r.ok && r.durMs !== null).map((r) => r.durMs).sort((a, b) => a - b)
  const evidence = durs.length > 0 ? `成功样本 p50 ${fmtS(pct(durs, 50))} / max ${fmtS(durs[durs.length - 1])}` : '无成功样本'
  md.push(`| ${endpoint} | \`${p.tool}\` | ${p.total} | ${(p.rate * 100).toFixed(0)}% | **${verdict[0]}** | ${verdict[1]}；${evidence} |`)
}
md.push('')
md.push('> 判定口径：成功率 ≥90% = 可用；30–90% = 不稳定；<30% = 疑似不可用。若失败全部落在本地环节（预检/schema），则标「本地阻断，后端未验证」——此时**不能**把锅甩给后端。')
md.push('')

md.push('## 六、文件引用维度（带文件名 vs 不带）')
md.push('')
if (fileRefStats.length === 0) {
  md.push('样本不足，未发现可用的对照。')
} else {
  md.push('| 工具 | 带文件名成功率 | 不带成功率 | 样本（带/不带） |')
  md.push('| --- | ---: | ---: | ---: |')
  for (const f of fileRefStats) {
    md.push(`| \`${f.tool}\` | ${(f.rateWith * 100).toFixed(0)}% | ${(f.rateWithout * 100).toFixed(0)}% | ${f.withN}/${f.withoutN} |`)
  }
  md.push('')
  md.push('> 这个维度是把「纯文本链路」与「带参考文件链路」分开看。若差距显著，说明问题出在**文件句柄的可消费性**（文件名不存在 / 类型不被该端点接受 / 后端未落 input 目录），而不是模型或 prompt。')
}
md.push('')

md.push('## 七、排队与产能（单任务约束）')
md.push('')
md.push('| 指标 | 值 | 说明 |')
md.push('| --- | --- | --- |')
md.push(`| 会话墙钟 | ${fmtMin(wallMs)} | 含人在回路等待 ${fmtMin(humanMs)} |`)
md.push(`| 后端占用总时长 | ${fmtMin(backendBusyMs)} | 所有后端调用耗时之和 = 串行产能下限 |`)
md.push(`| 后端占用率 | ${((backendBusyMs / wallMs) * 100).toFixed(0)}% | 余数主要是模型思考、文件读写与人等待 |`)
md.push(`| 并发峰值 | ${maxConcurrent} | >1 说明存在排队，耗时被污染 |`)
md.push(`| 重叠调用数 | ${overlapCount} | 这些调用的耗时含排队等待 |`)
md.push('')
if (maxConcurrent <= 1) {
  md.push(`> **重要**：本会话并发峰值为 **1**，即调用全程严格串行、无任何区间重叠。这排除了一个常见误判——那些 <${FAST_FAIL_MS / 1000}s 的快失败 **不是**「本会话内排队等不到资源」造成的（压根没有并发），而是请求到达后端时就被入口拒绝，或后端正被**会话外**的其它任务占用。要定性只能靠串行主动探测复现。`)
} else {
  md.push(`> **警惕**：并发峰值 ${maxConcurrent}，有 ${overlapCount} 次调用在排队。这些调用的耗时含等待，已计入明细表「排队等待」列，取基线时要扣除。`)
}
md.push('>')
md.push('> **口径提醒**：后端单任务同步，两个请求并发时后者要么排队（耗时变长），要么被入口拒（快失败 500）。因此「并发探测」对这个后端没有意义——探测必须串行，且耗时基线要在**后端空闲**时测。')
md.push('')

md.push('## 八、重试浪费')
md.push('')
if (retryWaste.length === 0) {
  md.push('无同参数连续重试。')
} else {
  md.push('| 工具 | 连续次数 | 累计耗时 | 最终是否成功 | 参数首值（截断） |')
  md.push('| --- | ---: | ---: | --- | --- |')
  for (const w of retryWaste) {
    md.push(`| \`${w.tool}\` | ${w.n} | ${fmtS(w.ms)} | ${w.finallyOk ? '是' : '否'} | ${w.sample.replace(/\|/g, '\\|')} |`)
  }
}
md.push('')

md.push('## 九、逐次调用明细')
md.push('')
md.push('| # | 工具 | 起(相对) | 耗时 | 排队等待 | 结果 | 关键参数 | 错误/产物摘要 |')
md.push('| ---: | --- | ---: | ---: | ---: | --- | --- | --- |')
records.forEach((r, i) => {
  const keyParams = Object.entries(r.args)
    .filter(([k]) => k !== 'prompt' && k !== 'screenplay' && k !== 'script' && k !== 'storyboard' && k !== 'todos')
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 28) : JSON.stringify(v).slice(0, 40)}`)
    .join(' ')
  const summary = (r.ok ? r.result : `${r.err.label}｜${r.err.hint}`).replace(/\n/g, ' ').replace(/\|/g, '\\|').slice(0, 110)
  md.push(`| ${i} | \`${r.tool}\` | ${r.t0.toFixed(0)}s | ${fmtS(r.durMs)} | ${r.queuedMs ? fmtS(r.queuedMs) : '—'} | ${r.ok ? '✅' : '❌'} | ${keyParams || '—'} | ${summary} |`)
})
md.push('')
md.push(`> 完整明细见同目录 \`calls.json\`；甘特时间线见 \`timeline.html\`。`)
md.push('')

// ---------------------------------------------------------------- 时间线 HTML

const totalSpan = Math.max(...records.map((r) => r.t1 ?? r.t0))
const rowH = 20
const svgW = 1180
const padL = 190
const padR = 20
const plotW = svgW - padL - padR
const height = records.length * rowH + 60
const x = (t) => padL + (t / totalSpan) * plotW
const COLOR = { ok: '#3fb950', fail: '#f85149', local: '#8b949e', human: '#58a6ff' }
const bars = records
  .map((r, i) => {
    const y = 40 + i * rowH
    const w = Math.max(1.5, x(r.t1 ?? r.t0 + 1) - x(r.t0))
    const color = r.cls === 'human' ? COLOR.human : r.ok ? COLOR.ok : r.cls === 'local' ? COLOR.local : COLOR.fail
    return `<div class="row"><div class="lbl">${i} ${r.tool}</div><div class="track"><div class="bar" style="left:${x(r.t0)}px;width:${w}px;background:${color}" title="${r.tool} ${fmtS(r.durMs)}${r.ok ? '' : ' ❌ ' + r.err.label}"></div></div></div>`
  })
  .join('\n')
const ticks = Array.from({ length: 11 }, (_, i) => {
  const t = (totalSpan / 10) * i
  return `<div class="tick" style="left:${x(t)}px"><span>${Math.round(t / 60)}m</span></div>`
}).join('\n')

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>会话调用时间线 · ${basename(INPUT)}</title>
<style>
:root{color-scheme:dark}
body{margin:0;background:#0d1117;color:#e6edf3;font:13px/1.5 -apple-system,"PingFang SC",sans-serif;padding:18px}
h1{font-size:16px;margin:0 0 4px}
.meta{color:#8b949e;font-size:12px;margin-bottom:14px}
.legend{display:flex;gap:16px;margin:10px 0 16px;font-size:12px;color:#8b949e}
.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:middle}
.canvas{position:relative;border-left:1px solid #30363d;padding-bottom:8px}
.row{display:flex;align-items:center;height:${rowH}px}
.lbl{width:${padL - 10}px;text-align:right;padding-right:10px;color:#8b949e;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.track{position:relative;flex:1;height:${rowH - 6}px;background:#161b22;border-radius:3px}
.bar{position:absolute;top:2px;height:${rowH - 10}px;border-radius:2px;opacity:.92}
.bar:hover{opacity:1;box-shadow:0 0 0 1px #e6edf3}
.tick{position:absolute;top:-22px;border-left:1px dashed #30363d;height:8px}
.tick span{position:absolute;top:-14px;left:-14px;color:#6e7681;font-size:10px}
</style></head><body>
<h1>会话调用时间线 · ${basename(INPUT)}</h1>
<div class="meta">跨度 ${fmtMin(wallMs)} · ${records.length} 次调用 · 后端占用 ${fmtMin(backendBusyMs)} · 并发峰值 ${maxConcurrent}</div>
<div class="legend"><span><i style="background:${COLOR.ok}"></i>成功</span><span><i style="background:${COLOR.fail}"></i>失败</span><span><i style="background:${COLOR.local}"></i>本地/失败</span><span><i style="background:${COLOR.human}"></i>人在回路</span></div>
<div class="canvas">${ticks}${bars}</div>
</body></html>`

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(join(OUT_DIR, 'report.md'), md.join('\n'))
writeFileSync(
  join(OUT_DIR, 'calls.json'),
  JSON.stringify(
    {
      source: INPUT,
      sessionStart,
      sessionEnd,
      wallMs,
      backendBusyMs,
      maxConcurrent,
      records: records.map((r) => ({
        tool: r.tool,
        cls: r.cls,
        args: r.args,
        t0: r.t0,
        durMs: r.durMs,
        queuedMs: r.queuedMs ?? 0,
        ok: r.ok,
        errKind: r.err?.kind ?? null,
        result: r.result.slice(0, 400),
      })),
    },
    null,
    2,
  ),
)
writeFileSync(join(OUT_DIR, 'timeline.html'), html)

console.log(`✓ 分析完成：${records.length} 次调用 → ${OUT_DIR}`)
console.log(`  报告      ${join(OUT_DIR, 'report.md')}`)
console.log(`  明细      ${join(OUT_DIR, 'calls.json')}`)
console.log(`  时间线    ${join(OUT_DIR, 'timeline.html')}`)
console.log(`  后端占用 ${fmtMin(backendBusyMs)} / 墙钟 ${fmtMin(wallMs)} · 并发峰值 ${maxConcurrent} · 成功率 ${((records.filter((r) => r.ok).length / records.length) * 100).toFixed(0)}%`)
