/**
 * CV-264③：项目列表按「最后修改」倒序 —— 写入口这一侧的守卫。
 *
 * 排序比较器在 `tests/project-sections.test.mjs`（纯函数，一测就过）；这里盯的是
 * **排序的燃料从哪来**，以及 REQ-005/T4 旧燃料的**退役**：
 *
 * 1. `writeCanvas`（画布保存 / 生成结算的唯一落盘口）必须刷 `updatedAt` ——
 *    「我改了画布 / 生成了产物」是「最后修改」最权威的信号；draft 目录
 *    （registry 无记录）静默跳过，不许把保存画布拖进错误面；
 * 2. `moveProjectToGroup` 补写 updatedAt —— 整理分组是显式改动（原 T4 语义保留）；
 * 3. **touch 链路退役**：「打开项目」不再写 updatedAt（验收反馈：点哪个哪个
 *    跳第一，不稳定）—— 路由 / api / 客户端三段接线必须真的删干净，防止复活。
 *
 * 直连 Host tsc 产物 `lib/projects.js`。运行：
 *   corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProjectRegistry } from '../lib/projects.js'

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const readSrc = (rel) => readFileSync(join(ROOT_DIR, 'src', rel), 'utf8')
const onDisk = async (root, file = 'projects.json') => JSON.parse(await readFile(join(root, file), 'utf8'))

/** 与 Host 同一时钟口径：ISO 毫秒精度，隔一个 tick 才保证可比。 */
const tick = () => new Promise((resolve) => setTimeout(resolve, 12))

test('writeCanvas：画布落盘刷新 updatedAt（本地缓存 + 磁盘同值）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-touch-'))
  try {
    const registry = new ProjectRegistry(root)
    const created = await registry.create('画布改动')
    await tick()

    await registry.writeCanvas(created.id, [])
    const after = await registry.getProject(created.id)
    assert.ok(Date.parse(after.updatedAt) > Date.parse(created.updatedAt),
      `画布保存必须把 updatedAt 往前顶（${created.updatedAt} → ${after.updatedAt}）`)
    // 缓存与磁盘要一致 —— 只改内存的话下一次 commitRegistry 会把它写回去。
    const diskProject = (await onDisk(root)).projects.find((entry) => entry.id === created.id)
    assert.equal(diskProject.updatedAt, after.updatedAt)
    // 画布本体也真的落了盘（dir 是绝对路径，直接拼 canvas.json）。
    const canvas = JSON.parse(await readFile(join(created.dir, 'canvas.json'), 'utf8'))
    assert.ok(Array.isArray(canvas.nodes), '画布文档必须真实落盘')
    // bump 只动排序字段：名字/创建时间/目录不许被顺手改掉。
    assert.equal(after.name, created.name)
    assert.equal(after.createdAt, created.createdAt)
    assert.equal(after.dir, created.dir)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('writeCanvas：registry 无记录（draft 目录）静默跳过 bump，不影响保存', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-touch-'))
  try {
    const registry = new ProjectRegistry(root)
    // draft 目录：projects/ 下真实存在但 registry 无记录 —— touchUpdatedAt 找不到
    // 记录必须静默 return，而不是抛 CS-PROJ-001 把保存画布拖进错误面。
    await registry.writeCanvas('draft-no-record', [])
    assert.deepEqual(await registry.list(), [], '不许顺手 upsert 一条记录')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('moveProjectToGroup：移动是显式改动，也必须写 updatedAt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-touch-'))
  try {
    const registry = new ProjectRegistry(root)
    const group = await registry.createGroup('分组 A')
    const created = await registry.create('待归档')
    await tick()

    await registry.moveProjectToGroup(created.id, group.id)
    const moved = await registry.getProject(created.id)
    assert.equal(moved.groupId, group.id, '移动本身照常生效')
    assert.ok(Date.parse(moved.updatedAt) > Date.parse(created.updatedAt),
      '不写 updatedAt 的话，刚整理过的项目在倒序列表里纹丝不动，像「移动没生效」')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('接线：touch 链路必须真的删干净（路由 / api / 客户端三段都不许复活）', () => {
  const routes = readSrc('routes.ts')
  assert.doesNotMatch(routes, /ROUTE_PROJECT_TOUCH/, 'touch 路由常量不许残留')
  assert.doesNotMatch(routes, /projects\/touch/, 'touch 路由路径不许残留')
  assert.doesNotMatch(routes, /registry\.touchProject/, 'touch 的 registry 调用不许残留')

  const api = readSrc('client/api.ts')
  assert.doesNotMatch(api, /touchStudioProject|projects\/touch/, 'api 封装不许残留')

  const store = readSrc('client/project-store.ts')
  assert.doesNotMatch(store, /touchProject/, 'store action 不许残留')

  const client = readSrc('client/index.ts')
  assert.doesNotMatch(client, /touchStudioProject|actions\.touchProject/,
    '打开项目不许再 touch —— 「点哪个哪个跳第一」就是它干的')
})

test('接线：projects.ts 的 touchProject 公开方法退役（writeCanvas 内部刷写收口）', () => {
  const projects = readSrc('projects.ts')
  assert.doesNotMatch(projects, /async touchProject\(/, '公开 touchProject 方法不许残留')
  assert.match(projects, /touchUpdatedAt\(projectId\)\.catch/, 'writeCanvas 的尽力而为刷写必须静默容错')
})
