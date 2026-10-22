/**
 * 「设置 → 模型」目录纯函数单测（src/model-directory.ts）。
 *
 * 覆盖：
 *  - joinProviderDirectory：目录行携带 active/declared、仅注册路由追加、deepseek 系稳定排前；
 *  - deriveKeyRef / asModelIds：引用名派生与 profile.models 规范化（字符串 / {id} / 混合）；
 *  - isCoreProvider + partitionProviders：精简模式核心行与折叠行分组；
 *  - summarizeModels：行头摘要（空清单 / 短清单 / 截断 +N）；
 *  - gatewayRowOf：DramaServer 官方网关行识别（P4 落地前目录无此行 → undefined）。
 *
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  asModelIds, deriveKeyRef, gatewayRowOf, isCoreProvider, joinProviderDirectory,
  partitionProviders, summarizeModels, GATEWAY_PROVIDER_ID,
} from '../lib/model-directory.js'

const row = (over = {}) => ({
  provider: 'p1', displayName: 'P1', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'p1'], active: false, ...over,
})

test('joinProviderDirectory：目录行带 active/declared，deepseek 系排前，仅注册路由追加在尾', () => {
  const registered = [
    { id: 'openai', name: 'OpenAI' },
    { id: 'deepseek-official', name: 'DeepSeek 官方' },
    { id: 'bare-adapter', name: 'Bare Adapter' },
  ]
  const directory = [
    row({ provider: 'openai', displayName: 'OpenAI', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] }),
    row({ provider: 'deepseek-official', displayName: 'DeepSeek 官方', settingsNs: 'llm-deepseek', settingsPath: [] }),
    row({ provider: 'my-route', displayName: 'My Route', declared: true }),
  ]
  const rows = joinProviderDirectory(registered, directory)
  // deepseek 稳定排最前；openai 目录行 active=true；my-route active=false + declared 保留。
  assert.equal(rows[0].provider, 'deepseek-official')
  const openai = rows.find((r) => r.provider === 'openai')
  assert.equal(openai?.active, true)
  const myRoute = rows.find((r) => r.provider === 'my-route')
  assert.equal(myRoute?.active, false)
  assert.equal(myRoute?.declared, true)
  // 仅注册、不在目录里的 bare-adapter 追加为无配置面的行。
  const bare = rows.find((r) => r.provider === 'bare-adapter')
  assert.deepEqual(bare, {
    provider: 'bare-adapter', displayName: 'Bare Adapter', settingsNs: '', settingsPath: [], active: true,
  })
})

test('deriveKeyRef：非字母数字折叠为下划线并整串大写', () => {
  assert.equal(deriveKeyRef('deepseek-official'), 'DEEPSEEK_OFFICIAL_API_KEY')
  assert.equal(deriveKeyRef('my.route#2'), 'MY_ROUTE_2_API_KEY')
})

test('asModelIds：字符串 / {id} 对象 / 混合与脏值', () => {
  assert.deepEqual(asModelIds(['a', 'b']), ['a', 'b'])
  assert.deepEqual(asModelIds([{ id: 'a' }, { id: 'b' }]), ['a', 'b'])
  assert.deepEqual(asModelIds(['a', { id: 'b' }, 42, null, { nope: 1 }, '']), ['a', 'b'])
  assert.deepEqual(asModelIds(undefined), [])
  assert.deepEqual(asModelIds('a'), [])
})

test('isCoreProvider + partitionProviders：deepseek/declared/active/configured 为核心，其余折叠', () => {
  assert.equal(isCoreProvider(row({ provider: 'deepseek-official' }), false), true)
  assert.equal(isCoreProvider(row({ provider: 'deepseek-account' }), false), true)
  assert.equal(isCoreProvider(row({ declared: true }), false), true)
  assert.equal(isCoreProvider(row({ active: true }), false), true)
  assert.equal(isCoreProvider(row(), true), true)
  assert.equal(isCoreProvider(row({ active: false }), false), false)

  const rows = [
    row({ provider: 'deepseek-official' }),
    row({ provider: 'unused-official', active: false }),
    row({ provider: 'mine', declared: true }),
  ]
  const { core, folded } = partitionProviders(rows, () => false)
  assert.deepEqual(core.map((r) => r.provider), ['deepseek-official', 'mine'])
  assert.deepEqual(folded.map((r) => r.provider), ['unused-official'])
})

test('summarizeModels：空清单占位、短清单直连、长清单截断 +N', () => {
  assert.equal(summarizeModels([]), '未配置模型清单')
  assert.equal(summarizeModels(['a']), 'a')
  assert.equal(summarizeModels(['a', 'b']), 'a · b')
  assert.equal(summarizeModels(['a', 'b', 'c', 'd']), 'a · b +2')
  // 空串位不计入头部计数（编辑中的空行不虚增 +N）。
  assert.equal(summarizeModels(['a', '', 'c']), 'a · c')
})

test('gatewayRowOf：识别 DramaServer 官方网关行；P4 未落地时为 undefined', () => {
  const rows = [
    row({ provider: 'deepseek-official' }),
    row({ provider: GATEWAY_PROVIDER_ID, settingsPath: ['providers', GATEWAY_PROVIDER_ID], active: true }),
  ]
  assert.equal(gatewayRowOf(rows)?.provider, GATEWAY_PROVIDER_ID)
  assert.equal(gatewayRowOf([row({ provider: 'deepseek-official' })]), undefined)
})
