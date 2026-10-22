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
 * 纯函数平移自 reelsbuddy-desktop `src/host/studio/gateway.ts`；configEditor 的
 * reconcile 装配在 `src/index.ts`（0.2.1 的 `entries()/edit()` 面）。
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

export interface GatewayCatalog {
  apiBaseUrl: string
  models: CatalogModel[]
  updatedAt: string
}

export interface GatewayRow {
  apiBaseUrl: string
  models: { code: string; displayName: string }[]
}

/** 折进 `llm-pi-ai` 的 `providers` 路由对象（与 Models 页的配置形状一致）。 */
export interface GatewayProviderProfile {
  displayName: string
  apiKeyEnv: string
  api: string
  baseURL: string
  models: { id: string; name: string; contextWindow: number }[]
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
    })),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 把网关路由合并进 `llm-pi-ai` 的下一份配置：只替换 `canvas-studio-gateway`，
 * 用户自己新增的 provider 原样保留；`profile` 为 null 时只移除网关（防已下线
 * 模型复活）。`providers` 表被清空时连键一起删，不留空对象。
 */
export function mergeGatewayConfig(
  current: Record<string, unknown>,
  profile: GatewayProviderProfile | null,
): Record<string, unknown> {
  const next = structuredClone(current)
  const raw = next['providers']
  const providers = isRecord(raw) ? structuredClone(raw) : {}
  if (profile === null) delete providers[GATEWAY_ROUTE_NAME]
  else providers[GATEWAY_ROUTE_NAME] = structuredClone(profile)
  if (Object.keys(providers).length === 0) delete next['providers']
  else next['providers'] = providers
  return next
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
    .map((model) => ({ code: model.code, displayName: model.display_name || model.code }))
  if (models.length === 0) return null
  return { apiBaseUrl: catalog.apiBaseUrl, models }
}

/** 目录指纹：无变化不写配置（避免每次会话推送都打一次 configEditor）。 */
export function gatewayFingerprint(gateway: GatewayRow | null): string {
  if (gateway === null) return ''
  return JSON.stringify({
    apiBaseUrl: gateway.apiBaseUrl,
    models: gateway.models.map((model) => [model.code, model.displayName]),
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
