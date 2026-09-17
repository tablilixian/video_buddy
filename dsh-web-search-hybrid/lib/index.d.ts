/**
 * Registers the hybrid web providers with `ctx.web`: TinyFish-backed search and
 * fetch when an API key resolves, keyless free engines (via `dsh-free-search`)
 * and a built-in keyless HTTP fetch as the fallback. The TinyFish API key is
 * the SAME `TINYFISH_API_KEY` credential the web-search-tinyfish settings
 * section manages, so configuring a key there upgrades both paths without any
 * hybrid-specific setup.
 * @module dsh-web-search-hybrid
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export { HYBRID_PROVIDER_ID, HybridFetchProvider, HybridSearchProvider, } from './provider.js';
export type { HybridProviderOptions } from './provider.js';
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "web-search-hybrid";
/** The web seam this provider registers into. */
export declare const inject: string[];
/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
    /** Literal TinyFish API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
    apiKey?: string;
    /** Credential reference resolved for each call; defaults to `TINYFISH_API_KEY`. */
    apiKeyEnv?: string;
    /** Bing market for the keyless search chain; defaults to `zh-CN`. */
    bingMarket?: string;
}
export declare const Config: z<Config>;
/** Register the hybrid search and fetch providers with `ctx.web`. */
export declare function apply(ctx: Context, config: Config): void;
