/**
 * OPT-12（2026-10-26）：按工具的必填参数守卫单测（反向变异靶）。
 *
 * 覆盖两层：① `assertRequiredToolParams` 规则本体；② `wrapStudioToolDefinition`
 * 的接线（删掉那一行接线调用，② 必红）。规则变更时 `tool-required-params.ts`
 * 的注释表与这里同步。
 *
 * 直连 Host tsc 编译产物 lib/*.js（零 Remotion 依赖）。
 * 定向跑：node --test tests/tool-required-params.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertRequiredToolParams } from '../lib/tool-required-params.js'
import { wrapStudioToolDefinition } from '../lib/tool-error-boundary.js'

test('image_generate + shotRefs 无 aspectRatio → 拒收且文案可执行', () => {
  assert.throws(
    () => assertRequiredToolParams('image_generate', { prompt: 'x', shotRefs: ['分镜 1'] }),
    (error) => {
      assert.match(error.message, /显式传 aspectRatio/)
      assert.match(error.message, /meta\.aspect/)
      return true
    },
    '缺 aspectRatio 的分镜出图必须被拦下',
  )
})

test('image_generate_withtxt / character_generate 同规则；image_fix 豁免', () => {
  assert.throws(() => assertRequiredToolParams('image_generate_withtxt', { prompt: 'x', shotRefs: ['S1'] }), /aspectRatio/)
  assert.throws(() => assertRequiredToolParams('character_generate', { shotRefs: ['S1'] }), /aspectRatio/)
  // image_fix 无 aspectRatio 参数（画幅继承源图），不在规则表 → 放行不抛。
  assert.doesNotThrow(() => assertRequiredToolParams('image_fix', { filename: 'ref-1', shotRefs: ['S1'] }))
})

test('放行面：带 aspectRatio / 无 shotRefs / 未注册规则的工具', () => {
  assert.doesNotThrow(() => assertRequiredToolParams('image_generate', { prompt: 'x', shotRefs: ['S1'], aspectRatio: '9:16' }))
  assert.doesNotThrow(() => assertRequiredToolParams('image_generate', { prompt: 'x' }))
  assert.doesNotThrow(() => assertRequiredToolParams('render_composition', { manifest: '{}' }))
  // 非对象 args 与未知工具一律放行。
  assert.doesNotThrow(() => assertRequiredToolParams('image_generate', null))
  assert.doesNotThrow(() => assertRequiredToolParams('未知工具', { shotRefs: ['S1'] }))
})

test('接线：wrapStudioToolDefinition 包装后的 execute 同样拦（删接线即红）', async () => {
  const wrapped = wrapStudioToolDefinition({
    name: 'image_generate',
    execute: async () => ({ ok: true }),
  })
  await assert.rejects(
    () => wrapped.execute({ prompt: 'x', shotRefs: ['分镜 1'] }, {}),
    /aspectRatio/,
    '守卫必须挂在唯一入口上，execute 内部逻辑不应先跑',
  )
  // 合法入参放行到 execute。
  const ok = await wrapped.execute({ prompt: 'x', shotRefs: ['分镜 1'], aspectRatio: '16:9' }, {})
  assert.deepEqual(ok, { ok: true })
})
