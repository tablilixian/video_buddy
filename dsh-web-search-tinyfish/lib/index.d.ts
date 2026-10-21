/**
 * Register TinyFish-backed search and fetch providers in `ctx.web`. Both use the
 * free TinyFish Search/Fetch API with a single `X-API-Key`. No DeepSeek key required.
 * @module dsh-web-search-tinyfish
 */
import type { Context, Volatile } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export { TinyFishFetchProvider, TinyFishSearchProvider, TINYFISH_PROVIDER_ID } from './provider.js';
export type { TinyFishProviderOptions } from './provider.js';
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "web-search-tinyfish";
/** The web seam this provider registers into. */
export declare const inject: string[];
/** Plugin config; 0.2.1 delivers each field as a volatile reference. */
export interface Config {
    /** Literal TinyFish API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
    apiKey: Volatile<string | undefined>;
    /** Credential reference resolved for each call; defaults to `TINYFISH_API_KEY`. */
    apiKeyEnv: Volatile<string>;
}
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    apiKey: z<string, string, "volatile">;
    apiKeyEnv: z<string, string, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    apiKey: z<string, string, "volatile">;
    apiKeyEnv: z<string, string, "volatile-defined">;
}>>, "plain">;
/** Settings namespace carrying this provider's key reference. */
export declare const WEB_SEARCH_TINYFISH_SETTINGS_NAMESPACE = "web-search-tinyfish";
/** Register the TinyFish search and fetch providers with `ctx.web`. */
export declare function apply(ctx: Context, config: Config): void;
