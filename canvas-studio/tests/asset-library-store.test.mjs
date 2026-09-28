/**
 * REQ-001：全局资产库存储层契约测试（Host 侧，直连 tsc 产物 lib/）。
 *
 * 背景：`assets-library.json` 落在注册表同一 root（跨 profile 共享），与 projects.json
 * 一样是「常驻内存 + 原子写」——两个共享同一 DSH home 的实例不能互相整表覆盖。
 * 因此合流 + 墓碑（照 commitRegistry 的纪律）是本模块的第一契约。
 *
 * 锁住八条行为：
 *   1. 双实例交替新建：磁盘合流、谁的记录都不丢（同 CV-046 对 projects 的锁法）；
 *   2. 删除落墓碑：对方旧快照再写不复活，墓碑留档（上限内）；
 *   3. 主名称全局唯一（大小写不敏感）：create / update 撞名 → CS-LIB-002；
 *   4. 未知 id 的 require/update/remove/addAnchor/recordUsage → CS-LIB-001；
 *   5. 文档损坏：读写都显式抛 CS-DEV-ERR，且不许被静默改写成空库；
 *   6. 媒体拷入：源文件 → `library/<id>/m_0.<ext>` + SHA-256 contentHash；源缺失
 *      → CS-LIB-003 且不留半截条目/孤儿目录（create 回滚）；
 *   7. 从画布取数 `collectNodeMediaSources`：节点缺失/文件缺失 → CS-LIB-003，
 *      无 url 节点 → 空数组（允许纯元数据入库）；
 *   8. 所有写盘必须经过 `commit`（合流出口），不许有第二个原子写调用点。
 *
 * 运行：corepack yarn workspace canvas-studio build && corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AssetLibrary, collectNodeMediaSources, libraryIdOfHandle } from '../lib/asset-library.js'
import { ProjectRegistry } from '../lib/projects.js'

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

/** 读磁盘上的库文档（测试只认落盘结果，不认内存缓存）。 */
async function onDisk(root) {
  return JSON.parse(await readFile(join(root, 'assets-library.json'), 'utf8'))
}

async function namesOf(library) {
  return (await library.list()).map((entry) => entry.name).sort()
}

/** 与 asset-gc 测试同一形状的最小画布节点。 */
const canvasNode = (overrides = {}) => ({
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

test('REQ-001：两个实例交替新建，谁的资产都不会被抹掉', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-lib-'))
  try {
    const a = new AssetLibrary(root)
    await a.create({ category: 'character', name: '女主' })

    // 第二个实例（模拟另一个 DSH 进程）：它的缓存里没有「女主」。
    const b = new AssetLibrary(root)
    await b.create({ category: 'scene', name: '雨夜街口' })

    const disk = await onDisk(root)
    assert.deepEqual(disk.assets.map((entry) => entry.name).sort(), ['女主', '雨夜街口'].sort(),
      '后写方不许拿自己的内存副本整表覆盖')
    assert.deepEqual(await namesOf(b), ['女主', '雨夜街口'].sort(),
      'B 本次写盘前先与磁盘合流，缓存也应是并集')
    assert.deepEqual(await namesOf(new AssetLibrary(root)), ['女主', '雨夜街口'].sort(), '磁盘才是事实源')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('REQ-001：删除落墓碑 —— 对方拿着旧快照再写，也不会把条目复活', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-lib-'))
  try {
    const a = new AssetLibrary(root)
    const keep = await a.create({ category: 'prop', name: '怀表' })
    const doomed = await a.create({ category: 'prop', name: '旧钥匙' })

    const b = new AssetLibrary(root)
    await b.list() // B 的快照里还有「旧钥匙」

    await a.remove(doomed.id)
    assert.deepEqual((await onDisk(root)).assets.map((entry) => entry.name), ['怀表'])

    await b.update(keep.id, { description: '午夜款' })
    const disk = await onDisk(root)
    assert.deepEqual(disk.assets.map((entry) => entry.name), ['怀表'],
      '删除结果不能被另一个实例的旧快照复活')
    assert.ok(disk.deleted.includes(doomed.id), '被删 id 应作为墓碑留在文档里')
    // 墓碑同样不许被本实例缓存丢掉，否则下一次写盘就复活了。
    assert.deepEqual(await namesOf(b), ['怀表'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('REQ-001：主名称全局唯一 —— create/update 撞名（大小写不敏感）→ CS-LIB-002', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-lib-'))
  try {
    const library = new AssetLibrary(root)
    const first = await library.create({ category: 'character', name: 'Luna' })
    await assert.rejects(
      () => library.create({ category: 'character', name: 'luna' }),
      (err) => err.code === 'CS-LIB-002',
      '同名不同大小写也算重名',
    )
    const other = await library.create({ category: 'scene', name: '码头' })
    await assert.rejects(
      () => library.update(other.id, { name: 'Luna' }),
      (err) => err.code === 'CS-LIB-002',
      '改名撞库内已有条目同样拒绝',
    )
    // 改成自己的名字不报重名（排除自身的查重逻辑）。
    const renamed = await library.update(first.id, { name: 'LUNA' })
    assert.equal(renamed.name, 'LUNA')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('REQ-001：未知 id 的读写一律 CS-LIB-001', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-lib-'))
  try {
    const library = new AssetLibrary(root)
    await library.create({ category: 'group', name: '路人甲' })
    const missing = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    await assert.rejects(() => library.require(missing), (err) => err.code === 'CS-LIB-001')
    await assert.rejects(() => library.update(missing, { description: 'x' }), (err) => err.code === 'CS-LIB-001')
    await assert.rejects(() => library.remove(missing), (err) => err.code === 'CS-LIB-001')
    await assert.rejects(() => library.addAnchor(missing, { projectId: 'p', nodeId: 'n' }), (err) => err.code === 'CS-LIB-001')
    await assert.rejects(() => library.recordUsage(missing, { projectId: 'p' }), (err) => err.code === 'CS-LIB-001')
    assert.equal(await library.get(missing), undefined, 'get 是明确的「不存在回 undefined」档，不抛')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('REQ-001：文档损坏时读写都抛 CS-DEV-ERR，且不许被改写成空库', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-lib-'))
  try {
    const broken = '{ 这不是 JSON'
    await writeFile(join(root, 'assets-library.json'), broken)
    const library = new AssetLibrary(root)
    await assert.rejects(
      () => library.list(),
      (err) => err.code === 'CS-DEV-ERR' && err.devMessage.includes('corrupt'),
      '损坏必须显式抛错 —— 静默当空表会让下一次写盘抹掉整个库',
    )
    await assert.rejects(
      () => library.create({ category: 'prop', name: '损坏后新建' }),
      (err) => err.code === 'CS-DEV-ERR',
      '写路径同样先读盘，损坏时拒绝覆盖',
    )
    assert.equal(await readFile(join(root, 'assets-library.json'), 'utf8'), broken,
      '损坏内容原样留着（用户还有机会手工修复）')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('REQ-001：媒体拷入 —— m_0 命名 + SHA-256 contentHash；源缺失整单回滚', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-lib-'))
  try {
    const sourceDir = join(root, 'sources')
    await mkdir(sourceDir, { recursive: true })
    const bytes = Buffer.from('png-bytes')
    const sourcePath = join(sourceDir, 'front.png')
    await writeFile(sourcePath, bytes)

    const library = new AssetLibrary(root)
    const asset = await library.create({
      category: 'character',
      name: '女主',
      anchors: [{ projectId: 'p1', nodeId: 'n1' }],
      media: [{ sourcePath, label: '正视图' }],
    })
    assert.equal(asset.media.length, 1)
    assert.equal(asset.media[0].file, 'm_0.png')
    assert.equal(asset.media[0].label, '正视图')
    assert.equal(
      asset.media[0].contentHash,
      createHash('sha256').update(bytes).digest('hex'),
      'contentHash 必须是文件内容的 SHA-256（物化去重的比对键）',
    )
    const copied = await stat(join(library.assetDir(asset.id), 'm_0.png'))
    assert.ok(copied.isFile(), '媒体文件应落在 library/<assetId>/ 下')

    // 源文件缺失：CS-LIB-003，且不留半截条目与孤儿目录。
    await assert.rejects(
      () => library.create({
        category: 'scene',
        name: '断链场景',
        media: [{ sourcePath: join(sourceDir, 'missing.png') }],
      }),
      (err) => err.code === 'CS-LIB-003',
    )
    assert.deepEqual(await namesOf(library), ['女主'], '失败的 create 不许留下条目')
    assert.deepEqual(await readdir(join(root, 'library')), [asset.id],
      '失败的 create 不许留下孤儿媒体目录')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('REQ-001：addAnchor —— 锚点去重（幂等），媒体续接 m_1；remove 清媒体目录', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-lib-'))
  try {
    const sourceDir = join(root, 'sources')
    await mkdir(sourceDir, { recursive: true })
    const front = join(sourceDir, 'front.png')
    const side = join(sourceDir, 'side.png')
    await writeFile(front, Buffer.from('a'))
    await writeFile(side, Buffer.from('b'))

    const library = new AssetLibrary(root)
    const asset = await library.create({
      category: 'character',
      name: '女主',
      anchors: [{ projectId: 'p1', nodeId: 'n1' }],
      media: [{ sourcePath: front, label: '正视图' }],
    })

    // 同一锚点再挂一次（带新媒体）：锚点不重复，媒体从 m_1 续接。
    const reanchored = await library.addAnchor(
      asset.id,
      { projectId: 'p1', nodeId: 'n1' },
      [{ sourcePath: side, label: '侧视图' }],
    )
    assert.equal(reanchored.anchors.length, 1, '同一 {projectId,nodeId} 不重复挂')
    assert.deepEqual(reanchored.media.map((entry) => entry.file), ['m_0.png', 'm_1.png'])

    // 纯重复调用（无新媒体）：原样返回，不写盘（updatedAt 不变）。
    const again = await library.addAnchor(asset.id, { projectId: 'p1', nodeId: 'n1' })
    assert.equal(again.updatedAt, reanchored.updatedAt, '幂等调用不落新时间戳')

    // 删除：条目 + 媒体目录 + 墓碑。
    await library.remove(asset.id)
    assert.deepEqual(await namesOf(library), [])
    const libDirs = await readdir(join(root, 'library')).catch(() => [])
    assert.ok(!libDirs.includes(asset.id), '媒体目录应被清掉')
    assert.ok((await onDisk(root)).deleted.includes(asset.id))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('REQ-001：collectNodeMediaSources —— 节点/文件缺失 CS-LIB-003，无 url 节点回空', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-lib-'))
  try {
    const registry = new ProjectRegistry(root)
    const project = await registry.create('源项目')
    const assetsDir = registry.assetsDir(project.id)
    await mkdir(assetsDir, { recursive: true })
    await writeFile(join(assetsDir, 'shot.png'), Buffer.from('img'))
    await registry.writeCanvas(project.id, [
      canvasNode({ id: 'n1', url: '/canvas-studio/assets/shot.png' }),
      canvasNode({ id: 'n2', kind: 'text', url: undefined }),
    ])

    const withMedia = await collectNodeMediaSources(registry, project.id, 'n1')
    assert.equal(withMedia.sources.length, 1)
    assert.equal(withMedia.sources[0].sourcePath, join(assetsDir, 'shot.png'))

    const textNode = await collectNodeMediaSources(registry, project.id, 'n2')
    assert.deepEqual(textNode.sources, [], '无 url 节点允许入库为纯元数据条目')

    await assert.rejects(
      () => collectNodeMediaSources(registry, project.id, '不存在的节点'),
      (err) => err.code === 'CS-LIB-003',
      '源节点缺失时宁可拒绝入库，不产出媒体悬空的库条目',
    )
    await assert.rejects(
      () => collectNodeMediaSources(registry, project.id, 'n-fresh'),
      (err) => err.code === 'CS-LIB-003',
      '节点不在画布上同样是 CS-LIB-003',
    )

    // 文件被清掉后：同节点取数 → CS-LIB-003（不产出悬空媒体）。
    await rm(join(assetsDir, 'shot.png'))
    await assert.rejects(
      () => collectNodeMediaSources(registry, project.id, 'n1'),
      (err) => err.code === 'CS-LIB-003',
      '媒体文件缺失（进 .trash / 被 GC）时拒绝入库',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('REQ-001：list 过滤（category/q）与 recordUsage 幂等', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-lib-'))
  try {
    const library = new AssetLibrary(root)
    const luna = await library.create({ category: 'character', name: 'Luna', aliases: ['女主'], tags: ['主角'] })
    await library.create({ category: 'scene', name: '雨夜街口', description: '霓虹反光' })
    const prop = await library.create({ category: 'prop', name: '怀表' })

    assert.deepEqual((await library.list({ category: 'character' })).map((entry) => entry.name), ['Luna'])
    assert.deepEqual((await library.list({ q: '女主' })).map((entry) => entry.name), ['Luna'],
      'q 要能匹配到别名')
    assert.deepEqual((await library.list({ q: '霓虹' })).map((entry) => entry.name), ['雨夜街口'],
      'q 要能匹配到描述')

    // recordUsage 幂等：同 {projectId,nodeId} 不重复追加。
    const once = await library.recordUsage(luna.id, { projectId: 'p1', nodeId: 'n1' })
    const twice = await library.recordUsage(luna.id, { projectId: 'p1', nodeId: 'n1' })
    assert.equal(once.usage.length, 1)
    assert.equal(twice.usage.length, 1, '重复引用不重复计数')
    await library.recordUsage(prop.id, { projectId: 'p2' })
    assert.equal((await library.require(prop.id)).usage.length, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('REQ-001：libraryIdOfHandle 句柄取 id', () => {
  assert.equal(libraryIdOfHandle('lib:abc-123'), 'abc-123')
  assert.equal(libraryIdOfHandle('  lib:abc-123  '), 'abc-123')
  assert.equal(libraryIdOfHandle('node:n1'), undefined, '非 lib: 前缀交回调用方走画布解析')
  assert.equal(libraryIdOfHandle('lib:'), undefined, '空 id 段同样不产句柄')
})

test('REQ-001 守卫：所有写盘必须经过 commit（合流出口唯一）', () => {
  const source = readFileSync(join(SRC_DIR, 'asset-library.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
  const atomicWrites = [...source.matchAll(/writeFileAtomic\(/g)].length
  assert.equal(atomicWrites, 1, `原子写只准出现在 commit 内，实际有 ${atomicWrites} 处`)
  const commits = [...source.matchAll(/await this\.commit\(/g)].length
  assert.ok(commits >= 5, `create/update/remove/addAnchor/recordUsage 都应经 commit，实际 ${commits} 处`)
  // 合流出口内部必须真的走墓碑与磁盘并集（而不是换个名字的裸写）。
  assert.match(source, /tombstones\.has\(entry\.id\)/u, '合流必须按墓碑过滤')
  assert.match(source, /document\?\.assets \?\? \[\]/u, '合流必须以磁盘记录为基准')
})
