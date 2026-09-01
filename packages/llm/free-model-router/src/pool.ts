/**
 * Candidate pool: the cartesian product of enabled platforms, their keys, and
 * their catalog models — restricted to routes `llm-pi-ai` has actually
 * registered — plus the selection over it.
 * @module @ibrahimsaleem/dsh-llm-free-model-router/pool
 */

import type { CandidateOverride, Config, PoolPolicy } from './config.ts'
import type { FreeModelDescriptor, FreePlatform } from './catalog/types.ts'
import { FREE_PLATFORMS, LOCAL_FALLBACK_PLATFORM_ID } from './catalog/platforms.ts'
import { routeIdFor } from './catalog/profile-writer.ts'
import { nextDailyReset } from './classify.ts'
import type { Ledger } from './ledger.ts'

/** Minimum context window for a candidate to serve an agentic coding request. */
export const MIN_CONTEXT_WINDOW = 32_768

/** One route×model×key the router can send a request to. */
export interface Candidate {
  /** Stable key `<platformId>#<keyIndex>/<modelId>`. */
  key: string
  platformId: string
  routeId: string
  modelId: string
  keyIndex: number
  platform: FreePlatform
  descriptor: FreeModelDescriptor
  /** `descriptor.codingRank` after any user override. */
  codingRank: number
  /** `descriptor.rpm` after any user override. */
  rpm: number | undefined
  /** `descriptor.rpd` after any user override. */
  rpd: number | undefined
}

/** Candidate key for a platform / key index / model. */
export function candidateKey(platformId: string, keyIndex: number, modelId: string): string {
  return `${platformId}#${keyIndex}/${modelId}`
}

/**
 * Build the candidate pool from settings, restricted to routes present in
 * `registeredRoutes` (what `llm-pi-ai` actually registered).
 */
export function buildPool(config: Config, registeredRoutes: ReadonlySet<string>): Candidate[] {
  const pool: Candidate[] = []
  for (const platform of FREE_PLATFORMS) {
    const settings = config.platforms[platform.id]
    if (settings?.enabled !== true) continue
    const authKeys = platform.authless || platform.orgLevelLimits ? 1 : Math.max(1, settings.keys)
    for (let keyIndex = 1; keyIndex <= authKeys; keyIndex += 1) {
      const routeId = routeIdFor(platform.id, keyIndex)
      if (!registeredRoutes.has(routeId)) continue
      for (const descriptor of platform.models) {
        const override: CandidateOverride | undefined = config.overrides[`${platform.id}/${descriptor.id}`]
        if (override?.disabled === true) continue
        pool.push({
          key: candidateKey(platform.id, keyIndex, descriptor.id),
          platformId: platform.id,
          routeId,
          modelId: descriptor.id,
          keyIndex,
          platform,
          descriptor,
          codingRank: override?.codingRank ?? descriptor.codingRank,
          rpm: override?.rpm ?? descriptor.rpm,
          rpd: override?.rpd ?? descriptor.rpd,
        })
      }
    }
  }
  return pool
}

/** The local-Ollama candidates in a pool, best rank first. */
export function localFallbackCandidates(pool: readonly Candidate[]): Candidate[] {
  return pool
    .filter(c => c.platformId === LOCAL_FALLBACK_PLATFORM_ID)
    .sort((a, b) => a.codingRank - b.codingRank)
}

interface SelectionInput {
  pool: readonly Candidate[]
  ledger: Ledger
  poolPolicy: PoolPolicy
  /** Prefer this candidate when it is still a healthy choice (avoids needless KV-cache churn). */
  prefer?: { routeId: string; modelId: string }
  /** Exclude these candidate keys (already tried this step). */
  exclude?: ReadonlySet<string>
  /** Allow candidates below {@link MIN_CONTEXT_WINDOW} (the local-fallback path). */
  allowSmallContext?: boolean
  now?: () => number
}

/**
 * Choose the best healthy candidate, or `undefined` when none can serve.
 * `max-stability` drops reasoning models; every policy skips cooling/disabled
 * and near-limit candidates (unless a near-limit one is the only option).
 */
export function selectCandidate(input: SelectionInput): Candidate | undefined {
  const now = input.now ?? Date.now
  const eligible = input.pool.filter((c) => {
    if (input.exclude?.has(c.key)) return false
    if (!c.descriptor.toolCapable) return false
    if (!input.allowSmallContext && c.descriptor.contextWindow < MIN_CONTEXT_WINDOW) return false
    if (input.poolPolicy === 'max-stability' && c.descriptor.reasoning) return false
    return input.ledger.isAvailable(c.key, nextDailyReset(c.platform.dailyResetZone, now()))
  })
  if (eligible.length === 0) return undefined

  const ranked = [...eligible].sort((a, b) => a.codingRank - b.codingRank)
  const notNear = ranked.filter(c => !input.ledger.nearLimit(c.key, c.rpm, c.rpd))
  const shortlist = notNear.length > 0 ? notNear : ranked

  const prefer = input.prefer
  if (prefer !== undefined) {
    const kept = shortlist.find(c => c.routeId === prefer.routeId && c.modelId === prefer.modelId)
    if (kept !== undefined) return kept
  }
  return shortlist[0]
}
