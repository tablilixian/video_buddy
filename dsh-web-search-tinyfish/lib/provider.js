/**
 * TinyFish Search + Fetch providers for the `ctx.web` seam. Both are free-tier:
 * Search (https://api.search.tinyfish.ai) and Fetch (https://api.fetch.tinyfish.ai),
 * authenticated with a single `X-API-Key`. No credit card required.
 * @module dsh-web-search-tinyfish/provider
 */
import { WebError } from '@deepseek-ai/dsh-web';
/** Stable id this provider registers under (must match the patch's searchProvider/fetchProvider). */
export const TINYFISH_PROVIDER_ID = 'tinyfish';
const SEARCH_ENDPOINT = 'https://api.search.tinyfish.ai';
const FETCH_ENDPOINT = 'https://api.fetch.tinyfish.ai';
const USER_AGENT = 'deepseek-harness/0.0.1';
/** The TinyFish-backed search provider. */
export class TinyFishSearchProvider {
    options;
    id = TINYFISH_PROVIDER_ID;
    constructor(options) {
        this.options = options;
    }
    available() {
        // Pinned selection requires available()===true; the actual key check happens at call time.
        return true;
    }
    async search(request, signal) {
        const apiKey = await this.apiKey(signal);
        const url = new URL(SEARCH_ENDPOINT);
        url.searchParams.set('query', request.query);
        let response;
        try {
            response = await fetch(url, {
                method: 'GET',
                headers: { 'X-API-Key': apiKey, accept: 'application/json', 'user-agent': USER_AGENT },
                signal,
            });
        }
        catch (error) {
            if (signal?.aborted)
                throw new WebError('TinyFish search aborted', 'WEB_ABORTED', { cause: error });
            throw new WebError(`TinyFish search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error });
        }
        if (!response.ok)
            await this.throwOnError(response, 'search', signal);
        let payload;
        try {
            payload = (await response.json());
        }
        catch (error) {
            if (signal?.aborted)
                throw new WebError('TinyFish search aborted', 'WEB_ABORTED', { cause: error });
            throw new WebError(`TinyFish returned an unprocessable search body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error });
        }
        const sources = [];
        for (const item of payload.results ?? []) {
            if (!item.url || item.url.length === 0)
                continue;
            const source = {
                url: item.url,
                ...(item.title && item.title.length > 0 ? { title: item.title } : {}),
                ...(item.snippet && item.snippet.length > 0 ? { snippet: item.snippet } : {}),
            };
            sources.push(source);
        }
        return { sources, truncated: false };
    }
    async apiKey(signal) {
        if (signal?.aborted)
            throw new WebError('TinyFish search aborted', 'WEB_ABORTED');
        const resolved = await this.options.resolveApiKey();
        if (resolved !== undefined && resolved.length > 0)
            return resolved;
        throw new WebError(`TinyFish search has no API key for "${this.options.apiKeyEnv}"; store it through the credentials service `
            + '(the web settings page writes it), export it in the launching environment, or set a literal "apiKey" in the '
            + 'web-search-tinyfish config', 'WEB_PROVIDER_CREDENTIAL_MISSING');
    }
    async throwOnError(response, kind, signal) {
        const status = response.status;
        let message = `TinyFish ${kind} error (HTTP ${status})`;
        try {
            const parsed = (await response.json());
            const detail = parsed.error ?? parsed.message ?? parsed.detail;
            if (detail !== undefined && detail.length > 0)
                message = detail;
        }
        catch (error) {
            if (signal?.aborted)
                throw new WebError(`${kind} aborted`, 'WEB_ABORTED', { cause: error });
        }
        if (status === 401) {
            throw new WebError(`TinyFish API key rejected (HTTP 401): ${message}`, 'WEB_PROVIDER_CREDENTIAL_MISSING');
        }
        if (status === 429) {
            const retry = response.headers.get('retry-after');
            throw new WebError(`TinyFish rate limit exceeded (HTTP 429)${retry ? `; retry after ${retry}s` : ''}`, 'WEB_PROVIDER_ERROR');
        }
        throw new WebError(message, 'WEB_PROVIDER_ERROR');
    }
}
/** The TinyFish-backed fetch provider. */
export class TinyFishFetchProvider {
    options;
    id = TINYFISH_PROVIDER_ID;
    constructor(options) {
        this.options = options;
    }
    available() {
        return true;
    }
    async fetch(request, signal) {
        const apiKey = await this.apiKey(signal);
        let response;
        try {
            response = await fetch(FETCH_ENDPOINT, {
                method: 'POST',
                headers: { 'X-API-Key': apiKey, 'content-type': 'application/json', accept: 'application/json', 'user-agent': USER_AGENT },
                body: JSON.stringify({ urls: [request.url], format: 'markdown' }),
                signal,
            });
        }
        catch (error) {
            if (signal?.aborted)
                throw new WebError('TinyFish fetch aborted', 'WEB_ABORTED', { cause: error });
            throw new WebError(`TinyFish fetch request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error });
        }
        if (!response.ok)
            await this.throwOnError(response, 'fetch', signal);
        let payload;
        try {
            payload = (await response.json());
        }
        catch (error) {
            if (signal?.aborted)
                throw new WebError('TinyFish fetch aborted', 'WEB_ABORTED', { cause: error });
            throw new WebError(`TinyFish returned an unprocessable fetch body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error });
        }
        const item = (payload.results ?? []).find((r) => r.url === request.url);
        if (item !== undefined) {
            const content = item.text ?? item.content ?? '';
            const statusCode = item.status ?? 200;
            return { url: request.url, statusCode, body: { kind: 'text', content }, truncated: false };
        }
        const err = (payload.errors ?? []).find((e) => e.url === request.url);
        if (err !== undefined) {
            throw new WebError(`TinyFish fetch failed for ${request.url}: ${err.error ?? 'unknown error'}${err.status ? ` (HTTP ${err.status})` : ''}`, 'WEB_PROVIDER_ERROR');
        }
        throw new WebError(`TinyFish fetch returned no result for ${request.url}`, 'WEB_PROVIDER_ERROR');
    }
    async apiKey(signal) {
        if (signal?.aborted)
            throw new WebError('TinyFish fetch aborted', 'WEB_ABORTED');
        const resolved = await this.options.resolveApiKey();
        if (resolved !== undefined && resolved.length > 0)
            return resolved;
        throw new WebError(`TinyFish fetch has no API key for "${this.options.apiKeyEnv}"; store it through the credentials service `
            + '(the web settings page writes it), export it in the launching environment, or set a literal "apiKey" in the '
            + 'web-search-tinyfish config', 'WEB_PROVIDER_CREDENTIAL_MISSING');
    }
    async throwOnError(response, kind, signal) {
        const status = response.status;
        let message = `TinyFish ${kind} error (HTTP ${status})`;
        try {
            const parsed = (await response.json());
            const detail = parsed.error ?? parsed.message ?? parsed.detail;
            if (detail !== undefined && detail.length > 0)
                message = detail;
        }
        catch (error) {
            if (signal?.aborted)
                throw new WebError(`${kind} aborted`, 'WEB_ABORTED', { cause: error });
        }
        if (status === 401) {
            throw new WebError(`TinyFish API key rejected (HTTP 401): ${message}`, 'WEB_PROVIDER_CREDENTIAL_MISSING');
        }
        if (status === 429) {
            const retry = response.headers.get('retry-after');
            throw new WebError(`TinyFish rate limit exceeded (HTTP 429)${retry ? `; retry after ${retry}s` : ''}`, 'WEB_PROVIDER_ERROR');
        }
        throw new WebError(message, 'WEB_PROVIDER_ERROR');
    }
}
//# sourceMappingURL=provider.js.map