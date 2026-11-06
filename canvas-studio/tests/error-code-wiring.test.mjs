/**
 * 接线守卫：结构化错误码必须从 catch 一路传到 store。
 *
 * 为什么单独守：`setFailed(message)` 只传半截信息时，注册表里声明的 `uiKind` 全部变成
 * 死配置，三态卡退回字符串启发式 —— 2026-11-06 真机就是这么漏的：`CS-STORY-002` 已经
 * 登记 `terminal`，前端照样显示「出错了，重试一次？」，因为 `StudioFrame` 的 catch 只把
 * `cause.message` 交了出去。
 *
 * 断言的是「所有 catch 调用点」而不是某一个字面量：漏改一处就红，这正是本次要防的
 * 半途接线。分级语义本身由 `error-card-plan.test.mjs` / `error-kind.test.mjs` 守。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const FRAME_SRC = readFileSync(new URL('../src/client/StudioFrame.tsx', import.meta.url), 'utf8')

test('接线：每个 setFailed(cause …) 都必须把结构化码一起交下去', () => {
  const calls = [...FRAME_SRC.matchAll(/actions\.setFailed\(cause instanceof Error[^\n]*/g)].map((m) => m[0])
  assert.ok(calls.length >= 10, `catch 调用点只匹配到 ${calls.length} 处，正则疑似失效`)
  const offenders = calls.filter((line) => !line.includes('studioErrorCodeOf(cause)'))
  assert.deepEqual(
    offenders,
    [],
    `这些 catch 把错误码丢了（terminal / config 等分级会退化成启发式）：\n${offenders.join('\n')}`,
  )
})

test('接线：落地失败那条路径必须带码（真机就卡在这里）', () => {
  assert.match(
    FRAME_SRC,
    /'落地失败', studioErrorCodeOf\(cause\)/,
    '落地 catch 必须带码，否则 CS-STORY-002 的 terminal 分级永远走不到',
  )
})
