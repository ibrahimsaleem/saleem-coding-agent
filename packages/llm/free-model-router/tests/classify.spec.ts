import { describe, expect, it, vi } from 'vitest'
import type { LlmFailure } from '@deepseek-ai/dsh-llm'
import { classifyRateLimit, nextDailyReset } from '../src/classify.ts'

function failure(message: string, code = 'RATE_LIMIT', extra: Partial<LlmFailure> = {}): LlmFailure {
  return { message, code, ...extra }
}

describe('classifyRateLimit', () => {
  it('flags a Google RESOURCE_EXHAUSTED daily quota as daily', () => {
    const cls = classifyRateLimit(failure(
      '429 RESOURCE_EXHAUSTED: Quota exceeded for quota metric GenerateRequestsPerDay',
    ))
    expect(cls.kind).toBe('daily')
  })

  it('flags a per-minute RESOURCE_EXHAUSTED as per-minute', () => {
    const cls = classifyRateLimit(failure(
      '429 RESOURCE_EXHAUSTED: Quota exceeded, limit: 10 requests per minute',
    ))
    expect(cls.kind).toBe('per-minute')
  })

  it('reads Google retryDelay from the flattened body', () => {
    const now = 1_000_000
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const cls = classifyRateLimit(failure('429 rate limit; "retryDelay": "30s"'))
    expect(cls.recoverAt).toBe(now + 30_000)
    vi.restoreAllMocks()
  })

  it('reads an OpenRouter X-RateLimit-Reset epoch', () => {
    const cls = classifyRateLimit(failure('429; x-ratelimit-reset: 1756512600000'))
    expect(cls.recoverAt).toBe(1_756_512_600_000)
  })

  it('reads a plain Retry-After seconds header', () => {
    const now = 5_000
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const cls = classifyRateLimit(failure('Too Many Requests. retry-after: 12'))
    expect(cls.recoverAt).toBe(now + 12_000)
    vi.restoreAllMocks()
  })

  it('prefers providerRetryAfterMs when the adapter parsed it', () => {
    const now = 100
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const cls = classifyRateLimit(failure('429', 'RATE_LIMIT', { providerRetryAfterMs: 4000 }))
    expect(cls.recoverAt).toBe(now + 4000)
    vi.restoreAllMocks()
  })

  it('treats a QUOTA credit-exhaustion message as daily', () => {
    const cls = classifyRateLimit(failure('You have run out of credits. Add funds to continue.', 'QUOTA'))
    expect(cls.kind).toBe('daily')
  })

  it('falls back to per-minute for a bare RATE_LIMIT with no hints', () => {
    expect(classifyRateLimit(failure('429 Too Many Requests')).kind).toBe('per-minute')
  })
})

describe('nextDailyReset', () => {
  it('returns the next UTC midnight for utc / unknown zones', () => {
    const noon = Date.UTC(2026, 8, 1, 12, 0, 0)
    expect(nextDailyReset('utc', noon)).toBe(Date.UTC(2026, 8, 2, 0, 0, 0))
    expect(nextDailyReset('unknown', noon)).toBe(Date.UTC(2026, 8, 2, 0, 0, 0))
  })

  it('returns ~08:00 UTC (midnight Pacific) for the google zone', () => {
    const earlyUtc = Date.UTC(2026, 8, 1, 3, 0, 0)
    expect(nextDailyReset('america/los_angeles', earlyUtc)).toBe(Date.UTC(2026, 8, 1, 8, 0, 0))
    const lateUtc = Date.UTC(2026, 8, 1, 20, 0, 0)
    expect(nextDailyReset('america/los_angeles', lateUtc)).toBe(Date.UTC(2026, 8, 2, 8, 0, 0))
  })
})
