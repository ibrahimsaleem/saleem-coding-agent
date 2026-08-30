/**
 * Per-session cost estimation. The session log records aggregate token totals
 * per session, not a per-request breakdown, so a session's tokens are split
 * across the models it used weighted by each model's share of requests — a
 * weighted approximation, not exact accounting.
 * @module @deepseek-ai/dsh-host-harness-monitor/cost
 */

import type { MonitorSessionCost, MonitorTokenUsage } from './types.ts'

/** Published rates for one model, USD per 1,000,000 tokens. */
export interface ModelPrice {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/**
 * Per-model rates, keyed by `<provider>/<model>` exactly as a session's
 * `request/context` events spell it. A model with no entry here is reported as
 * unknown cost, never silently priced at zero. `cacheWrite` defaults to the
 * input rate where a source does not publish it. Approximate published Google
 * AND OpenRouter list prices as of early 2026 — re-verify before relying on
 * these for real budgeting.
 */
export const PRICING: Readonly<Record<string, ModelPrice>> = {
  'openrouter/stealth/ox-alpha': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  // Google Gemini 3.x — flash-lite tier
  'google/gemini-3.5-flash-lite': { input: 0.10, output: 0.40, cacheRead: 0.025, cacheWrite: 0.10 },
  'google/gemini-3.1-flash-lite': { input: 0.10, output: 0.40, cacheRead: 0.025, cacheWrite: 0.10 },
  // Google Gemini 3.x / 2.5 — flash tier
  'google/gemini-3.6-flash': { input: 0.30, output: 2.50, cacheRead: 0.075, cacheWrite: 0.30 },
  'google/gemini-3.5-flash': { input: 0.30, output: 2.50, cacheRead: 0.075, cacheWrite: 0.30 },
  'google/gemini-3-flash-preview': { input: 0.30, output: 2.50, cacheRead: 0.075, cacheWrite: 0.30 },
  'google/gemini-2.5-flash': { input: 0.30, output: 2.50, cacheRead: 0.075, cacheWrite: 0.30 },
  // Google — pro tier
  'google/gemini-3.1-pro-preview': { input: 2.00, output: 12.00, cacheRead: 0.20, cacheWrite: 2.00 },
  'google/gemini-2.5-pro': { input: 1.25, output: 10.00, cacheRead: 0.31, cacheWrite: 1.25 },
}

/**
 * Look up a model's rates.
 * @param key - `<provider>/<model>`.
 * @returns the rates, or null when the model is unpriced.
 */
function priceFor(key: string): ModelPrice | null {
  return PRICING[key] ?? null
}

/**
 * Estimate one session's cost.
 * @param tokens - the session's aggregate token totals.
 * @param requestCountsByModel - request count per `<provider>/<model>` for this session.
 * @returns the priced total, the unpriced request share, and the per-model breakdown.
 */
export function estimateSessionCost(
  tokens: MonitorTokenUsage,
  requestCountsByModel: Record<string, number>,
): MonitorSessionCost {
  const entries = Object.entries(requestCountsByModel)
  const totalRequests = entries.reduce((sum, [, count]) => sum + count, 0)
  if (totalRequests === 0) return { knownUsd: 0, unknownShare: 0, byModel: [] }

  let knownUsd = 0
  let unknownRequests = 0
  const byModel = entries.map(([key, count]) => {
    const weight = count / totalRequests
    const slice = {
      input: tokens.input * weight,
      output: tokens.output * weight,
      cacheRead: tokens.cacheRead * weight,
      cacheWrite: tokens.cacheWrite * weight,
    }
    const price = priceFor(key)
    if (price === null) {
      unknownRequests += count
      return { key, requests: count, weight, usd: null }
    }
    const usd = (
      slice.input * price.input
      + slice.output * price.output
      + slice.cacheRead * price.cacheRead
      + slice.cacheWrite * price.cacheWrite
    ) / 1_000_000
    knownUsd += usd
    return { key, requests: count, weight, usd }
  })

  return { knownUsd, unknownShare: unknownRequests / totalRequests, byModel }
}
