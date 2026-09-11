/**
 * CV-151：风格 GIF 网格判定 + 预设 tokens 三方对账。
 *
 * 覆盖：STYLE_DEMO_MAP ↔ style-presets.md 预设表首列逐字对账（CV-116 四处联动的
 * 两处自动化防漂移）/ MAP 值都在 skill-catalog 里（demo 单点真相）/ 匹配函数
 * 精确与宽松行为 / shouldRenderStyleGrid 收紧规则（Look 采集类问题不误入网格、
 * 网格内兜底选项不丢）/ 预设表 tokens 列 5 项齐全。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STYLE_DEMO_MAP, shouldRenderStyleGrid, styleDemoSkill } from '../lib/style-grid.js'
import { getSkillEntry } from '../lib/skill-catalog.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PRESETS_MD = readFileSync(
  join(ROOT, 'skills-local', 'canvas-studio-creation', 'references', 'style-presets.md'),
  'utf-8',
)

/** 从 style-presets.md 预设表解析出 [预设名, tokens 单元格]（跳过表头与分隔行）。 */
function parsePresetTable() {
  return PRESETS_MD.split('\n')
    .filter(line => line.startsWith('| '))
    .filter(line => !line.includes(' --- '))
    .map(line => line.split('|').map(cell => cell.trim()))
    .filter(cells => cells.length >= 5 && cells[1] !== '预设' && cells[1] !== '')
    .map(cells => [cells[1], cells[4] ?? null])
}

test('CV-116 防漂移：STYLE_DEMO_MAP 与 style-presets.md 预设表首列逐字一致', () => {
  const rows = parsePresetTable()
  const docNames = rows.map(([name]) => name)
  assert.equal(rows.length, 11, `预设表应有 11 行，实得 ${rows.length}`)
  assert.deepEqual(
    [...docNames].sort(),
    Object.keys(STYLE_DEMO_MAP).sort(),
    '预设表首列与 STYLE_DEMO_MAP 键必须逐字一致（四处联动的两处）',
  )
})

test('MAP 值都在 skill-catalog 里且不重复（GIF demo 的单点真相）', () => {
  const values = Object.values(STYLE_DEMO_MAP)
  assert.equal(new Set(values).size, values.length, 'skill 名不得重复')
  for (const skill of values) {
    assert.ok(getSkillEntry(skill) !== null, `STYLE_DEMO_MAP 里的 ${skill} 必须存在于 catalog`)
  }
})

test('styleDemoSkill：精确 / （推荐）后缀 / 宽松变体 / 未命中', () => {
  assert.equal(styleDemoSkill('极简产品广告'), 'minimalist-product-ad-generator')
  assert.equal(styleDemoSkill('3D 动画短片（推荐）'), '3d-animation-short-generator')
  assert.equal(styleDemoSkill('3D动画短片'), '3d-animation-short-generator', '去空格宽松匹配')
  assert.equal(styleDemoSkill('极简产品广告风格'), 'minimalist-product-ad-generator', '后缀宽松匹配')
  assert.equal(styleDemoSkill('就是这个感觉'), null, '样张确认选项不得命中')
  assert.equal(styleDemoSkill('你按题材帮我定'), null)
})

test('shouldRenderStyleGrid：预设出口入网格；Look 采集类问题不误入', () => {
  const presets = Object.keys(STYLE_DEMO_MAP)
  assert.equal(shouldRenderStyleGrid(presets), true, '11 条预设全命中 → 网格')
  assert.equal(
    shouldRenderStyleGrid([...presets, '都不满意，我自己描述']),
    true,
    '预设出口 + 1 个兜底选项 → 仍入网格（兜底项改走文字按钮，不丢）',
  )
  const sampleConfirm = ['就是这个感觉', '换一批', '我来说说', '你按题材帮我定']
  assert.equal(shouldRenderStyleGrid(sampleConfirm), false, '样张确认四选项 → 文字按钮')
  assert.equal(
    shouldRenderStyleGrid([...sampleConfirm, '或直接用「东方神话视觉导演」的方向']),
    false,
    '样张确认选项顺带提到预设名（宽松命中 1 个）→ 不得误入网格（旧规则会吞掉其余选项）',
  )
  assert.equal(shouldRenderStyleGrid(['品牌宣传', '我自己描述']), false, '2 选 1 命中 → 不入网格（命中数 < 2）')
  assert.equal(shouldRenderStyleGrid(['16:9', '9:16']), false, '画幅问题 → 文字按钮')
})

test('CV-151：预设表 tokens 列 11 行齐全且 5 项字段完整', () => {
  const rows = parsePresetTable()
  assert.equal(rows.length, 11)
  for (const [name, tokens] of rows) {
    assert.ok(tokens !== null, `${name} 行应有第 4 列 Look tokens`)
    for (const key of ['色彩：', '光线：', '材质：', '镜头语汇：', '节奏：']) {
      assert.ok(tokens.includes(key), `${name} 的 tokens 缺「${key}」字段`)
    }
  }
})
