/**
 * REQ-034 · B3：`render_composition` 的 `projectId` 收口回归测试。
 *
 * 背景（2026-10-16 桌面验收实测）：模型按习惯给 `render_composition` 填
 * `projectId: "current"` 这类**伪 id**。此前工具不校验、直接拿它当项目 id 建渲染
 * 工单；而画布客户端永远用真实项目 id 轮询 `/remotion/pending`，`pendingRenderJobFor`
 * 按 id 过滤 ⇒ 两边对不上 ⇒ 客户端立即停轮询 ⇒ 宿主白等到 `CS-RENDER-TIMEOUT`
 * （默认 10 分钟）。修法：显式传入的 id 必须是注册表里的真项目，否则当场快速失败。
 *
 * 直连 Host 侧编译产物 lib/host-tools.js。运行：
 * corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertRenderCompositionProjectId } from '../lib/host-tools.js'

test('projectId 省略（null）→ 放行，交由上游按 cwd 解析', () => {
  assert.doesNotThrow(() => assertRenderCompositionProjectId(null, ['proj-a']))
  assert.doesNotThrow(() => assertRenderCompositionProjectId(null, []))
})

test('projectId 命中注册表 → 放行', () => {
  assert.doesNotThrow(() => assertRenderCompositionProjectId('proj-a', ['proj-a', 'proj-b']))
})

test('projectId 为伪 id（"current"）→ 立即 CS-USER-ERR，不建工单', () => {
  let caught
  try {
    assertRenderCompositionProjectId('current', ['proj-a'])
  } catch (error) {
    caught = error
  }
  assert.ok(caught, '伪 id 必须抛错（否则会把工单登记到伪项目上白等超时）')
  assert.equal(caught.code, 'CS-USER-ERR')
  assert.match(caught.message, /省略 projectId/)
})

test('注册表为空 + 显式 projectId → 同样快速失败', () => {
  assert.throws(() => assertRenderCompositionProjectId('proj-a', []), /projectId/)
})
