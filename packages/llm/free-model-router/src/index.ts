/**
 * `@ibrahimsaleem/dsh-llm-free-model-router` — run the harness fully free.
 *
 * Activate one or more free platforms (Google AI Studio, OpenRouter `:free`,
 * Groq, Cerebras, Ollama Cloud, Ollama local, …). The router then auto-picks a
 * good free coding model per request and, when a candidate hits its per-minute
 * rate limit, spends its daily quota, or rejects its key, transparently routes
 * the next attempt to a different key / model / platform — degrading to local
 * Ollama and only then failing with a clear message.
 *
 * It plugs into two agent-loop waterfalls: `agent/request` (proactive pick,
 * outermost so it observes and can override the model picker) and
 * `agent/request-error` (reactive failover — its routes drop `RATE_LIMIT` from
 * `retryPolicy.retryableCodes` so `llm-retry` delegates rate limits here).
 * The health/quota ledger persists to `~/.dsh/free-model-router/ledger.json`
 * so a spent free tier stays remembered across a restart.
 *
 * @module @ibrahimsaleem/dsh-llm-free-model-router
 */

import { FreeModelRouterService } from './service.ts'
import './events.ts'

export type { PoolPolicy, PlatformSettings, CandidateOverride } from './config.ts'
export { Config, FREE_MODEL_ROUTER_NAMESPACE } from './config.ts'
export { FreeModelRouterService } from './service.ts'
export type * from './types.ts'
export type { RouterSwitchEventData, RouterCandidateDisabledEventData } from './events.ts'
export { FREE_PLATFORMS, findPlatform } from './catalog/platforms.ts'
export type { FreePlatform, FreeModelDescriptor } from './catalog/types.ts'

/** The router mounts as its Service; the constructor installs both agent-loop listeners. */
export default FreeModelRouterService
