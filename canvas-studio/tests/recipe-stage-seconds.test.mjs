/**
 * 配方判据的**输入口径**守卫（2026-11-27 超级月亮复盘）。
 *
 * ## 抓什么
 *
 * 「段数」这条判据是 `配方段数 ≤ 期望屏数`，而期望屏数 = `totalSeconds / stageSeconds`。
 * `stageSeconds` 此前**完全由模型自填**、无默认值、无范围校验 —— 真机会话里填了 12s
 * （成片真实 7.5s/屏），于是判据给出「4 段 ≤ 6 屏 ✅」这种结论。
 *
 * 判据本身没错，错的是**输入**：模型拿这个结论去论证"配方不合适"，实际上它只是
 * 把屏长填大了一倍。这类「用错的输入跑对的判据」在回执里看不出来 —— 除非把
 * **实际用了哪个值**也打出来。
 *
 * 因此这里的断言不是「源码里有这行字」，而是：
 * - 缺省 stageSeconds ⇒ 回执必须显式说「按 Host 值 6.5s/屏」，且判据仍然生效（不回退 `—`）；
 * - 越界值 ⇒ 钳到 [4,10] 并在回执里说明原值与钳后值；
 * - 过闸的回执必须点明「段数过闸 ≠ 屏数正确」（段只是骨架，屏数归屏表）。
 *
 * 反向变异：把 stage 兜底改回 `requirement.stageSeconds`（缺省即不判）⇒ 前两条精确变红。
 *
 * 定向跑：node --test tests/recipe-stage-seconds.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gateRecipe } from '../lib/host-tools-template.js'
import { RECIPES } from '../lib/remotion/recipes.js'
import { MAX_STAGE_SEC, MIN_STAGE_SEC, TARGET_STAGE_SEC } from '../lib/remotion/stage-plan.js'

const RECIPE = RECIPES['explainer-cards']
const stageLine = (requirement) => gateRecipe(RECIPE, requirement, {}).checks[0].line

test('缺省 stageSeconds ⇒ 按 Host 值推屏数并说明出处（不回退「—」）', () => {
  const line = stageLine({ totalSeconds: 75 })
  assert.match(line, /期望屏 \d+/u, '缺省 stageSeconds 时判据必须仍然生效')
  assert.match(line, new RegExp(`${String(TARGET_STAGE_SEC)}s`, 'u'), '必须用 Host 的屏长常量')
  assert.match(line, /Host 值/u, '必须说明这个值是 Host 兜底的，不是模型给的 —— 否则模型以为是自己填的')
  assert.doesNotMatch(line, /不参与判定/u)
})

test('stageSeconds 越界 ⇒ 钳到 [4,10] 并说明原值与钳后值', () => {
  const tooBig = stageLine({ totalSeconds: 75, stageSeconds: 30 })
  assert.match(tooBig, /越界/u)
  assert.match(tooBig, new RegExp(`钳到 ${String(MAX_STAGE_SEC)}s`, 'u'))
  assert.match(tooBig, /stageSeconds 30/u, '要留下原值，否则看不出自己填错了')

  const tooSmall = stageLine({ totalSeconds: 75, stageSeconds: 0.5 })
  assert.match(tooSmall, new RegExp(`钳到 ${String(MIN_STAGE_SEC)}s`, 'u'))
})

test('合法 stageSeconds ⇒ 原样使用，不加多余说明', () => {
  const line = stageLine({ totalSeconds: 75, stageSeconds: 7.5 })
  assert.match(line, /7\.5s/u)
  assert.doesNotMatch(line, /越界|Host 值/u)
})

test('段数过闸必须点明「段 ≠ 屏」——避免把「配方 4 段」读成「成片只有 4 屏」', () => {
  const line = stageLine({ totalSeconds: 75 })
  assert.match(line, /段数过闸 ≠ 屏数正确/u)
  assert.match(line, /每屏 4–10s/u)
})
