import { describe, expect, it } from 'vitest'
import type { Config } from '../src/config.ts'
import { Ledger } from '../src/ledger.ts'
import { buildPool, selectCandidate } from '../src/pool.ts'

function config(overrides: Partial<Config> = {}): Config {
  return {
    enabled: true,
    poolPolicy: 'balanced',
    keepLocalFallback: true,
    platforms: {
      google: { enabled: true, keys: 1 },
      openrouter: { enabled: true, keys: 2 },
      'ollama-local': { enabled: true, keys: 0 },
    },
    overrides: {},
    ...overrides,
  }
}

/** Routes the profile-writer would produce for the config above. */
const REGISTERED = new Set(['free-google', 'free-openrouter', 'free-openrouter-2', 'free-ollama-local'])

describe('buildPool', () => {
  it('produces one candidate per route×model and honours registered routes', () => {
    const pool = buildPool(config(), REGISTERED)
    expect(pool.some(c => c.routeId === 'free-google' && c.modelId === 'gemini-3-flash')).toBe(true)
    expect(pool.some(c => c.routeId === 'free-openrouter-2')).toBe(true)
    // A route pi-ai has not registered contributes nothing.
    expect(buildPool(config(), new Set(['free-google'])).every(c => c.routeId === 'free-google')).toBe(true)
  })

  it('drops a candidate disabled by an override', () => {
    const pool = buildPool(config({ overrides: { 'google/gemini-3-flash': { disabled: true } } }), REGISTERED)
    expect(pool.some(c => c.modelId === 'gemini-3-flash')).toBe(false)
  })
})

describe('selectCandidate', () => {
  const pool = buildPool(config(), REGISTERED)
  const reset = Date.now() + 86_400_000

  it('picks the best coding rank among healthy candidates', () => {
    const ledger = new Ledger()
    for (const c of pool) ledger.ensure(c.key, reset)
    const pick = selectCandidate({ pool, ledger, poolPolicy: 'balanced' })
    expect(pick?.modelId).toBe('gemini-3-flash')
  })

  it('skips a cooling candidate', () => {
    const ledger = new Ledger()
    for (const c of pool) ledger.ensure(c.key, reset)
    const top = pool.find(c => c.modelId === 'gemini-3-flash')!
    ledger.cool(top.key, Date.now() + 60_000)
    const pick = selectCandidate({ pool, ledger, poolPolicy: 'balanced' })
    expect(pick?.key).not.toBe(top.key)
  })

  it('max-stability drops reasoning models', () => {
    const ledger = new Ledger()
    for (const c of pool) ledger.ensure(c.key, reset)
    const pick = selectCandidate({ pool, ledger, poolPolicy: 'max-stability' })
    expect(pick?.descriptor.reasoning).toBe(false)
  })

  it('prefers the already-resolved candidate when it is still a healthy shortlist choice', () => {
    const ledger = new Ledger()
    for (const c of pool) ledger.ensure(c.key, reset)
    const glm = pool.find(c => c.modelId === 'z-ai/glm-4.7:free' && c.routeId === 'free-openrouter')!
    const pick = selectCandidate({
      pool, ledger, poolPolicy: 'balanced',
      prefer: { routeId: glm.routeId, modelId: glm.modelId },
    })
    expect(pick?.key).toBe(glm.key)
  })

  it('returns undefined when every candidate is cooling', () => {
    const ledger = new Ledger()
    for (const c of pool) { ledger.ensure(c.key, reset); ledger.cool(c.key, Date.now() + 60_000) }
    expect(selectCandidate({ pool, ledger, poolPolicy: 'balanced' })).toBeUndefined()
  })
})
