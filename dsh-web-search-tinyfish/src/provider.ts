/**
 * TinyFish Search + Fetch providers for the `ctx.web` seam. Both are free-tier:
 * Search (https://api.search.tinyfish.ai) and Fetch (https://api.fetch.tinyfish.ai),
 * authenticated with a single `X-API-Key`. No credit card required.
 * @module dsh-web-search-tinyfish/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'

/** Stable id this provider registers under (must match the patch's searchProvider/fetchProvider). */
export const TINYFISH_PROVIDER_ID = 'tinyfish'

const SEARCH_ENDPOINT = 'https://api.search.tinyfish.ai'
const FETCH_ENDPOINT = 'https://api.fetch.tinyfish.ai'
const USER_AGENT = 'deepseek-harness/0.0.1'

/** Resolved provider options (the plugin's `apply` supplies the API key resolver). */
export interface TinyFishProviderOptions {
  /** Resolve the current TinyFish API key for one operation. */
  resolveApiKey: () => Promise<string | undefined>
  /** Credential reference named by missing-credential diagnostics. */
  apiKeyEnv: string
}

interface TinyFishSearchResult {
  query?: string
  results?: Array<{
    position?: number
    site_name?: string
    title?: string
    snippet?: string
    url?: string
  }>
  total_results?: number
  page?: number
}

interface TinyFishFetchItem {
  url?: string
  title?: string
  format?: string
  text?: string
  content?: string
  status?: number
  error?: string
}

interface TinyFishFetchResponse {
  results?: TinyFishFetchItem[]
  errors?: Array<{ url?: string; error?: string; status?: number }>
}

/** The TinyFish-backed search provider. */
export class TinyFishSearchProvider implements WebSearchProvider {
  readonly id = TINYFISH_PROVIDER_ID

  constructor(private readonly options: TinyFishProviderOptions) {}

  available(): boolean {
    // Pinned selection requires available()===true; the actual key check happens at call time.
    return true
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const apiKey = await this.apiKey(signal)
    const url = new URL(SEARCH_ENDPOINT)
    url.searchParams.set('query', request.query)
    let response: Response
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { 'X-API-Key': apiKey, accept: 'application/json', 'user-agent': USER_AGENT },
        signal,
      })
    } catch (error: unknown) {
      if (signal?.aborted) throw new WebError('TinyFish search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`TinyFish search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    if (!response.ok) await this.throwOnError(response, 'search', signal)
    let payload: TinyFishSearchResult
    try {
      payload = (await response.json()) as TinyFishSearchResult
    } catch (error: unknown) {
      if (signal?.aborted) throw new WebError('TinyFish search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`TinyFish returned an unprocessable search body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    const sources: WebSearchSource[] = []
    for (const item of payload.results ?? []) {
      if (!item.url || item.url.length === 0) continue
      const source: WebSearchSource = {
        url: item.url,
        ...(item.title && item.title.length > 0 ? { title: item.title } : {}),
        ...(item.snippet && item.snippet.length > 0 ? { snippet: item.snippet } : {}),
      }
      sources.push(source)
    }
    return { sources, truncated: false }
  }

  private async apiKey(signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) throw new WebError('TinyFish search aborted', 'WEB_ABORTED')
    const resolved = await this.options.resolveApiKey()
    if (resolved !== undefined && resolved.length > 0) return resolved
    throw new WebError(
      `TinyFish search has no API key for "${this.options.apiKeyEnv}"; store it through the credentials service `
        + '(the web settings page writes it), export it in the launching environment, or set a literal "apiKey" in the '
        + 'web-search-tinyfish config',
      'WEB_PROVIDER_CREDENTIAL_MISSING',
    )
  }

  private async throwOnError(response: Response, kind: string, signal?: AbortSignal): Promise<never> {
    const status = response.status
    let message = `TinyFish ${kind} error (HTTP ${status})`
    try {
      const parsed = (await response.json()) as { error?: string; message?: string; detail?: string }
      const detail = parsed.error ?? parsed.message ?? parsed.detail
      if (detail !== undefined && detail.length > 0) message = detail
    } catch (error: unknown) {
      if (signal?.aborted) throw new WebError(`${kind} aborted`, 'WEB_ABORTED', { cause: error })
    }
    if (status === 401) {
      throw new WebError(`TinyFish API key rejected (HTTP 401): ${message}`, 'WEB_PROVIDER_CREDENTIAL_MISSING')
    }
    if (status === 429) {
      const retry = response.headers.get('retry-after')
      throw new WebError(
        `TinyFish rate limit exceeded (HTTP 429)${retry ? `; retry after ${retry}s` : ''}`,
        'WEB_PROVIDER_ERROR',
      )
    }
    throw new WebError(message, 'WEB_PROVIDER_ERROR')
  }
}

/** The TinyFish-backed fetch provider. */
export class TinyFishFetchProvider implements WebFetchProvider {
  readonly id = TINYFISH_PROVIDER_ID

  constructor(private readonly options: TinyFishProviderOptions) {}

  available(): boolean {
    return true
  }

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    const apiKey = await this.apiKey(signal)
    let response: Response
    try {
      response = await fetch(FETCH_ENDPOINT, {
        method: 'POST',
        headers: { 'X-API-Key': apiKey, 'content-type': 'application/json', accept: 'application/json', 'user-agent': USER_AGENT },
        body: JSON.stringify({ urls: [request.url], format: 'markdown' }),
        signal,
      })
    } catch (error: unknown) {
      if (signal?.aborted) throw new WebError('TinyFish fetch aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`TinyFish fetch request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    if (!response.ok) await this.throwOnError(response, 'fetch', signal)
    let payload: TinyFishFetchResponse
    try {
      payload = (await response.json()) as TinyFishFetchResponse
    } catch (error: unknown) {
      if (signal?.aborted) throw new WebError('TinyFish fetch aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`TinyFish returned an unprocessable fetch body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    const item = (payload.results ?? []).find((r) => r.url === request.url)
    if (item !== undefined) {
      const content = item.text ?? item.content ?? ''
      const statusCode = item.status ?? 200
      return { url: request.url, statusCode, body: { kind: 'text', content }, truncated: false }
    }
    const err = (payload.errors ?? []).find((e) => e.url === request.url)
    if (err !== undefined) {
      throw new WebError(
        `TinyFish fetch failed for ${request.url}: ${err.error ?? 'unknown error'}${err.status ? ` (HTTP ${err.status})` : ''}`,
        'WEB_PROVIDER_ERROR',
      )
    }
    throw new WebError(`TinyFish fetch returned no result for ${request.url}`, 'WEB_PROVIDER_ERROR')
  }

  private async apiKey(signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) throw new WebError('TinyFish fetch aborted', 'WEB_ABORTED')
    const resolved = await this.options.resolveApiKey()
    if (resolved !== undefined && resolved.length > 0) return resolved
    throw new WebError(
      `TinyFish fetch has no API key for "${this.options.apiKeyEnv}"; store it through the credentials service `
        + '(the web settings page writes it), export it in the launching environment, or set a literal "apiKey" in the '
        + 'web-search-tinyfish config',
      'WEB_PROVIDER_CREDENTIAL_MISSING',
    )
  }

  private async throwOnError(response: Response, kind: string, signal?: AbortSignal): Promise<never> {
    const status = response.status
    let message = `TinyFish ${kind} error (HTTP ${status})`
    try {
      const parsed = (await response.json()) as { error?: string; message?: string; detail?: string }
      const detail = parsed.error ?? parsed.message ?? parsed.detail
      if (detail !== undefined && detail.length > 0) message = detail
    } catch (error: unknown) {
      if (signal?.aborted) throw new WebError(`${kind} aborted`, 'WEB_ABORTED', { cause: error })
    }
    if (status === 401) {
      throw new WebError(`TinyFish API key rejected (HTTP 401): ${message}`, 'WEB_PROVIDER_CREDENTIAL_MISSING')
    }
    if (status === 429) {
      const retry = response.headers.get('retry-after')
      throw new WebError(
        `TinyFish rate limit exceeded (HTTP 429)${retry ? `; retry after ${retry}s` : ''}`,
        'WEB_PROVIDER_ERROR',
      )
    }
    throw new WebError(message, 'WEB_PROVIDER_ERROR')
  }
}
