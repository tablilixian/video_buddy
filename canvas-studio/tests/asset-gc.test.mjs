/**
 * CV-243 / BUG-005 契约测试：资产废料回收（回收站 + 打开项目 GC）。
 *
 * 背景：删除链路只改 canvas.json，assets/ 里留下孤儿文件（实锤 20MB mix 中间
 * 产物）。方案见 docs/plans/资产废料回收方案.md：删除 → 无引用文件移 `.trash/`
 * （不物理删，undo/共享/生成中竞态免疫）；打开项目 GC → 回活/物理清/孤儿清/manifest 剪枝。
 *
 * 锁住六条行为：
 *   1. 删除节点 → 无引用文件进 .trash、根目录消失；
 *   2. 粘贴共享（两节点同 url）→ 删其一文件不动（按 basename 计数）；
 *   3. 被删节点本无本地文件 → 静默不抛；
 *   4. GC 回活：引用集合内但落在 trash 的文件移回根目录；
 *   5. GC 清理：trash 未引用物理删、根孤儿物理删、reference-manifest.json 保留；
 *   6. manifest 剪枝：指向已不存在文件的条目删除、存活条目不动。
 *
 * 直连 Host tsc 产物 lib/。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectRegistry } from '../lib/projects.js'
import {
  collectReferencedBasenames,
  gcProjectAssets,
  deleteUnreferencedAssets,
} from '../lib/asset-gc.js'
import { pruneReferenceManifest } from '../lib/generate.js'
import { recordAssetHistory } from '../lib/asset-history.js'

const TRASH = '.trash'

const node = (overrides = {}) => ({
  id: 'n1',
  kind: 'image',
  url: '/canvas-studio/assets/p/n1.png',
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  createdAt: 1,
  origin: 'agent',
  sourceIds: [],
  ...overrides,
})

async function withRegistry(run) {
  const root = await mkdtemp(join(tmpdir(), 'cs-cv243-'))
  try {
    const registry = new ProjectRegistry(root)
    const project = await registry.create('废料回收')
    const assetsDir = registry.assetsDir(project.id)
    await run(registry, project.id, assetsDir)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const writeFileSet = async (assetsDir, names) => {
  for (const name of names) await writeFile(join(assetsDir, name), Buffer.from([1]))
}

test('CV-243：collectReferencedBasenames 按 url basename 去重收集', () => {
  const doc = {
    nodes: [
      node({ id: 'a', url: '/canvas-studio/assets/p/a.png' }),
      node({ id: 'b', url: '/canvas-studio/assets/p/a.png' }), // 粘贴共享
      node({ id: 'c', url: '/canvas-studio/assets/p/export-x.mp4' }),
      node({ id: 'd', url: undefined }), // 无 url
    ],
  }
  assert.deepEqual(
    [...collectReferencedBasenames(doc)].sort(),
    ['a.png', 'export-x.mp4'],
  )
})

test('B-1 定案：删除节点 → 无引用文件**物理删除**（不再进 .trash），历史补 deletedAt', async () => {
  await withRegistry(async (registry, projectId, assetsDir) => {
    await writeFileSet(assetsDir, ['n1.png', 'n2.png'])
    const beforeNodes = [node({ id: 'n1', url: '/canvas-studio/assets/p/n1.png' }), node({ id: 'n2', url: '/canvas-studio/assets/p/n2.png' })]
    // 保存后：n2 留存（模拟 writeCanvas 落盘后的文档）
    await registry.writeCanvas(projectId, [node({ id: 'n2', url: '/canvas-studio/assets/p/n2.png' })], undefined, undefined, { author: 'client', removedIds: ['n1'] })
    await recordAssetHistory(registry, projectId, { file: 'n1.png', tool: 'image', size: 1 })
    const deleted = await deleteUnreferencedAssets(registry, projectId, ['n1'], beforeNodes)
    assert.deepEqual(deleted, ['n1.png'])
    assert.equal(await readdir(assetsDir).then(names => names.includes('n1.png')), false, '根目录不再有 n1.png')
    assert.equal(await readFile(join(assetsDir, TRASH, 'n1.png')).then(() => true).catch(() => false), false, 'B-1 定案：不再进 .trash（物理删，无回退口径）')
    const history = JSON.parse(await readFile(join(assetsDir, 'history.json'), 'utf8'))
    const entry = (history.entries ?? []).find(item => item.file === 'n1.png')
    assert.ok(entry?.deletedAt !== undefined, '历史条目必须补 deletedAt（GC 保护名单据此放行）')
  })
})

test('CV-243：粘贴共享文件——两节点同 url，删其一文件不动', async () => {
  await withRegistry(async (registry, projectId, assetsDir) => {
    await writeFileSet(assetsDir, ['a.png'])
    const url = '/canvas-studio/assets/p/a.png'
    const beforeNodes = [node({ id: 'n1', url }), node({ id: 'n2', url })]
    await registry.writeCanvas(projectId, [node({ id: 'n2', url })], undefined, undefined, { author: 'client', removedIds: ['n1'] })
    const deleted = await deleteUnreferencedAssets(registry, projectId, ['n1'], beforeNodes)
    assert.deepEqual(deleted, [], 'n2 仍引用 a.png，不回收')
    assert.equal(await readFile(join(assetsDir, 'a.png')).then(() => true).catch(() => false), true, '共享文件留在根目录')
  })
})

test('CV-243：被删节点无 url / 文件不存在 → 静默不抛', async () => {
  await withRegistry(async (registry, projectId) => {
    const beforeNodes = [node({ id: 'n1' }), node({ id: 'n2', url: '/canvas-studio/assets/p/ghost.png' })]
    await registry.writeCanvas(projectId, [], undefined, undefined, { author: 'client', removedIds: ['n1', 'n2'] })
    const trashed = await deleteUnreferencedAssets(registry, projectId, ['n1', 'n2'], beforeNodes)
    assert.deepEqual(trashed, [], '无 url / 文件不存在的候选静默跳过，不抛错')
  })
})

test('CV-243：GC 回活——仍被引用但落在 trash 的文件移回根目录', async () => {
  await withRegistry(async (registry, projectId, assetsDir) => {
    // 场景：删除 → trash → undo 恢复 → 已保存（引用集合重新包含 a.png）
    await mkdir(join(assetsDir, TRASH), { recursive: true })
    await writeFile(join(assetsDir, TRASH, 'a.png'), Buffer.from([1]))
    await registry.writeCanvas(projectId, [node({ id: 'n1', url: '/canvas-studio/assets/p/a.png' })])
    const result = await gcProjectAssets(registry, projectId)
    assert.equal(result.restored, 1)
    assert.equal(await readFile(join(assetsDir, 'a.png')).then(() => true).catch(() => false), true, '文件回到根目录')
  })
})

test('CV-243：GC 清理——trash 未引用物理删、根孤儿物理删、manifest 结构文件保留', async () => {
  await withRegistry(async (registry, projectId, assetsDir) => {
    await mkdir(join(assetsDir, TRASH), { recursive: true })
    await writeFile(join(assetsDir, TRASH, 'dead.png'), Buffer.from([1]))
    await writeFileSet(assetsDir, ['orphan.png', 'live.png', 'reference-manifest.json'])
    await registry.writeCanvas(projectId, [node({ id: 'n1', url: '/canvas-studio/assets/p/live.png' })])
    const result = await gcProjectAssets(registry, projectId)
    assert.equal(result.purged, 1)
    assert.equal(result.orphansRemoved, 1)
    assert.equal(await readFile(join(assetsDir, 'live.png')).then(() => true).catch(() => false), true, '引用文件不动')
    assert.equal(await readFile(join(assetsDir, 'reference-manifest.json')).then(() => true).catch(() => false), true, 'manifest 结构文件保留')
    assert.equal(await readdir(join(assetsDir, TRASH)).then(names => names.length), 0, 'trash 已清空')
  })
})

test('CV-243：GC 后 manifest 剪枝——死条目删除、存活条目不动', async () => {
  await withRegistry(async (registry, projectId, assetsDir) => {
    await writeFileSet(assetsDir, ['live.png'])
    await writeFile(
      join(assetsDir, 'reference-manifest.json'),
      JSON.stringify({ version: 1, handles: { 'ref-aaaa.png': 'live.png', 'ref-bbbb.png': 'dead.png' } }),
    )
    await registry.writeCanvas(projectId, [node({ id: 'n1', url: '/canvas-studio/assets/p/live.png' })])
    await gcProjectAssets(registry, projectId)
    const manifest = JSON.parse(await readFile(join(assetsDir, 'reference-manifest.json'), 'utf8'))
    assert.deepEqual(manifest.handles, { 'ref-aaaa.png': 'live.png' }, '死条目剪掉，存活条目保留')
  })
})

test('CV-243：pruneReferenceManifest 幂等且无变化不写盘', async () => {
  await withRegistry(async (registry, projectId, assetsDir) => {
    await writeFileSet(assetsDir, ['a.png'])
    await writeFile(
      join(assetsDir, 'reference-manifest.json'),
      JSON.stringify({ version: 1, handles: { 'ref-aaaa.png': 'a.png' } }),
    )
    const before = await readFile(join(assetsDir, 'reference-manifest.json'), 'utf8')
    await pruneReferenceManifest(registry, projectId, () => true)
    assert.equal(await readFile(join(assetsDir, 'reference-manifest.json'), 'utf8'), before, '全保留不写盘')
  })
})
