/**
 * TinyFish Search + Fetch providers for the `ctx.web` seam. Both are free-tier:
 * Search (https://api.search.tinyfish.ai) and Fetch (https://api.fetch.tinyfish.ai),
 * authenticated with a single `X-API-Key`. No credit card required.
 * @module dsh-web-search-tinyfish/provider
 */
import type { WebFetchProvider, WebFetchRequest, WebFetchResult, WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web';
/** Stable id this provider registers under (must match the patch's searchProvider/fetchProvider). */
export declare const TINYFISH_PROVIDER_ID = "tinyfish";
/** Resolved provider options (the plugin's `apply` supplies the API key resolver). */
export interface TinyFishProviderOptions {
    /** Resolve the current TinyFish API key for one operation. */
    resolveApiKey: () => Promise<string | undefined>;
    /** Credential reference named by missing-credential diagnostics. */
    apiKeyEnv: string;
}
/** The TinyFish-backed search provider. */
export declare class TinyFishSearchProvider implements WebSearchProvider {
    private readonly options;
    readonly id = "tinyfish";
    constructor(options: TinyFishProviderOptions);
    available(): boolean;
    search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>;
    private apiKey;
    private throwOnError;
}
/** The TinyFish-backed fetch provider. */
export declare class TinyFishFetchProvider implements WebFetchProvider {
    private readonly options;
    readonly id = "tinyfish";
    constructor(options: TinyFishProviderOptions);
    available(): boolean;
    fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult>;
    private apiKey;
    private throwOnError;
}
