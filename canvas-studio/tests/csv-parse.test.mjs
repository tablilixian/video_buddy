/**
 * 阶段 4.2（2026-11-04）：`import_csv` 数据导入守卫。
 *
 * 锁三件事：
 * 1. **解析语义**（csv-parse.ts，node 直连）：引号包裹 / 混用行界 / 分隔符嗅探 /
 *    数值收口（千分位、% 按比例）与「文本列不被猜成数字」；
 * 2. **建议算法**：value 列取数值占比最高、label 列取文本占比最高、limit 截断记 note；
 * 3. **注册面**：工具进 createStudioTools 全量名单（43 → 44），presentation A 档在册。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const srcOf = (p) => readFileSync(join(ROOT, p), 'utf8')

test('4.2 解析：引号包裹 / 混用行界 / 分隔符嗅探', async () => {
  const { parseCsv, sniffDelimiter } = await import('../lib/csv-parse.js')
  // 引号内逗号与换行不切分；"" 转义
  const q = parseCsv('name,note\r\n"x,1","含""引号"""\r\n"多\n行",b\n')
  assert.deepEqual(q?.headers, ['name', 'note'])
  assert.deepEqual(q?.rows[0], ['x,1', '含"引号"'])
  assert.deepEqual(q?.rows[1], ['多\n行', 'b'])
  assert.equal(sniffDelimiter('a;b;c\n1;2;3'), ';')
  assert.equal(sniffDelimiter('a\tb\n1\t2'), '\t')
  assert.equal(sniffDelimiter('a,b\n1,2'), ',')
  // 空表 → null
  assert.equal(parseCsv('   \n  '), null)
})

test('4.2 数值收口：千分位 / % 按比例 / 文本不猜数', async () => {
  const { coerceNumber } = await import('../lib/csv-parse.js')
  assert.equal(coerceNumber('1,234'), 1234)
  assert.equal(coerceNumber(' 45.1 '), 45.1)
  assert.equal(coerceNumber('76%'), 0.76)
  assert.equal(coerceNumber('-3.5'), -3.5)
  assert.equal(coerceNumber('Q1'), null)
  assert.equal(coerceNumber(''), null)
  assert.equal(coerceNumber('1.2.3'), null)
})

test('4.2 建议：value 列取数值占比最高 + limit 截断 + 全 0 拒荐', async () => {
  const { parseCsv, suggestChartData } = await import('../lib/csv-parse.js')
  const t = parseCsv('月份,销售额,备注\n1月,120,上线\n2月,340,活动\n3月,280,回调\n')
  const s = suggestChartData(t, 12)
  assert.equal(s?.labelColumn, '月份')
  assert.equal(s?.valueColumn, '销售额')
  assert.deepEqual(s?.labels, ['1月', '2月', '3月'])
  assert.deepEqual(s?.values, [120, 340, 280])
  assert.equal(s?.truncated, false)
  // 截断：limit=2 → 只取前两行并标记
  const s2 = suggestChartData(t, 2)
  assert.equal(s2?.labels.length, 2)
  assert.equal(s2?.truncated, true)
  // 全 0 / 无数值列 → null
  const zero = parseCsv('月份,值\n1月,0\n2月,0\n')
  assert.equal(suggestChartData(zero, 12), null)
  const text = parseCsv('名称,说明\n甲,好\n乙,差\n')
  assert.equal(suggestChartData(text, 12), null)
})

test('4.2 注册面：import_csv 进全量名单 + presentation A 档 + 零后端槽清单', () => {
  // 名单守卫（tool-registry）自己锁数量与集合，这里锁三处账面同步：
  const registry = srcOf('tests/tool-registry.test.mjs')
  assert.ok(registry.includes("'import_csv'"), 'tool-registry 名单必须含 import_csv')
  assert.ok(registry.includes('43 → 44'), '计数注释必须登记 43 → 44')
  const presentation = srcOf('src/tool-presentation.ts')
  assert.match(presentation, /import_csv: \{ tier: 'A', title: 'CSV 导入', icon: '表' \}/)
  const toolchain = srcOf('skills/canvas-studio-creation/references/toolchain.md')
  assert.ok(toolchain.includes('| import_csv |'), 'toolchain.md 必须有 import_csv 行')
  assert.ok(toolchain.includes('`import_csv`（`download_video`'), '不受约束清单必须含 import_csv')
})
