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

// ---------------------------------------------------------------------------
// C-10（2026-10-02）：appendCanvasNode 与并发客户端保存都不能被对方整档写掉。
//
// 「agent 活动期加图，一刷新就没了」的通道：Host「读快照 → 写整档」窗口内客户端
// 保存落盘，陈旧快照把用户新加的素材整档覆盖。
//
// **AR-01（2026-10-11）改写了本用例的模拟方式**。原实现用「钩住 `readCanvas`，
// 在 append 读盘后、写盘前**内联**触发一次客户端保存」来制造交错。入队串行化之后
// 这种写法变成了**同 key 重入**（append 的队列任务里再去 `writeCanvas` 入同一 key），
// 而队列已把它改成显式抛错（不是静默挂起）——即这个模拟本身不再合法。
//
// 更重要的是：**该场景在新实现下已结构性不可能**。客户端保存与 append 现在走同一条
// 队列（同文件 → 同 key），二者必然串行，后跑的那个读到的是先跑者的结果再合并。
// 所以这里改成**忠实的生产形态**：两个写者各自独立并发发起，断言两者都不丢
// （两种先后顺序下结果都必须是 a+b+c，与调度无关）。
// ---------------------------------------------------------------------------
test('C-10：appendCanvasNode 与并发客户端保存互不覆盖（真实并发形态）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-append-'))
  try {
    const registry = new ProjectRegistry(dir)
    const project = await registry.create('append竞态')
    const node = (id, createdAt) => ({
      id, kind: 'image', url: `/u/${id}.png`, x: 0, y: 0, width: 10, height: 10, createdAt, origin: 'agent', sourceIds: [],
    })
    await registry.appendCanvasNode(project.id, node('a', 1))
    // 两个独立写者并发发起：Host 追加 c；客户端整档保存「它知道的 a + 新增 b」。
    // 队列保证串行 —— 无论谁先跑，客户端那份都不能把 c 写掉、append 也不能把 b 写掉。
    await Promise.all([
      registry.appendCanvasNode(project.id, node('c', 3)),
      registry.writeCanvas(project.id, [node('a', 1), node('b', 2)], undefined, undefined, { author: 'client' }),
    ])
    const doc = await registry.readCanvas(project.id)
    const ids = doc.nodes.map((n) => n.id).sort()
    assert.deepEqual(ids, ['a', 'b', 'c'], '并发客户端新增（b）必须幸存，host 追加（c）照常落盘')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
