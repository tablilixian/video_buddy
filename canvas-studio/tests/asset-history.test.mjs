/**
 * CV-246 / BUG-006 契约测试：生成产物历史（history.json + GC 保护联动）。
 *
 * 方案见 docs/plans/生成历史面板方案.md：
 *   - 每个产物落盘点记账（file/kind/tool/label/createdAt/size），同 file 幂等；
 *   - 未删条目（无 deletedAt）是 GC 保护名单：画布不引用也不清——根目录孤儿
 *     留在根目录、.trash 里的留在 .trash（历史面板仍可预览，走 .trash fallback）；
 *   - 面板删除（markHistoryDeleted）后 GC 才物理清 + 剪条目（两段式闭环）。
 *
 * 锁住八条行为：
 *   1. 记账/读回：字段齐全，kind 按扩展名派生，label 按工具映射；
 *   2. 同 file 重复记账幂等；
 *   3. markHistoryDeleted 写入 deletedAt；
 *   4. GC 不清 history 保护的根目录「孤儿」；
 *   5. GC 不清 history 保护的 .trash 文件（留在原地，不回活）；
 *   6. GC 物理清已删除（deletedAt）的 .trash 文件并剪掉条目；
 *   7. history.json 本身不被 GC 当孤儿清；
 *   8. recordAssetHistory 后 generate 落盘链路的产物有账（saveLocalAssetBytes 直连）。
 *
 * 直连 Host tsc 产物 lib/。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectRegistry } from '../lib/projects.js'
import {
  collectProtectedBasenames,
  kindOfExtension,
  labelOfTool,
  loadAssetHistory,
  markHistoryDeleted,
  recordAssetHistory,
} from '../lib/asset-history.js'
import { gcProjectAssets } from '../lib/asset-gc.js'
import { saveLocalAssetBytes } from '../lib/generate.js'

async function withRegistry(run) {
  const root = await mkdtemp(join(tmpdir(), 'cs-cv246-'))
  try {
    const registry = new ProjectRegistry(root)
    const project = await registry.create('历史面板')
    const assetsDir = registry.assetsDir(project.id)
    await run(registry, project.id, assetsDir)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('CV-246：记账/读回——kind 按扩展名派生，label 按工具映射', async () => {
  await withRegistry(async (registry, projectId) => {
    await recordAssetHistory(registry, projectId, { file: 'a.mp4', tool: 'video_generate', size: 1234 })
    await recordAssetHistory(registry, projectId, { file: 'b.png', tool: 'upload', size: 10 })
    const history = await loadAssetHistory(registry, projectId)
    assert.equal(history.version, 1)
    assert.equal(history.entries.length, 2)
    const video = history.entries.find((entry) => entry.file === 'a.mp4')
    assert.equal(video.kind, 'video')
    assert.equal(video.label, '视频生成')
    assert.equal(video.size, 1234)
    assert.ok(typeof video.createdAt === 'number' && video.createdAt > 0)
    const image = history.entries.find((entry) => entry.file === 'b.png')
    assert.equal(image.kind, 'image')
    assert.equal(image.label, '上传文件')
  })
})

test('CV-246：同 file 重复记账幂等（promote/重试场景不重复插条目）', async () => {
  await withRegistry(async (registry, projectId) => {
    await recordAssetHistory(registry, projectId, { file: 'a.mp4', tool: 'video_generate' })
    await recordAssetHistory(registry, projectId, { file: 'a.mp4', tool: 'video_generate' })
    const history = await loadAssetHistory(registry, projectId)
    assert.equal(history.entries.length, 1)
  })
})

test('CV-246：markHistoryDeleted 写入 deletedAt；未删集合随之收窄', async () => {
  await withRegistry(async (registry, projectId) => {
    await recordAssetHistory(registry, projectId, { file: 'a.mp4', tool: 'compose' })
    await recordAssetHistory(registry, projectId, { file: 'b.png', tool: 'upload' })
    assert.deepEqual([...await collectProtectedBasenames(registry, projectId)].sort(), ['a.mp4', 'b.png'])
    await markHistoryDeleted(registry, projectId, 'a.mp4')
    const history = await loadAssetHistory(registry, projectId)
    const deleted = history.entries.find((entry) => entry.file === 'a.mp4')
    assert.ok(typeof deleted.deletedAt === 'number' && deleted.deletedAt > 0)
    assert.deepEqual([...await collectProtectedBasenames(registry, projectId)], ['b.png'])
  })
})

test('CV-246：GC 不清 history 保护的根目录「孤儿」（画布无引用也不动）', async () => {
  await withRegistry(async (registry, projectId, assetsDir) => {
    await writeFile(join(assetsDir, 'a.mp4'), Buffer.from([1]))
    await recordAssetHistory(registry, projectId, { file: 'a.mp4', tool: 'video_generate' })
    const result = await gcProjectAssets(registry, projectId)
    assert.equal(result.orphansRemoved, 0, '受历史保护的文件不算孤儿')
    const names = (await readdir(assetsDir)).sort()
    assert.ok(names.includes('a.mp4'), '文件仍在根目录')
  })
})

test('CV-246：GC 不清 history 保护的 .trash 文件（留在原地不回活）', async () => {
  await withRegistry(async (registry, projectId, assetsDir) => {
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(assetsDir, '.trash'), { recursive: true })
    await writeFile(join(assetsDir, '.trash', 'a.mp4'), Buffer.from([1]))
    await recordAssetHistory(registry, projectId, { file: 'a.mp4', tool: 'video_generate' })
    const result = await gcProjectAssets(registry, projectId)
    assert.equal(result.purged, 0, '受历史保护的 trash 文件不物理删')
    assert.equal(result.restored, 0, '也不回活（回活会成为下次孤儿）')
    const trashNames = await readdir(join(assetsDir, '.trash'))
    assert.deepEqual(trashNames, ['a.mp4'])
  })
})

test('CV-246：GC 物理清已删除（deletedAt）的 .trash 文件并剪条目（两段式闭环）', async () => {
  await withRegistry(async (registry, projectId, assetsDir) => {
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(assetsDir, '.trash'), { recursive: true })
    await writeFile(join(assetsDir, '.trash', 'a.mp4'), Buffer.from([1]))
    await recordAssetHistory(registry, projectId, { file: 'a.mp4', tool: 'video_generate' })
    await markHistoryDeleted(registry, projectId, 'a.mp4')
    const result = await gcProjectAssets(registry, projectId)
    assert.equal(result.purged, 1, 'deletedAt 条目的 trash 文件被物理清')
    const history = await loadAssetHistory(registry, projectId)
    assert.equal(history.entries.length, 0, '文件已不存在 → 条目剪掉')
  })
})

test('CV-246：history.json 本身不被 GC 当孤儿清；账实相符的条目保留', async () => {
  await withRegistry(async (registry, projectId, assetsDir) => {
    await writeFile(join(assetsDir, 'a.mp4'), Buffer.from([1]))
    await recordAssetHistory(registry, projectId, { file: 'a.mp4', tool: 'video_generate' })
    await gcProjectAssets(registry, projectId)
    const history = await loadAssetHistory(registry, projectId)
    assert.equal(history.entries.length, 1, '登记表完好、账实相符条目保留')
    // 死条目（文件从未落盘）→ GC 剪枝是正确行为：预览必然 404，留着只会误导。
    await recordAssetHistory(registry, projectId, { file: 'ghost.mp4', tool: 'video_generate' })
    await gcProjectAssets(registry, projectId)
    const pruned = await loadAssetHistory(registry, projectId)
    assert.deepEqual(pruned.entries.map((entry) => entry.file), ['a.mp4'], '指向不存在文件的条目被剪')
  })
})

test('CV-246：saveLocalAssetBytes 落盘后自动记账（上传链路）', async () => {
  await withRegistry(async (registry, projectId) => {
    const result = await saveLocalAssetBytes(registry, projectId, 'song.mp3', Buffer.from([1, 2, 3]))
    const history = await loadAssetHistory(registry, projectId)
    assert.equal(history.entries.length, 1)
    const entry = history.entries[0]
    assert.equal(entry.file, result.assetFile)
    assert.equal(entry.kind, 'audio')
    assert.equal(entry.tool, 'upload')
    assert.equal(entry.label, '上传文件')
    assert.equal(entry.size, 3)
  })
})

test('CV-246：kind 派生与工具映射表（唯一派生点）', () => {
  assert.equal(kindOfExtension('png'), 'image')
  assert.equal(kindOfExtension('.jpg'), 'image')
  assert.equal(kindOfExtension('mp4'), 'video')
  assert.equal(kindOfExtension('mov'), 'video')
  assert.equal(kindOfExtension('mp3'), 'audio')
  assert.equal(kindOfExtension('flac'), 'audio')
  assert.equal(kindOfExtension('md'), 'file')
  assert.equal(kindOfExtension(''), 'file')
  assert.equal(labelOfTool('video_generate'), '视频生成')
  assert.equal(labelOfTool('compose'), '成片合成')
  assert.equal(labelOfTool('cut_audio'), '音频裁切')
  assert.equal(labelOfTool('image_fix'), '图内文字修复')
  assert.equal(labelOfTool('unknown_tool'), 'unknown_tool', '未知工具兜底展示原名')
})
