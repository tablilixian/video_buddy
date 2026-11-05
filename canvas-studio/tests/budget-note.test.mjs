/**
 * P2-1 max-tokens 兜底单测（降级版：不 steer，只落宿主观察 + 一次性提醒）。
 *
 * 为什么必须测：这条链路只在**真机被掐断**时才走到，平时跑一百次正常任务一次都
 * 触发不了 —— 没有单测就是纯靠运气。而它一旦静默失效，下一次 3h37m 还是会重演。
 *
 * 钉三件事：文案里的事实（T+ / 累计次数 / 进度）、提醒只出一次的信息量、
 * 落盘失败不抛（turn 已在收尾，不该再造一个错误）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NEXT_FILE, budgetGuardLine, renderBudgetNote, writeBudgetNote } from '../lib/budget-note.js'

const T0 = 1_760_000_000_000

function freshDir() {
  return mkdtempSync(join(tmpdir(), 'cs-budget-'))
}

function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // 沙箱里递归删除可能被拦；清不掉不该让测试红。
  }
}

test('NEXT.md 写事实：时间 / 该轮调用数 / 累计次数 / 当前进度', () => {
  const note = renderBudgetNote({
    now: T0 + 13 * 60_000,
    landedAt: T0,
    best: { version: 3, durationSec: 45, trackCount: 78 },
    toolCalls: 0,
    strikes: 2,
  })
  assert.ok(note.includes('max-tokens'), note)
  assert.ok(note.includes('T+13min'), note)
  assert.ok(note.includes('累计被掐断：2 次'), note)
  assert.ok(note.includes('当前最佳 v3 · 45.00s · 78 轨'), note)
  assert.ok(note.includes('scaffold_manifest({ writeTo: "build/manifest.json" })'), '必须给出下一步的具体命令')
  assert.ok(note.includes('build/PROGRESS.md'), '必须指向唯一的进度事实源')
})

test('没有 landedAt / 没有成片：如实说，不编 T+ 与版本号', () => {
  const note = renderBudgetNote({ now: T0, toolCalls: 0, strikes: 1 })
  assert.ok(note.includes('未落地'), note)
  assert.ok(note.includes('尚无成片'), note)
  assert.ok(!note.includes('T+'), '没有起点就不能凭空算 T+')
})

test('提醒行：0 调用时点明「一步没落地」，非 0 时报真实数', () => {
  const zero = budgetGuardLine({ toolCalls: 0, strikes: 1 })
  assert.ok(zero.includes('该轮 0 次工具调用'), zero)
  assert.ok(zero.includes('第 1 次'), zero)
  assert.ok(zero.includes('build/NEXT.md'), zero)
  const some = budgetGuardLine({ toolCalls: 7, strikes: 3 })
  assert.ok(some.includes('该轮仅 7 次工具调用'), some)
  assert.ok(some.includes('第 3 次'), some)
})

test('落盘：build/NEXT.md 内容与入参一致（目录不存在也能建）', () => {
  const dir = freshDir()
  try {
    const path = writeBudgetNote(dir, '# hello\n')
    assert.ok(path !== null)
    assert.equal(path, join(dir, 'build', NEXT_FILE))
    assert.equal(readFileSync(path, 'utf8'), '# hello\n')
  } finally {
    cleanup(dir)
  }
})

test('落盘失败返回 null，不抛（turn 已在收尾）', () => {
  const dir = freshDir()
  try {
    // 用「同名文件占住 build 这个目录名」制造真实失败：mkdir 会 EEXIST/ENOTDIR。
    writeFileSync(join(dir, 'build'), 'not a directory', 'utf8')
    assert.equal(existsSync(join(dir, 'build', NEXT_FILE)), false)
    assert.equal(writeBudgetNote(dir, 'x'), null)
  } finally {
    cleanup(dir)
  }
})

test('覆盖写：上一次的观察不残留（只保留最近一次被掐断）', () => {
  const dir = freshDir()
  try {
    mkdirSync(join(dir, 'build'), { recursive: true })
    writeBudgetNote(dir, 'old')
    const path = writeBudgetNote(dir, 'new')
    assert.equal(readFileSync(path, 'utf8'), 'new')
  } finally {
    cleanup(dir)
  }
})
