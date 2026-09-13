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

test('CR-003：缓存未命中时回退路径越界（projectId=../x）直接拒绝，不穿目录', async () => {
  await withRegistry(async (registry, root) => {
    // 缓存未加载（新实例未 list()）时 dirOf 走回退分支；`../x` 必须被拦下，
    // 否则 writeFileAtomic 会把 canvas.json/skills.json 写到 projects 之外。
    const fresh = new ProjectRegistry(root)
    assert.throws(() => fresh.canvasFile('../escape'), /非法项目目录引用/u)
    assert.throws(() => fresh.assetsDir('..'), /非法项目目录引用/u)
    assert.throws(() => fresh.activeSkillsFile('../win'), /非法项目目录引用/u)
  })
})

test('CR-003：缓存未命中时合法 id 仍回退 projects/<id>（安全网语义不变）', async () => {
  await withRegistry(async (registry, root) => {
    const fresh = new ProjectRegistry(root)
    assert.equal(fresh.canvasFile('a1b2c3'), join(root, 'projects', 'a1b2c3', 'canvas.json'))
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

/** 造一个能通过 isCanvasNode 校验的节点（CV-172 用例专用）。 */
function canvasNode(fields) {
  return {
    x: 0, y: 0, width: 360, height: 220,
    createdAt: 1757000000000, origin: 'agent', sourceIds: [],
    ...fields,
  }
}

/**
 * CV-172 回归：**组节点必须能写进磁盘再读回来**。
 *
 * 背景（09-13 用真实项目 canvas.json 定位到）：isCanvasNode 的 kind 白名单漏了
 * 'group'，于是 normalizeCanvasDocument 在**读盘时**把 attachShotGroup 写出的组节点
 * 丢掉；writeCanvas 的 merge-protect 又基于同一条读路径，下一次写盘就把组**物理
 * 抹除**。后果是成员节点的 parentId 从此悬空 —— 同一分镜的产物各自新建
 * grp-<自己id> 的组，图层面板因为「父不存在」整行消失（实测 18 节点只渲染 11 行）。
 *
 * 这是「写了读不回」的静默 bug：画布上看不出异常，只有对着 readCanvas 的返回值
 * 断言才能钉住。故本用例必须保留。
 */
test('CV-172：组节点能落盘并读回（漏 group 会让成员 parentId 悬空）', async () => {
  await withRegistry(async (registry) => {
    const project = await registry.create('组节点回归')
    const shotCard = canvasNode({ id: 'shot-1', kind: 'text', title: '分镜 1 · 中景' })
    const keyframe = canvasNode({ id: 'kf-1', kind: 'image', url: '/canvas-studio/assets/kf1.png', parentId: 'grp-kf-1' })
    const group = canvasNode({ id: 'grp-kf-1', kind: 'group', title: '分镜 1 · 素材', zIndex: -1, sourceIds: ['shot-1'] })

    await registry.writeCanvas(project.id, [shotCard, keyframe, group])
    const back = await registry.readCanvas(project.id)
    const ids = back.nodes.map(node => node.id)

    assert.ok(ids.includes('grp-kf-1'), '组节点必须能读回（否则 parentId 悬空 + 图层面板丢行）')
    assert.equal(
      back.nodes.find(node => node.id === 'kf-1').parentId,
      'grp-kf-1',
      '成员的 parentId 必须指向一个真实存在的组',
    )
    assert.equal(
      ids.filter(id => id === 'grp-kf-1').length,
      1,
      '组不得被重复写入',
    )

    // 重复写盘（模拟客户端保存）也不能把组挤掉：merge-protect 的读路径同样要看得见组。
    await registry.writeCanvas(project.id, [shotCard, keyframe, group])
    const again = await registry.readCanvas(project.id)
    assert.ok(again.nodes.some(node => node.id === 'grp-kf-1'), '重复写盘后组仍在')
    assert.equal(again.nodes.length, 3, '节点数不得膨胀')
  })
})
