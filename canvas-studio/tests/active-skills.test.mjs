/**
 * 已装载 skill 清单持久化测试（CV-066 Phase D）。
 *
 * 覆盖 ProjectRegistry.readActiveSkills / writeActiveSkills：往返、去重、
 * 类型过滤、缺失文件与损坏 JSON 的降级（空清单）。store action（activate/
 * deactivate）是极薄的去重/过滤逻辑，在 client bundle 内（tsdown 产物不可
 * 单测直连），由 typecheck 与桌面验收保障。
 *
 * 直连 Host tsc 产物 lib/projects.js。运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectRegistry } from '../lib/projects.js'

async function withRegistry(run) {
  const root = await mkdtemp(join(tmpdir(), 'cs-skills-'))
  try {
    const registry = new ProjectRegistry(root)
    await run(registry, root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('write → read 往返：整表替换幂等', async () => {
  await withRegistry(async (registry) => {
    const project = await registry.create('技能项目')
    assert.deepEqual(await registry.readActiveSkills(project.id), [])

    await registry.writeActiveSkills(project.id, ['brand-promo-video-generator', 'h3-prompt-writing'])
    assert.deepEqual(
      await registry.readActiveSkills(project.id),
      ['brand-promo-video-generator', 'h3-prompt-writing'],
    )

    // 整表替换：第二次写覆盖第一次，不是追加
    await registry.writeActiveSkills(project.id, ['3d-animation-short-generator'])
    assert.deepEqual(await registry.readActiveSkills(project.id), ['3d-animation-short-generator'])
  })
})

test('写入去重 + 过滤非字符串', async () => {
  await withRegistry(async (registry) => {
    const project = await registry.create('去重项目')
    await registry.writeActiveSkills(project.id, ['a', 'a', 42, 'b', null])
    assert.deepEqual(await registry.readActiveSkills(project.id), ['a', 'b'])
  })
})

test('缺失 skills.json → 空清单（不抛错）', async () => {
  await withRegistry(async (registry) => {
    const project = await registry.create('无清单项目')
    assert.deepEqual(await registry.readActiveSkills(project.id), [])
  })
})

test('损坏 skills.json → 空清单（不抛错）', async () => {
  await withRegistry(async (registry) => {
    const project = await registry.create('损坏项目')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(project.dir, 'skills.json'), '{not-json', 'utf8')
    assert.deepEqual(await registry.readActiveSkills(project.id), [])
  })
})

test('skills.json 落盘在项目目录且格式合法', async () => {
  await withRegistry(async (registry) => {
    const project = await registry.create('落盘项目')
    await registry.writeActiveSkills(project.id, ['music-video-subtitle-generator'])
    const text = await readFile(join(project.dir, 'skills.json'), 'utf8')
    assert.deepEqual(JSON.parse(text), ['music-video-subtitle-generator'])
  })
})
