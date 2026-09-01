/**
 * Classify a normalized {@link LlmFailure} into a router action hint. pi-ai
 * discards the structured provider error, so this works on the flattened
 * `failure.message` text plus `failure.status` / `failure.providerRetryAfterMs`.
 * @module @ibrahimsaleem/dsh-llm-free-model-router/classify
 */

import type { LlmFailure } from '@deepseek-ai/dsh-llm'
import type { DailyResetZone } from './catalog/types.ts'

/** How a rate-limit / quota failure recovers. */
export interface RateLimitClass {
  /** `daily` = wait for the provider's quota reset; `per-minute` = short cooldown; `unknown` = short cooldown. */
  kind: 'per-minute' | 'daily' | 'unknown'
  /** Epoch ms the candidate can be tried again, when the provider stated it. */
  recoverAt?: number
}

const DAILY_HINT = /\b(per\s?-?\s?day|daily|RPD|requests?\s+per\s+day|free-models-per-day|"?PerDay"?|GenerateRequestsPerDay)\b/i
const MINUTE_HINT = /\b(per\s?-?\s?minute|per-?min|RPM|TPM|requests?\s+per\s+minute|tokens?\s+per\s+minute)\b/i
const QUOTA_WORDS = /\b(quota|insufficient|out of (credits|budget)|billing|free tier)\b/i

/** Parse an integer-seconds or HTTP-date `Retry-After` out of the message. */
function parseRetryAfter(message: string): number | undefined {
  const seconds = /retry[-\s]?after[":\s]+(\d+(?:\.\d+)?)/i.exec(message)
  if (seconds?.[1] !== undefined) return Date.now() + Math.round(Number(seconds[1]) * 1000)
  return undefined
}

/** Google surfaces `"retryDelay": "34s"` in the flattened 429 body. */
function parseGoogleRetryDelay(message: string): number | undefined {
  const match = /retry\s?delay["':\s]+["']?(\d+(?:\.\d+)?)s/i.exec(message)
  if (match?.[1] !== undefined) return Date.now() + Math.round(Number(match[1]) * 1000)
  const inline = /try again in\s+(\d+(?:\.\d+)?)\s*s/i.exec(message)
  if (inline?.[1] !== undefined) return Date.now() + Math.round(Number(inline[1]) * 1000)
  return undefined
}

/** OpenRouter puts an epoch-ms `X-RateLimit-Reset` in the flattened 429 body. */
function parseXRateLimitReset(message: string): number | undefined {
  const match = /x-ratelimit-reset["':\s]+["']?(\d{10,13})/i.exec(message)
  if (match?.[1] === undefined) return undefined
  const value = Number(match[1])
  return value > 1e12 ? value : value * 1000
}

/**
 * Decide whether a `RATE_LIMIT` / `QUOTA` failure is a per-minute blip or a
 * spent daily allowance, and when it will recover.
 */
export function classifyRateLimit(failure: LlmFailure): RateLimitClass {
  const message = failure.message
  const recoverAt = (failure.providerRetryAfterMs !== undefined && failure.providerRetryAfterMs > 0
    ? Date.now() + failure.providerRetryAfterMs
    : undefined)
    ?? parseGoogleRetryDelay(message)
    ?? parseXRateLimitReset(message)
    ?? parseRetryAfter(message)

  let kind: RateLimitClass['kind']
  if (failure.code === 'QUOTA') {
    kind = DAILY_HINT.test(message) || !MINUTE_HINT.test(message) ? 'daily' : 'per-minute'
  } else if (DAILY_HINT.test(message) || (QUOTA_WORDS.test(message) && !MINUTE_HINT.test(message))) {
    kind = 'daily'
  } else if (MINUTE_HINT.test(message) || failure.code === 'RATE_LIMIT') {
    kind = 'per-minute'
  } else {
    kind = 'unknown'
  }
  return recoverAt === undefined ? { kind } : { kind, recoverAt }
}

/** Epoch ms of a platform's next daily quota reset (best-effort by zone). */
export function nextDailyReset(zone: DailyResetZone, now: number = Date.now()): number {
  const date = new Date(now)
  if (zone === 'america/los_angeles') {
    // Midnight Pacific ≈ 08:00 UTC (ignores DST; over/under-cools by ≤1h, self-correcting).
    const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 8, 0, 0, 0))
    if (next.getTime() <= now) next.setUTCDate(next.getUTCDate() + 1)
    return next.getTime()
  }
  // utc + unknown -> next 00:00 UTC
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, 0, 0, 0, 0))
  return next.getTime()
}
