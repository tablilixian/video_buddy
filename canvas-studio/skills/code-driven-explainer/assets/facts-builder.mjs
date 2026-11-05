#!/usr/bin/env node
/**
 * 事实快照生成器（知识型 / 数据型科普片 · 跟片走）。
 *
 * ## 为什么需要它
 *
 * 真机复盘（2026-11-05，45s 科普片）：故事板阶段 15 个模型步 / 9.7 min 花在反复 curl
 * 多个站点与「用户 23.5° vs NASA 23.4°」的四轮推理上。数值口径与冲突裁决是确定性
 * 计算，不该由模型用 token 去争 —— 与 manifest-builder.mjs 的「排版交回脚本」同理。
 *
 * ## 它保证什么
 *
 * 1. 裁决序固定：用户原话 explicit > 项目预置 > 快照 verified > 联网值；
 * 2. 落选值不删，进 conflicts[].footnote 并作为「未采用」脚注写进 facts[]；
 * 3. 每条来源带 sha256 + retrievedAt，可复查；不回填历史项目；
 * 4. 输出 write_storyboard 的 facts 节可直接粘的 JSON，模型不必再读一遍快照。
 *
 * ## 用法
 *
 *   node facts-builder.mjs <spec.json> [out.json]     # 默认写 build/fact-snapshot.json
 *   node facts-builder.mjs <spec.json> --stdout-only  # 只打印，不落盘
 *
 * spec 形状（内容表，由模型一次填好；不含时间戳，便于幂等重跑）：
 * {
 *   "projectId": "…",
 *   "sources":  [{ "id":"nasa-gistemp", "url":"https://…", "retrievedAt":"2026-11-05" }],
 *   "constants":[{ "key":"axialTilt", "value":23.5, "unit":"deg",
 *                   "source":"user|project|snapshot|network", "sourceId":"nasa-gistemp",
 *                   "status":"verified|pending", "claim":"地轴倾角约 23.5°" }],
 *   "conflicts":[{ "key":"axialTilt", "userValue":23.5, "sourceValue":23.4,
 *                   "sourceId":"nasa-gistemp" }]
 * }
 *
 * 零依赖：只用 node 内置模块，可整段复制进项目 build/ 目录直接跑。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const PRIORITY = { user: 4, project: 3, snapshot: 2, network: 1 }
const STATUSES = new Set(['verified', 'pending'])

function fail(message) {
  console.error(`✖ facts-builder: ${message}`)
  process.exit(1)
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

/** 按裁决序取胜出值；同级取先出现的一条，保持确定性。 */
function winnerOf(rows) {
  return [...rows].sort((a, b) => (PRIORITY[b.source] ?? 0) - (PRIORITY[a.source] ?? 0))[0]
}

function loadSpec(path) {
  if (!existsSync(path)) fail(`spec 不存在: ${path}`)
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    fail(`spec 不是合法 JSON: ${String(error)}`)
  }
  if (!Array.isArray(parsed.sources)) fail('spec.sources 必须是数组')
  if (!Array.isArray(parsed.constants)) fail('spec.constants 必须是数组')
  if (parsed.constants.length === 0) fail('spec.constants 不能为空（没有事实就不要生成快照）')
  return parsed
}

function build(parsed) {
  const sourceById = new Map()
  for (const source of parsed.sources) {
    if (typeof source.id !== 'string' || source.id === '') fail('sources[].id 必填')
    if (typeof source.url !== 'string' || source.url === '') fail(`sources[${source.id}].url 必填`)
    sourceById.set(source.id, {
      id: source.id,
      url: source.url,
      sha256: sha256(source.url),
      retrievedAt: source.retrievedAt ?? '',
    })
  }

  const byKey = new Map()
  for (const row of parsed.constants) {
    if (typeof row.key !== 'string' || row.key === '') fail('constants[].key 必填')
    if (!Object.hasOwn(PRIORITY, row.source)) fail(`constants[${row.key}].source 非法: ${String(row.source)}`)
    if (!STATUSES.has(row.status)) fail(`constants[${row.key}].status 非法: ${String(row.status)}`)
    if (row.sourceId !== undefined && !sourceById.has(row.sourceId)) {
      fail(`constants[${row.key}].sourceId 指向不存在的来源: ${String(row.sourceId)}`)
    }
    if (row.value === undefined) fail(`constants[${row.key}].value 必填`)
    if (!byKey.has(row.key)) byKey.set(row.key, [])
    byKey.get(row.key).push(row)
  }

  // 裁决：每个 key 只留胜出值，落选值进 conflicts。
  const constants = []
  const conflicts = []
  for (const [key, rows] of byKey) {
    const win = winnerOf(rows)
    constants.push({ key, value: win.value, unit: win.unit ?? '', source: win.source, status: win.status })
    for (const lost of rows) {
      if (lost === win) continue
      conflicts.push({
        key,
        resolved: win.value,
        dropped: lost.value,
        droppedSource: lost.source,
        footnote: `${key}: 用户/预置采用 ${String(win.value)}，${lost.source} 的 ${String(lost.value)} 未采用（见 facts 脚注）`,
      })
    }
  }

  // spec 里显式声明的冲突（用户值 vs 来源值）优先级最高，脚本不再推理。
  for (const conflict of parsed.conflicts ?? []) {
    if (typeof conflict.key !== 'string') fail('conflicts[].key 必填')
    if (conflict.userValue === undefined) fail(`conflicts[${conflict.key}].userValue 必填`)
    const target = constants.find(row => row.key === conflict.key)
    if (target) target.value = conflict.userValue
    else constants.push({
      key: conflict.key, value: conflict.userValue, unit: '', source: 'user', status: 'verified',
    })
    conflicts.push({
      key: conflict.key,
      resolved: conflict.userValue,
      dropped: conflict.sourceValue,
      droppedSource: conflict.sourceId ?? 'external',
      footnote: `${conflict.key}: 用户指定 ${String(conflict.userValue)}，来源 ${String(conflict.sourceValue)} 未采用`,
    })
  }

  // facts[] —— write_storyboard 可直接粘贴的片段。
  const facts = []
  for (const row of constants) {
    const claim = `${row.key} = ${String(row.value)}${row.unit}`
    facts.push({
      claim,
      source: row.source === 'user' ? '用户原话' : `fact-snapshot.json#${row.key}`,
      status: row.status,
    })
  }
  for (const conflict of conflicts) {
    facts.push({ claim: conflict.footnote, source: `fact-snapshot.json#conflict:${conflict.key}`, status: 'verified' })
  }

  return {
    schemaVersion: 1,
    projectId: parsed.projectId ?? '',
    generatedFrom: 'facts-builder.mjs',
    sources: [...sourceById.values()],
    constants,
    conflicts,
    facts,
  }
}

const args = process.argv.slice(2)
const specPath = args.find(value => !value.startsWith('--'))
if (!specPath) fail('用法: node facts-builder.mjs <spec.json> [out.json] [--stdout-only]')
const stdoutOnly = args.includes('--stdout-only')
const outArg = args.find(value => value !== specPath && !value.startsWith('--'))
const outPath = resolve(outArg ?? 'build/fact-snapshot.json')

const snapshot = build(loadSpec(resolve(specPath)))
if (!stdoutOnly) {
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
}
console.log(`✔ 事实快照: ${stdoutOnly ? '(未落盘)' : outPath}`)
console.log(`  常量 ${snapshot.constants.length} 条 · 来源 ${snapshot.sources.length} 条 · 冲突 ${snapshot.conflicts.length} 条 · pending ${snapshot.facts.filter(f => f.status === 'pending').length} 条`)
console.log('\n--- 写入 write_storyboard 的 facts 节 ---')
console.log(JSON.stringify({ facts: snapshot.facts }))
