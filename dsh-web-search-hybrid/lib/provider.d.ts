/**
 * Hybrid web providers for `ctx.web`: one search provider and one fetch provider
 * (both id `hybrid`) that choose their backend at call time.
 *
 * Search: when a TinyFish API key resolves, delegate to the in-house
 * TinyFish provider; otherwise — or after a TinyFish failure other than caller
 * abort — fall back to the keyless free-engine chain from `dsh-free-search`
 * (Bing zh-CN → DDG lite → DDG html; first non-empty result wins).
 *
 * Fetch: when a TinyFish API key resolves, delegate to the TinyFish fetch
 * provider; otherwise — or after a TinyFish failure other than caller abort —
 * use the built-in keyless HTTP retrieval (compact port of the upstream
 * `web-fetch-http` semantics: http(s) URLs only, same-origin redirects under a
 * hop cap, timeout and size caps, html/text content classification).
 *
 * The backend choice is made per call so a stored or removed key takes effect
 * without a restart. `available()` stays true: the seam's pinned-selection
 * contract requires it, mirroring the TinyFish providers.
 * @module dsh-web-search-hybrid/provider
 */
import type { WebFetchProvider, WebFetchRequest, WebFetchResult, WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web';
import type { TinyFishProviderOptions } from 'dsh-web-search-tinyfish';
/** Stable id both hybrid providers register under. */
export declare const HYBRID_PROVIDER_ID = "hybrid";
/** Resolved provider options (the plugin's `apply` supplies the key resolver). */
export interface HybridProviderOptions {
    /** Resolve the current TinyFish API key for one operation; `undefined` = no key. */
    resolveApiKey: () => Promise<string | undefined>;
    /** Credential reference named by missing-credential diagnostics. */
    apiKeyEnv: string;
    /** Bing market for the keyless search chain (e.g. `zh-CN`). */
    bingMarket: string;
}
/** The hybrid search provider: keyed TinyFish first, keyless free engines as the fallback. */
export declare class HybridSearchProvider implements WebSearchProvider {
    private readonly options;
    readonly id = "hybrid";
    private readonly tinyfish;
    constructor(options: HybridProviderOptions, tinyfishOptions: TinyFishProviderOptions);
    /** The backend choice happens per call, so the provider is always usable. */
    available(): boolean;
    search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>;
}
/** The hybrid fetch provider: keyed TinyFish first, built-in keyless HTTP retrieval as the fallback. */
export declare class HybridFetchProvider implements WebFetchProvider {
    private readonly options;
    readonly id = "hybrid";
    private readonly tinyfish;
    constructor(options: HybridProviderOptions, tinyfishOptions: TinyFishProviderOptions);
    /** The backend choice happens per call, so the provider is always usable. */
    available(): boolean;
    fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult>;
}
