/**
 * REQ-022（CV-293）storyboard 落盘层的判定测试。
 *
 * 这一层管的是「怎么安全地读写」——坏了怎么办、并发怎么办。两条边界最贵：
 *
 * 1. **损坏必须留证且不静默重置**。画布读坏降级空文档是对的（可抛弃的 UI 状态）；
 *    故事版是用户创作资产，静默重置 = 毁稿，且下一次保存会把损坏内容永久覆盖掉。
 * 2. **所有写者必须串行**。四条通道（agent 工具 / 存档回退落地路由 / L 类回写 /
 *    A 类 actuals）都做「读 → 改 → 写」，不串行就丢更新。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadStoryboard,
  saveStoryboard,
  updateStoryboard,
  storyboardQueueIdle,
} from '../lib/storyboard-store.js'
import { createStoryboard, emptyStoryboardSections } from '../lib/contracts/storyboard.js'

/** 只用到 `storyboardFile()` 的最小 registry 替身（真 ProjectRegistry 需要 root provider）。 */
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'req022-store-'))
  await mkdir(dir, { recursive: true })
  const registry = { storyboardFile: (id) => join(dir, `${id}.storyboard.json`) }
  return { dir, registry, fileOf: (id) => join(dir, `${id}.storyboard.json`) }
}

function doc(brief) {
  const sections = { ...emptyStoryboardSections(), '00_creative': { brief } }
  return createStoryboard({
    projectId: 'p1',
    title: '《雨夜来信》',
    meta: { genre: '民国悬疑', targetDuration: 30, aspect: '16:9' },
    sections,
  })
}

test('没有文件 → status missing（未开工是正常态，不是错误）', async () => {
  const { registry } = await fixture()
  assert.deepEqual(await loadStoryboard(registry, 'p1'), { status: 'missing' })
})

test('写 → 读 往返：文档结构完整回来', async () => {
  const { registry } = await fixture()
  await saveStoryboard(registry, 'p1', doc('雨夜的一封信'))
  const load = await loadStoryboard(registry, 'p1')
  assert.equal(load.status, 'ok')
  assert.equal(load.document.sections['00_creative'].brief, '雨夜的一封信')
  assert.equal(load.document.versions.baseline, 'v1')
  assert.equal(load.document.landed, null)
})

test('损坏（非法 JSON）→ status corrupt + `.corrupt` 留证 + 原文件已迁走', async () => {
  const { registry, fileOf } = await fixture()
  await writeFile(fileOf('p1'), '{ 这不是 json', 'utf8')

  const load = await loadStoryboard(registry, 'p1')
  assert.equal(load.status, 'corrupt')
  assert.ok(load.reason.length > 0, '必须给出可读的原因')
  assert.ok(load.backup.endsWith('.corrupt'), '备份路径必须指向 .corrupt')
  assert.ok(existsSync(load.backup), '原文件必须已改名留证')
  assert.equal(existsSync(fileOf('p1')), false, '原文件不能留在原地（否则会被静默覆盖）')
  assert.equal(await readFile(load.backup, 'utf8'), '{ 这不是 json', '备份内容必须原样')
})

test('损坏（顶层不是对象）→ 同样走 corrupt 分支', async () => {
  const { registry, fileOf } = await fixture()
  await writeFile(fileOf('p1'), JSON.stringify([1, 2, 3]), 'utf8')
  const load = await loadStoryboard(registry, 'p1')
  assert.equal(load.status, 'corrupt')
})

test('旧 schemaVersion → status stale：不留证、不改名、不静默迁移', async () => {
  const { registry, fileOf } = await fixture()
  // 一份「能读懂但不是当前格式」的文件（v1 时代写下的）——关键是它**有效**，不该被当成损坏。
  await writeFile(fileOf('p1'), JSON.stringify({ schemaVersion: 1, projectId: 'p1', title: '旧稿', sections: {} }), 'utf8')

  const load = await loadStoryboard(registry, 'p1')
  assert.equal(load.status, 'stale')
  assert.equal(load.found, 1)
  assert.equal(load.expected, 2)
  assert.equal(existsSync(fileOf('p1')), true, '旧格式文件是好的，不该被改名留证')
  assert.equal(existsSync(`${fileOf('p1')}.corrupt`), false, '不该产生 .corrupt')
})

test('没有 schemaVersion 字段 → 同样按 stale 处理（比当成损坏更诚实）', async () => {
  const { registry, fileOf } = await fixture()
  await writeFile(fileOf('p1'), JSON.stringify({ projectId: 'p1' }), 'utf8')
  const load = await loadStoryboard(registry, 'p1')
  assert.equal(load.status, 'stale')
  assert.equal(load.found, 0)
})

test('再次损坏会覆盖同名备份（只留最近一次，不无限堆积）', async () => {
  const { registry, fileOf } = await fixture()
  await writeFile(fileOf('p1'), '坏一号', 'utf8')
  const first = await loadStoryboard(registry, 'p1')
  await writeFile(fileOf('p1'), '坏二号', 'utf8')
  const second = await loadStoryboard(registry, 'p1')
  assert.equal(first.backup, second.backup, '备份路径稳定为 <file>.corrupt')
  assert.equal(await readFile(second.backup, 'utf8'), '坏二号')
})

test('updateStoryboard：读改写原子完成', async () => {
  const { registry } = await fixture()
  await saveStoryboard(registry, 'p1', doc('初稿'))
  const next = await updateStoryboard(registry, 'p1', (current) => ({
    ...current,
    title: '《雨夜来信》v2',
  }))
  assert.equal(next?.title, '《雨夜来信》v2')
  const load = await loadStoryboard(registry, 'p1')
  assert.equal(load.document.title, '《雨夜来信》v2')
})

test('updateStoryboard：盘上无可读文档 → undefined（不凭空造一份）', async () => {
  const { registry } = await fixture()
  assert.equal(await updateStoryboard(registry, 'p1', (current) => current), undefined)
})

test('并发更新不丢写（串行队列的核心价值）', async () => {
  const { registry } = await fixture()
  await saveStoryboard(registry, 'p1', doc('起点'))
  // 10 个「读 → 在 08_constraints 追加一条 → 写」并发发出，串行化后必须全部落地。
  await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      updateStoryboard(registry, 'p1', (current) => ({
        ...current,
        sections: {
          ...current.sections,
          '08_constraints': [...current.sections['08_constraints'], `纪律 ${index}`],
        },
      })),
    ),
  )
  await storyboardQueueIdle()
  const load = await loadStoryboard(registry, 'p1')
  assert.equal(load.document.sections['08_constraints'].length, 10, '丢写 = 有更新被覆盖')
})

test('串行链前序失败不阻断后续（一档写坏不该锁死该项目）', async () => {
  const { registry } = await fixture()
  await saveStoryboard(registry, 'p1', doc('起点'))
  const boom = updateStoryboard(registry, 'p1', () => { throw new Error('模拟写失败') })
  await assert.rejects(boom, /模拟写失败/u)
  const after = await updateStoryboard(registry, 'p1', (current) => ({ ...current, title: '仍然能写' }))
  assert.equal(after?.title, '仍然能写')
})

test('落盘文件是 0600（创作资产不进 world-readable）', async () => {
  const { registry, fileOf } = await fixture()
  await saveStoryboard(registry, 'p1', doc('权限'))
  const info = await stat(fileOf('p1'))
  assert.equal(info.mode & 0o777, 0o600)
})
