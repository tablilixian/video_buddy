/**
 * CV-046：注册表**跨实例**互相覆盖。
 *
 * 症状：注册表落在 `$DSH_HOME/canvas-studio/`（home 根下、跨 profile 共享），且是
 * 「常驻内存 + 原子写」。用户把插件装进两个共享同一 DSH home 的实例（已有 web 端
 * server + 本项目桌面壳）时，后写方会以自己的**内存副本整表覆盖** `projects.json`
 * —— 先写方新建的项目记录从注册表消失（目录还在磁盘上，表现为「项目丢了」）。
 * 原子写只保证文件不损坏，防不了两份内存态互相覆盖。
 *
 * 修法（2026-09-01 拍的方案②）：写盘前**与磁盘合流**（同 id 以内存为准、内存里
 * 没有的磁盘记录保留），删除额外落**墓碑**（否则删除会被对方的旧快照复活）。
 *
 * 本文件用**两个真实 ProjectRegistry 实例指向同一 root** 复刻并存场景。
 * 直连 Host 侧编译产物 lib/projects.js。运行：
 *   corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProjectRegistry } from '../lib/projects.js'

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

/** 读磁盘上的注册表文档（测试直接看落盘结果，不看内存缓存）。 */
async function onDisk(root) {
  return JSON.parse(await readFile(join(root, 'projects.json'), 'utf8'))
}

async function namesOf(registry) {
  return (await registry.list()).map((entry) => entry.name).sort()
}

test('CV-046：两个实例交替新建，谁的记录都不会被抹掉', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-registry-'))
  try {
    const a = new ProjectRegistry(root)
    await a.create('甲')

    // 第二个实例（模拟另一个 DSH 进程）启动后新建：它的缓存里没有「甲」。
    const b = new ProjectRegistry(root)
    await b.create('乙')

    const disk = await onDisk(root)
    assert.deepEqual(disk.projects.map((entry) => entry.name).sort(), ['乙', '甲'],
      '后写方不许拿自己的内存副本整表覆盖')
    // 缓存也要是合流后的清单 —— 否则**本实例下一次写盘**同样会丢。
    assert.deepEqual(await namesOf(b), ['乙', '甲'])
    // A 的缓存是它自己上次读盘那一刻的世界（常驻内存的定位如此），
    // CV-046 保证的是**不丢数据**：新开的实例读盘就能看到两条。
    assert.deepEqual(await namesOf(a), ['甲'], 'A 的内存快照尚未刷新是预期行为')
    assert.deepEqual(await namesOf(new ProjectRegistry(root)), ['乙', '甲'], '磁盘才是事实源')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('CV-046：拿着旧快照的实例做更新，不抹掉对方刚新建的项目', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-registry-'))
  try {
    const a = new ProjectRegistry(root)
    const first = await a.create('甲')
    const b = new ProjectRegistry(root)
    await b.list() // B 的快照 = [甲]

    const third = await a.create('丙') // A 新建，B 不知情
    await b.updateWorkflow(first.id, { state: 'executing' })

    const disk = await onDisk(root)
    assert.ok(disk.projects.some((entry) => entry.id === third.id), 'B 的旧快照不该带走「丙」')
    assert.equal(disk.projects.find((entry) => entry.id === first.id).workflow.state, 'executing',
      '同 id 以内存（本次调用）为准')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('CV-046：删除落墓碑 —— 对方拿着含该记录的旧快照再写，也不会把它复活', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-registry-'))
  try {
    const a = new ProjectRegistry(root)
    const keep = await a.create('保留')
    const doomed = await a.create('要删的')

    const b = new ProjectRegistry(root)
    await b.list() // B 的快照里还有「要删的」

    await a.removeProject(doomed.id)
    assert.deepEqual((await onDisk(root)).projects.map((entry) => entry.name), ['保留'])

    await b.updateWorkflow(keep.id, { state: 'drafting' })
    const disk = await onDisk(root)
    assert.deepEqual(disk.projects.map((entry) => entry.name), ['保留'],
      '删除结果不能被另一个实例的旧快照复活')
    assert.ok(disk.deleted.includes(doomed.id), '被删 id 应作为墓碑留在文档里')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('CV-046：注册表损坏时显式报错，且不许被静默改写成空表', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-registry-'))
  try {
    const broken = '{ 这不是 JSON'
    await writeFile(join(root, 'projects.json'), broken)
    const registry = new ProjectRegistry(root)
    await assert.rejects(() => registry.list(), (err) => err.code === 'CS-DEV-ERR' && err.devMessage.includes('corrupt'),
      '损坏必须显式抛错 —— 静默当空表会让下一次写盘抹掉整个注册表')
    await assert.rejects(() => registry.create('损坏后新建'), (err) => err.code === 'CS-DEV-ERR' && err.devMessage.includes('corrupt'),
      '写路径同样要先读盘，损坏时拒绝覆盖')
    assert.equal(await readFile(join(root, 'projects.json'), 'utf8'), broken,
      '损坏内容必须原样留着（用户还有机会手工修复），不许被写成空注册表')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('CV-046 守卫：所有写盘都必须经过 commitRegistry（不许再有裸 writeRegistry 调用点）', () => {
  const source = readFileSync(join(SRC_DIR, 'projects.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
  const callers = [...source.matchAll(/await this\.writeRegistry\(/g)].length
  assert.equal(callers, 1, `writeRegistry 只准被 commitRegistry 调用，实际有 ${callers} 处`)
  assert.match(source, /private async commitRegistry\(/, '合流出口必须存在')
  // 合流出口内部必须真的走墓碑与并集运算（而不是换个名字的裸写）。
  assert.match(source, /tombstones\.has\(entry\.id\)/u, '合流必须按墓碑过滤')
  assert.match(source, /document\?\.projects \?\? \[\]/u, '合流必须以磁盘记录为基准')
})
