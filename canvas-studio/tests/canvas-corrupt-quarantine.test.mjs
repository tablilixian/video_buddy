/**
 * AR-02 守卫：`canvas.json` 损坏时**留证**，并且**绝不静默把原内容写掉**。
 *
 * 背景：修复前 `readCanvas` 解析失败直接 `return { nodes: [] }` —— 于是下一个保存
 * （Host 结算 / 客户端拖动都会触发）把「空 + 新节点」原子写回，磁盘上的原内容
 * **永久消失**，且没有任何痕迹。对比 `storyboard.json`：它早就有 `quarantine()`
 * 留证 + 显式报错（`storyboard-store.ts:79`，测试见 `tests/storyboard-store.test.mjs:61`）。
 *
 * 本文件钉住四件事：
 *   1. 损坏 → 原内容被**改名留证**到 `<canvas>.corrupt`，原路径清空；
 *   2. 留证之后画布**可以继续用**（按空画布重建）—— 这是刻意与故事板不同的选择
 *      （画布每次都自动保存，一律拒绝会让画布永久不可用；理由见 `file-quarantine.ts`）；
 *   3. 备份名稳定、二次损坏只留最近一次（不无限堆积）；
 *   4. **留证失败时拒绝写入** —— 唯一一种会真正丢数据的路径，必须硬拦。
 *   5. 反例：正常画布 / 缺失文件 / 空文件都**不得**产生 `.corrupt`（不许乱留证）。
 *
 * 从 ../lib/*.js 导入 —— 先 build 再跑。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectRegistry } from '../lib/projects.js'

const CORRUPT = '{ this is not json'

/** 最小合法节点（字段与 `isCanvasNode` 兼容）。 */
const node = (id) => ({
  id,
  kind: 'image',
  title: id,
  url: `/canvas-studio/assets/p/${id}.png`,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  createdAt: 1,
  origin: 'agent',
  sourceIds: [],
})

async function withRegistry(run) {
  const root = await mkdtemp(join(tmpdir(), 'cs-ar02-corrupt-'))
  try {
    const registry = new ProjectRegistry(root)
    // 必须走 create：项目目录由它建立（canvasFile 的父目录不是自动存在的）。
    const project = await registry.create('画布损坏测试')
    await run(registry, project)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('AR-02：损坏画布 → 原内容留证到 .corrupt，原路径清空，读回为空画布', async () => {
  await withRegistry(async (registry, project) => {
    const file = registry.canvasFile(project.id)
    await writeFile(file, CORRUPT, 'utf8')

    const document = await registry.readCanvas(project.id)
    assert.equal(document.nodes.length, 0, '损坏时按空画布继续（调用方无需特判）')

    assert.equal(existsSync(file), false, '原路径必须已清空（否则下一次保存就是把原内容盖掉）')
    const backup = `${file}.corrupt`
    assert.ok(existsSync(backup), '必须留证成 <canvas>.corrupt')
    assert.equal(await readFile(backup, 'utf8'), CORRUPT, '备份必须是逐字节的原内容')
  })
})

test('AR-02：留证之后画布可以继续用（重建成功，且落盘是合法 JSON）', async () => {
  await withRegistry(async (registry, project) => {
    const file = registry.canvasFile(project.id)
    await writeFile(file, CORRUPT, 'utf8')

    await registry.appendCanvasNode(project.id, node('rebuilt'))
    const document = await registry.readCanvas(project.id)
    assert.equal(document.nodes.length, 1)
    assert.equal(document.nodes[0].id, 'rebuilt')
    // 落盘内容必须是合法 JSON（不再是损坏文本）
    const parsed = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(parsed.nodes.length, 1)
    assert.ok(existsSync(`${file}.corrupt`), '留证文件仍在（重建不吞证据）')
  })
})

test('AR-02：直接 writeCanvas 也先留证再覆盖（原内容进备份，不消失）', async () => {
  await withRegistry(async (registry, project) => {
    const file = registry.canvasFile(project.id)
    await writeFile(file, CORRUPT, 'utf8')

    await registry.writeCanvas(project.id, [node('a')])
    const parsed = JSON.parse(await readFile(file, 'utf8'))
    deepEqualIds(parsed.nodes, ['a'])
    assert.equal(await readFile(`${file}.corrupt`, 'utf8'), CORRUPT, '原损坏内容必须仍在备份里')
  })
})

test('AR-02：二次损坏只保留最近一次备份（备份名稳定，不无限堆积）', async () => {
  await withRegistry(async (registry, project) => {
    const file = registry.canvasFile(project.id)
    await writeFile(file, '{ 第一次损坏', 'utf8')
    await registry.readCanvas(project.id)
    const first = await readFile(`${file}.corrupt`, 'utf8')
    assert.equal(first, '{ 第一次损坏')

    await writeFile(file, '{ 第二次损坏', 'utf8')
    await registry.readCanvas(project.id)
    const second = await readFile(`${file}.corrupt`, 'utf8')
    assert.equal(second, '{ 第二次损坏', '只保留最近一次损坏')
  })
})

test('AR-02：留证失败时**拒绝写入**（唯一会真丢数据的路径必须硬拦）', async () => {
  await withRegistry(async (registry, project) => {
    const file = registry.canvasFile(project.id)
    await writeFile(file, CORRUPT, 'utf8')
    // 让备份路径变成一个「非空目录」→ rename(file, backup) 必然失败，
    // 从而构造出「原文件读不懂、又迁不走」这个唯一的危险状态。
    await mkdir(`${file}.corrupt`, { recursive: true })
    await writeFile(join(`${file}.corrupt`, 'occupied.txt'), 'x', 'utf8')

    await assert.rejects(
      () => registry.writeCanvas(project.id, [node('a')]),
      (error) => error.code === 'CS-DEV-ERR' && error.devMessage.includes('拒绝写入'),
      '留证失败时写入必须被拒绝 —— 否则唯一一份数据被覆盖',
    )
    // 关键：原文件必须**原封不动**还在
    assert.equal(await readFile(file, 'utf8'), CORRUPT, '被拒绝的这次写入不得触碰原文件')
    await assert.rejects(() => registry.appendCanvasNode(project.id, node('b')))
  })
})

test('AR-02 反例：只有「解析失败」才留证 —— 缺失与正常画布都不许产生 .corrupt', async () => {
  await withRegistry(async (registry, project) => {
    const file = registry.canvasFile(project.id)
    // 缺失：文件根本不在，没有可保全的东西
    assert.equal((await registry.readCanvas(project.id)).nodes.length, 0)
    assert.equal(existsSync(`${file}.corrupt`), false, '缺失 ≠ 损坏，不该留证')

    // 空文件：**算损坏**（空串不是合法 JSON）。这里刻意不设特例分支 —— 行为统一
    // 比省下一个 0 字节备份更值；且空文件本身就是「被截断」的证据。
    await writeFile(file, '', 'utf8')
    await registry.readCanvas(project.id)
    assert.ok(existsSync(`${file}.corrupt`), '空文件同样按「解析失败」留证（不留特例）')
    assert.equal(await readFile(`${file}.corrupt`, 'utf8'), '', '留证的就是那个空文件本身')
    assert.equal(existsSync(file), false, '原路径已清空')

    // 正常画布：不得留证
    await registry.writeCanvas(project.id, [node('ok')])
    await registry.readCanvas(project.id)
    assert.equal(existsSync(`${file}.corrupt`), true, '上一步的空档留证仍在（不被吞）')
    const before = await readFile(`${file}.corrupt`, 'utf8')
    await registry.readCanvas(project.id)
    assert.equal(await readFile(`${file}.corrupt`, 'utf8'), before, '正常读取不产生新的留证/不改动已有留证')
  })
})

/** 顺序无关的 id 集合比较（避免依赖落盘顺序）。 */
function deepEqualIds(nodes, expected) {
  assert.deepEqual([...nodes.map((entry) => entry.id)].sort(), [...expected].sort())
}
