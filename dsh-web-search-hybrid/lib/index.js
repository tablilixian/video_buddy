/**
 * Registers the hybrid web providers with `ctx.web`: TinyFish-backed search and
 * fetch when an API key resolves, keyless free engines (via `dsh-free-search`)
 * and a built-in keyless HTTP fetch as the fallback. The TinyFish API key is
 * the SAME `TINYFISH_API_KEY` credential the web-search-tinyfish settings
 * section manages, so configuring a key there upgrades both paths without any
 * hybrid-specific setup.
 * @module dsh-web-search-hybrid
 */
import z from '@deepseek-ai/schemastery';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment';
import { HybridFetchProvider, HybridSearchProvider } from './provider.js';
export { HYBRID_PROVIDER_ID, HybridFetchProvider, HybridSearchProvider, } from './provider.js';
/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-hybrid';
/** The web seam this provider registers into. */
export const inject = ['web'];
const DEFAULT_API_KEY_ENV = 'TINYFISH_API_KEY';
export const Config = z.object({
    apiKey: z.string().role('secret'),
    apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
    bingMarket: z.string().default('zh-CN'),
});
function resolveOptions(ctx, config) {
    const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV);
    const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0 ? config.apiKey : undefined;
    return {
        resolveApiKey: async () => {
            if (literalApiKey !== undefined)
                return literalApiKey;
            const credentials = ctx.get('credentials');
            if (credentials !== undefined)
                return (await credentials.resolve(apiKeyEnv))?.value;
            const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv);
            return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined;
        },
        apiKeyEnv,
        bingMarket: config.bingMarket ?? 'zh-CN',
    };
}
/** Register the hybrid search and fetch providers with `ctx.web`. */
export function apply(ctx, config) {
    const options = resolveOptions(ctx, config);
    const tinyfishOptions = {
        resolveApiKey: options.resolveApiKey,
        apiKeyEnv: options.apiKeyEnv,
    };
    ctx.web.registerSearchProvider(new HybridSearchProvider(options, tinyfishOptions));
    ctx.web.registerFetchProvider(new HybridFetchProvider(options, tinyfishOptions));
}
//# sourceMappingURL=index.js.map