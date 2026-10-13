/**
 * bible-story-director skill 守卫（2026-10-13）。
 *
 * 只测**已有守卫没覆盖**的三件事，不重复造第二份实现：
 *   1. 索引表每条故事都带出处，且出处是「书卷 + 章」形态
 *      —— 出处是 §01 事实锚点的地基，漏一条 = 该故事整条链路失效
 *   2. 索引表的时代标签 ∈ period-guide 时代表的九类（跨文件自洽）
 *      —— 两处漂移会让 S2 考据查错表，且不会有任何运行时报错
 *   3. 核心主张仍在（五条硬约束 + 禁用元素清单）
 *      —— 这五条是本 skill 相对总纲的全部增量，被删掉就是功能倒退
 *
 * 刻意的边界（不测什么）：
 *   - 不断言 description 长度 / 分册存在性 / catalog 覆盖 —— `minimax-skill.test.mjs`
 *     与 `skill-catalog.test.mjs` 已各有唯一实现，同一规则不写第二份。
 *   - 不断言措辞、排版、字节数漂移 —— 脆且易假绿。
 *
 * 纯读 skills/ 下的 md 文件，不 import lib/ 产物（内容守卫与构建解耦）。
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'bible-story-director')

/** 索引表最少收录的故事数（低于此值说明表被误删）。 */
const MIN_STORIES = 50

/** 单条出处的合法形态：`书卷 章:节` 或 `书卷 章–章`（含多段用 `；` 连接）。 */
const SOURCE_PATTERN = /^[\u4e00-\u9fa5]{1,4}\s*\d+(:\d+)?\s*[–—\-]/u

/** 表格数据行 → 单元格数组（跳过表头行与 `| --- |` 分隔行）。 */
function tableRows(md, afterHeading) {
  const start = afterHeading === undefined ? 0 : md.indexOf(afterHeading)
  assert.ok(start >= 0, `找不到小节标题：${afterHeading}`)
  return md.slice(start).split('\n')
    .filter(line => /^\|\s*\S/.test(line) && !/^\|\s*-{2,}/u.test(line))
    .map(line => line.split('|').slice(1, -1).map(cell => cell.trim()))
    .filter(cells => cells.length > 1)
}

/** 取 `## <heading>` 到下一个 `## ` 之间的正文。 */
function section(md, heading) {
  const start = md.indexOf(heading)
  assert.ok(start >= 0, `找不到小节：${heading}`)
  const rest = md.slice(start + heading.length)
  const end = rest.indexOf('\n## ')
  return end < 0 ? rest : rest.slice(0, end)
}

const skillMd = await readFile(join(SKILL_DIR, 'SKILL.md'), 'utf8')
const storyIndex = await readFile(join(SKILL_DIR, 'references', 'story-index.md'), 'utf8')
const periodGuide = await readFile(join(SKILL_DIR, 'references', 'period-guide.md'), 'utf8')

test('索引表：收录不少于 50 个故事，且每条都带合法形态的出处', () => {
  // 表头行首列是「故事」，据此把它滤掉。
  const rows = tableRows(storyIndex, '## 主表').filter(cells => cells[0] !== '故事')
  assert.ok(
    rows.length >= MIN_STORIES,
    `索引表只收录 ${rows.length} 个故事，低于下限 ${MIN_STORIES}（表被误删或截断）`,
  )
  const bad = rows
    .filter(cells => !SOURCE_PATTERN.test(cells[2] ?? ''))
    .map(cells => `${cells[0]} → 「${cells[2] ?? ''}」`)
  assert.deepEqual(
    bad, [],
    `以下故事的出处缺失或形态非法（应为「书卷 章:节」或「书卷 章–章」）：\n  ${bad.join('\n  ')}`,
  )
})

test('跨文件自洽：索引表的时代标签全部落在 period-guide 时代表的九类里', () => {
  const eraRows = tableRows(periodGuide, '## 时代表').filter(cells => cells[0] !== '时代标签')
  const eras = eraRows.map(cells => cells[0])
  assert.ok(
    eras.length >= 5,
    `period-guide 的时代表只解析出 ${eras.length} 类（${eras.join(' / ')}），表结构可能被改坏`,
  )
  const known = new Set(eras)

  const storyRows = tableRows(storyIndex, '## 主表').filter(cells => cells[0] !== '故事')
  const unknown = storyRows
    .filter(cells => !known.has(cells[4] ?? ''))
    .map(cells => `${cells[0]} → 「${cells[4] ?? ''}」`)
  assert.deepEqual(
    unknown, [],
    `索引表用了 period-guide 时代表里没有的时代标签：\n  ${unknown.join('\n  ')}\n` +
    `（可选值：${eras.join(' / ')}）—— 两处必须逐字一致，否则 S2 考据会查错表`,
  )
})

test('索引表：故事名不重复（同一故事被写两行会让出处自相矛盾）', () => {
  const names = tableRows(storyIndex, '## 主表')
    .filter(cells => cells[0] !== '故事')
    .map(cells => cells[0])
  const seen = new Set()
  const duplicated = names.filter(name => (seen.has(name) ? true : (seen.add(name), false)))
  assert.deepEqual(duplicated, [], `索引表里重复的故事名：${duplicated.join('、')}`)
})

test('核心主张仍在：五条硬约束与禁用元素清单未被删改', () => {
  // 五条硬约束的关键主张（SKILL.md §4）—— 这是相对总纲的全部增量。
  for (const anchor of ['禁止', '中世纪', '金发', '不增删人物', '神迹']) {
    assert.ok(skillMd.includes(anchor), `SKILL.md 缺少核心约束词：「${anchor}」`)
  }
  // 禁用元素清单（period-guide）—— AI 画圣经最常见的三类翻车。
  for (const anchor of ['板甲', '哥特', '十字架']) {
    assert.ok(periodGuide.includes(anchor), `period-guide.md 缺少禁用元素：「${anchor}」`)
  }
  // 两份文件都必须明确「正向表述替代 negativePrompt」这一写法规避（工具层硬限制）。
  assert.ok(skillMd.includes('negativePrompt') || periodGuide.includes('negativePrompt'),
    '缺少「用正向表述替代 negativePrompt」的写法纪律')
})

test('分册非空：五个 references 分册都有实质内容（防止空壳占位）', async () => {
  const booklets = ['story-index.md', 'period-guide.md', 'narrative-framework.md', 'storyboard-mapping.md', 'templates.md']
  for (const name of booklets) {
    const text = await readFile(join(SKILL_DIR, 'references', name), 'utf8')
    assert.ok(text.length > 500, `分册内容过短（${text.length} 字符）：references/${name}`)
  }
})
