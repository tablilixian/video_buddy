/**
 * P1-1 守卫：**卡解析规则表必须与注册表同步**（REQ-038 R11 二轮）。
 *
 * 抓的是什么：真机二轮 34 次源码探查里 12 次在问「copy 到底怎么拆」，因为
 * 卡目录只给「用不用」的形态标签，还把 DAT3 的 `键:值` 二级解析误判成「多行」
 * ⇒ 模型按目录写 `买入\n卖出` 拿到自动编号而不是 99/101。
 *
 * 五条断言：
 * 1. 磁盘上的生成物 === 现跑脚本的输出（漂移即红）。
 * 2. 覆盖完整：58 张一张不漏 + 表格列数健全（分隔符名里混进 ASCII 竖线会打断
 *    markdown 列 —— 实测踩过：`竖线|` 把 B1 的 dataSource 列挤到错位）。
 * 3. **DAT3 回归断言**：解析规则必须是 `键:值`（冒号拆 k/v + labels+values），
 *    不得再出现「多行」判词 —— 这正是让模型回源码的那条假信息。
 * 4. **反向变异**：临时注册一张 `键:值` 卡，生成物必须出现对应规则
 *    （证明确实是探测产物，不是硬编码）。
 * 5. 体积闸：references 要克制（与卡目录同量级）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderCardRules, OUTPUT } from '../scripts/gen-card-rules.mjs'
import { registeredCardIds, registerCard } from '../lib/remotion/recipe-cards-all.js'

test('卡解析规则表与注册表一致（改了卡的 generate 必须重跑 gen-card-rules.mjs）', () => {
  assert.equal(
    readFileSync(OUTPUT, 'utf8'),
    renderCardRules(),
    '生成物与注册表不一致 —— 跑 `yarn build && node scripts/gen-card-rules.mjs` 后一起提交。',
  )
})

test('覆盖完整：58 张一张不漏，且每行列数一致（ASCII 竖线混进单元格会打断 markdown 表）', () => {
  const text = readFileSync(OUTPUT, 'utf8')
  const missing = registeredCardIds().filter((id) => !new RegExp(`^\\| ${id} \\|`, 'mu').test(text))
  assert.deepEqual(missing, [], `规则表缺卡：${missing.join(', ')}`)
  const fieldCounts = new Set(
    text.split('\n').filter((line) => /^\| [A-Z]+\d+ \|/u.test(line)).map((line) => line.split('|').length),
  )
  assert.deepEqual([...fieldCounts], [9], `行内字段数不一致（${[...fieldCounts].join(', ')}）：单元格里的 | 必须转义或改名（D5 后应为 7 列 = 9 段）`)
})

test('D5 新列：表头含「data 键」且列口径有说明（缺列 = data 通道对模型不可见）', () => {
  const text = readFileSync(OUTPUT, 'utf8')
  assert.match(text, /\| 卡 \| copy 解析规则 \| label \| highlights \| dataSource \| data 键 \| 同义卡 \|/u, '表头缺 data 键列')
  assert.match(text, /data 键\*\*（D5）/u, '列口径缺 data 键说明')
})

test('DAT3 回归：解析规则必须是「键:值」拆 k/v，不得退回「多行」假信息', () => {
  const row = readFileSync(OUTPUT, 'utf8').split('\n').find((line) => line.startsWith('| DAT3 '))
  assert.ok(row, 'DAT3 行不存在')
  assert.match(row, /键:值/, `DAT3 的解析规则应是「键:值」（实际：${row}）——「多行」标签让模型把 买入\\n卖出 当两行文字，真值 99/101 全丢`)
  assert.match(row, /labels\+values/, `DAT3 的去向应含 labels+values（实际：${row}）`)
})

test('反向变异：临时注册一张「键:值」卡，生成物必须出现对应解析规则', () => {
  registerCard({
    id: 'TYP9',
    title: '临时解析探针卡',
    assets: [],
    // D5：顺带验证 dataKeys → 规则表列的管道（声明什么，列里就有什么）。
    dataKeys: ['probeRadius', 'probePeriod'],
    generate: (ctx) => [
      {
        id: `${ctx.segmentId}-chart`,
        type: 'chart',
        variant: 'bars',
        labels: ctx.copy.split(/[;;\n]/).map((line) => line.split(':')[0].trim()),
        values: ctx.copy.split(/[;;\n]/).map((line) => Number(line.split(':')[1]) || 1),
        box: { x: 50, y: 50, w: 70, h: 40 },
        startFrame: ctx.startFrame,
        durationInFrames: ctx.durationInFrames,
        fadeFrames: 0,
      },
    ],
  })
  const row = renderCardRules().split('\n').find((line) => line.startsWith('| TYP9 '))
  assert.ok(row, '新注册的卡没出现在规则表里（硬编码的表 = 下一个漂移源头）')
  assert.match(row, /键:值/, `探针卡的规则应是「键:值」（实际：${row}）—— 规则必须是探测产物`)
  assert.match(row, /probeRadius probePeriod/u, `TYP9 行缺 data 键列内容（实际：${row}）—— dataKeys 声明必须进规则表`)
})

test('体积闸：解析规则表不得超过 14KB（references 体积要克制，塞进动效参数就破闸）', () => {
  const size = readFileSync(OUTPUT, 'utf8').length
  assert.ok(size < 14_000, `生成物 ${size} 字符 —— 超闸说明列设计失控`)
})
