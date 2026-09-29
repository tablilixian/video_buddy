/**
 * REQ-005 / T4：项目列表按「最近改动」倒序 —— 写入口这一侧的守卫。
 *
 * 排序比较器在 `tests/project-sections.test.mjs`（纯函数，一测就过）；这里盯的是
 * **排序的燃料从哪来**：
 *
 * 1. `ProjectRegistry.touchProject` ——「打开项目」也要写 updatedAt，否则列表永远
 *    按建库时间排，「我最近在做哪个」答不上来；
 * 2. `moveProjectToGroup` 补写 updatedAt —— 整理分组是显式改动，不写的话刚归好类
 *    的项目纹丝不动地留在原地，读起来像「移动没生效」；
 * 3. 路由 / api / 客户端三段接线 —— 路径写错或漏了 same-origin 闸，touch 就是
 *    一个静默不生效的空动作（客户端 fire-and-forget，失败不留痕）。
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
const onDisk = async (root) => JSON.parse(await readFile(join(root, 'projects.json'), 'utf8'))

/** 与 Host 同一时钟口径：ISO 毫秒精度，隔一个 tick 才保证可比。 */
const tick = () => new Promise((resolve) => setTimeout(resolve, 12))

test('touchProject：把 updatedAt 顶到当前时刻并落盘（本地缓存 + 磁盘同值）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-touch-'))
  try {
    const registry = new ProjectRegistry(root)
    const created = await registry.create('倒序燃料')
    await tick()

    const touched = await registry.touchProject(created.id)
    assert.ok(Date.parse(touched.updatedAt) > Date.parse(created.updatedAt),
      `touch 必须把 updatedAt 往前顶（${created.updatedAt} → ${touched.updatedAt}）`)
    // 缓存与磁盘要一致 —— 只改内存的话下一次 commitRegistry 会把它写回去。
    assert.equal((await registry.getProject(created.id)).updatedAt, touched.updatedAt)
    const disk = await onDisk(root)
    assert.equal(disk.projects.find((entry) => entry.id === created.id).updatedAt, touched.updatedAt)
    // touch 只动排序字段：名字/创建时间/目录不许被顺手改掉。
    assert.equal(touched.name, created.name)
    assert.equal(touched.createdAt, created.createdAt)
    assert.equal(touched.dir, created.dir)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('touchProject：项目不存在 → CS-PROJ-001（不静默造记录）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-touch-'))
  try {
    const registry = new ProjectRegistry(root)
    await assert.rejects(
      () => registry.touchProject('no-such-project'),
      (err) => err.code === 'CS-PROJ-001',
      '与其它写方法同一口径：找不到就报错，而不是 upsert 一条空记录',
    )
    assert.deepEqual(await registry.list(), [], '失败路径不许留下半条记录')
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

test('接线：touch 路由是 exact 路径 + same-origin 闸，且真的调到 touchProject', () => {
  const routes = readSrc('routes.ts')
  assert.match(routes, /ROUTE_PROJECT_TOUCH = '\/canvas-studio\/projects\/touch'/,
    'touch 走独立 exact 路径（ROUTE_PROJECTS 的 POST 已被「创建」占满）')
  assert.match(routes, /path: ROUTE_PROJECT_TOUCH, handler:/, '必须真的注册这条路由')
  assert.match(routes, /path: ROUTE_PROJECT_TOUCH, handler:[\s\S]{0,400}req\.method !== 'POST' \|\| !mutationAllowed\(req, expectedPort\)/,
    '写操作必须过 same-origin 闸（读只要 loopback，写再加同一来源）')
  assert.match(routes, /registry\.touchProject\(body\.id\)/, '路由必须落到 registry.touchProject')

  const api = readSrc('client/api.ts')
  assert.match(api, /fetch\('\/canvas-studio\/projects\/touch'/, 'api 封装的路径必须与路由注册一字不差')
  assert.match(api, /export async function touchStudioProject\(/, 'api 面必须导出 touchStudioProject')
})

test('接线：openProject 成功路径 fire-and-forget touch，失败不进错误面', () => {
  const client = readSrc('client/index.ts')
  const openProject = client.slice(
    client.indexOf('const openProject = '),
    client.indexOf('const isDuplicateProjectName'),
  )
  assert.match(openProject, /actions\.touchProject\(project\.id, new Date\(\)\.toISOString\(\)\)/,
    '本地先顶一格：排序立刻生效，不等网络')
  assert.match(openProject, /void touchStudioProject\(project\.id\)/,
    '服务端 touch 必须 fire-and-forget（不 await，避免给打开项目加一次网络往返）')
  assert.match(openProject, /\.catch\(\(\) => \{\}\)/,
    'touch 失败必须静默 —— 它是排序提示，绝不能把「打开项目」拖进错误面')
  assert.doesNotMatch(openProject, /await touchStudioProject/, '不许改成 await：打开的主流程不该等它')
})
