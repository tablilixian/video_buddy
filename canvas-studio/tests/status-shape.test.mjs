/**
 * STATUS.md 形状闸（2026-10-13 文档体积治理）。
 *
 * 背景：STATUS.md 曾是文档侧第一 token 黑洞（348 KB / 平均 678 B 每行，§4 的
 * 「一句话」单元格平均 1602 B、最长 6774 B）。真凶不是总字节，而是**整段正文塞进
 * 表格单元格** —— `Read limit=24` 本意读约 1.5 KB，撞上这种表却灌进 38 KB。
 *
 * 治法（同日落地）：§4 → §4.1 短索引表 + `cv-details.md` 详情层；§8 变更流水整体
 * 迁到 `changelog.md`；§2.1 同样收成索引。本闸把「行不许长、索引不许散」钉死 ——
 * 形状一退回原样立刻红，不必等下一次 token 审计发现。
 *
 * 运行：node --test tests/status-shape.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const DOCS = join(here, '..', 'docs')
const read = (rel) => readFileSync(join(DOCS, rel), 'utf8')

const BYTES = (s) => Buffer.byteLength(s, 'utf8')

/** 检出超长行；返回 [{line, bytes, head}]。抽成函数是为了下面做正控。 */
function linesOver(lines, max, { skip = () => false } = {}) {
  return lines
    .map((l, i) => ({ line: i + 1, bytes: BYTES(l), head: l.slice(0, 90) }))
    .filter((x) => x.bytes > max && !skip(x.head))
}

/** 取 `## X.` 到下一个二级标题之间的行。 */
function section(lines, heading) {
  const a = lines.findIndex((l) => l.startsWith(heading))
  assert.ok(a >= 0, `STATUS.md 找不到章节 ${heading}`)
  const b = lines.findIndex((l, i) => i > a && l.startsWith('## '))
  return lines.slice(a, b === -1 ? lines.length : b)
}

/** 解析索引表数据行：返回 { id, cells }；行内裸 | 会切出多余格。 */
function indexRows(lines) {
  return lines
    .filter((l) => /^\|\s*(CV|BUG)-\S+\s*\|/.test(l))
    .map((l) => ({ raw: l, cells: l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()) }))
}

const statusLines = read('STATUS.md').split('\n')
const details = read('cv-details.md')
const sec4 = section(statusLines, '## 4.')
const sec2 = section(statusLines, '## 2.')

const MAX_STATUS_LINE = 1700
const MAX_INDEX_LINE = 400
const MAX_TITLE = 40

test('文档治理正控：超长行检测函数必须真的能变红（防「永远绿」的假闸）', () => {
  assert.equal(linesOver(['x'.repeat(MAX_STATUS_LINE + 1)], MAX_STATUS_LINE).length, 1,
    '检测函数失效 —— 1701 字节的行没被判违规')
  assert.equal(linesOver(['x'.repeat(MAX_STATUS_LINE)], MAX_STATUS_LINE).length, 0,
    '边界错：恰好等于上限不应判违规')
  assert.equal(linesOver(['| CV-999 | 已修复 | P1 | ' + 'x'.repeat(MAX_INDEX_LINE) + ' |'], MAX_INDEX_LINE).length, 1,
    '索引阈值检测失效')
})

test('STATUS.md 全文无「整段正文塞进单元格」：任何行 ≤ 1700 字节', () => {
  const bad = linesOver(statusLines, MAX_STATUS_LINE)
  assert.equal(bad.length, 0,
    '超长行复现（整段正文又塞回单元格了）：\n'
    + bad.map((x) => `  L${x.line} ${x.bytes}B  ${x.head}…`).join('\n'))
})

test('§4.1 CV 索引表：行结构严格（恰好 4 格 · 标题 ≤ 40 字符 · 无裸 |）且每行 ≤ 400 字节', () => {
  const rows = indexRows(sec4)
  assert.ok(rows.length > 0, '§4.1 索引表必须有数据行')
  const bad = []
  for (const { raw, cells } of rows) {
    if (cells.length !== 4) bad.push(`格数 ${cells.length}（应 4）: ${raw.slice(0, 80)}`)
    else if (cells[3].length > MAX_TITLE) bad.push(`标题 ${cells[3].length} 字符（应 ≤ ${MAX_TITLE}）: ${cells[3]}`)
    else if (BYTES(raw) > MAX_INDEX_LINE) bad.push(`行 ${BYTES(raw)}B（应 ≤ ${MAX_INDEX_LINE}）: ${raw.slice(0, 80)}`)
  }
  assert.equal(bad.length, 0, '§4.1 索引行不合规：\n' + bad.map((s) => '  ' + s).join('\n'))
})

test('§2.1 缺陷索引表：行结构严格（恰好 4 格 · 问题 ≤ 40 字符）且每行 ≤ 400 字节', () => {
  const rows = indexRows(sec2)
  assert.ok(rows.length > 0, '§2.1 索引表必须有数据行')
  const bad = []
  for (const { raw, cells } of rows) {
    if (cells.length !== 4) bad.push(`格数 ${cells.length}（应 4）: ${raw.slice(0, 80)}`)
    else if (cells[3].length > MAX_TITLE) bad.push(`问题 ${cells[3].length} 字符（应 ≤ ${MAX_TITLE}）: ${cells[3]}`)
    else if (BYTES(raw) > MAX_INDEX_LINE) bad.push(`行 ${BYTES(raw)}B（应 ≤ ${MAX_INDEX_LINE}）: ${raw.slice(0, 80)}`)
  }
  assert.equal(bad.length, 0, '§2.1 索引行不合规：\n' + bad.map((s) => '  ' + s).join('\n'))
})

test('两层同步：§4.1 / §2.1 索引里的每个 CV 号，在 cv-details.md 必须有对应 #### 小节', () => {
  const heads = new Set([...details.matchAll(/^#### (CV-\S+?) ·/gm)].map((m) => m[1]))
  const idxIds = [...new Set([...indexRows(sec4), ...indexRows(sec2)].map((r) => r.cells[0]))]
  const orphan = idxIds.filter((id) => !heads.has(id))
  assert.equal(orphan.length, 0,
    `索引有条目但 cv-details.md 无小节（详情层漏建）：${orphan.join(', ')}`)
})

test('cv-details.md 小节标题唯一（同一 CV 不得有两个 #### 小节）', () => {
  const all = [...details.matchAll(/^#### (CV-\S+?) ·/gm)].map((m) => m[1])
  const dup = all.filter((id, i) => all.indexOf(id) !== i)
  assert.equal(dup.length, 0, `重复小节：${[...new Set(dup)].join(', ')}`)
})
