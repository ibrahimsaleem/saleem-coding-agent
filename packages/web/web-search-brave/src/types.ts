/**
 * Wire types for the Brave Search API
 * (`GET https://api.search.brave.com/res/v1/web/search`). Types only — no
 * runtime code. Brave returns a nested `web.results[]`; each entry carries a
 * URL, title, a `description` snippet, and an optional `page_age` timestamp.
 *
 * @module @ibrahimsaleem/dsh-web-search-brave/types
 */

/** One entry of Brave's `web.results[]`. */
export interface BraveResult {
  url: string
  title?: string
  description?: string
  /** ISO-ish timestamp when present; absent for most results. */
  page_age?: string
}

/** Brave's search response envelope (only the `web` results block is consumed). */
export interface BraveSearchResponse {
  web?: {
    results?: BraveResult[]
  }
}

/** Brave's error response envelope (best-effort; fields vary by failure). */
export interface BraveError {
  error?: {
    detail?: string
    code?: string
  }
}
