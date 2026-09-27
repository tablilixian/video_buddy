/**
 * CV-242 契约测试：writeCanvas 的写者语义 —— 字段保护 + 显式删除协议。
 *
 * 背景（2026-09-27 真机实查，见 docs/plans/参考句柄断链根治方案.md）：canvas.json 有
 * 两个写者——Host 做字段级回写（惰性 promote / heal），客户端做整档覆盖保存。此前：
 *   1. 客户端内存副本感知不到 Host 的中途回写，视频异步窗口（提交→轮询完成可达数分钟）
 *      内一拖画布就把 filename 冲掉 ⇒ 详情面板参考图反查断链（分镜 6 提到 3 张只显示 2 张）；
 *   2. preserved 分不清「客户端还不知道」与「客户端已删除」，删除的节点在磁盘上复活
 *     （2026-08-25 的「删除复活」修复只治理了客户端侧读写竞态）。
 *
 * 锁住四条行为：
 *   1. 客户端保存（author:'client'）：同 id 节点 filename 以服务端为准（旧副本不冲掉回写）；
 *   2. Host 写入：incoming 恒胜（heal 换名不被自己的保护弹回）；
 *   3. removedIds：显式删除真删（不复活），未知节点照常保护（生成产物不被拖保存冲掉）；
 *   4. 新节点与普通字段照常写入（保护不误伤）。
 *
 * 直连 Host tsc 产物 lib/projects.js。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectRegistry } from '../lib/projects.js'

/** 最小合法画布节点（字段与 normalizeCanvasDocument 兼容）。 */
const node = (overrides = {}) => ({
  id: 'n1',
  kind: 'image',
  title: '末帧 · 分镜 5',
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

/** 客户端整档保存（走画布保存路由的同一语义）。 */
const clientSave = (registry, projectId, nodes, removedIds) =>
  registry.writeCanvas(projectId, nodes, undefined, undefined, {
    author: 'client',
    ...(removedIds !== undefined ? { removedIds } : {}),
  })

async function withRegistry(run) {
  const root = await mkdtemp(join(tmpdir(), 'cs-cv242-merge-'))
  try {
    const registry = new ProjectRegistry(root)
    await run(registry)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('CV-242：客户端旧副本（无 filename）保存不冲掉 Host 回写的 filename', async () => {
  await withRegistry(async (registry) => {
    const project = await registry.create('断链保护')
    // 初始：末帧节点创建时无 filename（本地产物，未上传 Drama）
    await clientSave(registry, project.id, [node()])
    // Host 惰性 promote 回写 filename（客户端副本未同步）
    await registry.writeCanvas(project.id, [node({ filename: 'ref-7516d08b.png' })])
    // 客户端带着旧副本（无 filename）整档保存——拖动画布即可触发
    await clientSave(registry, project.id, [node()])
    const doc = await registry.readCanvas(project.id)
    assert.equal(doc.nodes[0].filename, 'ref-7516d08b.png', 'filename 应以服务端为准保留')
  })
})

test('CV-242：Host heal 换名写入不被字段保护弹回（incoming 恒胜）', async () => {
  await withRegistry(async (registry) => {
    const project = await registry.create('换名放行')
    await registry.writeCanvas(project.id, [node({ filename: 'ref-aaaabbbb.png' })])
    // Host heal：句柄过期后重传拿到新句柄并回写（Host 写入不走保护）
    await registry.writeCanvas(project.id, [node({ filename: 'ref-ccccdddd.png' })])
    const doc = await registry.readCanvas(project.id)
    assert.equal(doc.nodes[0].filename, 'ref-ccccdddd.png', 'Host 写入应原样落盘')
  })
})

test('CV-242：客户端拿旧句柄保存仍以服务端为准', async () => {
  await withRegistry(async (registry) => {
    const project = await registry.create('旧句柄不回写')
    await registry.writeCanvas(project.id, [node({ filename: 'ref-ccccdddd.png' })])
    // 客户端副本还停在 heal 前的旧句柄
    await clientSave(registry, project.id, [node({ filename: 'ref-aaaabbbb.png' })])
    const doc = await registry.readCanvas(project.id)
    assert.equal(doc.nodes[0].filename, 'ref-ccccdddd.png', '应保留服务端最新句柄')
  })
})

test('CV-242：removedIds 让删除真删（不复活）；未上送账本的旧节点照常保护', async () => {
  await withRegistry(async (registry) => {
    const project = await registry.create('删除协议')
    // 磁盘上有两个节点；Host 刚生成 n3（客户端还不知道）
    await clientSave(registry, project.id, [node({ id: 'n1' }), node({ id: 'n2' })])
    await registry.writeCanvas(project.id, [node({ id: 'n1' }), node({ id: 'n2' }), node({ id: 'n3', title: '刚生成的产物' })])
    // 客户端删掉 n1 后保存（removedIds=[n1]，且副本里没有 n3）
    await clientSave(registry, project.id, [node({ id: 'n2' })], ['n1'])
    const doc = await registry.readCanvas(project.id)
    assert.deepEqual(doc.nodes.map((entry) => entry.id).sort(), ['n2', 'n3'], 'n1 真删；n3 不被拖保存冲掉')
  })
})

test('CV-242：不传 removedIds 的客户端保存保持既有保护语义（兼容）', async () => {
  await withRegistry(async (registry) => {
    const project = await registry.create('兼容语义')
    await clientSave(registry, project.id, [node({ id: 'n1' }), node({ id: 'n2' })])
    // 客户端只发 n2（模拟「还不知道 n1 被删」之外的场景——例如生成产物刚落盘）
    await clientSave(registry, project.id, [node({ id: 'n2' })])
    const doc = await registry.readCanvas(project.id)
    assert.deepEqual(doc.nodes.map((entry) => entry.id).sort(), ['n1', 'n2'], '无账本时 preserved 照旧')
  })
})

test('CV-242：新节点与普通字段照常写入（保护不误伤）', async () => {
  await withRegistry(async (registry) => {
    const project = await registry.create('新增节点')
    await clientSave(registry, project.id, [node({ id: 'n1', filename: 'ref-aaaabbbb.png' })])
    // 客户端新增 n2（带服务端签发的 filename）并移动 n1
    await clientSave(registry, project.id, [
      node({ id: 'n1', filename: 'ref-aaaabbbb.png', x: 500 }),
      node({ id: 'n2', filename: 'ref-eeeeffff.png', title: '抽帧 01' }),
    ])
    const doc = await registry.readCanvas(project.id)
    assert.equal(doc.nodes.length, 2)
    const n1 = doc.nodes.find((entry) => entry.id === 'n1')
    assert.equal(n1.x, 500, '坐标等普通字段照常更新')
    assert.equal(n1.filename, 'ref-aaaabbbb.png')
    const n2 = doc.nodes.find((entry) => entry.id === 'n2')
    assert.equal(n2.filename, 'ref-eeeeffff.png', '新节点的字段不丢')
  })
})
