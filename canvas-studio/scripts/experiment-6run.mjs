/**
 * experiment-6run.mjs — 借鉴+翻拍 3v3 实验的「后半程自动化」
 *
 * 分工：「建项目 + 发首句 + 等回合 + 建下一跑」由 **app 内一键实验按钮** 完成
 * （设置里开 testMode → 浮窗「借鉴翻拍 3v3（6 项目）」→ ▶ 开始）；本脚本只管跑完
 * 之后的：转录采集 → 指标统计 → 合并人工判分 → 四项判定出报告。
 *
 * 复用现成工具，不重造统计：
 *   scripts/probe-session.mjs                 → 工具调用 / 工具分布 / 读图命中 / 时间跨度
 *   scripts/analyze-storyboard-latency.mjs   → 墙钟 / 步数 / render 明细
 *
 * 用法：
 *   node scripts/experiment-6run.mjs init <实验目录>
 *   node scripts/experiment-6run.mjs collect <实验目录>
 *   node scripts/experiment-6run.mjs selftest <任意 session.v4.jsonl.zstd>
 *
 * init 会生成：6 份逐字可直接复制的第一句、runs/X1..X6/、manual.json（人工待填）、
 * 打乱后的盲评顺序、每跑提示。第一句从真机实验操作包自动抽取，带内容断言，
 * 避免手工复制时把 G1 的锚包漏进 G0。
 *
 * collect 会：扫描 runs/X<n>/ 下的会话转录 → 调上面两个现成工具取指标 →
 * 合并 manual.json → 输出 metrics.json + report.md（记录表 / 汇总 / 四项判定）。
 * 需要人看片才能定的字段（N1–N7 通过数、盲评分、到首版成片、回退、干预）留在
 * manual.json，脚本不假装能自动判。
 *
 * 零前置、不改产品代码、不碰 GUI、不重启 Electron、不动历史数据。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACK = resolve(HERE, '../docs/demos/2026-11-08-真机实验操作包-可直接复制.md')
const SESSION_ROOT = join(process.env.HOME ?? '', '.videobuddy/sessions')
const GROUPS = ['G1', 'G0', 'G1', 'G0', 'G1', 'G0']
const PROBE = join(HERE, 'probe-session.mjs')
const LATENCY = join(HERE, 'analyze-storyboard-latency.mjs')

const mean = (xs) => xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length
const range = (xs) => xs.length === 0 ? null : Math.max(...xs) - Math.min(...xs)
const fmt = (v, digits = 1) => v === null || v === undefined || Number.isNaN(v) ? '—' : (typeof v === 'number' ? v.toFixed(digits) : String(v))
const pick = (obj, keys, fallback = null) => {
  for (const k of keys) if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k]
  return fallback
}

function runNode(script, args) {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (r.status !== 0) return { ok: false, error: (r.stderr || r.stdout || '').trim().slice(0, 300) }
  try { return { ok: true, data: JSON.parse(r.stdout) } } catch { return { ok: false, error: 'JSON 解析失败: ' + r.stdout.slice(0, 200) } }
}

/** 从操作包抽 3 段 ```text 块：0=环境自检，1=G1 第一句，2=G0 第一句。带内容断言。 */
function loadFirstSentences() {
  if (!existsSync(PACK)) throw new Error('找不到操作包: ' + PACK)
  const md = readFileSync(PACK, 'utf8')
  const blocks = [...md.matchAll(/```text\n([\s\S]*?)\n```/g)].map(m => m[1])
  if (blocks.length < 3) throw new Error('操作包里 ```text 块少于 3 段，可能改过结构，拒绝生成第一句')
  const g1 = blocks[1], g0 = blocks[2]
  if (!g1.includes('制作锚包')) throw new Error('第 2 段 text 块不含「制作锚包」，疑似不是 G1 第一句')
  if (!g0.includes('光的波长') || g0.includes('制作锚包')) throw new Error('第 3 段 text 块疑似不是 G0 第一句（含锚包或缺题目）')
  const topic = '内容讲清楚三件事：光是电磁波'
  if (!g1.includes(topic) || !g0.includes(topic)) throw new Error('两组题目文本不一致，拒绝生成')
  return { g1, g0 }
}

/** 单份转录 → 指标。zstd 自动解压，复用两个现成统计工具。 */
function analyzeTranscript(file) {
  const out = { file, toolCalls: null, render: null, readImage: null, wallMin: null,
    steps: null, errors: null, span: null, delivered: null, warnings: [] }
  const probe = runNode(PROBE, [file, '--json'])
  if (!probe.ok) out.warnings.push('probe-session: ' + probe.error)
  else {
    const s = probe.data.summary ?? {}
    out.toolCalls = pick(s, ['toolCalls'])
    out.errors = pick(s, ['errors'])
    out.span = pick(s, ['span'])
    const bd = s.toolBreakdown ?? {}
    const renderFromBd = Object.entries(bd).filter(([k]) => /render_composition/i.test(k)).reduce((a, [, v]) => a + v, 0)
    const imgFromBd = Object.entries(bd).filter(([k]) => /image|read_image|inspect/i.test(k)).reduce((a, [, v]) => a + v, 0)
    const imgFromHits = pick(s.keyHits ?? {}, ['读图'], 0)
    out.render = renderFromBd
    out.readImage = Math.max(imgFromBd, imgFromHits)
  }

  let jsonl = file
  let tmp = null
  if (/\.zstd$/.test(file)) {
    tmp = join(tmpdir(), `exp6-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`)
    const z = spawnSync('zstd', ['-dc', file], { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 })
    if (z.status !== 0) out.warnings.push('zstd -dc 失败: ' + String(z.stderr).slice(0, 160))
    else { writeFileSync(tmp, z.stdout); jsonl = tmp }
  }
  if (jsonl.endsWith('.jsonl')) {
    const lat = runNode(LATENCY, [jsonl, '--json'])
    if (!lat.ok) out.warnings.push('analyze-storyboard-latency: ' + lat.error)
    else {
      const d = lat.data
      const secs = pick(d, ['wallSeconds'])
      out.wallMin = secs === null ? null : secs / 60
      out.steps = pick(d, ['steps'])
      const r = d.renders ?? {}
      out.render = Math.max(out.render ?? 0, pick(r, ['total'], 0))
      out.delivered = pick(r.budget ?? {}, ['delivered'], null)
    }
  }
  if (tmp && existsSync(tmp)) { try { unlinkSync(tmp) } catch { /* 临时文件清理失败不影响结论 */ } }
  return out
}

function findTranscript(runDir) {
  if (!existsSync(runDir)) return null
  const files = readdirSync(runDir).filter(f => /session.*\.jsonl(\.zstd)?$|\.jsonl(\.zstd)?$/.test(f))
  if (files.length === 0) return null
  return join(runDir, files.sort()[0])
}

function cmdInit(dir) {
  const { g1, g0 } = loadFirstSentences()
  const root = resolve(dir)
  mkdirSync(join(root, 'first-sentences'), { recursive: true })
  GROUPS.forEach((g, i) => {
    const n = i + 1
    writeFileSync(join(root, 'first-sentences', `X${n}.txt`), (g === 'G1' ? g1 : g0) + '\n')
    mkdirSync(join(root, 'runs', `X${n}`), { recursive: true })
  })
  const manual = { _说明: '只需填下面 6 个对象里 null 的字段。N1–N7 判分与盲评必须看片；toFirstFilmMin 从会话起止读；fallback 看渲染回执。', runs: {} }
  GROUPS.forEach((g, i) => {
    manual.runs[`X${i + 1}`] = { group: g, fallback: null, toFirstFilmMin: null,
      n1n7: null, defects: null, blindScore: null, interventions: 0,
      note: i === 0 ? '兼阶段 A（走得通）' : '' }
  })
  writeFileSync(join(root, 'manual.json'), JSON.stringify(manual, null, 2) + '\n')
  const order = [1, 2, 3, 4, 5, 6]
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const t = order[i]; order[i] = order[j]; order[j] = t
  }
  writeFileSync(join(root, 'blind-order.json'), JSON.stringify({ _说明: '盲评播放顺序，文件名不含组别', order: order.map(n => `X${n}.mp4`) }, null, 2) + '\n')
  const lines = [
    '# 借鉴+翻拍 3v3 实验目录', '',
    '跑次顺序（严格交替，每跑开全新会话）：' + GROUPS.map((g, i) => `X${i + 1}=${g}`).join(' / '), '',
    '每跑做 4 件事：',
    '1. 打开 first-sentences/X<n>.txt，整块复制进新会话第一句；不拆、不追问、不中途补指令。',
    '2. 记下会话开始 / 第一次出片 / 结束时间。',
    '3. 成片另存为 runs/X<n>/X<n>.mp4；会话转录放到 runs/X<n>/（*.jsonl 或 *.jsonl.zstd 都认）。',
    `   转录在 ${SESSION_ROOT}/<cwd>/<session-id>/session.v4.jsonl.zstd`,
    '4. 立刻把 manual.json 里这一跑的 null 字段填掉，别靠回忆。', '',
    '跑完 6 次：node scripts/experiment-6run.mjs collect ' + dir,
    '盲评：按 blind-order.json 的顺序播放 6 支片，填 blindScore 后再 collect 一次。', '',
    '发首句已由 app 内按钮自动化：设置里开 testMode → 浮窗点「借鉴翻拍 3v3」的 ▶ 开始。', '',
  ]
  writeFileSync(join(root, 'README.txt'), lines.join('\n'))
  console.log(`已生成 ${root}`)
  console.log('  第一句 6 份（从操作包抽取并校验）、runs/X1..X6/、manual.json、blind-order.json、README.txt')
  console.log('  盲评顺序:', order.map(n => `X${n}`).join(' → '))
}

function cmdCollect(dir) {
  const root = resolve(dir)
  if (!existsSync(root)) throw new Error('实验目录不存在: ' + root)
  const manualPath = join(root, 'manual.json')
  const manual = existsSync(manualPath) ? JSON.parse(readFileSync(manualPath, 'utf8')) : { runs: {} }
  const rows = []
  for (let n = 1; n <= 6; n += 1) {
    const id = `X${n}`
    const runDir = join(root, 'runs', id)
    const f = findTranscript(runDir)
    const auto = f ? analyzeTranscript(f) : { warnings: ['未找到转录（把 session.v4.jsonl.zstd 放进 runs/' + id + '/）'] }
    const m = (manual.runs ?? {})[id] ?? {}
    rows.push({ id, group: GROUPS[n - 1], transcript: f ? f.split('/').pop() : null,
      ...auto, manual: m })
  }
  writeFileSync(join(root, 'metrics.json'), JSON.stringify(rows, null, 2) + '\n')

  const val = (r, k) => r.manual && r.manual[k] !== null && r.manual[k] !== undefined ? Number(r.manual[k]) : null
  const hdr = ['跑次', '组', '转录', '工具调用', 'render', 'read_image', '墙钟(min)', '步数', '到首版(min)', 'N1–N7', '缺陷', '盲评', '回退', '备注']
  const lines = ['# 借鉴+翻拍 3v3 · 实验报告', '', '> 由 `scripts/experiment-6run.mjs collect` 生成。自动列来自会话转录统计，人工列来自 manual.json。', '',
    '| ' + hdr.join(' | ') + ' |', '|' + hdr.map(() => '---').join('|') + '|']
  for (const r of rows) {
    lines.push('| ' + [r.id, r.group, r.transcript ?? '—', fmt(r.toolCalls, 0), fmt(r.render, 0),
      fmt(r.readImage, 0), fmt(r.wallMin), fmt(r.steps, 0), fmt(val(r, 'toFirstFilmMin')),
      val(r, 'n1n7') === null ? '—' : `${val(r, 'n1n7')}/7`, fmt(val(r, 'defects'), 0),
      fmt(val(r, 'blindScore'), 0), r.manual?.fallback === null || r.manual?.fallback === undefined ? '—' : (r.manual.fallback ? '是' : '否'),
      r.manual?.note ?? ''].join(' | ') + ' |')
  }
  const warns = rows.flatMap(r => (r.warnings ?? []).map(w => `${r.id}: ${w}`))
  if (warns.length) lines.push('', '## 采集告警', '', ...warns.map(w => '- ' + w))

  const byGroup = (g) => rows.filter(r => r.group === g)
  const series = (g, get) => byGroup(g).map(get).filter(v => v !== null && v !== undefined && !Number.isNaN(v))
  const autoGet = (r, k) => r[k] === null || r[k] === undefined ? null : Number(r[k])
  const table = [
    ['指标', 'G0', 'G1', '方向'],
    ['通过率均值 (N1–N7)', mean(series('G0', r => val(r, 'n1n7'))), mean(series('G1', r => val(r, 'n1n7'))), 'G1 > G0'],
    ['通过率极差', range(series('G0', r => val(r, 'n1n7'))), range(series('G1', r => val(r, 'n1n7'))), 'G1 < G0'],
    ['到首版均值 (min)', mean(series('G0', r => val(r, 'toFirstFilmMin'))), mean(series('G1', r => val(r, 'toFirstFilmMin'))), 'G1 < G0'],
    ['总墙钟均值 (min)', mean(series('G0', r => autoGet(r, 'wallMin'))), mean(series('G1', r => autoGet(r, 'wallMin'))), 'G1 < G0'],
    ['render 均值', mean(series('G0', r => autoGet(r, 'render'))), mean(series('G1', r => autoGet(r, 'render'))), 'G1 < G0'],
    ['read_image 均值', mean(series('G0', r => autoGet(r, 'readImage'))), mean(series('G1', r => autoGet(r, 'readImage'))), 'G1 < G0'],
    ['盲评均值', mean(series('G0', r => val(r, 'blindScore'))), mean(series('G1', r => val(r, 'blindScore'))), 'G1 > G0'],
  ]
  lines.push('', '## 汇总', '', '| ' + table[0].join(' | ') + ' |', '|---|---|---|---|')
  for (const row of table.slice(1)) lines.push('| ' + row[0] + ' | ' + fmt(row[1], 2) + ' | ' + fmt(row[2], 2) + ' | ' + row[3] + ' |')

  const cmp = (a, b, wantLower) => {
    if (a === null || b === null || a === undefined || b === undefined || Number.isNaN(a) || Number.isNaN(b)) return 'na'
    if (b === a) return 'tie'
    return (wantLower ? b < a : b > a) ? 'pass' : 'fail'
  }
  const rework = (() => {
    const r = cmp(table[5][1], table[5][2], true)
    const i = cmp(table[6][1], table[6][2], true)
    if (r === 'na' || i === 'na') return 'na'
    if (r === 'fail' || i === 'fail') return 'fail'
    return r === 'pass' && i === 'pass' ? 'pass' : 'tie'
  })()
  const checks = [
    { name: '通过率均值 G1 > G0', v: cmp(table[1][1], table[1][2], false) },
    { name: '通过率极差 G1 < G0', v: cmp(table[2][1], table[2][2], true) },
    { name: '到首版耗时 G1 < G0', v: cmp(table[3][1], table[3][2], true) },
    { name: '返工 render 与 read_image 均 G1 < G0', v: rework },
  ]
  const icon = { pass: '✅ 同向', tie: '➖ 平局', fail: '❌ 反向', na: '⏳ 待填' }
  lines.push('', '## 四项判定（操作包 §8）', '')
  for (const c of checks) lines.push(`- ${icon[c.v]} ${c.name}`)
  const passed = checks.filter(c => c.v === 'pass').length
  const reversed = checks.filter(c => c.v === 'fail').length
  const missing = checks.filter(c => c.v === 'na').length
  const ties = checks.filter(c => c.v === 'tie').length
  if (missing > 0) lines.push('', `> 有 ${missing}/4 项待填（缺人工字段或转录）。结论待补，不要提前下。`)
  else if (passed === 4) lines.push('', '> **结论：四项全同向 ⇒ 路线成立**，可以谈产品化。')
  else if (reversed >= 2) lines.push('', `> **结论：${reversed} 项反向 ⇒ 路线不成立**，不投入产品化。`)
  else lines.push('', `> **结论：${passed} 同向 / ${ties} 平局 / ${reversed} 反向，趋势不明确**，3v3 只够看趋势；需要硬结论就加到 5v5。`)
  lines.push('', '> 发生渲染回退的跑次要单独标注，不与正常跑次混算耗时（操作包 §5/§8）。', '')
  writeFileSync(join(root, 'report.md'), lines.join('\n'))
  console.log('已生成', join(root, 'metrics.json'))
  console.log('已生成', join(root, 'report.md'))
  const tail = lines.slice(lines.findIndex(l => l.startsWith('## 四项判定'))).filter(Boolean)
  console.log('\n' + tail.join('\n'))
}

function cmdSelftest(file) {
  const f = resolve(file)
  if (!existsSync(f)) throw new Error('转录不存在: ' + f)
  const r = analyzeTranscript(f)
  console.log(JSON.stringify(r, null, 2))
  if (r.toolCalls === null && r.wallMin === null) { console.error('自测失败：两个统计工具都没取到指标'); process.exitCode = 1 }
  else console.log('\n自测通过：采集链路可用')
}

const [cmd, arg] = process.argv.slice(2)
try {
  if (cmd === 'init') cmdInit(arg)
  else if (cmd === 'collect') cmdCollect(arg)
  else if (cmd === 'selftest') cmdSelftest(arg)
  else console.log('用法: node scripts/experiment-6run.mjs init|collect|selftest <路径>')
} catch (e) { console.error('✗', e.message); process.exitCode = 1 }
