/**
 * Wire types shared by the router service and the apiproxy `router.*` domain.
 * Pure — no Node, no Cordis — so this module is browser-safe.
 * @module @ibrahimsaleem/dsh-llm-free-model-router/types
 */

import type { PoolPolicy } from './config.ts'

export type { PoolPolicy } from './config.ts'

/** Health of one candidate route×model×key. */
export type CandidateState = 'available' | 'cooling' | 'disabled'

/** One candidate's live health, as shown in the settings panel. */
export interface CandidateHealth {
  /** Stable key `<platformId>#<keyIndex>/<modelId>`. */
  key: string
  /** Catalog platform id. */
  platformId: string
  /** `llm-pi-ai` route id. */
  routeId: string
  /** Wire model id. */
  modelId: string
  /** 1-based key index. */
  keyIndex: number
  /** Coding rank (lower preferred). */
  codingRank: number
  /** Current health state. */
  state: CandidateState
  /** Epoch ms the candidate resumes, when cooling. */
  coolingUntil?: number
  /** Why the candidate is disabled, when disabled. */
  disabledReason?: string
  /** Requests in the trailing 60s. */
  requestsLastMinute: number
  /** Requests since the last daily reset. */
  requestsToday: number
  /** Declared per-minute request ceiling, when known. */
  rpm?: number
  /** Declared per-day request ceiling, when known. */
  rpd?: number
  /** Last failure code seen on this candidate. */
  lastFailureCode?: string
}

/** State of one platform card in the settings panel. */
export interface PlatformState {
  /** Catalog platform id. */
  id: string
  /** Human-facing name. */
  displayName: string
  /** Whether the user enabled it. */
  enabled: boolean
  /** Keys configured. */
  keys: number
  /** Maximum keys this platform accepts. */
  maxKeys: number
  /** Rate limits are per-org, not per-key. */
  orgLevelLimits: boolean
  /** No API key required. */
  authless: boolean
  /** Credential refs and whether each is currently set. */
  credentials: { ref: string; configured: boolean }[]
  /** Base-URL override in effect (Ollama local). */
  endpoint?: string
}

/** Full router state for the settings panel. */
export interface RouterStateView {
  /** Master switch. */
  enabled: boolean
  /** Selection policy. */
  poolPolicy: PoolPolicy
  /** Local Ollama fallback toggle. */
  keepLocalFallback: boolean
  /** Every shipped platform with its activation state. */
  platforms: PlatformState[]
  /** Every live candidate's health, best rank first. */
  candidates: CandidateHealth[]
  /** The candidate the router would pick right now, or null when the pool is empty. */
  currentPick: { key: string; routeId: string; modelId: string } | null
}

/** Durable ledger fields that survive a harness restart. */
export interface LedgerEntrySnapshot {
  state: CandidateState
  coolingUntil?: number
  dayCount: number
  dayResetAt: number
  disabledReason?: string
}

/** On-disk ledger document. */
export interface LedgerDocument {
  version: 1
  updatedAt: number
  entries: Record<string, LedgerEntrySnapshot>
}

/** Reason one `router/switch` session event was written. */
export type RouterSwitchReason = 'proactive' | 'rate-limit' | 'quota' | 'auth' | 'server' | 'wait' | 'local-fallback'

/** Result of `router.activatePlatform` / `router.testKey`. */
export interface RouterMutationResult {
  ok: boolean
  /** Human-readable detail on failure (e.g. a shadowed credential ref). */
  message?: string
  /** Model ids discovered by `testKey`. */
  models?: string[]
}
