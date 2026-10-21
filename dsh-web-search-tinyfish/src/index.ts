/**
 * Register TinyFish-backed search and fetch providers in `ctx.web`. Both use the
 * free TinyFish Search/Fetch API with a single `X-API-Key`. No DeepSeek key required.
 * @module dsh-web-search-tinyfish
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
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

/** Plugin config; 0.2.1 delivers each field as a volatile reference. */
export interface Config {
  /** Literal TinyFish API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  apiKey: Volatile<string | undefined>
  /** Credential reference resolved for each call; defaults to `TINYFISH_API_KEY`. */
  apiKeyEnv: Volatile<string>
}

export const Config = z.object({
  apiKey: z.string().role('secret').volatile(),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV).volatile(),
})

/** Settings namespace carrying this provider's key reference. */
export const WEB_SEARCH_TINYFISH_SETTINGS_NAMESPACE = 'web-search-tinyfish'

/** Resolve the currently authoritative section into one set of provider options. */
function resolveOptions(ctx: Context, config: Config): TinyFishProviderOptions {
  const apiKeyEnv = credentialRef(config.apiKeyEnv.get() ?? DEFAULT_API_KEY_ENV)
  const literal = config.apiKey.get()
  const literalApiKey = literal !== undefined && literal.length > 0 ? literal : undefined
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
  // The section is re-read per call, so a settings edit needs no restart.
  const options = () => resolveOptions(ctx, config)
  ctx.web.registerSearchProvider(new TinyFishSearchProvider(options))
  ctx.web.registerFetchProvider(new TinyFishFetchProvider(options))
}
