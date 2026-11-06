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
  publishGatewayCredential, readGatewayCatalog, resolveModelInput, writeGatewayCatalog,
  GATEWAY_CREDENTIAL_REF, GATEWAY_IMAGE_INPUT_OVERRIDES, GATEWAY_MAX_OUTPUT_TOKENS,
  GATEWAY_MAX_REQUEST_IMAGE_BYTES, GATEWAY_ROUTE_NAME,
} from '../lib/gateway.js'
import {
  REASONING_EFFORT_OPTIONS, gatewayReasoningEfforts, reasoningEffortLabel,
} from '../lib/model-directory.js'

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
      { code: 'deepseek-flash', displayName: 'DEEPSEEK-FLASH', input: ['text', 'image'] },
      { code: 'no-display-name', displayName: 'no-display-name', input: ['text'] },
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
    maxRequestImageBytes: 2 * 1024 * 1024,
    models: [
      {
        id: 'deepseek-flash', name: 'DEEPSEEK-FLASH', contextWindow: 262_144, maxTokens: 32_768, input: ['text', 'image'],
        reasoningEfforts: { minimal: 'none', low: 'low', medium: 'medium', high: 'high' },
        compat: { supportsReasoningEffort: true },
      },
      { id: 'no-display-name', name: 'no-display-name', contextWindow: 262_144, maxTokens: 32_768, input: ['text'] },
    ],
  })
})

test('网关模型行必须声明图像输入（目录标 text 也由实测覆盖表兜底）', () => {
  // 根因回归：index.ts 的 reconcile 用 gatewayProfile 整体覆盖 providers 行；
  // 模型行若不带 input，llm-pi-ai 回落到 defaultInput=[text]，
  // tool-fs/read-image.ts 的严格能力闸会拒收 read_image，本机 patch 也会被冲掉。
  const row = gatewayRow(catalogOf([modelOf('deepseek-flash')]))
  assert.deepEqual(row.models[0].input, ['text', 'image'])
  assert.deepEqual(gatewayProfile(row).models[0].input, ['text', 'image'])
  assert.ok(GATEWAY_IMAGE_INPUT_OVERRIDES.has('deepseek-flash'))
})

test('resolveModelInput：目录声明优先，未命中覆盖表保持纯文本', () => {
  assert.deepEqual(resolveModelInput(modelOf('plain-x')), ['text'])
  assert.deepEqual(
    resolveModelInput(modelOf('vision-x', { capabilities: { inputs: ['text', 'image'] } })),
    ['text', 'image'],
  )
  assert.deepEqual(resolveModelInput(modelOf('image-only', { modality: 'image' })), ['text', 'image'])
  // 脏目录不炸，也不凭空获得图像能力。
  assert.deepEqual(resolveModelInput(modelOf('dirty', { capabilities: { inputs: 'image' } })), ['text'])
})

test('目录指纹纳入 input：能力变化必须触发 reconcile', () => {
  const textOnly = gatewayRow(catalogOf([modelOf('vision-x', { capabilities: { inputs: ['text'] } })]))
  const withImage = gatewayRow(catalogOf([modelOf('vision-x', { capabilities: { inputs: ['text', 'image'] } })]))
  assert.notEqual(gatewayFingerprint(textOnly), gatewayFingerprint(withImage))
})

test('模型行必须带 maxTokens=32768（DramaServer 输出上限，压缩压力预留依据）', () => {
  const profile = gatewayProfile(gatewayRow(catalogOf([modelOf('deepseek-flash')])))
  assert.equal(GATEWAY_MAX_OUTPUT_TOKENS, 32_768)
  for (const model of profile.models) {
    assert.equal(model.maxTokens, GATEWAY_MAX_OUTPUT_TOKENS)
    assert.ok(model.maxTokens < 65_536, '必须低于 compaction 默认 headroom（65536），否则压缩请求 400')
  }
})

test('网关 provider 必须带 maxRequestImageBytes < 网关 4 MiB 整包上限（413 事故回归）', () => {
  // 2026-11-05 实测：DramaServer /v1/llm 请求体上限精确 4194304 B，超出即
  // 413 INVALID_REQUEST（终态，image-offload 不接管 → 会话永久卡死）。
  // 本地图片预算必须先于网关触发 IMAGE_OFFLOAD_REQUIRED 自愈。
  const profile = gatewayProfile(gatewayRow(catalogOf([modelOf('deepseek-flash')])))
  assert.equal(GATEWAY_MAX_REQUEST_IMAGE_BYTES, 2 * 1024 * 1024)
  assert.equal(profile.maxRequestImageBytes, GATEWAY_MAX_REQUEST_IMAGE_BYTES)
  assert.ok(
    profile.maxRequestImageBytes < 4 * 1024 * 1024,
    '图片预算必须低于网关 4 MiB 整体请求体上限',
  )
  // 常量变化必须反映到指纹，否则 reconcile 门挡住、老安装不重写网关行。
  assert.ok(gatewayFingerprint(gatewayRow(catalogOf([modelOf('deepseek-flash')]))).includes('"maxRequestImageBytes":'))
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

test('思考档位：关闭思考映射到 none、不用 off、只作用于实测模型、纳入指纹', () => {
  const map = gatewayReasoningEfforts()
  // 关键回归：llm-pi-ai adapter.ts:132 对 effort==='off' 直接省略 reasoning 选项，
  // wire 值到不了请求。因此「关闭思考」必须挂在非 off 档位（minimal → none）。
  assert.equal(map.minimal, 'none', '网关实测 reasoning_effort=none ⇒ reasoning_tokens=0')
  assert.equal(map.off, undefined, '绝不声明 off（选了等于没选）')
  assert.ok(Object.keys(map).length >= 2, '至少声明一个非 off 档位，否则 resolveModelReasoning 校验失败')
  for (const option of REASONING_EFFORT_OPTIONS) {
    if (option.level !== '' && option.wire !== null) {
      assert.equal(map[option.level], option.wire, `设置页 ${option.label} 与 profile 档位必须同源`)
    }
  }
  assert.match(reasoningEffortLabel('off'), /自定义/, '旧文本框遗留的非法值必须显式回显，不能静默吞掉')

  const row = gatewayRow(catalogOf([modelOf('deepseek-flash'), modelOf('other-flash')]))
  const profile = gatewayProfile(row)
  assert.deepEqual(profile.models[0].reasoningEfforts, map)
  assert.equal(profile.models[0].compat.supportsReasoningEffort, true)
  assert.equal(profile.models[1].reasoningEfforts, undefined, '未实测模型不得被标成 reasoning model')
  assert.ok(gatewayFingerprint(row).includes('"reasoningEfforts"'), '档位表变化必须触发 reconcile 重写网关行')
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
