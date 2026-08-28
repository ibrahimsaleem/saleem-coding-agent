/**
 * `@ibrahimsaleem/dsh-web-search-brave`: registers a Brave-Search-backed
 * `WebSearchProvider` with `ctx.web`. A function/namespace plugin (NOT a
 * default-export service): a search provider does not own the `ctx.web` key —
 * it registers INTO the seam's provider registry, exactly as
 * `@deepseek-ai/dsh-web-search-exa` does for Exa.
 *
 * Brave's free tier (2,000 queries/month, no payment method required) is why
 * this is Saleem Harness's default search provider instead of a paid one.
 *
 * @module @ibrahimsaleem/dsh-web-search-brave
 */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import {
  BraveSearchProvider,
  BRAVE_DEFAULT_BASE_URL,
  BRAVE_DEFAULT_COUNT,
} from './provider.ts'

export {
  BRAVE_DEFAULT_BASE_URL,
  BRAVE_DEFAULT_COUNT,
  BRAVE_PROVIDER_ID,
  BraveSearchProvider,
} from './provider.ts'
export type { BraveSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-brave'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Brave Search API key (the "Subscription Token"). Falls back to `$BRAVE_SEARCH_API_KEY`. Empty → provider unavailable. */
  apiKey?: string
  /** Endpoint base, used verbatim as the request URL. Defaults to the public API. */
  baseURL?: string
  /** Default result count when a request carries no `maxResults`. Defaults to 10; Brave's free tier caps at 20. */
  count?: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string(),
  baseURL: z.string(),
  count: z.number().step(1).min(1),
})

/** Register the Brave search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider(new BraveSearchProvider({
    // Every environment layer may name this key: the product trusts the
    // project it is launched in, and the managed store is not involved here.
    apiKey: config.apiKey ?? launchEnvironmentOf(ctx).get('BRAVE_SEARCH_API_KEY')?.value ?? '',
    baseURL: config.baseURL ?? BRAVE_DEFAULT_BASE_URL,
    count: config.count ?? BRAVE_DEFAULT_COUNT,
  }))
}
