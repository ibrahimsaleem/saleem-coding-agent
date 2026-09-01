/**
 * The router's `agent/request-error` waterfall listener. It classifies a
 * failed free-tier request, cools or disables the candidate, and either asks
 * the loop to retry (the `agent/request` listener then routes to the next
 * healthy candidate) or delegates to `llm-retry` / a terminal failure.
 *
 * Router routes declare `retryPolicy.retryableCodes` without `RATE_LIMIT`, so
 * `llm-retry` already delegates those here regardless of listener order.
 * @module @ibrahimsaleem/dsh-llm-free-model-router/failover
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, RequestErrorAction } from '@deepseek-ai/dsh-agent'
import type { LlmFailure } from '@deepseek-ai/dsh-llm'
import { classifyRateLimit } from './classify.ts'
import type { FreeModelRouterService } from './service.ts'
import type { Candidate } from './pool.ts'
import { countRouterSwitches, lastRequestContext } from './session-read.ts'
import type { RouterCandidateDisabledEventData, RouterSwitchEventData } from './events.ts'
import type { RouterSwitchReason } from './types.ts'

/** Short cooldown for a transient server-side failure `llm-retry` already exhausted. */
const SERVER_COOLDOWN_MS = 30_000
/** Default cooldown for a per-minute rate limit with no stated reset. */
const MINUTE_COOLDOWN_MS = 60_000
/** How long the router will block waiting for the soonest cooldown before giving up on the wait path. */
const MAX_BOUNDED_WAIT_MS = 45_000
/** Extra switches allowed beyond one per pool candidate before a step fails terminally. */
const BUDGET_SLACK = 2

const AUTH_CODES = new Set(['AUTH', 'INVALID_CREDENTIAL', 'MISSING_CREDENTIAL'])
const SERVER_CODES = new Set(['SERVER', 'TIMEOUT', 'TRANSPORT', 'EMPTY_RESPONSE'])

/** Register the failover listener; returns its disposer. */
export function installFailover(ctx: Context, service: FreeModelRouterService): () => void {
  const dispose = ctx.on('agent/request-error', async (
    { agent, turn, step, provider, failure, signal },
    next,
  ): Promise<RequestErrorAction> => {
    if (signal.aborted) return next()
    const model = lastRequestContext(agent)?.model
    if (model === undefined) return next()
    const candidate = service.candidateFor(provider, model)
    if (candidate === undefined) return next()

    // Crash-safe, step-scoped switch budget reconstructed from the durable log.
    if (countRouterSwitches(agent, turn, step) >= service.candidates().length + BUDGET_SLACK) return next()

    service.health.noteFailure(candidate.key, failure.code)

    if (AUTH_CODES.has(failure.code)) {
      service.disable(candidate, failure.code)
      appendDisabled(agent, turn, step, candidate, failure.code, failure)
      return delegateOrRetry(candidate)
    }

    if (failure.code === 'RATE_LIMIT' || failure.code === 'QUOTA') {
      const cls = failure.code === 'QUOTA'
        ? { kind: 'daily' as const, recoverAt: undefined }
        : classifyRateLimit(failure)
      const until = cls.kind === 'daily'
        ? cls.recoverAt ?? service.dailyResetFor(candidate)
        : cls.recoverAt ?? Date.now() + MINUTE_COOLDOWN_MS
      service.cool(candidate, until, failure.code)
      return switchOrWaitOrFallback(agent, turn, step, candidate, failure, signal, next)
    }

    if (SERVER_CODES.has(failure.code)) {
      service.cool(candidate, Date.now() + SERVER_COOLDOWN_MS, failure.code)
      return delegateOrRetry(candidate)
    }

    // CONTEXT_WINDOW_EXCEEDED (compaction owns it), INVALID_REQUEST, PI_AI_ERROR, UNKNOWN: leave terminal.
    return next()

    /** Retry when another healthy candidate exists; otherwise let the failure fall through. */
    function delegateOrRetry(failed: Candidate): RequestErrorAction | Promise<RequestErrorAction> {
      return service.pickExcluding(new Set([failed.key])) === undefined ? next() : { kind: 'retry' }
    }
  })

  return dispose

  /** Retry → bounded wait for the soonest reset → local Ollama → delegate. */
  async function switchOrWaitOrFallback(
    agent: Agent,
    turn: number,
    step: number,
    failed: Candidate,
    failure: LlmFailure,
    signal: AbortSignal,
    next: () => Promise<RequestErrorAction>,
  ): Promise<RequestErrorAction> {
    if (service.pickExcluding(new Set([failed.key])) !== undefined) return { kind: 'retry' }

    const soonest = service.soonestRecovery()
    if (soonest !== undefined && soonest - Date.now() <= MAX_BOUNDED_WAIT_MS && !signal.aborted) {
      appendSwitch(agent, turn, step, failed, failed, 'wait', failure.code)
      if (!await cancellableDelay(Math.max(0, soonest - Date.now()), signal)) return
      return { kind: 'retry' }
    }

    if (service.config().keepLocalFallback) {
      const local = service.localFallbacks().find(c => c.key !== failed.key)
      if (local !== undefined) {
        appendSwitch(agent, turn, step, failed, local, 'local-fallback', failure.code)
        return { kind: 'retry' }
      }
    }
    return next()
  }

  function appendSwitch(
    agent: Agent, turn: number, step: number, from: Candidate, to: Candidate,
    reason: RouterSwitchReason, failureCode: string | null,
  ): void {
    const event: RouterSwitchEventData = {
      turn, step, reason,
      fromRoute: from.routeId, fromModel: from.modelId,
      toRoute: to.routeId, toModel: to.modelId,
      failureCode,
    }
    try {
      agent.session.append('router/switch', event)
    } catch {
      // Best-effort observability.
    }
  }

  function appendDisabled(
    agent: Agent, turn: number, step: number, candidate: Candidate, reason: string, failure: LlmFailure | null,
  ): void {
    const event: RouterCandidateDisabledEventData = {
      turn, step, key: candidate.key, routeId: candidate.routeId, reason, failure,
    }
    try {
      agent.session.append('router/candidate-disabled', event)
    } catch {
      // Best-effort observability.
    }
  }
}

/** Resolve `true` when the delay elapsed, `false` when the signal aborted first. */
function cancellableDelay(delayMs: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, delayMs)
    timer.unref?.()
    function onAbort(): void {
      clearTimeout(timer)
      resolve(false)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
