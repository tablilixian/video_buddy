#!/usr/bin/env node
/**
 * 效果测试归集脚本：把散落在各项目目录的效果测试报告汇集进仓库文档。
 *
 * 用法：node scripts/collect-effect-tests.mjs <assetsRoot>
 *   <assetsRoot> = 设置页「资产库位置」（其下 projects/<项目名>/ 含 canvas.json 与 效果测试报告.md）
 *
 * 行为：
 *   1. 扫描 <assetsRoot> 下 projects 目录中每个项目的「效果测试报告.md」
 *   2. 报告逐份复制到 docs/effect-tests/runs/<项目名>/效果测试报告.md（覆盖旧版，报告是追加式全量文件）
 *   3. 从每份报告提取「轮次记录表待粘贴行」，按 轮次+用例 去重后自动追加到轮次记录表（已存在则跳过）
 *   4. 打印归集摘要；不删除/不改写任何项目目录内容
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RUNS_DIR = join(REPO_ROOT, 'docs', 'effect-tests', 'runs')
const RECORD_DOC = join(REPO_ROOT, 'docs', 'effect-tests', '视频效果验证测试用例与轮次记录.md')

const assetsRoot = process.argv[2]
if (!assetsRoot) {
  console.error('用法：node scripts/collect-effect-tests.mjs <assetsRoot>（设置页「资产库位置」路径）')
  process.exit(1)
}
const projectsDir = join(resolve(assetsRoot), 'projects')
if (!existsSync(projectsDir)) {
  console.error(`projects 目录不存在：${projectsDir}`)
  process.exit(1)
}

/** 从报告中提取待粘贴行（去掉反引号），返回 `{ key, row }` 数组。 */
function extractRows(reportText) {
  const rows = []
  for (const match of reportText.matchAll(/`(R\d+ \|[^`]+)`/gu)) {
    const row = match[1].trim()
    const cells = row.split('|').map((c) => c.trim())
    // key = 轮次 + 用例（第 1、5 列），如 "R001:T1(+T2)"
    const key = `${cells[0]}:${cells[4] ?? ''}`
    rows.push({ key, row })
  }
  return rows
}

/** 读轮次记录表中已有的行 key 集合。 */
function existingKeys(docText) {
  const keys = new Set()
  for (const line of docText.split(/\r?\n/)) {
    if (!line.startsWith('| R')) continue
    const cells = line.split('|').map((c) => c.trim())
    if (cells.length > 4) keys.add(`${cells[1]}:${cells[5] ?? ''}`)
  }
  return keys
}

const projects = readdirSync(projectsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)

let copied = 0
let appended = 0
const skipped = []

for (const name of projects) {
  const reportPath = join(projectsDir, name, '效果测试报告.md')
  if (!existsSync(reportPath)) continue

  // 1) 汇集报告
  const destDir = join(RUNS_DIR, name)
  mkdirSync(destDir, { recursive: true })
  copyFileSync(reportPath, join(destDir, '效果测试报告.md'))
  copied += 1

  // 2) 提取并追加轮次表行
  const reportText = readFileSync(reportPath, 'utf8')
  const docText = readFileSync(RECORD_DOC, 'utf8')
  const have = existingKeys(docText)
  const missing = extractRows(reportText).filter((r) => !have.has(r.key))
  if (missing.length === 0) {
    skipped.push(`${name}（轮次行已存在）`)
    continue
  }
  // 追加到最后一个表格行之后（保持「> 填写示例」引用块在表尾之后）
  const lines = docText.split(/\r?\n/)
  let lastTableRow = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith('| R')) lastTableRow = i
  }
  if (lastTableRow === -1) {
    console.error('轮次记录表中未找到数据行锚点，跳过追加')
    skipped.push(`${name}（表格锚点缺失）`)
    continue
  }
  const insert = missing.map((r) => `| ${r.row} |`)
  lines.splice(lastTableRow + 1, 0, ...insert)
  writeFileSync(RECORD_DOC, lines.join('\n'))
  appended += missing.length
  console.log(`+ ${name}：追加 ${missing.length} 行（${missing.map((r) => r.key).join(', ')}）`)
}

console.log(`\n归集完成：报告 ${copied} 份 → docs/effect-tests/runs/；新增轮次行 ${appended} 条${skipped.length ? `；跳过：${skipped.join('、')}` : ''}`)
