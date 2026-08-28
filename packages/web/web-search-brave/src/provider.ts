/**
 * `BraveSearchProvider`: a `WebSearchProvider` backed by the Brave Search API
 * (`GET /res/v1/web/search`). It maps `web.results[]` entries to the seam's
 * normalized shape: `description` → `snippet`, `page_age` → `publishedAt`
 * when present. Brave's free tier (2,000 queries/month) needs no payment
 * method, which is why this is the default provider.
 * @module @ibrahimsaleem/dsh-web-search-brave/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { BraveError, BraveResult, BraveSearchResponse } from './types.ts'

/** Stable id this provider registers under. */
export const BRAVE_PROVIDER_ID = 'brave'

/** Default Brave Search endpoint. */
export const BRAVE_DEFAULT_BASE_URL = 'https://api.search.brave.com/res/v1/web/search'

/** Default result count when a request carries no `maxResults`. Brave's free tier caps at 20. */
export const BRAVE_DEFAULT_COUNT = 10

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'saleem-harness/0.0.1'

/** Resolved provider options (the plugin's `apply` supplies env-var and constant defaults). */
export interface BraveSearchProviderOptions {
  /** Brave Search API key (the "Subscription Token"). Empty/absent makes the provider unavailable. */
  apiKey: string
  /** Endpoint base; used verbatim as the request URL. */
  baseURL: string
  /** Default result count when a request carries no `maxResults`. */
  count: number
}

/**
 * Map one Brave result to a normalized source. A result with no description
 * still maps (unlike Exa, Brave nearly always returns one), using an empty
 * snippet only if genuinely absent.
 * @param result - one entry of Brave's `web.results[]`.
 * @returns the normalized source.
 */
export function mapBraveResult(result: BraveResult): WebSearchSource {
  return {
    url: result.url,
    ...result.title != null && result.title.length > 0 ? { title: result.title } : {},
    snippet: result.description ?? '',
    ...result.page_age != null && result.page_age.length > 0 ? { publishedAt: result.page_age } : {},
  }
}

/**
 * Map a Brave response envelope to a normalized search result.
 * @param response - the parsed `GET /res/v1/web/search` response body.
 * @returns the normalized result.
 */
export function mapBraveResponse(response: BraveSearchResponse): WebSearchResult {
  const sources = (response.web?.results ?? []).map(mapBraveResult)
  // Brave's base Web Search API returns no generated answer (that needs the
  // separate Summarizer feature), so `content` is omitted. The web service
  // owns the final `maxResults` truncation, so this provider reports
  // `truncated: false`.
  return { sources, truncated: false }
}

/** The Brave-backed search provider. */
export class BraveSearchProvider implements WebSearchProvider {
  readonly id = BRAVE_PROVIDER_ID

  constructor(private readonly options: BraveSearchProviderOptions) {}

  available(): boolean {
    return this.options.apiKey.length > 0
      && isValidBaseUrl(this.options.baseURL)
      && isPositiveInteger(this.options.count)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    // A per-request bound wins over the configured default.
    const count = request.maxResults ?? this.options.count
    const url = new URL(this.options.baseURL)
    url.searchParams.set('q', request.query)
    url.searchParams.set('count', String(count))

    let response: Response
    try {
      response = await fetch(url, {
        method: 'GET',
        redirect: 'error',
        headers: {
          'x-subscription-token': this.options.apiKey,
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('Brave search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Brave search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `Brave API error (HTTP ${status})`
      try {
        const parsed = await response.json() as BraveError
        const detail = parsed.error?.detail ?? parsed.error?.code
        if (detail !== undefined && detail.length > 0) message = detail
      } catch (error: unknown) {
        // An abort fired mid-body must surface as WEB_ABORTED, not be swallowed
        // into a generic HTTP-error message — cancellation is not a provider
        // error (the seam's cancellation contract).
        if (isAbortError(error)) throw new WebError('Brave search aborted', 'WEB_ABORTED', { cause: error })
        // Otherwise: the HTTP status is already captured in `message` above; a
        // malformed/non-JSON error body can only cost a richer provider
        // message, never the real error.
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      const payload = await response.json() as BraveSearchResponse
      return mapBraveResponse(payload)
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('Brave search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Brave returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
}

/** True when `baseURL` parses as an absolute URL (a cheap local config check). */
function isValidBaseUrl(baseURL: string): boolean {
  return URL.canParse(baseURL)
}

/** True for a request limit that can be sent to Brave (a positive whole number). */
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
