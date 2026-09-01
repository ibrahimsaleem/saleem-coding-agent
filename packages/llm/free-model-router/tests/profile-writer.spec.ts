import { describe, expect, it } from 'vitest'
import { findPlatform } from '../src/catalog/platforms.ts'
import { credentialRefFor, platformToPiAiProfiles, routeIdFor, routeIdsFor } from '../src/catalog/profile-writer.ts'

describe('profile-writer', () => {
  it('namespaces route ids and indexes extra keys', () => {
    expect(routeIdFor('openrouter', 1)).toBe('free-openrouter')
    expect(routeIdFor('openrouter', 2)).toBe('free-openrouter-2')
  })

  it('derives indexed credential refs and skips them for authless platforms', () => {
    const openrouter = findPlatform('openrouter')!
    expect(credentialRefFor(openrouter, 1)).toBe('OPENROUTER_API_KEY')
    expect(credentialRefFor(openrouter, 2)).toBe('OPENROUTER_API_KEY_2')
    expect(credentialRefFor(findPlatform('ollama-local')!, 1)).toBeUndefined()
  })

  it('builds one hand-declared OpenAI-compatible route per key', () => {
    const profiles = platformToPiAiProfiles(findPlatform('openrouter')!, 2)
    expect(Object.keys(profiles).sort()).toEqual(['free-openrouter', 'free-openrouter-2'])
    const route = profiles['free-openrouter']!
    expect(route.api).toBe('openai-completions')
    expect(route.baseURL).toBe('https://openrouter.ai/api/v1')
    expect(route.apiKeyEnv).toBe('OPENROUTER_API_KEY')
    expect(route.retryPolicy).toMatchObject({ mode: 'normal', retryableCodes: ['SERVER', 'TIMEOUT', 'TRANSPORT', 'EMPTY_RESPONSE'] })
    expect(route.models?.every(m => m.reasoningEfforts === false)).toBe(true)
  })

  it('collapses org-level and authless platforms to a single route', () => {
    expect(routeIdsFor(findPlatform('groq')!, 3)).toEqual(['free-groq'])
    expect(routeIdsFor(findPlatform('ollama-local')!, 3)).toEqual(['free-ollama-local'])
    const ollama = platformToPiAiProfiles(findPlatform('ollama-local')!, 1, 'http://127.0.0.1:11434/v1')
    expect(ollama['free-ollama-local']!.baseURL).toBe('http://127.0.0.1:11434/v1')
    expect(ollama['free-ollama-local']!.apiKeyEnv).toBeUndefined()
  })
})
