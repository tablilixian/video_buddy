/**
 * REQ-003 Step 3 / F5：就地编辑草稿表（纯数据模块直连）。
 *
 * 草稿是「没保存的东西」，只进内存表（与 lobby-stash 的文件本体同一手法），
 * 不进 store、不落盘、不进画布契约。这里钉死它的生命周期语义。
 *
 * 运行：corepack yarn test:smoke（先 corepack yarn build —— 从 ../lib 导入）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clearEditorDrafts,
  deleteEditorDraft,
  getEditorDraft,
  hasEditorDraft,
  setEditorDraft,
} from '../lib/editor-drafts.js'

test('F5 生命周期：写入 → 读取 → 重开回填 → 显式取消丢弃 → 保存清除', () => {
  clearEditorDrafts()
  // 没有草稿时查询安全。
  assert.equal(hasEditorDraft('node-1'), false)
  assert.equal(getEditorDraft('node-1'), undefined)

  // 关闭面板（Esc / 点空白）⇒ 保留：写入一个双字段节点的草稿（音乐节点有两个提示词字段）。
  setEditorDraft('node-1', { prompt: { prompt: '改了一半的提示词', lyrics: '未写完的歌词' } })
  assert.equal(hasEditorDraft('node-1'), true)
  assert.equal(getEditorDraft('node-1')?.prompt.prompt, '改了一半的提示词')
  assert.equal(getEditorDraft('node-1')?.prompt.lyrics, '未写完的歌词')

  // 重开回填后用户改主意，显式「取消」⇒ 丢弃。
  deleteEditorDraft('node-1')
  assert.equal(hasEditorDraft('node-1'), false)

  // 再次编辑并「仅保存 / 保存并重试」成功 ⇒ 清除。
  setEditorDraft('node-1', { prompt: { prompt: '又改了一半' } })
  deleteEditorDraft('node-1')
  assert.equal(getEditorDraft('node-1'), undefined)
})

test('F5 隔离：按节点 id 分键，切项目整体清空', () => {
  clearEditorDrafts()
  setEditorDraft('node-a', { prompt: { prompt: 'A 的草稿' } })
  setEditorDraft('node-b', { prompt: { prompt: 'B 的草稿' } })
  assert.equal(getEditorDraft('node-a')?.prompt.prompt, 'A 的草稿')
  assert.equal(getEditorDraft('node-b')?.prompt.prompt, 'B 的草稿')
  // 清除一个节点不影响另一个。
  deleteEditorDraft('node-a')
  assert.equal(hasEditorDraft('node-a'), false)
  assert.equal(hasEditorDraft('node-b'), true)
  // 切换项目 ⇒ 整体清空（StudioFrame 在 projectId 变化时调用）。
  clearEditorDrafts()
  assert.equal(hasEditorDraft('node-b'), false)
})

test('F5 形状：refs 预留字段可存（方案 §4.10 的 { prompt, refs }）', () => {
  clearEditorDrafts()
  setEditorDraft('node-c', { prompt: { prompt: '正文' }, refs: ['ref-x.png', 'ref-y.png'] })
  assert.deepEqual(getEditorDraft('node-c')?.refs, ['ref-x.png', 'ref-y.png'])
  clearEditorDrafts()
})
