/**
 * Small helpers that read the durable session log for the router's listeners.
 * @module @ibrahimsaleem/dsh-llm-free-model-router/session-read
 */

import type { Agent } from '@deepseek-ai/dsh-agent'

function lastNumber(agent: Agent, type: string, field: string): number {
  const events = agent.session.events
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (event?.type !== type) continue
    const value = (event.data as Record<string, unknown>)[field]
    return typeof value === 'number' ? value : 0
  }
  return 0
}

/** Current open turn number (0 when none has started). */
export function currentTurn(agent: Agent): number {
  return lastNumber(agent, 'turn/start', 'turn')
}

/** Current open step number (0 when none has started). */
export function currentStep(agent: Agent): number {
  return lastNumber(agent, 'step/start', 'step')
}

/** The `{ provider, model }` of the most recent `request/context` event, if any. */
export function lastRequestContext(agent: Agent): { provider: string; model: string } | undefined {
  const events = agent.session.events
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (event?.type !== 'request/context') continue
    const data = event.data as { provider?: unknown; model?: unknown }
    if (typeof data.provider === 'string' && typeof data.model === 'string') {
      return { provider: data.provider, model: data.model }
    }
  }
  return undefined
}

/** How many `router/switch` events this turn+step already has (crash-safe switch budget). */
export function countRouterSwitches(agent: Agent, turn: number, step: number): number {
  let count = 0
  for (const event of agent.session.events) {
    if (event.type !== 'router/switch') continue
    const data = event.data as { turn?: unknown; step?: unknown }
    if (data.turn === turn && data.step === step) count += 1
  }
  return count
}
