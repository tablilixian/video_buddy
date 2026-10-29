// CV-382 · CR 台账双轨机器闸（D-03：只做结构闸 —— ID 集合 / 状态词 / 方案留痕，不解析正文语义）。
//
// 背景：docs/code-review/README.md 的 §1 清单表与 §3 状态总表此前至少 7 条状态相反
// （CR-032/035/036/042/045/046/089），外加 §1.1 的 CR-104 在 §3 无行 —— 「修已修的东西」
// 就是这么发生的（2026-10-29 批次差点重做 CR-042 / CR-023）。本闸钉四条结构断言：
//   ① §1 清单（1.1 高危 + 1.2 中危）的每个 ID 必须存在于 §3（§3 是全集 —— §1.3 明言
//      「低危见各模块文档」，故用「§1 ⊆ §3」而不是集合相等；反向变异：插一个 §3 没有的 ID → 红）
//   ② 同 ID 状态词一致（剥掉括注后比较；反向变异：把某条 §1 状态改回矛盾值 → 红）
//   ③ 状态词 ∈ 允许集合（§0 五词 + 台账既有词汇「已定案」——CR-012 于 2026-09-30 对账
//      定案「维持不注入」，词汇已在两表落地，闸收编而非改史）
//   ④ 「已修复·待验收」的每个 ID 必须在 §3 表行之外（§0 批注 / §1 清单 / §6 变更记录）
//      有留痕 —— 方案一句话所在（只标已修不写方案 = 红）
//
// 断言消息写明「改状态词请同步 §1 与 §3」（§8 风险表：防后续正常编辑误伤）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const README_PATH = join(ROOT, 'docs', 'code-review', 'README.md')

const ALLOWED_STATUSES = new Set(['待处理', '进行中', '已修复·待验收', '已完成', '已否决', '已定案'])
const CR_ROW = /^\|\s*CR-\d+\s*\|/

/** 剥掉加粗 / 表情 / 括注（全角（ 与半角 ( 都算），取裸状态词。 */
function normalizeStatus(raw) {
  return raw
    .replace(/\*\*/g, '')
    .replace(/[🚩✅]/g, '')
    .split(/[（(]/)[0]
    .trim()
}

function parseLedger() {
  const lines = readFileSync(README_PATH, 'utf8').split('\n')
  const sectionStart = (prefix) => lines.findIndex((line) => line.startsWith(prefix))
  const s1 = sectionStart('## 1.')
  const s2 = sectionStart('## 2.')
  const s3 = sectionStart('## 3.')
  const s4 = sectionStart('## 4.')
  assert.ok(s1 > 0 && s2 > s1 && s3 > s2 && s4 > s3, 'README 章节结构（## 1. ~ ## 4.）不完整，闸无法解析')

  // §1 行：| ID | P | 模块 | 问题 | 位置 | 状态 | —— 状态取最后一个非空格。
  // §3 行：| ID | P | 状态 | 完成日 | 备注 | —— 状态取 ID 后第 2 格。
  const collect = (from, to, statusOf) => {
    const map = new Map()
    const duplicates = []
    for (const line of lines.slice(from, to)) {
      if (!CR_ROW.test(line)) continue
      const cells = line.split('|').map((cell) => cell.trim())
      const id = cells[1]
      const status = normalizeStatus(statusOf(cells))
      if (map.has(id)) duplicates.push(id)
      map.set(id, status)
    }
    return { map, duplicates }
  }

  const s1Ledger = collect(s1, s2, (cells) => {
    const nonEmpty = cells.filter((cell) => cell.length > 0)
    return nonEmpty[nonEmpty.length - 1]
  })
  const s3Ledger = collect(s3, s4, (cells) => cells[3])
  return { lines, s1: s1Ledger, s3: s3Ledger, range: { s1, s2, s3, s4 } }
}

const ledger = parseLedger()

test('台账闸①：§1 清单的每个 ID 必须存在于 §3 状态总表（两表都不许重复 ID）', () => {
  for (const [label, { duplicates }] of [['§1', ledger.s1], ['§3', ledger.s3]]) {
    assert.deepEqual(
      duplicates,
      [],
      `${label} 表出现重复 ID：${duplicates.join('、')}（一行一条，删多余的）`,
    )
  }
  const orphans = [...ledger.s1.map.keys()].filter((id) => !ledger.s3.map.has(id))
  assert.deepEqual(
    orphans,
    [],
    `§1 有而 §3 无的孤儿条目：${orphans.join('、')}（在 §3 补行，或确属误录则从 §1 删除 —— §3 是全集）`,
  )
})

test('台账闸②：§1 与 §3 同 ID 状态词一致（改状态词请同步两表）', () => {
  const mismatched = [...ledger.s1.map.entries()]
    .filter(([id, status]) => ledger.s3.map.get(id) !== status)
    .map(([id, status]) => `${id}: §1=${status} §3=${ledger.s3.map.get(id)}`)
  assert.deepEqual(
    mismatched,
    [],
    `两表状态词相反（双轨矛盾，正是本闸要拦的形态；括注不参与比较，只比裸状态词）：\n${mismatched.join('\n')}`,
  )
})

test('台账闸③：状态词 ∈ 允许集合（§0 五词 + 已定案）', () => {
  const unknown = new Map()
  for (const [table, ledgerMap] of [['§1', ledger.s1.map], ['§3', ledger.s3.map]]) {
    for (const [id, status] of ledgerMap.entries()) {
      if (!ALLOWED_STATUSES.has(status)) unknown.set(`${table} ${id}`, status)
    }
  }
  assert.deepEqual(
    [...unknown.entries()],
    [],
    `出现允许集合之外的状态词（新词请先在 README §0「状态词」表定义并同步本闸的 ALLOWED_STATUSES）：${[...unknown.entries()].map(([id, status]) => `${id}=${status}`).join('、')}`,
  )
})

test('台账闸④：已修复·待验收 的每个 ID 必须在 §3 表行之外有方案留痕', () => {
  // §3 表行本身不算留痕（那里只有状态列）；方案一句话住在 §0 批注 / §1 清单 / §6 变更记录。
  const outside = ledger.lines
    .filter((line, index) => !(index >= ledger.range.s3 && index < ledger.range.s4 && CR_ROW.test(line)))
    .join('\n')
  const noTrace = [...ledger.s3.map.entries()]
    .filter(([, status]) => status === '已修复·待验收')
    .map(([id]) => id)
    .filter((id) => !outside.includes(id))
  assert.deepEqual(
    noTrace,
    [],
    `以下条目标了已修复·待验收，但 §3 表行之外（§0/§1/§6）找不到任何留痕 —— 请在 §6 变更记录补一笔「用了哪种方案」：${noTrace.join('、')}`,
  )
})
