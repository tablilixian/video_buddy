/**
 * REQ-041 · F4：目标时长三处不一致 ⇒ 每版交付都报假红 —— 守卫。
 *
 * 真机事故（2026-11-25 超级月亮项目，盘上仍是这个状态）：
 *
 *   projects.json  plan.targetDuration = 15   ← 建项目那次锁的，之后再没动过
 *   storyboard.json meta.targetDuration = 60 ← `write_storyboard` 收的值
 *   成片                                  80.02s
 *   deliver/card.json durationCheck { target 15, delta 65, durationMismatch true }
 *
 * 口径（两条，缺一条就有假红）：
 * 1. `write_storyboard` 一声明目标时长，就把 `plan.targetDuration` 回写对齐
 *    （`ProjectRegistry.setPlanTargetDuration`，只改这一项）；
 * 2. 交付断言前再自愈一次：故事板与 plan 不一致时**以故事板为准**并把 plan 写回
 *    （`resolveDeliveryTargetDuration`）—— 本修复之前写的故事板不会经过第 1 条。
 *
 * 注意断言本身**没有放宽**：真机那条 60 vs 80.02 仍然会标 durationMismatch（那是真的
 * 超长 20s），被消掉的是「15 vs 80」这种拿旧规格去卡新片子的假红。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectRegistry } from '../lib/projects.js'
import { normalizeStoryboard } from '../lib/contracts/storyboard.js'
import { saveStoryboard } from '../lib/storyboard-store.js'
import { resolveDeliveryTargetDuration } from '../lib/host-tools.js'

async function withRegistry(run) {
  const root = await mkdtemp(join(tmpdir(), 'cs-req041-f4-'))
  try {
    await run(new ProjectRegistry(root))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

/** 落一份只带 meta 的故事板（其余节留空，够 `loadStoryboard` 读出 meta 即可）。 */
async function writeStoryboard(registry, projectId, targetDuration) {
  const document = normalizeStoryboard({
    projectId,
    title: '测试',
    meta: { genre: '科普讲解', targetDuration, aspect: '16:9' },
    sections: {},
  })
  assert.ok(document, '故事板归一化失败（测试夹具问题）')
  await saveStoryboard(registry, projectId, document)
}

const planOf = async (registry, projectId) => (await registry.getProject(projectId))?.plan

test('F4：故事板声明 60s ⇒ plan 从 15s 回写为 60s（画幅不被牵连）', async () => {
  await withRegistry(async (registry) => {
    const project = await registry.create('月亮', null, { targetDuration: 15, aspectRatio: '16:9' })
    const result = await registry.setPlanTargetDuration(project.id, 60)
    assert.deepEqual(result, { from: 15, to: 60 })
    const plan = await planOf(registry, project.id)
    assert.equal(plan.targetDuration, 60, '交付断言 / 首页 chip / 提示词都读这里')
    assert.equal(plan.aspectRatio, '16:9', '回写只碰目标时长，不许牵连画幅')
  })
})

test('F4：同值再写一次不返回变更（幂等，不会反复刷注册表）', async () => {
  await withRegistry(async (registry) => {
    const project = await registry.create('月亮', null, { targetDuration: 15 })
    assert.deepEqual(await registry.setPlanTargetDuration(project.id, 60), { from: 15, to: 60 })
    assert.equal(await registry.setPlanTargetDuration(project.id, 60), null, '没变化 = null')
  })
})

test('F4：原来没锁目标时长 ⇒ from 报 null（不假装有旧值）', async () => {
  await withRegistry(async (registry) => {
    const project = await registry.create('无规格')
    assert.deepEqual(await registry.setPlanTargetDuration(project.id, 42), { from: null, to: 42 })
    assert.equal((await planOf(registry, project.id)).targetDuration, 42)
  })
})

test('F4：非法值（0 / NaN / 负数）一律不写盘', async () => {
  await withRegistry(async (registry) => {
    const project = await registry.create('月亮', null, { targetDuration: 15 })
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(await registry.setPlanTargetDuration(project.id, bad), null, `${String(bad)} 不该写盘`)
    }
    assert.equal((await planOf(registry, project.id)).targetDuration, 15, '原值必须原样')
  })
})

test('F4：不存在的项目 ⇒ null（不抛）', async () => {
  await withRegistry(async (registry) => {
    assert.equal(await registry.setPlanTargetDuration('no-such-project', 30), null)
  })
})

test('F4 交付断言：plan 停在 15、故事板写 60 ⇒ 按 60 判，并把 plan 自愈为 60', async () => {
  await withRegistry(async (registry) => {
    const project = await registry.create('月亮', null, { targetDuration: 15 })
    await writeStoryboard(registry, project.id, 60)
    assert.equal(await resolveDeliveryTargetDuration(registry, project.id), 60, '真机形态：15 是过期规格')
    assert.equal((await planOf(registry, project.id)).targetDuration, 60, '自愈：下一次读 plan 的界面也一致')
  })
})

test('F4 交付断言：没有故事板 ⇒ 用 plan 的值（不凭空造目标）', async () => {
  await withRegistry(async (registry) => {
    const project = await registry.create('月亮', null, { targetDuration: 15 })
    assert.equal(await resolveDeliveryTargetDuration(registry, project.id), 15)
  })
})

test('F4 交付断言：两处已经一致 ⇒ 原样返回（不额外写盘）', async () => {
  await withRegistry(async (registry) => {
    const project = await registry.create('月亮', null, { targetDuration: 60 })
    await writeStoryboard(registry, project.id, 60)
    assert.equal(await resolveDeliveryTargetDuration(registry, project.id), 60)
    assert.equal((await planOf(registry, project.id)).targetDuration, 60)
  })
})
