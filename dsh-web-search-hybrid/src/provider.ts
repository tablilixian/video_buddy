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

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebFetchBody,
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
} from '@deepseek-ai/dsh-web'
import { searchBing, searchDdgHtml, searchDdgLite } from 'dsh-free-search'
import { TinyFishFetchProvider, TinyFishSearchProvider } from 'dsh-web-search-tinyfish'
import type { TinyFishProviderOptions } from 'dsh-web-search-tinyfish'

/** Stable id both hybrid providers register under. */
export const HYBRID_PROVIDER_ID = 'hybrid'

/** Resolved provider options (the plugin's `apply` supplies the key resolver). */
export interface HybridProviderOptions {
  /** Resolve the current TinyFish API key for one operation; `undefined` = no key. */
  resolveApiKey: () => Promise<string | undefined>
  /** Credential reference named by missing-credential diagnostics. */
  apiKeyEnv: string
  /** Bing market for the keyless search chain (e.g. `zh-CN`). */
  bingMarket: string
}

/** Free-engine chain tried in order until one returns a non-empty source list. */
const FREE_SEARCH_ENGINES = [
  {
    name: 'bing',
    run: (request: WebSearchRequest, options: HybridProviderOptions, signal?: AbortSignal) =>
      searchBing(request.query, request.maxResults ?? 8, { bingMarket: options.bingMarket }, signal),
  },
  {
    name: 'ddg-lite',
    run: (request: WebSearchRequest, _options: HybridProviderOptions, signal?: AbortSignal) =>
      searchDdgLite(request.query, request.maxResults ?? 8, {}, signal),
  },
  {
    name: 'ddg-html',
    run: (request: WebSearchRequest, _options: HybridProviderOptions, signal?: AbortSignal) =>
      searchDdgHtml(request.query, request.maxResults ?? 8, {}, signal),
  },
] as const

/** Run the keyless free-engine chain; throws `WEB_PROVIDER_ERROR` when every engine fails. */
async function freeSearch(
  request: WebSearchRequest,
  options: HybridProviderOptions,
  signal?: AbortSignal,
): Promise<WebSearchResult> {
  const failures: string[] = []
  for (const engine of FREE_SEARCH_ENGINES) {
    if (signal?.aborted) throw new WebError('hybrid search aborted', 'WEB_ABORTED')
    try {
      const result = await engine.run(request, options, signal)
      if (Array.isArray(result.sources) && result.sources.length > 0) return result
      failures.push(`${engine.name}: empty result`)
    } catch (error: unknown) {
      if (signal?.aborted) throw new WebError('hybrid search aborted', 'WEB_ABORTED', { cause: error })
      failures.push(`${engine.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new WebError(`all free search engines failed (${failures.join('; ')})`, 'WEB_PROVIDER_ERROR')
}

/** The hybrid search provider: keyed TinyFish first, keyless free engines as the fallback. */
export class HybridSearchProvider implements WebSearchProvider {
  readonly id = HYBRID_PROVIDER_ID

  private readonly tinyfish: TinyFishSearchProvider

  constructor(
    private readonly options: HybridProviderOptions,
    tinyfishOptions: TinyFishProviderOptions,
  ) {
    this.tinyfish = new TinyFishSearchProvider(tinyfishOptions)
  }

  /** The backend choice happens per call, so the provider is always usable. */
  available(): boolean {
    return true
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const apiKey = await this.options.resolveApiKey()
    if (apiKey === undefined || apiKey.length === 0) return freeSearch(request, this.options, signal)
    try {
      return await this.tinyfish.search(request, signal)
    } catch (error: unknown) {
      if (signal?.aborted) throw error
      try {
        return await freeSearch(request, this.options, signal)
      } catch {
        // A configured key that fails is the more actionable diagnosis; keep it.
        throw error
      }
    }
  }
}

/** Built-in keyless fetch limits (compact port of the upstream web-fetch-http defaults). */
const FETCH_LIMITS = {
  maxUrlLength: 2048,
  maxResponseBytes: 5_000_000,
  maxBodyChars: 200_000,
  timeoutMs: 30_000,
  maxRedirects: 4,
  userAgent: 'deepseek-harness/0.0.1 (+https://github.com/anywhere-labs/deepseek-harness-desktop)',
} as const

/** The hybrid fetch provider: keyed TinyFish first, built-in keyless HTTP retrieval as the fallback. */
export class HybridFetchProvider implements WebFetchProvider {
  readonly id = HYBRID_PROVIDER_ID

  private readonly tinyfish: TinyFishFetchProvider

  constructor(
    private readonly options: HybridProviderOptions,
    tinyfishOptions: TinyFishProviderOptions,
  ) {
    this.tinyfish = new TinyFishFetchProvider(tinyfishOptions)
  }

  /** The backend choice happens per call, so the provider is always usable. */
  available(): boolean {
    return true
  }

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    const apiKey = await this.options.resolveApiKey()
    if (apiKey === undefined || apiKey.length === 0) return httpFetch(request, signal)
    try {
      return await this.tinyfish.fetch(request, signal)
    } catch (error: unknown) {
      if (signal?.aborted) throw error
      try {
        return await httpFetch(request, signal)
      } catch {
        // Same precedence as search: a configured key that fails is the more
        // actionable diagnosis when the keyless fallback also fails.
        throw error
      }
    }
  }
}

/**
 * Keyless HTTP(S) retrieval. Compact port of the upstream `web-fetch-http`
 * provider: http(s) URLs only, same-origin redirects under a hop cap, one
 * combined timeout, byte-capped body read, and html/text classification.
 * Requests carry no browser cookies or ambient credentials; private-network and
 * SSRF protection is not implemented, matching the upstream provider's stance.
 */
async function httpFetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
  if (signal?.aborted) throw new WebError('web fetch aborted', 'WEB_ABORTED')

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, FETCH_LIMITS.timeoutMs)
  const forwardAbort = (): void => controller.abort()
  signal?.addEventListener('abort', forwardAbort, { once: true })
  try {
    return await followAndRead(request.url, controller.signal)
  } catch (error: unknown) {
    if (timedOut) throw new WebError('web fetch timed out', 'WEB_FETCH_TIMEOUT', { cause: error })
    if (signal?.aborted) throw new WebError('web fetch aborted', 'WEB_ABORTED', { cause: error })
    if (error instanceof WebError) throw error
    throw new WebError(`web fetch failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', forwardAbort)
  }
}

/** Follow same-origin redirects up to the hop cap, then read the final response. */
async function followAndRead(initialUrl: string, signal: AbortSignal): Promise<WebFetchResult> {
  let currentUrl = validateFetchUrl(initialUrl)
  let redirectsFollowed = 0

  for (;;) {
    const response = await requestOnce(currentUrl, signal)

    if (isRedirectStatus(response.status)) {
      if (redirectsFollowed >= FETCH_LIMITS.maxRedirects) {
        await response.body?.cancel()
        throw new WebError(`exceeded the maximum of ${FETCH_LIMITS.maxRedirects} redirects`, 'WEB_REDIRECT_BLOCKED')
      }
      const location = response.headers.get('location')
      if (location === null) {
        await response.body?.cancel()
        throw new WebError(`redirect response (HTTP ${response.status}) without a Location header`, 'WEB_PROVIDER_ERROR')
      }
      let target: URL
      try {
        target = new URL(location, currentUrl)
        validateFetchUrl(target.toString())
        if (target.origin !== currentUrl.origin) {
          throw new WebError(
            `cross-origin redirect to ${target.origin} is not followed automatically; retry against that URL directly`,
            'WEB_REDIRECT_BLOCKED',
          )
        }
      } catch (error: unknown) {
        await response.body?.cancel()
        throw error
      }
      await response.body?.cancel()
      currentUrl = target
      redirectsFollowed++
      continue
    }

    return await readBody(response, currentUrl)
  }
}

/** Validate the transport basics the retrieval relies on: http(s) and length. */
function validateFetchUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch (error: unknown) {
    throw new WebError(`invalid fetch URL "${raw}"`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WebError(`unsupported fetch URL protocol "${url.protocol}"`, 'WEB_PROVIDER_ERROR')
  }
  if (url.toString().length > FETCH_LIMITS.maxUrlLength) {
    throw new WebError(`fetch URL exceeds the maximum of ${FETCH_LIMITS.maxUrlLength} characters`, 'WEB_PROVIDER_ERROR')
  }
  return url
}

async function requestOnce(url: URL, signal: AbortSignal): Promise<Response> {
  // Network failures propagate to httpFetch, which classifies them through the
  // combined-signal flags (timeout vs caller abort vs transport error).
  return fetch(url, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      'user-agent': FETCH_LIMITS.userAgent,
      'accept': 'text/html,application/xhtml+xml,text/*;q=0.9,application/json;q=0.8',
    },
    signal,
  })
}

/** HTTP redirect status codes that carry a `Location`. */
function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

/** Classify the response into a {@link WebFetchBody} kind, or `undefined` when unsupported. */
function classifyContentType(contentType: string | null): 'html' | 'text' | undefined {
  const value = contentType?.toLowerCase() ?? ''
  if (value.includes('text/html') || value.includes('application/xhtml')) return 'html'
  if (value.startsWith('text/') || value.includes('json') || value.includes('xml') || value.includes('javascript')) {
    return 'text'
  }
  return undefined
}

/** Parse the `charset=` parameter of a Content-Type header; defaults to UTF-8. */
function parseCharset(contentType: string | null): string {
  const match = /charset=([^;]+)/i.exec(contentType ?? '')
  return match?.[1]?.trim().replace(/^["']|["']$/g, '') ?? 'utf-8'
}

/** Read, byte-cap, classify, and decode the final response body. */
async function readBody(response: Response, finalUrl: URL): Promise<WebFetchResult> {
  const contentType = response.headers.get('content-type')
  const kind = classifyContentType(contentType)
  if (kind === undefined) {
    await response.body?.cancel()
    throw new WebError(`unsupported content type "${contentType ?? 'unknown'}"`, 'WEB_UNSUPPORTED_CONTENT_TYPE')
  }

  let decoder: TextDecoder
  try {
    decoder = new TextDecoder(parseCharset(contentType))
  } catch (error: unknown) {
    await response.body?.cancel()
    throw new WebError(`unsupported charset in "${contentType ?? 'unknown'}"`, 'WEB_UNSUPPORTED_CONTENT_TYPE', { cause: error })
  }

  const { bytes, truncatedByBytes } = await readCapped(response)
  const decoded = decoder.decode(bytes)
  const truncatedByChars = decoded.length > FETCH_LIMITS.maxBodyChars
  const content = truncatedByChars ? decoded.slice(0, FETCH_LIMITS.maxBodyChars) : decoded
  const body: WebFetchBody = kind === 'html' ? { kind: 'html', content } : { kind: 'text', content }

  return {
    url: finalUrl.toString(),
    statusCode: response.status,
    body,
    truncated: truncatedByBytes || truncatedByChars,
  }
}

/**
 * Read the response stream up to `maxResponseBytes`. A `Content-Length` over
 * the cap rejects immediately; a stream that grows past the cap is cut short
 * (`truncatedByBytes`) rather than rejected.
 */
async function readCapped(response: Response): Promise<{ bytes: Uint8Array; truncatedByBytes: boolean }> {
  const declared = response.headers.get('content-length')
  if (declared !== null) {
    const length = Number(declared)
    if (Number.isFinite(length) && length > FETCH_LIMITS.maxResponseBytes) {
      await response.body?.cancel()
      throw new WebError(`response exceeds the maximum of ${FETCH_LIMITS.maxResponseBytes} bytes`, 'WEB_FETCH_TOO_LARGE')
    }
  }
  if (response.body === null) return { bytes: new Uint8Array(0), truncatedByBytes: false }

  const chunks: Uint8Array[] = []
  let total = 0
  let truncatedByBytes = false
  const reader = response.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const remaining = FETCH_LIMITS.maxResponseBytes - total
      if (value.byteLength > remaining) {
        chunks.push(value.subarray(0, remaining))
        total += remaining
        truncatedByBytes = true
        break
      }
      chunks.push(value)
      total += value.byteLength
    }
  } finally {
    // Cancel after a completed (or capped) read is best-effort cleanup.
    await reader.cancel().catch(() => {})
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { bytes, truncatedByBytes }
}
