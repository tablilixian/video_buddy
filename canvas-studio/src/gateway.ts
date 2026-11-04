/**
 * 模型网关（DramaServer 的 LLM Gateway → DSH 的模型 Provider；方案 P4，CV-357）。
 *
 * DramaServer 的 `/v1/llm` 声明成一条手写网关路由（`llm-pi-ai` 的
 * `openai-completions` 协议），凭据用凭据引用 `CANVAS_STUDIO_GATEWAY_TOKEN`，由
 * Host 在会话推送时写入凭据存储（存的值优先于环境，下一次请求即生效，不需要重启）。
 *
 * 路由需要一份非空模型目录，目录来自 DramaServer 的 `/v1/models`。登录后取到过
 * 目录就缓存到 `<DSH_HOME>/canvas-studio/gateway-catalog.json`，下次启动据此生成
 * 路由；没登录过就没有 DramaServer 模型可选（其余功能不受影响）。
 *
 * 纯函数平移自 reelsbuddy-desktop `src/host/studio/gateway.ts`；落行走宿主
 * `settings.mutate`（桌面「模型」页同一条写路径，llm-pi-ai volatile 热重注册），
 * reconcile 装配在 `src/index.ts`。
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CatalogModel } from './drama-management.js'

export const GATEWAY_ROUTE_NAME = 'canvas-studio-gateway'
export const GATEWAY_CREDENTIAL_REF = 'CANVAS_STUDIO_GATEWAY_TOKEN'
/** 网关行所在的 settings 命名空间（llm-pi-ai 的 providers 表）。 */
export const GATEWAY_SETTINGS_NS = 'llm-pi-ai'
export const GATEWAY_CATALOG_FILE = 'gateway-catalog.json'
/** 未在目录里声明容量时的兜底（DramaServer 默认最大输出 32k，给足上下文）。 */
export const GATEWAY_DEFAULT_CONTEXT_WINDOW = 262_144
/**
 * DramaServer `/v1/llm` 的输出上限（2026-10-23 实测：32768 → 200，65536 → 400
 * `invalid_argument`，错误体与会话记录中 18 次压缩失败逐字节一致）。
 * 写进每个模型行的作用：compaction-basic 的压力预留（`reservedCompletionTokens`）
 * 会取适配器的 per-request 默认（`defaultMaxTokens` ← 本字段）计入输出预留，
 * 使压力阈值不再按 65k headroom 虚高、压缩触发时机正确。注意普通请求的
 * `max_completion_tokens` 仍只在调用方显式设置时携带（pi-ai 只认 options.maxTokens），
 * 压缩请求的输出上限由 cordis.patch.yml 里 compaction-basic 的 `maxTokens` 显式管住。
 */
export const GATEWAY_MAX_OUTPUT_TOKENS = 32_768

/**
 * 已实测支持图像输入、但服务端目录未声明的网关模型。
 *
 * 2026-11-04 实测：DramaServer `/v1/llm` 把 `deepseek-flash` 路由到
 * `deepseek-v4.1-flash`；带 `image_url` 的 chat/completions 返回 200，
 * 纯色图答 "Red"，真实静帧能描述太阳/地球/弧线/文字。而 `/v1/models`
 * 目录仍标 `modality="text"`、`capabilities` 无 `inputs`。
 *
 * llm-pi-ai 的模型行缺 `input` 字段时会回落到 route 的 `defaultInput=[text]`，
 * 于是 tool-fs/read-image.ts 的严格能力闸拒收 read_image，llm 还会把消息里的
 * 图片投影成文本。目录不是能力 SSOT 期间用本表兜底；后端把
 * `capabilities.inputs` 补成 `["text","image"]` 后删除本表即可。
 */
export const GATEWAY_IMAGE_INPUT_OVERRIDES: ReadonlySet<string> = new Set(['deepseek-flash'])

export type GatewayInputModality = 'text' | 'image'
const GATEWAY_INPUT_MODALITIES: readonly GatewayInputModality[] = ['text', 'image']

/** 单条目录模型 → llm-pi-ai 的 `input` 声明（目录优先，实测覆盖表兜底）。 */
export function resolveModelInput(
  model: Pick<CatalogModel, 'code' | 'modality' | 'capabilities'>,
): GatewayInputModality[] {
  const declared = model.capabilities?.['inputs']
  const fromCatalog = Array.isArray(declared)
    ? GATEWAY_INPUT_MODALITIES.filter((modality) => declared.includes(modality))
    : []
  const fallback: GatewayInputModality[] = model.modality === 'image' ? ['text', 'image'] : ['text']
  const resolved = new Set<GatewayInputModality>(fromCatalog.length > 0 ? fromCatalog : fallback)
  resolved.add('text')
  if (GATEWAY_IMAGE_INPUT_OVERRIDES.has(model.code)) resolved.add('image')
  return GATEWAY_INPUT_MODALITIES.filter((modality) => resolved.has(modality))
}

export interface GatewayCatalog {
  apiBaseUrl: string
  models: CatalogModel[]
  updatedAt: string
}

export interface GatewayRow {
  apiBaseUrl: string
  models: { code: string; displayName: string; input: GatewayInputModality[] }[]
}

/** 折进 `llm-pi-ai` 的 `providers` 路由对象（与 Models 页的配置形状一致）。 */
export interface GatewayProviderProfile {
  displayName: string
  apiKeyEnv: string
  api: string
  baseURL: string
  models: { id: string; name: string; contextWindow: number; maxTokens: number; input: GatewayInputModality[] }[]
}

export function gatewayProfile(gateway: GatewayRow): GatewayProviderProfile {
  return {
    displayName: 'DramaServer',
    apiKeyEnv: GATEWAY_CREDENTIAL_REF,
    api: 'openai-completions',
    baseURL: `${gateway.apiBaseUrl.replace(/\/+$/, '')}/v1/llm`,
    models: gateway.models.map((model) => ({
      id: model.code,
      name: model.displayName,
      contextWindow: GATEWAY_DEFAULT_CONTEXT_WINDOW,
      maxTokens: GATEWAY_MAX_OUTPUT_TOKENS,
      input: model.input,
    })),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 读取一份配置里的网关路由对象；没有时返回 undefined。 */
export function gatewayProviderOf(config: Record<string, unknown> | undefined): unknown {
  const providers = isRecord(config) ? config['providers'] : undefined
  return isRecord(providers) ? providers[GATEWAY_ROUTE_NAME] : undefined
}

export function gatewayCatalogPath(studioHomeDirectory: string): string {
  return join(studioHomeDirectory, GATEWAY_CATALOG_FILE)
}

export function readGatewayCatalog(studioHomeDirectory: string): GatewayCatalog | null {
  const path = gatewayCatalogPath(studioHomeDirectory)
  if (!existsSync(path)) return null
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return null
    const record = parsed as Record<string, unknown>
    const apiBaseUrl = record['apiBaseUrl']
    const models = record['models']
    if (typeof apiBaseUrl !== 'string' || !Array.isArray(models)) return null
    const usable = models.filter(
      (model): model is CatalogModel =>
        typeof model === 'object' &&
        model !== null &&
        typeof (model as Record<string, unknown>)['code'] === 'string',
    )
    if (usable.length === 0) return null
    return {
      apiBaseUrl,
      models: usable,
      updatedAt: typeof record['updatedAt'] === 'string' ? record['updatedAt'] : '',
    }
  } catch {
    return null
  }
}

export function writeGatewayCatalog(
  studioHomeDirectory: string,
  catalog: { apiBaseUrl: string; models: CatalogModel[] },
): GatewayCatalog | null {
  const models = catalog.models.filter((model) => typeof model.code === 'string' && model.code.length > 0)
  if (models.length === 0 || catalog.apiBaseUrl.length === 0) {
    rmSync(gatewayCatalogPath(studioHomeDirectory), { force: true })
    return null
  }
  const next: GatewayCatalog = {
    apiBaseUrl: catalog.apiBaseUrl,
    models,
    updatedAt: new Date().toISOString(),
  }
  writeFileSync(gatewayCatalogPath(studioHomeDirectory), `${JSON.stringify(next, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  return next
}

/** 把缓存目录折成补丁层要用的行参数（只有 `available !== false` 的模型才算数）。 */
export function gatewayRow(catalog: GatewayCatalog | null): GatewayRow | null {
  if (catalog === null) return null
  const models = catalog.models
    .filter((model) => model.available !== false)
    .map((model) => ({
      code: model.code,
      displayName: model.display_name || model.code,
      input: resolveModelInput(model),
    }))
  if (models.length === 0) return null
  return { apiBaseUrl: catalog.apiBaseUrl, models }
}

/** 目录指纹：无变化不写配置（避免每次会话推送都打一次 configEditor）。 */
export function gatewayFingerprint(gateway: GatewayRow | null): string {
  if (gateway === null) return ''
  return JSON.stringify({
    apiBaseUrl: gateway.apiBaseUrl,
    models: gateway.models.map((model) => [model.code, model.displayName, model.input]),
  })
}

/** 凭据服务的最小结构（Host 只用到 set）。 */
export interface CredentialsSink {
  set(ref: unknown, value: string): Promise<void>
}

/**
 * 把上游凭据写进 DSH 凭据存储。返回值区分「写成功」与「没有凭据服务」，
 * 调用方据此记录日志（是否登录由调用方判定）。
 */
export async function publishGatewayCredential(
  service: CredentialsSink | undefined,
  credentialRef: (name: string) => unknown,
  token: string,
): Promise<boolean> {
  if (service === undefined || token.length === 0) return false
  await service.set(credentialRef(GATEWAY_CREDENTIAL_REF), token)
  return true
}
