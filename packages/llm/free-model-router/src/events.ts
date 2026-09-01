/**
 * Durable session events the free-model router writes when it moves a request
 * to a different free candidate or takes one out of rotation.
 * @module @ibrahimsaleem/dsh-llm-free-model-router/events
 */

import type { LlmFailure } from '@deepseek-ai/dsh-llm'
import type { RouterSwitchReason } from './types.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Durable, non-surface record of the free-model router moving one request to a different candidate. */
    'router/switch': RouterSwitchEventData
    /** Durable, non-surface record of the free-model router taking one candidate out of rotation. */
    'router/candidate-disabled': RouterCandidateDisabledEventData
  }
}

/** Payload recorded when the router routes a request to a different free candidate. */
export interface RouterSwitchEventData {
  /** Open turn number. */
  turn: number
  /** Step within the turn whose request moved. */
  step: number
  /** Why the switch happened. */
  reason: RouterSwitchReason
  /** Route left behind. */
  fromRoute: string
  /** Model left behind. */
  fromModel: string
  /** Route selected. */
  toRoute: string
  /** Model selected. */
  toModel: string
  /** Failure code that forced the switch, when reactive. */
  failureCode: string | null
}

/** Payload recorded when the router disables a candidate (bad key, spent quota during a long block). */
export interface RouterCandidateDisabledEventData {
  /** Open turn number. */
  turn: number
  /** Step within the turn. */
  step: number
  /** Candidate key `<platformId>#<keyIndex>/<modelId>`. */
  key: string
  /** Route id of the disabled candidate. */
  routeId: string
  /** Reason (a failure code or `config`). */
  reason: string
  /** The originating failure, when there was one. */
  failure: LlmFailure | null
}
