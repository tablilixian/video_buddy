/**
 * C1 一致性资产卡契约测试：StudioAsset 的持久化闭环。
 * C2 追加：同名卡覆盖（resolveAssetSlot）与失效锚点摘除（releaseAssetNodes）。
 *
 * 1. upsertAsset → readCanvas 往返保留（id/name/role/anchorNodeIds/lockedPrompt/negativePrompt）。
 * 2. 同 id upsert 覆盖、不同 id 追加。
 * 3. Host 写入保护：writeCanvas 不传 assets 时保留已存注册表（拖拽保存不丢资产卡）。
 * 4. 宽松迁移：磁盘上残缺/非法的 asset 条目被丢弃而非致命。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectRegistry } from '../lib/projects.js'
import { resolveAssetSlot } from '../lib/generate.js'
import { CANVAS_DOCUMENT_VERSION } from '../lib/contracts/canvas.js'

function sampleAsset(id = 'asset-1', overrides = {}) {
  return {
    id,
    name: '女主',
    role: 'character',
    anchorNodeIds: ['node-a', 'node-b'],
    lockedPrompt: '[SAME CHARACTER: 女性，30岁，黑色短发，米色风衣] [SAME LIGHT: 冷蓝主光]',
    negativePrompt: '不更换服装',
    createdAt: 1000,
    ...overrides,
  }
}

test('ProjectRegistry：upsertAsset → readCanvas 资产卡往返保留', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-asset-'))
  try {
    const registry = new ProjectRegistry(dir)
    const project = await registry.create('资产卡测试')
    const asset = sampleAsset()
    await registry.upsertAsset(project.id, asset)
    const read = await registry.readCanvas(project.id)
    assert.deepEqual(read.assets, [asset], '资产卡应原样往返')
    assert.equal(read.version, CANVAS_DOCUMENT_VERSION, '文档版本应为 v4')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('ProjectRegistry：同 id upsert 覆盖，不同 id 追加', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-asset-'))
  try {
    const registry = new ProjectRegistry(dir)
    const project = await registry.create('资产卡测试')
    await registry.upsertAsset(project.id, sampleAsset('asset-1', { name: '女主' }))
    await registry.upsertAsset(project.id, sampleAsset('asset-1', { name: '女主改' }))
    await registry.upsertAsset(project.id, sampleAsset('asset-2', { name: '侦探', role: 'character' }))
    const read = await registry.readCanvas(project.id)
    assert.equal(read.assets.length, 2, '应共 2 张资产卡')
    assert.equal(read.assets[0].name, '女主改', '同 id 应被覆盖')
    assert.equal(read.assets[1].name, '侦探', '新 id 应追加')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('ProjectRegistry：writeCanvas 不传 assets 时保留已存资产卡', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-asset-'))
  try {
    const registry = new ProjectRegistry(dir)
    const project = await registry.create('资产卡测试')
    await registry.upsertAsset(project.id, sampleAsset())
    // 模拟客户端拖拽保存：只写 nodes，不传 assets/view。
    await registry.writeCanvas(project.id, [])
    const read = await registry.readCanvas(project.id)
    assert.equal(read.assets.length, 1, '资产卡不应被节点保存清掉')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('ProjectRegistry：磁盘上非法资产条目被宽松丢弃', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-asset-'))
  try {
    const registry = new ProjectRegistry(dir)
    const project = await registry.create('资产卡测试')
    const canvasFile = registry.canvasFile(project.id)
    const document = {
      version: 3,
      nodes: [],
      assets: [
        sampleAsset('asset-ok'),
        { id: 'bad-1', name: '缺 role' },
        'not-an-object',
      ],
    }
    await writeFile(canvasFile, JSON.stringify(document), 'utf8')
    const read = await registry.readCanvas(project.id)
    assert.equal(read.assets.length, 1, '仅合法条目保留')
    assert.equal(read.assets[0].id, 'asset-ok')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('C2 resolveAssetSlot：同名资产卡复用原 id（覆盖而非堆积）', () => {
  const assets = [sampleAsset('asset-1', { name: '女主' })]
  assert.deepEqual(
    resolveAssetSlot(assets, '女主', () => 'new'),
    { id: 'asset-1', replacing: true },
    '同名应复用原 id 并标记 replacing',
  )
  assert.deepEqual(
    resolveAssetSlot(assets, '侦探', () => 'new'),
    { id: 'new', replacing: false },
    '不同名应新建 id',
  )
  assert.deepEqual(resolveAssetSlot(undefined, '女主', () => 'new'), { id: 'new', replacing: false }, '无注册表时新建')
})

test('C2 releaseAssetNodes：同名卡覆盖后旧锚点不再冒充该卡归属', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-asset-'))
  try {
    const registry = new ProjectRegistry(dir)
    const project = await registry.create('资产卡测试')
    await registry.upsertAsset(project.id, sampleAsset('asset-1', { anchorNodeIds: ['old-1', 'old-2'] }))
    const base = { kind: 'image', x: 0, y: 0, width: 10, height: 10, origin: 'agent', sourceIds: [] }
    const nodes = [
      { ...base, id: 'old-1', url: '/a.png', createdAt: 1, assetId: 'asset-1' },
      { ...base, id: 'old-2', url: '/b.png', createdAt: 2, assetId: 'asset-1' },
      { ...base, id: 'keep-1', url: '/c.png', createdAt: 3, assetId: 'asset-1' },
      { ...base, id: 'other', url: '/d.png', createdAt: 4, assetId: 'asset-2' },
    ]
    await registry.writeCanvas(project.id, nodes)
    await registry.releaseAssetNodes(project.id, 'asset-1', ['keep-1'])
    const read = await registry.readCanvas(project.id)
    const byId = new Map(read.nodes.map((n) => [n.id, n]))
    assert.equal(byId.get('old-1').assetId, undefined, '旧锚点应摘掉 assetId')
    assert.equal(byId.get('old-2').assetId, undefined, '旧锚点应摘掉 assetId')
    assert.equal(byId.get('keep-1').assetId, 'asset-1', '新锚点应保留归属')
    assert.equal(byId.get('other').assetId, 'asset-2', '其他卡归属不受影响')
    assert.equal(read.assets.length, 1, 'releaseAssetNodes 不应改动资产卡本身')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
