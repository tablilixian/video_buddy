/**
 * CV-374：风格库分册守卫（`style-library.md` = 预设出口的纯知识扩展层）。
 *
 * ## 为什么有这道门
 *
 * 风格库是**内容资产**：30 行风格靠人手工维护，没有任何类型系统可拦。它最容易
 * 腐烂的四种方式，各钉一条：
 *
 * 1. **静默增删行**——头部声明的条数与表内实际行数对账，漏改计数即红；
 * 2. **行写残**——4 列齐全、Look tokens 五项字段齐全且顺序固定（缺一项，
 *    `look_card` 落卡后逐镜注入就少一维，且没人知道少的是哪一维）；
 * 3. **三张风格表撞名**——本册 / `style-presets.md` 11 条成片预设 /
 *    `src/visual-styles.ts` 12 条视觉风格。撞名会让 agent 与用户都在问
 *    「这说的是哪一层」（CV-288 D1 已为两表立过零重名，本册是第三张表）；
 * 4. **接线掉链**——预设出口、澄清 ②-3、总纲分册一览、look 回退四处任一
 *    不再点名本册，模型就读不到它（分册存在但没人指 = 等于不存在）。
 *
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VISUAL_STYLES } from '../lib/visual-styles.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SKILL_DIR = join(ROOT, 'skills', 'canvas-studio-creation')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

const LIB_MD = read('skills/canvas-studio-creation/references/style-library.md')
const PRESETS_MD = read('skills/canvas-studio-creation/references/style-presets.md')

/** 解析风格库 §3 表：4 列内容行（跳过表头与分隔行）。 */
function parseLibraryRows() {
  const section = LIB_MD.split(/^## 3\./m)[1]?.split(/^## 4\./m)[0] ?? ''
  return section
    .split('\n')
    .filter((line) => line.startsWith('| ') && !line.includes(' --- '))
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 6 && cells[1] !== '' && cells[1] !== '风格')
}

/** 解析 style-presets.md 预设表首列（与 style-grid / visual-styles 同口径）。 */
function parsePresetNames() {
  return PRESETS_MD.split('\n')
    .filter((line) => line.startsWith('| ') && !line.includes(' --- '))
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 5 && cells[1] !== '预设' && cells[1] !== '')
    .map((cells) => cells[1])
}

test('CV-374：头部声明条数与表内实际行数一致（静默增删行即红）', () => {
  const claim = LIB_MD.match(/(\d+)\s*条纯知识风格行/u)
  assert.ok(claim, '头部缺少「N 条纯知识风格行」声明')
  const rows = parseLibraryRows()
  assert.equal(
    rows.length,
    Number(claim[1]),
    `头部声明 ${claim[1]} 条，表内实得 ${rows.length} 条 —— 增删行必须同步改头部计数`,
  )
  assert.ok(rows.length >= 30, '风格库不得低于 30 条（扩容只增不减）')
})

test('CV-374：每行 4 列齐全，Look tokens 五项字段齐全且顺序固定', () => {
  const keys = ['色彩：', '光线：', '材质：', '镜头语汇：', '节奏：']
  for (const cells of parseLibraryRows()) {
    const [name, usage, tokens, styleNote] = [cells[1], cells[2], cells[3], cells[4]]
    assert.ok(usage, `${name} 缺「适用」列`)
    assert.ok(styleNote, `${name} 缺「风格段与镜头要点」列`)
    let cursor = -1
    for (const key of keys) {
      const at = tokens.indexOf(key)
      assert.ok(at > cursor, `${name} 的 tokens 缺或乱序「${key}」`)
      cursor = at
    }
    assert.ok(!name.includes('|'), `${name} 名含竖线会破表`)
  }
})

test('CV-374：三张风格表零重名（风格库 / 成片预设 / 视觉风格）', () => {
  const rows = parseLibraryRows()
  const names = rows.map((cells) => cells[1])
  assert.equal(new Set(names).size, names.length, '风格库内部有重名行')

  const presetNames = new Set(parsePresetNames())
  assert.ok(presetNames.size >= 11, `只解析到 ${presetNames.size} 条预设，口径坏了`)
  for (const name of names) {
    assert.ok(!presetNames.has(name), `风格库「${name}」与成片预设重名（两层不同载体，撞了会迷惑）`)
  }

  const visualNames = new Set(VISUAL_STYLES.map((s) => s.name))
  assert.ok(visualNames.size >= 12, '视觉风格表解析口径坏了')
  for (const name of names) {
    assert.ok(!visualNames.has(name), `风格库「${name}」与画布视觉风格重名（那是单张图的前缀层）`)
  }
})

test('CV-374：接线在场 —— 预设出口 / 澄清 ②-3 / 总纲分册一览 / look 回退都点名本册', () => {
  assert.ok(
    PRESETS_MD.includes('style-library.md'),
    'style-presets.md 必须给出扩展层指针（预设没命中时模型才知道往下读哪）',
  )
  const skill = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8')
  assert.ok(skill.includes('style-library.md'), '总纲分册一览必须点名 style-library.md')
  const clarification = readFileSync(join(SKILL_DIR, 'references', 'clarification.md'), 'utf8')
  assert.ok(clarification.includes('style-library.md'), '澄清 ②-3 出口必须点名 style-library.md')
  const look = readFileSync(join(SKILL_DIR, 'references', 'look.md'), 'utf8')
  assert.ok(
    look.includes('style-library.md'),
    'look.md §9.3 必须点名 style-library.md（出口路径的落卡口径在这里收口）',
  )
})
