/**
 * CV-296：`write_storyboard` **分节合并**语义 —— 没传 = 保留现值；传了 = 替换该节。
 *
 * 修复的缺陷：此前每次调用都整体替换 `sections`，而 skill 又叫模型「分次写」
 * （第一笔 meta+creative+visual、第二笔 storyboard……）—— 后一笔会把没传的节
 * 静默清空（实证：射雕项目 v1 已填 §00，落地前固化版被冲成空）。
 * 本测试钉住合并语义，反向变异靶子 = `mergeStoryboardWrite` 里
 * `input[key] !== undefined ? input[key] : current?.sections[key]` 的保留分支。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { STORYBOARD_SECTION_KEYS, mergeStoryboardWrite, normalizeStoryboard } from '../lib/contracts/storyboard.js'

/** 造一份「第一笔已写」的现文档切片（模拟 skill 分次写的第一笔：meta+creative+visual）。 */
function currentDoc() {
  return normalizeStoryboard({
    projectId: 'p1',
    title: '雨夜来信',
    meta: { genre: '民国悬疑', targetDuration: 30, aspect: '16:9' },
    sections: {
      '00_creative': { brief: '雨夜码头的诀别戏，冬季，江南。' },
      '02_visual': { tokens: [{ k: '色彩', v: '青灰' }] },
    },
  })
}

test('分节合并：第二笔只传 storyboard，§00/§02 与 title/meta 全部保留', () => {
  const merged = mergeStoryboardWrite(currentDoc(), {
    '04_storyboard': { scenes: [{ id: 'S1', title: '开场', shots: [] }] },
  })
  const normalized = normalizeStoryboard({ projectId: 'p1', ...merged })
  assert.ok(normalized, '归一化必须成功')
  assert.equal(normalized.title, '雨夜来信', 'title 未传 → 保留')
  assert.equal(normalized.meta.genre, '民国悬疑', 'meta 未传 → 保留')
  assert.equal(normalized.sections['00_creative'].brief, '雨夜码头的诀别戏，冬季，江南。', '§00 未传 → 保留（旧语义会被冲成空）')
  assert.equal(normalized.sections['02_visual'].tokens[0]?.v, '青灰', '§02 未传 → 保留')
  assert.equal(normalized.sections['04_storyboard'].scenes.length, 1, '传了的节替换')
  for (const key of ['01_facts', '03_narration', '05_characters', '06_sound', '07_assets', '08_constraints']) {
    assert.deepEqual(normalized.sections[key], normalizeStoryboard({ projectId: 'p1', sections: {} })?.sections[key], `${key} 未传 → 归一化空值`)
  }
})

test('分节合并：显式传空 = 清空该节（整体重写的清除路径仍在）', () => {
  const merged = mergeStoryboardWrite(currentDoc(), { '00_creative': { brief: '' } })
  const normalized = normalizeStoryboard({ projectId: 'p1', ...merged })
  assert.equal(normalized?.sections['00_creative'].brief, '', '显式空值 → 清空')
  assert.equal(normalized?.sections['02_visual'].tokens[0]?.v, '青灰', '其他节不受影响')
})

test('分节合并：整体重写 = 九节全传（全部替换，无残留）', () => {
  const allSections = Object.fromEntries(STORYBOARD_SECTION_KEYS.map((key) => [key, key === '05_characters' ? [] : {}]))
  const merged = mergeStoryboardWrite(currentDoc(), { title: '新片名', meta: {}, ...allSections })
  const normalized = normalizeStoryboard({ projectId: 'p1', ...merged })
  assert.equal(normalized?.title, '新片名')
  assert.equal(normalized?.sections['00_creative'].brief, '', '全传时空 brief 覆盖旧值')
  assert.equal(normalized?.sections['04_storyboard'].scenes.length, 0)
})

test('首稿（无现文档）：缺省节给归一化空值，行为与旧首稿一致', () => {
  const merged = mergeStoryboardWrite(undefined, {
    title: '初稿',
    meta: { genre: '广告', targetDuration: 15, aspect: '9:16' },
    '00_creative': { brief: '一句话' },
  })
  const normalized = normalizeStoryboard({ projectId: 'p1', ...merged })
  assert.ok(normalized)
  assert.equal(normalized.sections['00_creative'].brief, '一句话')
  assert.deepEqual(normalized.sections['01_facts'], { facts: [] })
  assert.deepEqual(normalized.sections['04_storyboard'], { scenes: [] })
  assert.deepEqual(normalized.sections['08_constraints'], [])
})

test('九节键集完整：键数 = 9 且与节序一致（防键集漂移）', () => {
  assert.deepEqual(
    [...STORYBOARD_SECTION_KEYS],
    ['00_creative', '01_facts', '02_visual', '03_narration', '04_storyboard', '05_characters', '06_sound', '07_assets', '08_constraints'],
  )
})
