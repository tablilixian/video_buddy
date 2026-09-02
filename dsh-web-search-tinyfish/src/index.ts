/**
 * Register TinyFish-backed search and fetch providers in `ctx.web`. Both use the
 * free TinyFish Search/Fetch API with a single `X-API-Key`. No DeepSeek key required.
 * @module dsh-web-search-tinyfish
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-web'
import { TinyFishFetchProvider, TinyFishSearchProvider, TINYFISH_PROVIDER_ID } from './provider.js'
import type { TinyFishProviderOptions } from './provider.js'

export { TinyFishFetchProvider, TinyFishSearchProvider, TINYFISH_PROVIDER_ID } from './provider.js'
export type { TinyFishProviderOptions } from './provider.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-tinyfish'

/** The web seam this provider registers into. */
export const inject = ['web']

const DEFAULT_API_KEY_ENV = 'TINYFISH_API_KEY'

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Literal TinyFish API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  apiKey?: string
  /** Credential reference resolved for each call; defaults to `TINYFISH_API_KEY`. */
  apiKeyEnv?: string
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
})

/** Settings namespace carrying this provider's key reference. */
export const WEB_SEARCH_TINYFISH_SETTINGS_NAMESPACE = settingsNamespace('web-search-tinyfish')

function resolveOptions(ctx: Context, config: Config): TinyFishProviderOptions {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0 ? config.apiKey : undefined
  return {
    resolveApiKey: async () => {
      if (literalApiKey !== undefined) return literalApiKey
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    apiKeyEnv,
  }
}

/** Register the TinyFish search and fetch providers with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  installSettingsSection(ctx, WEB_SEARCH_TINYFISH_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    // The registration carries no resolved value: the provider resolves the key per call.
    onChange: () => {},
  })
  const options = resolveOptions(ctx, current())
  ctx.web.registerSearchProvider(new TinyFishSearchProvider(options))
  ctx.web.registerFetchProvider(new TinyFishFetchProvider(options))
}
