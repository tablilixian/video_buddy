#!/usr/bin/env node
/**
 * 回归守卫（人工版）：`canvas.json` / `jobs.json` 的**并发写不丢数据**。
 *
 * ## 来历（AR-01 / AR-04）
 *
 * 这两个状态档的写路径都是 `read → 内存改 → writeFileAtomic`。**原子写只保证文件
 * 不损坏，不保证「读-改-写」的原子性** —— 两个并发写者各读一份快照、后者整段覆盖
 * 前者。本仓此前只有 `storyboard.json` / `history.json` / `reference-manifest.json`
 * 有串行队列，**恰好漏了最大的事实源 `canvas.json`（以及 `jobs.json`）**。
 *
 * 本脚本的**修复前基线（2026-10-11，每场景 10 轮、轮轮丢失）**：
 *   冷启动并发 append ×20 → 只剩 1 条 ｜ 热画布 ×20 → 只剩 2 条
 *   并发 upsertAsset ×10 → 只剩 1 条 ｜ 并发入台账 ×5 → 只剩 1 条
 *
 * 修复 = `src/keyed-queue.ts` 按**文件路径**串行化写口（canvas 4 个写口 + groups
 * 3 个 + jobs 2 个）。修复后基线：**四个场景全部满额**。
 *
 * ## 与 gate 测试的关系
 *
 * 权威断言在 `tests/canvas-write-serialization.test.mjs`（进 `test:smoke` 门禁）。
 * 本脚本是它的**人工版**：轮数更多、打印对照表、便于「真机改动后手动复核」。
 * 二者刻意共存——gate 要快且确定，本脚本要能给人看证据。
 *
 * 用法：`node scripts/canvas-write-race-repro.mjs`
 * 先决条件：已 build（`node node_modules/.bin/tsdown && tsc -p tsconfig.json`）——
 *           本脚本从 `lib/` 产物导入，与其它测试同一口径。
 * 耗时：秒级。
 * 退出码：**0 = 零丢失（守卫通过）**；**1 = 检测到丢失（回归！）**。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectRegistry } from '../lib/projects.js'
import { readDramaJobs, recordDramaJobSubmitted } from '../lib/video-jobs.js'

/** 每个场景重复轮数——并发交错是时序相关的，单轮不足以下结论。 */
const ROUNDS = 10

/** 最小合法画布节点（字段与 `normalizeCanvasDocument` 的 `isCanvasNode` 兼容）。 */
const node = (id) => ({
  id,
  kind: 'image',
  title: id,
  url: `/canvas-studio/assets/p/${id}.png`,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  createdAt: 1,
  origin: 'agent',
  sourceIds: [],
})

/**
 * 最小合法资产（字段与 `isStudioAsset` 兼容 —— 少一个字段就会被
 * `normalizeCanvasDocument` 静默丢掉，那样测出来的是「fixture 不合法」而不是竞态。
 * 这坑第一次写就踩了：AR-11 的告警当场把「资产 1 条被丢弃」打了出来）。
 */
const asset = (id) => ({
  id,
  name: `资产 ${id}`,
  role: 'character',
  anchorNodeIds: [],
  lockedPrompt: '',
  createdAt: 1,
})

/**
 * 场景 A：**冷启动**并发 append（空画布 + N 个同时落卡）。
 * 期望 N 条，实测通常远少 —— 每个写者都从「空」读到同一份快照。
 */
async function coldAppend(registry, projectId, count) {
  await Promise.all(
    Array.from({ length: count }, (_, index) => registry.appendCanvasNode(projectId, node(`cold-${String(index)}`))),
  )
  const document = await registry.readCanvas(projectId)
  return document.nodes.length
}

/**
 * 场景 B：**热画布**并发 append（先有 1 条既有节点，再 N 个同时落卡）。
 * 这是生产形态：画布上已有素材，agent 在一个回合里连发多个生成工具。
 * 期望 1 + N 条。
 */
async function warmAppend(registry, projectId, count) {
  await registry.appendCanvasNode(projectId, node('pre-existing'))
  await Promise.all(
    Array.from({ length: count }, (_, index) => registry.appendCanvasNode(projectId, node(`warm-${String(index)}`))),
  )
  const document = await registry.readCanvas(projectId)
  const ids = new Set(document.nodes.map((entry) => entry.id))
  const lost = Array.from({ length: count }, (_, index) => `warm-${String(index)}`)
    .filter((id) => !ids.has(id))
  return { total: document.nodes.length, expected: count + 1, lost: lost.length }
}

/** 场景 C：并发 upsertAsset（资产索引同为读-改-写）。 */
async function concurrentUpsert(registry, projectId, count) {
  await Promise.all(
    Array.from({ length: count }, (_, index) => registry.upsertAsset(projectId, asset(`a-${String(index)}`))),
  )
  const document = await registry.readCanvas(projectId)
  return document.assets?.length ?? 0
}

/** 场景 D：并发视频任务入台账（AR-04，后果最重——台账是重启恢复的唯一凭据）。 */
async function concurrentJobLedger(registry, projectId, count) {
  await Promise.all(
    Array.from({ length: count }, (_, index) => recordDramaJobSubmitted(registry, projectId, {
      jobId: `job-${String(index)}`,
      toolName: 'video_generate',
      params: '{}',
    })),
  )
  const jobs = await readDramaJobs(registry, projectId)
  return jobs.length
}

/** 多轮跑一个场景，返回「各轮实测值」与「是否出现过丢失」。 */
async function runRounds(rounds, scenario) {
  const observed = []
  const expected = []
  for (let round = 0; round < rounds; round += 1) {
    const root = await mkdtemp(join(tmpdir(), 'cs-write-race-'))
    try {
      const registry = new ProjectRegistry(root)
      const result = await scenario(registry, 'p1', round)
      if (typeof result === 'number') observed.push(result)
      else observed.push(result.total)
      expected.push(typeof result === 'number' ? null : result.expected)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
  return { observed, expected }
}

/** 打印一个场景的结论行。 */
function report(name, { observed, expected }) {
  const expectedCount = expected[0] ?? null
  const worst = Math.min(...observed)
  const best = Math.max(...observed)
  const lost = observed.some((value, index) => {
    const want = expected[index] ?? expectedCount
    return want !== null && value < want
  })
  const detail = expectedCount === null
    ? `${String(best)}–${String(worst)}（期望不固定，看丢失判定）`
    : `${String(best)}–${String(worst)} / 期望 ${String(expectedCount)}`
  console.log(`  ${lost ? '❌ 丢失' : '✅ 未丢失'}  ${name}：实测 ${detail}`)
  return lost
}

async function main() {
  console.log(`AR-01 / AR-04 并发写复现实验（每场景 ${String(ROUNDS)} 轮）\n`)
  console.log('场景 A —— 冷启动并发 append（期望 20）')

  const cold = await runRounds(ROUNDS, async (registry, projectId) => coldAppend(registry, projectId, 20))
  // 冷启动场景的期望恒为 20（首轮首个 append 之前无任何节点）。
  const coldReport = report('canvas.json 冷并发 append', {
    observed: cold.observed,
    expected: cold.observed.map(() => 20),
  })

  console.log('\n场景 B —— 热画布并发 append（期望 21）')
  const warm = await runRounds(ROUNDS, (registry, projectId) => warmAppend(registry, projectId, 20))
  const warmReport = report('canvas.json 热并发 append', {
    observed: warm.observed,
    expected: warm.expected,
  })

  console.log('\n场景 C —— 并发 upsertAsset（期望 10）')
  const assets = await runRounds(ROUNDS, async (registry, projectId) => concurrentUpsert(registry, projectId, 10))
  const assetReport = report('canvas.json 并发 upsertAsset', {
    observed: assets.observed,
    expected: assets.observed.map(() => 10),
  })

  console.log('\n场景 D —— 并发视频任务入台账（期望 5）')
  const jobs = await runRounds(ROUNDS, async (registry, projectId) => concurrentJobLedger(registry, projectId, 5))
  const jobReport = report('jobs.json 并发入台账', {
    observed: jobs.observed,
    expected: jobs.observed.map(() => 5),
  })

  const anyLost = coldReport || warmReport || assetReport || jobReport
  console.log('\n──────────────────────────────────────────────')
  if (!anyLost) {
    console.log('结论：**四个场景全部满额，零丢失** —— 写口串行化生效。')
    console.log('      权威断言见 tests/canvas-write-serialization.test.mjs（在 test:smoke 门禁内）。')
    process.exit(0)
  }
  console.log('结论：**检测到并发丢失 = 回归**。')
  console.log('      排查方向：① 是否有新的写路径绕过了 sharedWriteQueue（直接 read+writeFileAtomic）；')
  console.log('      ② 是否有写口在队列任务体内又入队了同一个 key（自锁会让任务挂起，表现为丢失）；')
  console.log('      ③ 是否有人把 key 从「文件路径」改成了别的粒度。')
  process.exit(1)
}

await main()
