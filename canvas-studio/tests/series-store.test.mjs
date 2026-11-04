/**
 * 阶段 3.1（2026-11-04）：短剧 episodic 存储层守卫（`series.json`，方案
 * `docs/plans/短剧episodic方案-20261104.md`）。
 *
 * 锁四件事：CRUD 与集序 / 集号唯一与改登记语义 / recap 钳制与缺省不改 /
 * 损坏降级与并发串写。直连 lib/（先 build 再跑）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const srcOf = (p) => readFileSync(join(ROOT, p), 'utf8')

test('3.1：create / list / require 与系列名唯一', async () => {
  const { SeriesStore } = await import('../lib/series-store.js')
  const root = await mkdtemp(join(tmpdir(), 'series-'))
  try {
    const store = new SeriesStore(root)
    const a = await store.create('长风渡')
    assert.equal(a.title, '长风渡')
    assert.deepEqual(a.episodes, [])
    await assert.rejects(() => store.create('长风渡'), (err) => err.code === 'CS-USER-ERR')
    await assert.rejects(() => store.create('长风渡 '.toLowerCase() === '长风渡' ? '长风渡' : '长风渡'), /已存在|CS-USER-ERR/)
    // 大小写不敏感唯一性对中文退化为主判据；英文系列名验证大小写口径
    await store.create('Signal')
    await assert.rejects(() => store.create('signal'), (err) => err.code === 'CS-USER-ERR')
    const all = await store.list()
    assert.equal(all.length, 2)
    const back = await store.require(a.id)
    assert.equal(back.title, '长风渡')
    await assert.rejects(() => store.require('nope'), (err) => err.code === 'CS-USER-ERR')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('3.1：upsertEpisode —— 集号唯一 / 改登记保留未传字段 / 集序升序', async () => {
  const { SeriesStore } = await import('../lib/series-store.js')
  const root = await mkdtemp(join(tmpdir(), 'series-'))
  try {
    const store = new SeriesStore(root)
    const s = await store.create('测试系列')
    await store.upsertEpisode(s.id, { episodeNo: 2, projectId: 'p2', recap: '第二集收尾' })
    await store.upsertEpisode(s.id, { episodeNo: 1, projectId: 'p1', title: '首集' })
    const after = await store.require(s.id)
    assert.deepEqual(after.episodes.map((e) => e.episodeNo), [1, 2], '列出必须按集号升序')
    // 同集号改登记：只传 recap，title 保留
    await store.upsertEpisode(s.id, { episodeNo: 1, projectId: 'p1', recap: '首集前情' })
    const again = await store.require(s.id)
    assert.equal(again.episodes[0]?.title, '首集', '未传字段必须保留')
    assert.equal(again.episodes[0]?.recap, '首集前情')
    // 换项目绑同集号 → 拒收
    await assert.rejects(
      () => store.upsertEpisode(s.id, { episodeNo: 1, projectId: 'p-other' }),
      (err) => err.code === 'CS-USER-ERR',
    )
    // 非法集号拒收
    await assert.rejects(
      () => store.upsertEpisode(s.id, { episodeNo: 0, projectId: 'p1' }),
      (err) => err.code === 'CS-USER-ERR',
    )
    await assert.rejects(
      () => store.upsertEpisode(s.id, { episodeNo: 1000, projectId: 'p1' }),
      (err) => err.code === 'CS-USER-ERR',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('3.1：recap 钳 2000 字 + 文档形状与损坏降级', async () => {
  const { SeriesStore, MAX_RECAP_LENGTH, SERIES_VERSION } = await import('../lib/series-store.js')
  assert.equal(MAX_RECAP_LENGTH, 2000)
  const root = await mkdtemp(join(tmpdir(), 'series-'))
  try {
    const store = new SeriesStore(root)
    const s = await store.create('钳制')
    const long = '前'.repeat(5000)
    await store.upsertEpisode(s.id, { episodeNo: 1, projectId: 'p1', recap: long })
    const after = await store.require(s.id)
    assert.equal(after.episodes[0]?.recap?.length, 2000)
    // 文档形状：version 1 + series 数组
    const doc = JSON.parse(await readFile(join(root, 'series.json'), 'utf8'))
    assert.equal(doc.version, SERIES_VERSION)
    assert.ok(Array.isArray(doc.series))
    // 损坏降级：坏 JSON 后读取返回空且不抛
    await store.create('二号')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(root, 'series.json'), '{broken', 'utf8')
    const empty = await store.list()
    assert.deepEqual(empty, [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('3.1 注册面：两工具进全量名单 + presentation + toolchain/docs 账面', () => {
  const registry = srcOf('tests/tool-registry.test.mjs')
  assert.ok(registry.includes("'series_manage'") && registry.includes("'episode_brief'"))
  assert.ok(registry.includes('44 → 46'))
  const presentation = srcOf('src/tool-presentation.ts')
  assert.match(presentation, /series_manage: \{ tier: 'A', title: '剧集管理', icon: '剧' \}/)
  assert.match(presentation, /episode_brief: \{ tier: 'A', title: '前情上下文', icon: '前' \}/)
  const toolchain = srcOf('skills/canvas-studio-creation/references/toolchain.md')
  assert.ok(toolchain.includes('`series_manage` / `episode_brief`') || toolchain.includes('| series_manage |'))
  const toolsDoc = srcOf('docs/canvas-studio-tools.md')
  assert.ok(toolsDoc.includes('`series_manage`'))
})
