/**
 * 模型网关纯函数单测（src/gateway.ts，方案 P4/CV-357）。
 *
 * 覆盖：行生成（available 过滤 + display_name 兜底）、配置合并（只动自己的行 /
 * 用户 provider 保留 / 空目录移除防复活 / providers 清空连键删）、目录指纹
 * （无变化不写）、凭据发布形状（credentialRef、空 token 不写）、目录缓存读写回环。
 *
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  gatewayCatalogPath, gatewayFingerprint, gatewayProfile, gatewayProviderOf, gatewayRow,
  publishGatewayCredential, readGatewayCatalog, writeGatewayCatalog,
  GATEWAY_CREDENTIAL_REF, GATEWAY_ROUTE_NAME,
} from '../lib/gateway.js'

const catalogOf = (models) => ({ apiBaseUrl: 'http://business.test', models, updatedAt: '2026-10-22T00:00:00Z' })
const modelOf = (code, over = {}) => ({
  id: `id-${code}`, code, display_name: code.toUpperCase(), modality: 'text',
  capabilities: {}, entitled: true, available: true, endpoints: null, ...over,
})

test('gatewayRow + gatewayProfile：available 过滤、displayName 兜底、行形状', () => {
  const row = gatewayRow(catalogOf([
    modelOf('deepseek-flash'),
    modelOf('offline-model', { available: false }),
    modelOf('no-display-name', { display_name: '' }),
  ]))
  assert.deepEqual(row, {
    apiBaseUrl: 'http://business.test',
    models: [
      { code: 'deepseek-flash', displayName: 'DEEPSEEK-FLASH' },
      { code: 'no-display-name', displayName: 'no-display-name' },
    ],
  })
  // 全部不可用 → 无网关行（防已下线模型复活）。
  assert.equal(gatewayRow(catalogOf([modelOf('x', { available: false })])), null)
  assert.equal(gatewayRow(null), null)

  const profile = gatewayProfile(row)
  assert.deepEqual(profile, {
    displayName: 'DramaServer',
    apiKeyEnv: GATEWAY_CREDENTIAL_REF,
    api: 'openai-completions',
    baseURL: 'http://business.test/v1/llm',
    models: [
      { id: 'deepseek-flash', name: 'DEEPSEEK-FLASH', contextWindow: 262_144 },
      { id: 'no-display-name', name: 'no-display-name', contextWindow: 262_144 },
    ],
  })
})

test('gatewayProviderOf + 指纹：无变化不写的判据', () => {
  const profile = gatewayProfile(gatewayRow(catalogOf([modelOf('deepseek-flash')])))
  // settings.mutate 落行后的形状：providers 表下挂网关行。
  const config = { providers: { [GATEWAY_ROUTE_NAME]: profile, 'my-local-llm': { api: 'openai-completions' } } }
  assert.equal(gatewayProviderOf(config), config.providers[GATEWAY_ROUTE_NAME])
  assert.equal(gatewayProviderOf(undefined), undefined)

  const row = gatewayRow(catalogOf([modelOf('deepseek-flash')]))
  const same = gatewayRow(catalogOf([modelOf('deepseek-flash')]))
  const changed = gatewayRow(catalogOf([modelOf('deepseek-flash'), modelOf('deepseek-v3.2')]))
  assert.equal(gatewayFingerprint(row), gatewayFingerprint(same))
  assert.notEqual(gatewayFingerprint(row), gatewayFingerprint(changed))
  assert.equal(gatewayFingerprint(null), '')
})

test('publishGatewayCredential：credentialRef 包装 + 空 token / 无服务不写', async () => {
  const seen = []
  const sink = { set: async (ref, value) => { seen.push({ ref, value }) } }
  assert.equal(await publishGatewayCredential(sink, (name) => `ref:${name}`, 'token-1'), true)
  assert.deepEqual(seen, [{ ref: `ref:${GATEWAY_CREDENTIAL_REF}`, value: 'token-1' }])
  assert.equal(await publishGatewayCredential(sink, (n) => n, ''), false)
  assert.equal(await publishGatewayCredential(undefined, (n) => n, 'token-2'), false)
  assert.equal(seen.length, 1)
})

test('目录缓存：写读回环 + 0600 + 非法输入删文件', () => {
  const home = mkdtempSync(join(tmpdir(), 'cs-gateway-'))
  try {
    const written = writeGatewayCatalog(home, catalogOf([modelOf('deepseek-flash')]))
    assert.equal(written.apiBaseUrl, 'http://business.test')
    assert.equal(statSync(gatewayCatalogPath(home)).mode & 0o777, 0o600)
    const loaded = readGatewayCatalog(home)
    assert.equal(loaded.models[0].code, 'deepseek-flash')

    // 无效目录（无 code）→ 删缓存文件并返回 null。
    writeGatewayCatalog(home, { apiBaseUrl: 'http://business.test', models: [{ id: 'x' }] })
    assert.equal(existsSync(gatewayCatalogPath(home)), false)
    assert.equal(readGatewayCatalog(home), null)

    // 损坏文件 → null 不抛。
    writeFileSync(gatewayCatalogPath(home), '{oops', 'utf8')
    assert.equal(readGatewayCatalog(home), null)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
