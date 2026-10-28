/**
 * CV-376：`shotRefs` → 分镜卡节点 id 的解析（此前**零测试覆盖**，9 个调用点全靠运气）。
 *
 * ## 为什么要补这一组
 *
 * 2026-10-26~27 的会话转录里，模型传 `shotRefs: ['S1-Sh1']` 直接报「分镜卡未找到」——
 * 而 `S1-Sh1` 正是 shot.id：`write_storyboard` 的返回里有它，`storyboard-seed` 也把它
 * 写进了卡的 `sbRef`（`04:SC1/shots/S1-Sh1`）和标题（`分镜 1 · S1-Sh1 · 缓慢推进`），
 * 但旧查找函数只认「节点 id / 标题全等 / `分镜 N`」三档，压根不看 sbRef。
 *
 * 一次分镜出 5 个镜头、每镜都要引上一镜的卡，ref 一失败就是整批红。
 *
 * 运行：node --test tests/shot-ref.test.mjs（需先 `npx tsc -p tsconfig.json`）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SEED_SHOT_TOOL, STORYBOARD_NODE_TOOL } from '../lib/contracts/canvas.js'
import { resolveShotRefs } from '../lib/reference-resolve.js'

/** 一张标准分镜卡（`storyboard-seed` 的真实形状：标题三段 + sbRef 回指针）。 */
function shotCard(overrides = {}) {
  return {
    id: 'sb-1',
    kind: 'text',
    title: '分镜 1 · S1-Sh1 · 缓慢推进',
    sbRef: '04:SC1/shots/S1-Sh1',
    text: '【视觉】晨雾茶园\n【运镜】缓慢推进',
    x: 0,
    y: 0,
    width: 360,
    height: 220,
    createdAt: 1,
    toolName: SEED_SHOT_TOOL,
    origin: 'agent',
    sourceIds: [],
    ...overrides,
  }
}

/** `resolveShotRefs` 只需要 `readCanvas`，其余一律不碰。 */
function registryWith(nodes) {
  return { readCanvas: async () => ({ version: 4, nodes }) }
}

test('CV-376：shotRefs 认 sbRef 末段（S1-Sh1）—— 模型从 write_storyboard 返回里抄的写法', async () => {
  const registry = registryWith([
    shotCard(),
    shotCard({ id: 'sb-2', title: '分镜 2 · S1-Sh2 · 固定机位', sbRef: '04:SC1/shots/S1-Sh2' }),
  ])
  assert.deepEqual(await resolveShotRefs(registry, 'p1', ['S1-Sh1']), ['sb-1'])
  assert.deepEqual(await resolveShotRefs(registry, 'p1', ['S1-Sh2']), ['sb-2'])
  // 整串 sbRef 也认（模型偶尔抄全部）
  assert.deepEqual(await resolveShotRefs(registry, 'p1', ['04:SC1/shots/S1-Sh2']), ['sb-2'])
})

test('CV-376：shotRefs 认标题分段（「分镜 1」/「缓慢推进」）与无空格镜号（「分镜1」）', async () => {
  const registry = registryWith([
    shotCard(),
    shotCard({ id: 'sb-10', title: '分镜 10 · S1-Sh10 · 拉远', sbRef: '04:SC1/shots/S1-Sh10' }),
  ])
  assert.deepEqual(await resolveShotRefs(registry, 'p1', ['分镜 1']), ['sb-1'], '分段全等，且不误命中「分镜 10」')
  assert.deepEqual(await resolveShotRefs(registry, 'p1', ['分镜1']), ['sb-1'], '无空格镜号按正则命中')
  assert.deepEqual(await resolveShotRefs(registry, 'p1', ['分镜 10']), ['sb-10'])
  assert.deepEqual(await resolveShotRefs(registry, 'p1', ['缓慢推进']), ['sb-1'], '运镜段同样可引用')
})

test('CV-376：shotRefs 仍认节点 id 与标题全等，并按 id 去重', async () => {
  const registry = registryWith([shotCard(), shotCard({ id: 'sb-2', title: '分镜 2 · 特写', sbRef: '04:SC1/shots/S1-Sh2' })])
  assert.deepEqual(await resolveShotRefs(registry, 'p1', ['sb-1']), ['sb-1'], '节点 id')
  assert.deepEqual(await resolveShotRefs(registry, 'p1', ['分镜 2 · 特写']), ['sb-2'], '标题全等')
  assert.deepEqual(
    await resolveShotRefs(registry, 'p1', ['sb-1', 'S1-Sh1', '分镜 1']),
    ['sb-1'],
    '同一张卡的多写法只回一个 id',
  )
  assert.deepEqual(await resolveShotRefs(registry, 'p1', ['  ', '']), [], '空串跳过，不报错')
})

test('CV-376：未找到时报候选 + 保留「等落地」的出路，而不是让模型换参数绕道', async () => {
  const registry = registryWith([shotCard()])
  await assert.rejects(
    () => resolveShotRefs(registry, 'p1', ['分镜 9']),
    (error) => {
      assert.match(error.message, /分镜卡「分镜 9」未找到/u)
      assert.match(error.message, /最接近的候选/u, '要给候选，模型才能照抄改对')
      assert.match(error.message, /分镜 1 · S1-Sh1 · 缓慢推进/u)
      assert.match(error.message, /等待用户落地/u, '未落地是唯一出路，不能被误读成换参数重试')
      assert.match(error.message, /不要换别的参数绕道重试/u)
      return true
    },
  )
})

test('CV-376：画布上一张卡都没有时，文案直说「没有可用的分镜卡」', async () => {
  const registry = registryWith([])
  await assert.rejects(
    () => resolveShotRefs(registry, 'p1', ['S1-Sh1']),
    (error) => {
      assert.match(error.message, /画布上目前没有可用的分镜卡/u)
      assert.match(error.message, /等待用户落地/u)
      return true
    },
  )
})

test('CV-376：非分镜卡节点不进匹配池（同标题的普通文本卡不得冒充）', async () => {
  const registry = registryWith([
    shotCard({ toolName: STORYBOARD_NODE_TOOL }), // 旧工具写的卡：仍算分镜卡
    { id: 'plain', kind: 'text', title: 'S1-Sh1', x: 0, y: 0, width: 10, height: 10, createdAt: 2, origin: 'agent', sourceIds: [] },
  ])
  assert.deepEqual(
    await resolveShotRefs(registry, 'p1', ['S1-Sh1']),
    ['sb-1'],
    '旧工具（submit_storyboard_for_approval）写下的卡同样可用',
  )
  await assert.rejects(
    () => resolveShotRefs(registry, 'p1', ['plain']),
    (error) => error.code === 'CS-USER-ERR',
    '普通文本卡不是分镜卡，用 id 也不得命中',
  )
})
