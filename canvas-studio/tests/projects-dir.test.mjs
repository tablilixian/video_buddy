/**
 * 项目落盘目录名测试（2026-08-31：目录 = 用户名的 sanitize 版本，不再是 UUID）。
 * 1. sanitizeProjectDirName 纯函数：保留中文、替换非法字符、保留设备名、首尾点、
 *    空回退、字节截断、幂等。
 * 2. ProjectRegistry.create 集成：临时目录 + 真实 registry，断言目录名 = 用户名、
 *    sanitize 碰撞唯一化、同名拒绝、assets 落盘。
 * 直连 Host tsc 产物 lib/projects.js。运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectRegistry, sanitizeProjectDirName } from '../lib/projects.js'

test('sanitizeProjectDirName：中文名原样保留（用户可读）', () => {
  assert.equal(sanitizeProjectDirName('我的动画项目'), '我的动画项目')
  assert.equal(sanitizeProjectDirName('  少女与猫  '), '少女与猫')
})

test('sanitizeProjectDirName：非法字符替换为 -', () => {
  assert.equal(sanitizeProjectDirName('a:b?c*d"e|f<g>h'), 'a-b-c-d-e-f-g-h')
  assert.equal(sanitizeProjectDirName('a\\b'), 'a-b')
  assert.equal(sanitizeProjectDirName('x\u0000y'), 'x-y')
})

test('sanitizeProjectDirName：Windows 保留设备名加前缀', () => {
  assert.equal(sanitizeProjectDirName('CON'), 'project-CON')
  assert.equal(sanitizeProjectDirName('con.txt'), 'project-con.txt')
  assert.equal(sanitizeProjectDirName('COM1'), 'project-COM1')
  assert.equal(sanitizeProjectDirName('LPT9'), 'project-LPT9')
  // 普通词不受影响
  assert.equal(sanitizeProjectDirName('console'), 'console')
})

test('sanitizeProjectDirName：首尾点与空结果处理', () => {
  assert.equal(sanitizeProjectDirName('.hidden'), 'hidden')
  assert.equal(sanitizeProjectDirName('name.'), 'name')
  assert.equal(sanitizeProjectDirName('...'), 'project')
  assert.equal(sanitizeProjectDirName('///'), 'project')
  assert.equal(sanitizeProjectDirName(''), 'project')
})

test('sanitizeProjectDirName：UTF-8 字节截断（macOS 255 字节上限）', () => {
  const long = '画'.repeat(200) // 600 字节
  const result = sanitizeProjectDirName(long)
  assert.ok(Buffer.byteLength(result, 'utf8') <= 200, `字节数 ${Buffer.byteLength(result, 'utf8')}`)
  assert.ok(result.length > 0)
})

test('sanitizeProjectDirName：幂等', () => {
  const once = sanitizeProjectDirName('我的项目!x?y')
  assert.equal(sanitizeProjectDirName(once), once)
})

/** 真实 registry 集成：临时目录下建项目，断言磁盘目录 = 用户名。 */
async function withRegistry(run) {
  const root = await mkdtemp(join(tmpdir(), 'cs-registry-'))
  try {
    const registry = new ProjectRegistry(root)
    await run(registry, root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('create：目录名 = 用户名（中文可读），assets 落盘，dir 字段正确', async () => {
  await withRegistry(async (registry, root) => {
    const project = await registry.create('我的动画')
    assert.equal(project.dir, join(root, 'projects', '我的动画'))
    assert.equal(await stat(join(project.dir, 'assets')).then(s => s.isDirectory()), true)
    // 路径 API 与 dir 字段一致（不再是 projects/<uuid>）
    assert.equal(registry.assetsDir(project.id), join(project.dir, 'assets'))
    assert.equal(registry.canvasFile(project.id), join(project.dir, 'canvas.json'))
    // 列表可读
    assert.equal((await registry.list()).length, 1)
  })
})

test('create：sanitize 碰撞（a?b 与 a*b 都变 a-b）追加后缀唯一化', async () => {
  await withRegistry(async (registry, root) => {
    const first = await registry.create('a?b')
    const second = await registry.create('a*b')
    assert.equal(first.dir, join(root, 'projects', 'a-b'))
    assert.equal(second.dir, join(root, 'projects', 'a-b-2'))
    // 磁盘上确实存在两个独立目录
    const dirs = await readdir(join(root, 'projects'))
    assert.deepEqual([...dirs].sort(), ['a-b', 'a-b-2'])
  })
})

test('create：同名（大小写不敏感）仍拒绝', async () => {
  await withRegistry(async (registry) => {
    await registry.create('动画')
    await assert.rejects(() => registry.create('动画'), /项目名已存在/)
  })
})

test('create：英文名大小写不敏感拒绝', async () => {
  await withRegistry(async (registry) => {
    await registry.create('My Project')
    await assert.rejects(() => registry.create('my project'), /项目名已存在/)
  })
})

test('重启后 dirOf 从 registry 记录解析（不依赖 id=目录名假设，兼容历史 UUID 目录）', async () => {
  await withRegistry(async (registry, root) => {
    const project = await registry.create('我的动画')
    // 模拟重启：新实例从磁盘加载 registry 文件，dirOf 必须用记录里的 dir 字段。
    const reloaded = new ProjectRegistry(root)
    await reloaded.list()
    assert.equal(reloaded.projectDir(project.id), join(root, 'projects', '我的动画'))
    assert.equal(reloaded.assetsDir(project.id), join(root, 'projects', '我的动画', 'assets'))
  })
})

// R1（缺口 C）：设置页「默认执行模式」落进新项目工作流——此前该开关从不被消费，
// 新项目恒为 confirm/drafting。
test('create：默认执行模式 provider 为 auto 时，新项目 workflow.mode = auto', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-registry-mode-'))
  try {
    const registry = new ProjectRegistry(root, () => 'auto')
    const project = await registry.create('放手跑项目')
    assert.equal(project.workflow?.mode, 'auto')
    assert.equal(project.workflow?.state, 'drafting')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('create：默认执行模式缺省时新项目仍为 confirm（旧行为兼容）', async () => {
  await withRegistry(async (registry) => {
    const project = await registry.create('默认项目')
    assert.equal(project.workflow?.mode, 'confirm')
    assert.equal(project.workflow?.state, 'drafting')
  })
})

test('create：provider 是 live 读取——每次 create 取当时值', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-registry-live-'))
  try {
    let mode = 'confirm'
    const registry = new ProjectRegistry(root, () => mode)
    const first = await registry.create('项目一')
    assert.equal(first.workflow?.mode, 'confirm')
    mode = 'auto'
    const second = await registry.create('项目二')
    assert.equal(second.workflow?.mode, 'auto')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
