/**
 * router domain contract: the free-model router's live state plus the
 * platform-activation mutations the Settings panel drives. All logic lives in
 * `@ibrahimsaleem/dsh-llm-free-model-router` (`ctx.modelRouter`); this domain
 * is a thin pass-through. Loopback-only in practice (it writes credentials and
 * `llm-pi-ai` provider profiles), like the `settings` and `credentials` domains.
 */

import type { RouterMutationResult, RouterStateView } from '@ibrahimsaleem/dsh-llm-free-model-router/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'

export type {
  CandidateHealth, CandidateState, PlatformState, PoolPolicy, RouterMutationResult,
  RouterStateView, RouterSwitchReason,
} from '@ibrahimsaleem/dsh-llm-free-model-router/types'

/** Free-model router state and activation methods. */
export interface RouterApi {
  /** The router's full live state: config, every shipped platform, every live candidate's health. */
  state(request: RpcRequest<{}>): Promise<RpcResponse<RouterStateView>>

  /**
   * Activate a free platform: store its API key(s), write the `llm-pi-ai`
   * routes, and enable it. `keys` is empty for the authless local Ollama
   * platform; `endpoint` overrides the base URL (Ollama local).
   */
  activatePlatform(
    request: RpcRequest<{ platformId: string; keys: string[]; endpoint?: string }>,
  ): Promise<RpcResponse<RouterMutationResult>>

  /** Deactivate a platform: drop its routes and, when `forgetKeys`, its stored keys. */
  deactivatePlatform(
    request: RpcRequest<{ platformId: string; forgetKeys?: boolean }>,
  ): Promise<RpcResponse<RouterMutationResult>>

  /** Update the master toggle, pool policy, or local-fallback toggle. */
  setConfig(
    request: RpcRequest<{ enabled?: boolean; poolPolicy?: string; keepLocalFallback?: boolean }>,
  ): Promise<RpcResponse<RouterMutationResult>>

  /** Interrogate a platform endpoint with a candidate key without storing it. */
  testKey(
    request: RpcRequest<{ platformId: string; key: string; endpoint?: string }>,
  ): Promise<RpcResponse<RouterMutationResult>>
}
