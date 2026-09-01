/**
 * Turn a shipped {@link FreePlatform} plus a key count into the
 * `llm-pi-ai.providers` route profiles the router owns. Every route is
 * hand-declared with an explicit OpenAI-compatible endpoint so it never
 * collides with a pi-ai builtin route or a route the user configured through
 * the Models page.
 * @module @ibrahimsaleem/dsh-llm-free-model-router/catalog/profile-writer
 */

import type { PiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import type { FreePlatform } from './types.ts'

/** Route id prefix that marks a profile as router-owned. */
export const ROUTE_PREFIX = 'free-'

/** Codes the router handles itself; the route's own retry policy stays off them. */
const ROUTE_RETRYABLE_CODES = ['SERVER', 'TIMEOUT', 'TRANSPORT', 'EMPTY_RESPONSE'] as const

/** Route id for one platform + 1-based key index. */
export function routeIdFor(platformId: string, keyIndex: number): string {
  return keyIndex <= 1 ? `${ROUTE_PREFIX}${platformId}` : `${ROUTE_PREFIX}${platformId}-${keyIndex}`
}

/** Whether a route id belongs to this router. */
export function isRouterRoute(routeId: string): boolean {
  return routeId.startsWith(ROUTE_PREFIX)
}

/** Credential reference for one platform + 1-based key index. */
export function credentialRefFor(platform: FreePlatform, keyIndex: number): string | undefined {
  if (platform.authless || platform.apiKeyRefBase === undefined) return undefined
  return keyIndex <= 1 ? platform.apiKeyRefBase : `${platform.apiKeyRefBase}_${keyIndex}`
}

/**
 * Build every `llm-pi-ai.providers` route for one activated platform.
 * @param platform - shipped catalog platform.
 * @param keyCount - number of keys the user supplied (≥1; authless platforms use 1).
 * @param endpoint - optional base-URL override (Ollama local).
 * @returns route id → profile map to merge into `llm-pi-ai.providers`.
 */
export function platformToPiAiProfiles(
  platform: FreePlatform,
  keyCount: number,
  endpoint?: string,
): Record<string, PiAiProviderProfile> {
  const routes: Record<string, PiAiProviderProfile> = {}
  const effectiveKeys = platform.orgLevelLimits || platform.authless ? 1 : Math.max(1, keyCount)
  for (let keyIndex = 1; keyIndex <= effectiveKeys; keyIndex += 1) {
    const routeId = routeIdFor(platform.id, keyIndex)
    const ref = credentialRefFor(platform, keyIndex)
    routes[routeId] = {
      displayName: effectiveKeys > 1
        ? `${platform.displayName} · key ${keyIndex}`
        : platform.displayName,
      api: platform.api,
      baseURL: endpoint ?? platform.baseURL,
      ...ref === undefined ? {} : { apiKeyEnv: ref },
      models: platform.models.map(model => ({
        id: model.id,
        ...model.displayName === undefined ? {} : { name: model.displayName },
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        ...model.reasoning ? {} : { reasoningEfforts: false as const },
      })),
      retryPolicy: {
        mode: 'normal',
        maxRetries: 2,
        retryableCodes: [...ROUTE_RETRYABLE_CODES],
      },
    }
  }
  return routes
}

/** Every route id a platform would generate for a given key count. */
export function routeIdsFor(platform: FreePlatform, keyCount: number): string[] {
  const effectiveKeys = platform.orgLevelLimits || platform.authless ? 1 : Math.max(1, keyCount)
  const ids: string[] = []
  for (let keyIndex = 1; keyIndex <= effectiveKeys; keyIndex += 1) ids.push(routeIdFor(platform.id, keyIndex))
  return ids
}
