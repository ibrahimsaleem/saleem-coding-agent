import { describe, expect, it } from 'vitest'
import { Ledger } from '../src/ledger.ts'

function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = start
  return { now: () => t, advance: (ms) => { t += ms } }
}

describe('Ledger', () => {
  it('cools a candidate and lazily restores it after the cooldown', () => {
    const c = clock()
    const ledger = new Ledger(c.now)
    ledger.ensure('k', c.now() + 86_400_000)
    ledger.cool('k', c.now() + 60_000, 'RATE_LIMIT')
    expect(ledger.isAvailable('k', c.now() + 86_400_000)).toBe(false)
    c.advance(61_000)
    expect(ledger.isAvailable('k', c.now() + 86_400_000)).toBe(true)
    expect(ledger.view('k').lastFailureCode).toBe('RATE_LIMIT')
  })

  it('rolls the daily count over at dayResetAt', () => {
    const c = clock()
    const ledger = new Ledger(c.now)
    const reset = c.now() + 1000
    ledger.ensure('k', reset)
    ledger.noteRequestStart('k', reset)
    ledger.noteRequestStart('k', reset)
    expect(ledger.requestsToday('k')).toBe(2)
    c.advance(2000)
    ledger.noteRequestStart('k', c.now() + 86_400_000)
    expect(ledger.requestsToday('k')).toBe(1)
  })

  it('prunes the per-minute window and reports nearLimit', () => {
    const c = clock()
    const ledger = new Ledger(c.now)
    ledger.ensure('k', c.now() + 86_400_000)
    for (let i = 0; i < 8; i += 1) ledger.noteRequestStart('k', c.now() + 86_400_000)
    expect(ledger.nearLimit('k', 10)).toBe(true) // 8 >= 10 * 0.8
    c.advance(61_000)
    expect(ledger.requestsLastMinute('k')).toBe(0)
    expect(ledger.nearLimit('k', 10)).toBe(false)
  })

  it('disable is sticky until enable', () => {
    const c = clock()
    const ledger = new Ledger(c.now)
    ledger.ensure('k', c.now() + 86_400_000)
    ledger.disable('k', 'AUTH')
    ledger.cool('k', c.now() + 10) // no-op on a disabled entry
    expect(ledger.isAvailable('k', c.now() + 86_400_000)).toBe(false)
    ledger.enable('k')
    expect(ledger.isAvailable('k', c.now() + 86_400_000)).toBe(true)
  })

  it('round-trips durable state through a snapshot', () => {
    const c = clock()
    const a = new Ledger(c.now)
    a.ensure('k', c.now() + 5000)
    a.noteRequestStart('k', c.now() + 5000)
    a.cool('k', c.now() + 3_600_000, 'QUOTA')

    const b = new Ledger(c.now)
    b.hydrate(a.snapshot())
    expect(b.isAvailable('k', c.now() + 5000)).toBe(false)
    expect(b.requestsToday('k')).toBe(1)
    c.advance(3_600_001)
    expect(b.isAvailable('k', c.now() + 86_400_000)).toBe(true)
  })

  it('soonestRecovery returns the earliest cooling deadline', () => {
    const c = clock()
    const ledger = new Ledger(c.now)
    ledger.ensure('a', c.now() + 86_400_000)
    ledger.ensure('b', c.now() + 86_400_000)
    ledger.cool('a', c.now() + 5000)
    ledger.cool('b', c.now() + 2000)
    expect(ledger.soonestRecovery(['a', 'b'])).toBe(c.now() + 2000)
  })
})
