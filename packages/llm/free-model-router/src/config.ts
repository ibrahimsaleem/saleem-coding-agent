/**
 * The `free-model-router` settings section: which free platforms are active,
 * how aggressively to chase model quality, and whether local Ollama is the
 * guaranteed fallback.
 * @module @ibrahimsaleem/dsh-llm-free-model-router/config
 */

import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

/** Settings namespace this router owns. */
export const FREE_MODEL_ROUTER_NAMESPACE = settingsNamespace('free-model-router')

/**
 * Pool policy — the quality/stability trade-off for automatic selection.
 * - `balanced` (default): rank by coding quality, keep reasoning off where it
 *   can be turned off, allow a mid-turn switch only on a hard rate limit.
 * - `max-quality`: always the highest-ranked model including reasoning modes,
 *   switch mid-turn freely.
 * - `max-stability`: non-reasoning models only, switch between turns only.
 */
export type PoolPolicy = 'balanced' | 'max-quality' | 'max-stability'

/** One activated free platform. */
export interface PlatformSettings {
  /** Whether this platform contributes candidates. */
  enabled: boolean
  /** Number of API keys supplied (0 for authless / disabled). */
  keys: number
  /** Base-URL override (Ollama local endpoint). */
  endpoint?: string
}

/** Per-candidate rank / limit override, keyed `<platformId>/<modelId>`. */
export interface CandidateOverride {
  /** Replacement coding rank (lower = preferred). */
  codingRank?: number
  /** Replacement requests-per-minute ceiling. */
  rpm?: number
  /** Replacement requests-per-day ceiling. */
  rpd?: number
  /** Exclude this candidate from the pool entirely. */
  disabled?: boolean
}

/** The `free-model-router` settings section shape. */
export interface Config {
  /** Master switch. When off the router never overrides model selection. */
  enabled: boolean
  /** Quality/stability trade-off for automatic selection. */
  poolPolicy: PoolPolicy
  /** Keep local Ollama as the last-resort candidate when every free tier is exhausted. */
  keepLocalFallback: boolean
  /** Activated platforms, keyed by catalog platform id. */
  platforms: Record<string, PlatformSettings>
  /** Advanced per-candidate overrides. */
  overrides: Record<string, CandidateOverride>
}

const platformSettings: z<PlatformSettings> = z.object({
  enabled: z.boolean().default(false),
  keys: z.natural().default(0),
  endpoint: z.string(),
})

const candidateOverride: z<CandidateOverride> = z.object({
  codingRank: z.number(),
  rpm: z.natural(),
  rpd: z.natural(),
  disabled: z.boolean(),
})

/** Runtime schema for {@link Config}. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  poolPolicy: z.union(['balanced', 'max-quality', 'max-stability']).default('balanced'),
  keepLocalFallback: z.boolean().default(true),
  platforms: z.dict(platformSettings).default({}),
  overrides: z.dict(candidateOverride).default({}),
})
