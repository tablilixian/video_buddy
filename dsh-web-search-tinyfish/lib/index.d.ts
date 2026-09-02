/**
 * Register TinyFish-backed search and fetch providers in `ctx.web`. Both use the
 * free TinyFish Search/Fetch API with a single `X-API-Key`. No DeepSeek key required.
 * @module dsh-web-search-tinyfish
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export { TinyFishFetchProvider, TinyFishSearchProvider, TINYFISH_PROVIDER_ID } from './provider.js';
export type { TinyFishProviderOptions } from './provider.js';
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "web-search-tinyfish";
/** The web seam this provider registers into. */
export declare const inject: string[];
/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
    /** Literal TinyFish API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
    apiKey?: string;
    /** Credential reference resolved for each call; defaults to `TINYFISH_API_KEY`. */
    apiKeyEnv?: string;
}
export declare const Config: z<Config>;
/** Settings namespace carrying this provider's key reference. */
export declare const WEB_SEARCH_TINYFISH_SETTINGS_NAMESPACE: import("@deepseek-ai/dsh-settings").SettingsNamespace;
/** Register the TinyFish search and fetch providers with `ctx.web`. */
export declare function apply(ctx: Context, config: Config): void;
