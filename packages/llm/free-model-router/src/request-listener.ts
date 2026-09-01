/**
 * The router's own `agent/request` waterfall listener. It runs outermost (it
 * is registered at boot, before the per-agent model-selection listener), so it
 * sees the picker's resolved choice through `next()` and either keeps it or
 * substitutes the best healthy free candidate.
 * @module @ibrahimsaleem/dsh-llm-free-model-router/request-listener
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, ModelSelection } from '@deepseek-ai/dsh-agent'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type { FreeModelRouterService } from './service.ts'
import { isRouterRoute } from './catalog/profile-writer.ts'
import { currentStep, currentTurn } from './session-read.ts'
import type { RouterSwitchEventData } from './events.ts'

const AGENT_DEFAULT_REPOINT_DEBOUNCE_MS = 30_000

/** Register the proactive-selection listener; returns its disposer. */
export function installRequestListener(ctx: Context, service: FreeModelRouterService): () => void {
  /** Agents whose user touched the picker this session — the router stands down for them. */
  const manualOverride = new WeakMap<Agent, ModelSelection>()
  let lastRepointAt = 0

  const disposeStatus = ctx.on('agent/status', ({ agent, status }) => {
    if (status === 'idle') manualOverride.delete(agent)
  })

  const disposeRequest = ctx.on('agent/request', async ({ agent }, next): Promise<LlmCallConfig> => {
    const resolved = await next()
    const cfg = service.config()
    if (!cfg.enabled) return resolved

    const inPool = service.candidateFor(resolved.provider, resolved.model)
    if (inPool === undefined && !isRouterRoute(resolved.provider)) return resolved

    const defaultSelection = ctx.get('agentDefaultModel')?.currentSelection()
    if (
      inPool !== undefined
      && defaultSelection !== undefined
      && (resolved.provider !== defaultSelection.provider || resolved.model !== defaultSelection.model)
    ) {
      manualOverride.set(agent, { provider: resolved.provider, model: resolved.model })
    }

    const manual = manualOverride.get(agent)
    if (manual !== undefined) {
      const manualCandidate = service.candidateFor(manual.provider, manual.model)
      if (manualCandidate !== undefined && service.isHealthy(manualCandidate)) {
        service.noteRequestStart(manualCandidate)
        return { ...resolved, provider: manual.provider, model: manual.model }
      }
      // The manual pick is cooling — route around it this step.
    }

    const best = service.pickForRequest(
      inPool === undefined ? undefined : { routeId: resolved.provider, modelId: resolved.model },
    )
    if (best === undefined) {
      if (inPool !== undefined) service.noteRequestStart(inPool)
      return resolved
    }

    if (Date.now() - lastRepointAt >= AGENT_DEFAULT_REPOINT_DEBOUNCE_MS && maybeRepointDefault(ctx, service, best.routeId, best.modelId)) {
      lastRepointAt = Date.now()
    }

    if (best.routeId === resolved.provider && best.modelId === resolved.model) {
      service.noteRequestStart(best)
      return resolved
    }

    const event: RouterSwitchEventData = {
      turn: currentTurn(agent),
      step: currentStep(agent),
      reason: 'proactive',
      fromRoute: resolved.provider,
      fromModel: resolved.model,
      toRoute: best.routeId,
      toModel: best.modelId,
      failureCode: null,
    }
    try {
      agent.session.append('router/switch', event)
    } catch {
      // Best-effort observability; a rejected append never blocks the request.
    }
    service.noteRequestStart(best)
    const { reasoningEffort: _dropped, ...withoutEffort } = resolved
    return { ...withoutEffort, provider: best.routeId, model: best.modelId }
  })

  return () => {
    disposeStatus()
    disposeRequest()
  }
}

/** Point `agent-default-model` at the router's top pick when the stored default has gone unhealthy. */
function maybeRepointDefault(ctx: Context, service: FreeModelRouterService, routeId: string, modelId: string): boolean {
  const defaults = ctx.get('agentDefaultModel')
  if (defaults === undefined) return false
  const current = defaults.currentSelection()
  const currentCandidate = service.candidateFor(current.provider, current.model)
  if (currentCandidate === undefined || service.isHealthy(currentCandidate)) return false
  void defaults.saveSelection({ provider: routeId, model: modelId })
  return true
}
