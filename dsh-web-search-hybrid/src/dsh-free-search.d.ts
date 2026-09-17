/**
 * Minimal type surface of the `dsh-free-search` community package actually used
 * by the hybrid fallback chain. The package ships no declarations; this shim is
 * compile-time only and pinned to the 0.4.28 export shape.
 */

declare module 'dsh-free-search' {
  /** Result shape shared by the exported engine runners. */
  export interface FreeSearchResult {
    readonly sources: Array<{ url: string; title?: string; snippet?: string }>
    readonly truncated: boolean
  }

  /** Bing web scrape. `options.bingMarket` pins the market (e.g. `zh-CN`). */
  export function searchBing(
    query: string,
    maxResults?: number,
    options?: { lang?: string; bingMarket?: string; safeSearch?: string },
    signal?: AbortSignal,
  ): Promise<FreeSearchResult>

  /** DuckDuckGo lite scrape. */
  export function searchDdgLite(
    query: string,
    maxResults?: number,
    options?: { safeSearch?: string },
    signal?: AbortSignal,
  ): Promise<FreeSearchResult>

  /** DuckDuckGo html scrape. `options.region` maps to the `kl` parameter. */
  export function searchDdgHtml(
    query: string,
    maxResults?: number,
    options?: { region?: string; safeSearch?: string },
    signal?: AbortSignal,
  ): Promise<FreeSearchResult>
}
