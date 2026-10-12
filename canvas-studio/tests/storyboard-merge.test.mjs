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

/**
 * 造一份「样张与逐镜效果图都已挂上」的现文档 —— 也就是 CV-309 的事故现场：
 * 出图 → Host 回写引用 → agent 再写故事板 **之前** 的那份状态。
 */
function docWithRefs() {
  const normalized = normalizeStoryboard({
    projectId: 'p1',
    title: '跑过雨幕',
    sections: {
      '02_visual': { tokens: [{ k: '色彩', v: '青蓝灰' }], lookRef: { kind: 'canvasNode', id: 'n-look' } },
      '04_storyboard': {
        scenes: [{
          id: 'S1',
          title: '冲出图书馆',
          shots: [
            { id: 'S1-Sh1', duration: 2.5, frames: 60, camera: 'Push in', visual: 'v', audio: 'a', backup: false, refImage: { kind: 'canvasNode', id: 'n-shot1' } },
            { id: 'S1-Sh2', duration: 2.5, frames: 60, camera: 'Static', visual: 'v', audio: 'a', backup: false },
          ],
        }],
      },
    },
  })
  if (normalized === undefined) throw new Error('测试夹具构造失败')
  return normalized
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

// ────────── CV-309：Host 独占的图片引用（lookRef / refImage）不被重写冲掉 ──────────
//
// 事故复盘（2026-10-12「下雨天」项目）：18:02 出基调样张 → Host 自动挂 lookRef
// （覆盖层已能看到图）→ 18:04 agent 写 `visual` 时只带 5 条 tokens → 节级替换 ⇒
// 样张从故事板上消失。扫描 9 个项目，8 个中招。反向变异靶子 = `keepHostRefs`
// （让它原样返回 input，下面三条全红）。

test('CV-309 事故回放：重写 §02（只带 tokens）不冲掉 lookRef，重传 §04 不冲掉 refImage', () => {
  const current = docWithRefs()

  // 18:04 那一笔：agent 只带 tokens 重写视觉规范
  const afterVisual = normalizeStoryboard({
    projectId: 'p1',
    ...mergeStoryboardWrite(current, {
      '02_visual': { tokens: [{ k: '色彩', v: '低饱和青蓝灰' }, { k: '节奏', v: '快' }] },
    }),
  })
  assert.equal(afterVisual?.sections['02_visual'].lookRef?.id, 'n-look', '重写 §02 必须保留 lookRef（本次事故的根因）')
  assert.equal(afterVisual?.sections['02_visual'].tokens.length, 2, '传了的 tokens 照旧替换')

  // 再重传整份分镜（逐镜效果图与 tokens 同节，同理会丢）
  const afterStoryboard = normalizeStoryboard({
    projectId: 'p1',
    ...mergeStoryboardWrite(afterVisual, {
      '04_storyboard': {
        scenes: [{
          id: 'S1',
          title: '冲出图书馆',
          shots: [
            { id: 'S1-Sh1', duration: 3, frames: 72, camera: 'Static', visual: 'v2', audio: 'a', backup: false },
            { id: 'S1-Sh2', duration: 3, frames: 72, camera: 'Static', visual: 'v', audio: 'a', backup: false },
          ],
        }],
      },
    }),
  })
  const shots = afterStoryboard?.sections['04_storyboard'].scenes[0]?.shots ?? []
  assert.equal(shots[0]?.refImage?.id, 'n-shot1', '同 id shot 重传 → refImage 保留')
  assert.equal(shots[0]?.visual, 'v2', 'agent 改的内容照旧生效（保留只针对引用字段）')
  assert.equal(shots[1]?.refImage, undefined, '本来就没有图的镜不会凭空长出引用')
  assert.equal(afterStoryboard?.sections['02_visual'].lookRef?.id, 'n-look', '§02 本次未传 → lookRef 继续保留')
})

test('CV-309 引用三值语义：缺失 = 保留、null = 清空、给对象 = 覆盖', () => {
  const current = docWithRefs()
  const kept = normalizeStoryboard({
    projectId: 'p1',
    ...mergeStoryboardWrite(current, { '02_visual': { tokens: [] } }),
  })
  assert.equal(kept?.sections['02_visual'].lookRef?.id, 'n-look', '键缺失 → 保留')
  const cleared = normalizeStoryboard({
    projectId: 'p1',
    ...mergeStoryboardWrite(current, { '02_visual': { lookRef: null } }),
  })
  assert.equal(cleared?.sections['02_visual'].lookRef, undefined, '显式 null → 清空（逃生口）')
  const replaced = normalizeStoryboard({
    projectId: 'p1',
    ...mergeStoryboardWrite(current, { '02_visual': { lookRef: { kind: 'canvasNode', id: 'n-new' } } }),
  })
  assert.equal(replaced?.sections['02_visual'].lookRef?.id, 'n-new', '给引用对象 → 覆盖（纠错通道）')
})

test('CV-309 引用跟着 shot 走：镜被删掉不复活，显式清空分镜仍生效', () => {
  const dropped = normalizeStoryboard({
    projectId: 'p1',
    ...mergeStoryboardWrite(docWithRefs(), {
      '04_storyboard': {
        scenes: [{
          id: 'S1',
          title: '冲出图书馆',
          shots: [{ id: 'S1-Sh2', duration: 2.5, frames: 60, camera: 'Static', visual: 'v', audio: 'a', backup: false }],
        }],
      },
    }),
  })
  const shots = dropped?.sections['04_storyboard'].scenes[0]?.shots ?? []
  assert.deepEqual(shots.map((shot) => shot.id), ['S1-Sh2'], '被删的镜不复活')
  assert.equal(shots[0]?.refImage, undefined, '它的效果图引用也不留孤儿')

  const emptied = normalizeStoryboard({
    projectId: 'p1',
    ...mergeStoryboardWrite(docWithRefs(), { '04_storyboard': { scenes: [] } }),
  })
  assert.equal(emptied?.sections['04_storyboard'].scenes.length, 0, '显式清空分镜仍然生效（保留不挡清除）')
})
