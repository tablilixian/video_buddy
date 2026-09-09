// CV-124：技能 chip 纯函数层——label / 模型文本 / 反查 / 菜单过滤。
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  SKILL_CHIP_GLYPH,
  filterSkillEntries,
  findSkillByChipLabel,
  formatSkillToken,
  skillChipLabel,
} from '../lib/skill-chip.js'

const SKILLS = [
  { name: 'handdrawn-live-video-generator', title: '手绘发光动画', summary: '手绘发光动画与实拍空间融合' },
  { name: 'paper-collage-explainer-generator', title: '纸拼贴科普', summary: '半调网点纸拼贴贴画动画' },
  { name: 'dual-player-game-opener', title: '双人游戏开场', summary: '双人合作游戏菜单与开场动画' },
]

// ---------------------------------------------------------------------------

test('skillChipLabel：⚡ 前缀 + 短标题，超长按码点截断，空标题落兜底', () => {
  assert.equal(skillChipLabel('手绘发光动画'), `${SKILL_CHIP_GLYPH}手绘发光动画`)
  const long = skillChipLabel('这是一个特别特别特别特别特别长的技能标题名称')
  assert.ok(long.startsWith(SKILL_CHIP_GLYPH))
  assert.ok([...long].length <= 13) // ⚡ + 12 码点
  assert.ok(long.endsWith('…'))
  assert.equal(skillChipLabel('  '), `${SKILL_CHIP_GLYPH}技能`)
})

test('formatSkillToken：与「使用」按钮历史注入的纯文本逐字一致', () => {
  assert.equal(
    formatSkillToken('handdrawn-live-video-generator', '手绘发光动画'),
    '使用技能「手绘发光动画」（handdrawn-live-video-generator）：',
  )
})

test('findSkillByChipLabel：⚡ 短标题 / 注册名 / 截断前缀都能反查', () => {
  const chip = skillChipLabel('手绘发光动画')
  assert.equal(findSkillByChipLabel(SKILLS, chip)?.name, 'handdrawn-live-video-generator')
  // 带 @ 前缀（气泡 title 形态）也能命中。
  assert.equal(findSkillByChipLabel(SKILLS, `@${chip}`)?.name, 'handdrawn-live-video-generator')
  assert.equal(findSkillByChipLabel(SKILLS, 'paper-collage-explainer-generator')?.title, '纸拼贴科普')
  // 截断标签（尾 …）走前缀匹配。
  const truncated = skillChipLabel('这是一个特别特别特别特别特别长的技能标题名称')
  assert.equal(findSkillByChipLabel(SKILLS, truncated), undefined)
  const longSkills = [{ name: 'x', title: '这是一个特别特别特别特别特别长的技能标题名称Plus' }]
  assert.equal(findSkillByChipLabel(longSkills, truncated)?.name, 'x')
  // 未命中 / 空文本。
  assert.equal(findSkillByChipLabel(SKILLS, '不存在'), undefined)
  assert.equal(findSkillByChipLabel(SKILLS, SKILL_CHIP_GLYPH), undefined)
})

test('filterSkillEntries：name / title / summary 包含匹配，空 query 全量', () => {
  assert.equal(filterSkillEntries(SKILLS, '').length, 3)
  assert.equal(filterSkillEntries(SKILLS, '手绘').length, 1)
  assert.equal(filterSkillEntries(SKILLS, 'GENERATOR').length, 2) // 两个 *-generator
  assert.deepEqual(filterSkillEntries(SKILLS, '网点').map(s => s.name), ['paper-collage-explainer-generator'])
  assert.equal(filterSkillEntries(SKILLS, '不存在').length, 0)
})
