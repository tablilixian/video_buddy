/**
 * REQ-022 · 版本历史纯函数的判定测试（`storyboard-history.ts`）。
 *
 * 这一层是「不丢数据」的实现载体，错的方式只有一种但很贵：**把引用当快照**。
 * 一旦 `history[].snapshot` 与活副本共享同一个对象，之后任何一次活副本改动都会
 * 「顺带」改掉历史 —— 表现是「版本对比永远显示无差异」，而且历史内容被静默篡改。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { archive, latestVersion, nextVersionId, relabel, restoreTo, versionById } from '../lib/storyboard-history.js'
import { createStoryboard, emptyStoryboardSections } from '../lib/contracts/storyboard.js'

/** 造一份「已有一版」的仓库（v1 初稿，baseline=v1）。 */
function versionsWithOne() {
  const doc = createStoryboard({
    projectId: 'p1',
    title: '《雨夜来信》',
    meta: { genre: '民国悬疑', targetDuration: 30, aspect: '16:9' },
    sections: emptyStoryboardSections(),
  })
  return doc.versions
}

function sectionsWithBrief(brief) {
  return { ...emptyStoryboardSections(), '00_creative': { brief } }
}

test('nextVersionId：单调递增，只增不减', () => {
  const versions = versionsWithOne()
  assert.equal(nextVersionId(versions), 'v2')
  const after = archive(versions, sectionsWithBrief('a'), { kind: 'manual', label: '存档 v2', now: 1 })
  assert.equal(after.seq, 2)
  assert.equal(nextVersionId(after), 'v3')
})

test('archive：新版本带 kind / label / parent，baseline 前进', () => {
  const versions = versionsWithOne()
  const next = archive(versions, sectionsWithBrief('把开场改成黄昏'), { kind: 'manual', label: '黄昏版', note: '改 S1', now: 42 })
  assert.equal(next.history.length, 2)
  const latest = latestVersion(next)
  assert.equal(latest.version, 'v2')
  assert.equal(latest.kind, 'manual')
  assert.equal(latest.label, '黄昏版')
  assert.equal(latest.note, '改 S1')
  assert.equal(latest.parent, 'v1')
  assert.equal(latest.createdAt, 42)
  assert.equal(next.baseline, 'v2')
  assert.equal(versions.history.length, 1, '不得原地改旧仓库（纯函数）')
})

test('archive 的快照是深拷贝：之后改活副本不影响历史', () => {
  const versions = versionsWithOne()
  const live = sectionsWithBrief('原始内容')
  const next = archive(versions, live, { kind: 'manual', label: '存档 v2', now: 1 })
  // 模拟「活副本继续被 agent 改写」——这是分次写的常态。
  live['00_creative'] = { brief: '被改掉的内容' }
  assert.equal(
    versionById(next, 'v2').snapshot['00_creative'].brief,
    '原始内容',
    '历史快照与活副本共享了引用 ⇒ 版本对比会永远显示「无差异」',
  )
})

test('restoreTo：先打点当前活副本，再覆盖为目标版内容', () => {
  const versions = versionsWithOne()
  const afterArchive = archive(versions, sectionsWithBrief('第二版内容'), { kind: 'manual', label: '存档 v2', now: 1 })
  const result = restoreTo(afterArchive, sectionsWithBrief('第三版（将被回退掉）'), 'v2', 99)
  assert.ok(result !== undefined)
  // ① 回退前的内容被保住了（这是「不丢数据」的核心）
  assert.equal(afterArchive.history.length + 1, result.versions.history.length)
  assert.deepEqual(result.versions.history.at(-1).label, '回退前存档')
  assert.equal(result.versions.history.at(-1).kind, 'auto')
  assert.equal(result.versions.history.at(-1).snapshot['00_creative'].brief, '第三版（将被回退掉）')
  // ② 活副本变成目标版内容
  assert.equal(result.sections['00_creative'].brief, '第二版内容')
  // ③ baseline 指回**目标版**（回答「活副本派生自哪一版」）
  assert.equal(result.versions.baseline, 'v2')
})

test('restoreTo：目标版不存在 → undefined（调用方据此报错，不猜）', () => {
  assert.equal(restoreTo(versionsWithOne(), sectionsWithBrief('x'), 'v9'), undefined)
})

test('restoreTo 返回的活副本与历史快照不共享引用', () => {
  const versions = versionsWithOne()
  const seeded = archive(versions, sectionsWithBrief('要回退到的内容'), { kind: 'manual', label: '存档 v2', now: 1 })
  const result = restoreTo(seeded, sectionsWithBrief('当前'), 'v2', 2)
  result.sections['00_creative'] = { brief: '回退后又改了' }
  assert.equal(
    versionById(result.versions, 'v2').snapshot['00_creative'].brief,
    '要回退到的内容',
    '回退后的活副本与历史共享引用 ⇒ 后续编辑会篡改历史',
  )
})

test('relabel：只动名字与备注，版本号与内容都不变', () => {
  const versions = versionsWithOne()
  const after = relabel(versions, 'v1', '正式初稿', '开拍前定稿')
  assert.equal(after.history[0].label, '正式初稿')
  assert.equal(after.history[0].note, '开拍前定稿')
  assert.equal(after.history[0].version, 'v1')
  assert.deepEqual(after.history[0].snapshot, versions.history[0].snapshot)
  assert.equal(after.seq, versions.seq)
  assert.equal(after.baseline, versions.baseline)
  assert.equal(relabel(versions, 'v9', 'x'), undefined)
})
