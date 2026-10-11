/**
 * REQ-022（CV-295a）seed 投影的判定测试。
 *
 * seed 是 req3「干净落地」与 req4「拆分落节点」的落点，错的方式都很贵：
 * - **带进了历史**（版本历史 / 待核实项混进画布）→ 违反 req3，且会污染 agent 上下文；
 * - **镜号重排** → 素材组与产物命名（`分镜 N · 关键帧`）全线孤儿，用户已生成的视频失去归属；
 * - **占位节点塞 generationPrompt** → 该字段全库语义是「JSON 编码的请求参数」，
 *   节点重放与 auto-test-checkpoints 断言会同时读错。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planSeedFromStoryboard } from '../lib/storyboard-seed.js'
import { createStoryboard, emptyStoryboardSections } from '../lib/contracts/storyboard.js'
import { SEED_ANCHOR_TOOL, SEED_SHOT_TOOL, isShotCard } from '../lib/contracts/canvas.js'

/** 可复现 id 序列。 */
function seqIds() {
  let n = 0
  return () => `id-${String(++n)}`
}

function sectionsWithShots(shotCount) {
  const shots = Array.from({ length: shotCount }, (_, i) => ({
    id: `S1-Sh${String(i + 1)}`,
    duration: 2.5,
    frames: 60,
    camera: 'Push in',
    visual: `画面 ${String(i + 1)}`,
    audio: '雨声',
    promptEn: `prompt ${String(i + 1)}`,
    backup: false,
  }))
  return {
    ...emptyStoryboardSections(),
    '00_creative': { brief: '雨夜的一封信' },
    '01_facts': { facts: [
      { claim: '已核实的事实', source: 'https://ok', status: 'verified' },
      { claim: '待核实的事实', source: '', status: 'pending' },
    ] },
    '02_visual': { tokens: [{ k: '色彩', v: '青灰冷调' }, { k: '节奏', v: '文戏 2.5s' }] },
    '03_narration': { lines: [{ id: 'V1', text: '那封信比雨更冷', duration: 3.2, shotRef: 'S1-Sh1' }] },
    '04_storyboard': { scenes: [{ id: 'S1', title: '开场', shots }] },
    '05_characters': [{
      id: 'C1', label: 'ROLE A', name: '苏婉', tags: ['女'],
      profile: { temperament: '静', face: '鹅蛋脸', costume: '月白旗袍' },
      palette: { base: 'warm ivory', accent: '暗红' },
      appearsIn: ['S1'],
      gen: { lockedPrompt: '26-year-old chinese woman', negativePrompt: '不改五官' },
    }],
    '06_sound': { bgm: { bpm: 52, lufs: -16, sidechain: '1.5–3kHz' }, sfx: ['雨声床'] },
    '08_constraints': ['一个 shot 只允许一个运镜动词'],
  }
}

function plan(shotCount = 3, options = {}) {
  const doc = createStoryboard({
    projectId: 'p1',
    title: '《雨夜来信》',
    meta: { genre: '民国悬疑', targetDuration: 30, aspect: '16:9' },
    sections: sectionsWithShots(shotCount),
  })
  return planSeedFromStoryboard(doc, { newId: seqIds(), now: 1000, sourceVersion: 'v2', ...options })
}

test('锚点节点：toolName 是锚点值、无 sbRef、血缘可挂创意', () => {
  const { nodes } = plan(3, { briefNodeId: 'brief-1' })
  const anchor = nodes.find((n) => n.toolName === SEED_ANCHOR_TOOL)
  assert.ok(anchor !== undefined, '必须落锚点文档节点')
  assert.equal(anchor.kind, 'text')
  assert.equal(anchor.sbRef, undefined, '锚点是只读投影，不带 sbRef')
  assert.deepEqual(anchor.sourceIds, ['brief-1'], '锚点血缘指向创意节点')
  assert.ok(anchor.title.includes('v2'), '标题要带落地版本')
  assert.ok(anchor.text.includes('【参数】'))
  assert.ok(anchor.text.includes('【创意】'))
  assert.ok(anchor.text.includes('已核实的事实'), '已验证事实并入锚点')
})

test('干净落地：§01 待核实项不落画布（req3）', () => {
  const { nodes } = plan()
  const anchor = nodes.find((n) => n.toolName === SEED_ANCHOR_TOOL)
  assert.ok(!anchor.text.includes('待核实的事实'), 'pending 项必须被丢弃，不得带进画布')
})

test('分镜卡 ×N：镜号一次铸造成 1..N，且不重排', () => {
  const { nodes, shotNumbers } = plan(3)
  const cards = nodes.filter((n) => n.toolName === SEED_SHOT_TOOL)
  assert.equal(cards.length, 3)
  assert.deepEqual([...shotNumbers], [1, 2, 3])
  assert.ok(cards.every((card) => isShotCard(card)), 'seed 卡必须被 isShotCard 认作分镜卡')
  assert.deepEqual(
    cards.map((card) => card.title),
    ['分镜 1 · S1-Sh1 · Push in', '分镜 2 · S1-Sh2 · Push in', '分镜 3 · S1-Sh3 · Push in'],
  )
})

test('分镜卡：operationType / declared* / sourceIds→锚点 / sbRef 齐备', () => {
  const { nodes } = plan(2)
  const anchor = nodes.find((n) => n.toolName === SEED_ANCHOR_TOOL)
  const card = nodes.find((n) => n.toolName === SEED_SHOT_TOOL)
  assert.equal(card.operationType, 'storyboard')
  assert.equal(card.declaredDuration, 2.5)
  assert.equal(card.declaredFrames, 60)
  assert.deepEqual(card.sourceIds, [anchor.id], '分镜卡血缘指向锚点（剧本门下线后链改：卡→锚点→创意）')
  assert.equal(card.sbRef, '04:S1/shots/S1-Sh1')
})

test('分镜卡正文带稳定字段标签（供将来 L 类回写反向解析）', () => {
  const { nodes } = plan(1)
  const card = nodes.find((n) => n.toolName === SEED_SHOT_TOOL)
  for (const label of ['【镜 1】', '【运镜】', '【声音】', '【英文 prompt】']) {
    assert.ok(card.text.includes(label), `卡正文缺少稳定标签 ${label}`)
  }
})

test('§02 tokens → style 资产卡（lockedPrompt 按 k：v 拼接，sbRef=02:look）', () => {
  const { assets } = plan()
  const style = assets.find((asset) => asset.role === 'style')
  assert.ok(style !== undefined)
  assert.equal(style.sbRef, '02:look')
  assert.equal(style.lockedPrompt, '色彩：青灰冷调\n节奏：文戏 2.5s')
  assert.deepEqual(style.anchorNodeIds, [], 'seed 不预生成样张，锚点留空由执行期补')
})

test('§05 → character 资产卡 + 占位图节点，且占位节点不带 generationPrompt', () => {
  const { nodes, assets } = plan()
  const character = assets.find((asset) => asset.role === 'character')
  assert.ok(character !== undefined)
  assert.equal(character.sbRef, '05:C1')
  assert.equal(character.lockedPrompt, '26-year-old chinese woman')
  assert.equal(character.negativePrompt, '不改五官')

  const placeholder = nodes.find((node) => node.operationType === 'character-sheet')
  assert.ok(placeholder !== undefined, '必须落占位角色图节点（agent 据此调 character_sheet）')
  assert.deepEqual(character.anchorNodeIds, [placeholder.id], '资产卡锚点指向占位节点')
  assert.equal(placeholder.assetId, character.id)
  assert.equal(placeholder.sbRef, '05:C1')
  assert.equal(
    placeholder.generationPrompt,
    undefined,
    'generationPrompt 的全库语义是 JSON 请求参数——塞裸文本会让重放与自动测试断言同时读错',
  )
  assert.ok(placeholder.title.includes('待生成'), '占位语义写在标题里')
})

test('§03 + §06 → 旁白与声音参数节点（sbRef=03）', () => {
  const { nodes } = plan()
  const sound = nodes.find((node) => node.sbRef === '03')
  assert.ok(sound !== undefined)
  assert.equal(sound.kind, 'text')
  assert.ok(sound.text.includes('V1'))
  assert.ok(sound.text.includes('-16 LUFS'))
  assert.ok(sound.text.includes('雨声床'))
})

test('§08 硬约束不落节点（走纪律注入而不进画布）', () => {
  const { nodes } = plan()
  assert.ok(!nodes.some((node) => node.text?.includes('一个 shot 只允许一个运镜动词')), '硬约束不得落成节点')
})

test('§07 素材不造新节点（上传时参考节点已落，seed 只校验引用）', () => {
  const { nodes } = plan()
  assert.ok(!nodes.some((node) => node.kind === 'image' && node.operationType === undefined), '不得为素材造裸图片节点')
})

test('空分镜也能 seed（不抛，只落锚点与资产）', () => {
  const doc = createStoryboard({
    projectId: 'p1',
    title: '《空》',
    meta: { genre: 'x', targetDuration: 10, aspect: '16:9' },
    sections: emptyStoryboardSections(),
  })
  const result = planSeedFromStoryboard(doc, { newId: seqIds(), now: 1 })
  assert.equal(result.shotNumbers.length, 0)
  assert.equal(result.nodes.filter((n) => n.toolName === SEED_SHOT_TOOL).length, 0)
  assert.ok(result.nodes.some((n) => n.toolName === SEED_ANCHOR_TOOL))
})
