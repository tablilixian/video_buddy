/**
 * 复刻提效批二：**未知参数报错教学**回归（`tool-unknown-params.ts`）。
 *
 * 为什么值得一条守卫：甜品复刻真机会话里，模型为确认「某工具到底有哪些入参」
 * 共读源码 73 次、烧 42.8 分钟（占全会话模型时间 40.5%）。它读源码的触发点往往
 * 就是「上一次调用被报了个语焉不详的错」。本守卫把「合法字段清单 + 最小可用调用」
 * 直接放进报错里 —— 同一份信息、同一个时刻、零额外成本。
 *
 * 两层都要断：
 * 1. 纯函数层：未知键拒收 / 合法键放行 / `$` 与 `__` 前缀放行 / 近似名给纠错猜测。
 * 2. **真实注册面**：遍历 `createStudioTools()` 的每条工具，用它自己声明的参数名
 *    构造入参，守卫必须**全部放行** —— 这一条防的是「某工具 execute 用了未声明参数」
 *    造成的功能回归（守卫一旦误判，模型连正常调用都会被拦）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStudioTools } from '../lib/host-tools.js'
import { createPlaceholderTools } from '../lib/skills/placeholder-tools.js'
import { assertKnownToolParams, paramCatalogOf } from '../lib/tool-unknown-params.js'

const shape = {
  name: 'render_composition',
  parameters: {
    manifest: { type: 'object', description: '内联 manifest' },
    manifestPath: { type: 'string', required: true, description: 'manifest 绝对路径' },
    quality: { type: 'string', description: '档位' },
    spotFrames: { type: 'boolean', description: '抽帧核对' },
  },
}

test('合法参数全放行；未知参数拒收且文案带合法清单 + 最小调用示例', () => {
  assert.doesNotThrow(() => assertKnownToolParams(shape, { manifestPath: '/a.json', quality: 'high' }))
  assert.doesNotThrow(() => assertKnownToolParams(shape, {}))
  assert.throws(
    () => assertKnownToolParams(shape, { manifestPath: '/a.json', timingSegments: [] }),
    (error) => {
      assert.match(error.message, /不认识参数/u)
      assert.match(error.message, /timingSegments/u)
      // 合法清单必须完整出现（这是「省掉一次读源码」的全部价值）
      for (const name of ['manifest', 'manifestPath', 'quality', 'spotFrames']) {
        assert.ok(error.message.includes(name), `文案缺合法参数 ${name}`)
      }
      assert.match(error.message, /最小可用调用/u)
      assert.match(error.message, /不要为确认字段名去读/u, '必须反向禁止读源码')
      return true
    },
  )
})

test('近似名给「疑似写错」提示（大小写 / 一字之差 / 包含关系）', () => {
  const cases = [
    [{ manifestpath: '/a.json' }, 'manifestPath'],
    [{ manifestPATH: '/a.json' }, 'manifestPath'],
    [{ manifest: {}, manifesttPath: '/a.json' }, 'manifestPath'],
    [{ spotFrame: true }, 'spotFrames'],
  ]
  for (const [args, expect] of cases) {
    assert.throws(
      () => assertKnownToolParams(shape, args),
      (error) => {
        assert.match(error.message, /疑似写错/u, `没给纠错猜测：${JSON.stringify(args)}`)
        assert.ok(error.message.includes(expect), `猜测里应含 ${expect}`)
        return true
      },
      `应拒收：${JSON.stringify(args)}`,
    )
  }
})

test('框架/测试注入的元字段（$ / __ 前缀）与非对象入参一律放行', () => {
  assert.doesNotThrow(() => assertKnownToolParams(shape, { manifestPath: '/a.json', $meta: 1, __id: 'x' }))
  assert.doesNotThrow(() => assertKnownToolParams(shape, null))
  assert.doesNotThrow(() => assertKnownToolParams(shape, 'not-an-object'))
  assert.doesNotThrow(() => assertKnownToolParams(shape, []))
  // 没有 parameters 的工具（理论上不该有）放行，不制造假红
  assert.doesNotThrow(() => assertKnownToolParams({ name: 'x' }, { whatever: 1 }))
})

test('paramCatalogOf：JSON Schema 形态（defineTool 运行时的真实产物）也要读对', () => {
  // 回归：`defineTool` 会把源码里的 `Record<name, spec>` 转成 JSON Schema 再交出来，
  // 守卫在生产路径上拿到的就是这一形态。只认 Record 会把 type/properties/required
  // 当成「合法参数」，然后**任何真实入参都被判未知**（等于把全部工具拦死）。
  const runtimeShape = {
    name: 'x',
    parameters: {
      type: 'object',
      properties: { alpha: { type: 'string' }, beta: { type: 'number' } },
      required: ['beta'],
      additionalProperties: false,
    },
  }
  const catalog = paramCatalogOf(runtimeShape)
  assert.deepEqual(catalog.names.slice().sort(), ['alpha', 'beta'])
  assert.deepEqual(catalog.required, ['beta'])
  assert.equal(catalog.example, '{"beta":0}')
  assert.doesNotThrow(() => assertKnownToolParams(runtimeShape, { alpha: 'a', beta: 1 }))
  assert.throws(() => assertKnownToolParams(runtimeShape, { gamma: 1 }), /不认识参数/u)
})

test('paramCatalogOf：必填取齐、无必填时退化为前两个参数做示例', () => {  const catalog = paramCatalogOf(shape)
  assert.deepEqual(catalog.names, ['manifest', 'manifestPath', 'quality', 'spotFrames'])
  assert.deepEqual(catalog.required, ['manifestPath'])
  assert.equal(catalog.example, '{"manifestPath":"<字符串>"}')
  const noRequired = paramCatalogOf({ name: 't', parameters: { a: { type: 'boolean' }, b: { type: 'number' }, c: { type: 'string' } } })
  assert.equal(noRequired.example, '{"a":false,"b":0}')
})

test('真实注册面：每条工具用自己的声明参数调用都不会被守卫误拦', () => {
  const stubRegistry = { list: async () => [] }
  const definitions = [...createStudioTools(stubRegistry, 0), ...createPlaceholderTools()]
  assert.ok(definitions.length > 30, '注册面数量异常，先确认 createStudioTools 是否装配失败')
  for (const definition of definitions) {
    // 参数名必须从 paramCatalogOf 取（`definition.parameters` 是 JSON Schema，
    // 直接 Object.keys 会拿到 type/properties/required 这三个 schema 关键字）。
    const catalog = paramCatalogOf(definition)
    if (catalog === null) continue
    // 用真实参数名 + 类型占位值构造；守卫只看键名，不看值。
    const args = Object.fromEntries(
      catalog.names.map((name) => [name, 'x']),
    )
    assert.doesNotThrow(
      () => assertKnownToolParams(definition, args),
      `${definition.name}：守卫误拦了自己声明的参数 —— 说明该工具 execute 用了未在 parameters 里声明的字段`,
    )
  }
})

test('真实注册面：新增的 image_crop 参数表必须自洽（grid/rect/source）', () => {
  const stubRegistry = { list: async () => [] }
  const crop = createStudioTools(stubRegistry, 0).find((definition) => definition.name === 'image_crop')
  assert.ok(crop !== undefined, 'image_crop 未注册')
  const catalog = paramCatalogOf(crop)
  assert.deepEqual(catalog.names.sort(), ['grid', 'rect', 'source'])
  assert.deepEqual(catalog.required, ['source'])
  assert.throws(() => assertKnownToolParams(crop, { source: '/a.png', cropBox: {} }), /不认识参数/u)
})
