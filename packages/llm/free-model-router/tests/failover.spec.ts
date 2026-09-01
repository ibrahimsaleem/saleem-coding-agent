import { describe, expect, it, vi } from 'vitest'
import type { LlmFailure } from '@deepseek-ai/dsh-llm'
import { handleRequestError } from '../src/failover.ts'
import type { Candidate } from '../src/pool.ts'
import type { Config } from '../src/config.ts'
import type { FreeModelRouterService } from '../src/service.ts'

const SIGNAL = new AbortController().signal

function candidate(over: Partial<Candidate> = {}): Candidate {
  return {
    key: 'google#1/gemini-3-flash',
    platformId: 'google',
    routeId: 'free-google',
    modelId: 'gemini-3-flash',
    keyIndex: 1,
    platform: { id: 'google', dailyResetZone: 'america/los_angeles' } as Candidate['platform'],
    descriptor: { id: 'gemini-3-flash', contextWindow: 1_000_000, maxTokens: 65_536, codingRank: 10, toolCapable: true, reasoning: true },
    codingRank: 10,
    rpm: 10,
    rpd: 1500,
    ...over,
  }
}

/** Minimal fake session that records appended events. */
function fakeAgent(contextModel = 'gemini-3-flash', prior: { type: string; data: unknown }[] = []) {
  const events = [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'step/start', data: { turn: 1, step: 1 } },
    { type: 'request/context', data: { provider: 'free-google', model: contextModel } },
    ...prior,
  ]
  return {
    agent: {
      session: {
        get events() { return events },
        append: (type: string, data: unknown) => { events.push({ type, data }); return { type, data } },
      },
    },
    events,
  }
}

interface FakeServiceOptions {
  alternative?: Candidate | undefined
  local?: Candidate[]
  soonest?: number | undefined
  keepLocalFallback?: boolean
}

function fakeService(opts: FakeServiceOptions = {}) {
  const calls = { cool: [] as unknown[][], disable: [] as unknown[][], noteFailure: [] as string[] }
  const svc = {
    candidates: () => [candidate()],
    candidateFor: (route: string, model: string) =>
      route === 'free-google' && model === 'gemini-3-flash' ? candidate() : undefined,
    pickExcluding: () => opts.alternative,
    localFallbacks: () => opts.local ?? [],
    config: (): Config => ({ enabled: true, poolPolicy: 'balanced', keepLocalFallback: opts.keepLocalFallback ?? true, platforms: {}, overrides: {} }),
    dailyResetFor: () => Date.now() + 86_400_000,
    soonestRecovery: () => opts.soonest,
    cool: (...args: unknown[]) => { calls.cool.push(args) },
    disable: (...args: unknown[]) => { calls.disable.push(args) },
    health: { noteFailure: (_k: string, code: string) => { calls.noteFailure.push(code) } },
  }
  return { svc: svc as unknown as FreeModelRouterService, calls }
}

async function dispatch(
  service: FreeModelRouterService,
  agent: ReturnType<typeof fakeAgent>['agent'],
  failure: LlmFailure,
  next: () => Promise<undefined> = () => Promise.resolve(undefined),
): Promise<{ kind: 'retry' } | undefined> {
  return handleRequestError(
    service,
    { agent, turn: 1, step: 1, provider: 'free-google', failure, retryPolicy: undefined, signal: SIGNAL } as unknown as Parameters<typeof handleRequestError>[1],
    next,
  ) as Promise<{ kind: 'retry' } | undefined>
}

describe('installFailover', () => {
  it('retries when a rate-limited candidate has a healthy alternative', async () => {
    const { svc, calls } = fakeService({ alternative: candidate({ key: 'other', routeId: 'free-openrouter' }) })
    const { agent } = fakeAgent()
    const action = await dispatch(svc, agent, { message: '429 rate limit; per minute', code: 'RATE_LIMIT' })
    expect(action).toEqual({ kind: 'retry' })
    expect(calls.cool).toHaveLength(1)
    expect(calls.noteFailure).toEqual(['RATE_LIMIT'])
  })

  it('long-cools to the daily reset on QUOTA', async () => {
    const { svc, calls } = fakeService({ alternative: candidate({ key: 'other' }) })
    const { agent } = fakeAgent()
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    await dispatch(svc, agent, { message: 'insufficient quota', code: 'QUOTA' })
    expect(calls.cool[0]?.[1]).toBeGreaterThan(1_000_000 + 3_600_000)
    vi.restoreAllMocks()
  })

  it('disables the candidate and writes router/candidate-disabled on AUTH', async () => {
    const { svc, calls } = fakeService({ alternative: candidate({ key: 'other' }) })
    const { agent, events } = fakeAgent()
    const action = await dispatch(svc, agent, { message: '401 invalid key', code: 'AUTH' })
    expect(action).toEqual({ kind: 'retry' })
    expect(calls.disable).toHaveLength(1)
    expect(events.some(e => e.type === 'router/candidate-disabled')).toBe(true)
  })

  it('delegates CONTEXT_WINDOW_EXCEEDED untouched', async () => {
    const { svc, calls } = fakeService({ alternative: candidate({ key: 'other' }) })
    const { agent } = fakeAgent()
    const next = vi.fn(() => Promise.resolve(undefined))
    const action = await dispatch(svc, agent, { message: 'ctx too long', code: 'CONTEXT_WINDOW_EXCEEDED' }, next)
    expect(action).toBeUndefined()
    expect(next).toHaveBeenCalledOnce()
    expect(calls.cool).toHaveLength(0)
    expect(calls.disable).toHaveLength(0)
  })

  it('delegates INVALID_REQUEST without cooling', async () => {
    const { svc, calls } = fakeService({ alternative: candidate({ key: 'other' }) })
    const { agent } = fakeAgent()
    const action = await dispatch(svc, agent, { message: '400 safety block', code: 'INVALID_REQUEST' })
    expect(action).toBeUndefined()
    expect(calls.cool).toHaveLength(0)
  })

  it('falls to local Ollama when every free candidate is exhausted', async () => {
    const local = candidate({ key: 'ollama#1/qwen2.5-coder:7b', platformId: 'ollama-local', routeId: 'free-ollama-local', modelId: 'qwen2.5-coder:7b' })
    const { svc } = fakeService({ alternative: undefined, local: [local], soonest: undefined, keepLocalFallback: true })
    const { agent, events } = fakeAgent()
    const action = await dispatch(svc, agent, { message: '429 per minute', code: 'RATE_LIMIT' })
    expect(action).toEqual({ kind: 'retry' })
    const localSwitch = events.find(e => e.type === 'router/switch') as { data: { reason: string } } | undefined
    expect(localSwitch?.data.reason).toBe('local-fallback')
  })

  it('gives up (delegates) when nothing is available and no local fallback', async () => {
    const { svc } = fakeService({ alternative: undefined, local: [], soonest: undefined, keepLocalFallback: false })
    const { agent } = fakeAgent()
    const next = vi.fn(() => Promise.resolve(undefined))
    const action = await dispatch(svc, agent, { message: '429 per minute', code: 'RATE_LIMIT' }, next)
    expect(action).toBeUndefined()
    expect(next).toHaveBeenCalledOnce()
  })

  it('stops switching once the per-step budget is spent', async () => {
    const priorSwitches = Array.from({ length: 5 }, () => ({ type: 'router/switch', data: { turn: 1, step: 1 } }))
    const { svc, calls } = fakeService({ alternative: candidate({ key: 'other' }) })
    const { agent } = fakeAgent('gemini-3-flash', priorSwitches)
    const next = vi.fn(() => Promise.resolve(undefined))
    const action = await dispatch(svc, agent, { message: '429', code: 'RATE_LIMIT' }, next)
    // pool.length (1) + BUDGET_SLACK (2) = 3; 5 prior switches exceeds it.
    expect(action).toBeUndefined()
    expect(next).toHaveBeenCalledOnce()
    expect(calls.cool).toHaveLength(0)
  })
})
