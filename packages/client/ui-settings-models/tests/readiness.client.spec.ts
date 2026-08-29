/** Pure first-run readiness projection over the shared Models join. */
import { describe, expect, it } from 'vitest'
import type { CredentialView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelsSettingsState, ProviderRow } from '../src/client/store.ts'
import { onboardingReadiness, providerUsable } from '../src/client/store.ts'

const missingCredential: CredentialView = { configured: false, writable: true }

function row(overrides: Partial<ProviderRow> = {}): ProviderRow {
  return {
    entry: {
      provider: 'deepseek-official',
      displayName: 'DeepSeek',
      settingsNs: 'llm-deepseek',
      settingsPath: [],
      active: true,
    },
    configured: true,
    removable: false,
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    credential: missingCredential,
    ...overrides,
  }
}

/** A second provider the user configured themselves. */
function otherRow(overrides: Partial<ProviderRow> = {}): ProviderRow {
  return {
    entry: {
      provider: 'hfai',
      displayName: 'HFAI',
      settingsNs: 'llm-pi-ai',
      settingsPath: ['providers', 'hfai'],
      active: true,
    },
    configured: true,
    removable: true,
    apiKeyEnv: 'HFAI_API_KEY',
    credential: { configured: true, source: 'file', writable: true },
    ...overrides,
  }
}

function state(overrides: Partial<ModelsSettingsState> = {}): ModelsSettingsState {
  return {
    status: 'ready',
    error: null,
    credentialError: null,
    writable: true,
    rows: [row()],
    namespaces: new Map(),
    ...overrides,
  }
}

describe('providerUsable', () => {
  it('requires a registered route and a stored key for every named reference', () => {
    expect(providerUsable(otherRow())).toBe(true)
    expect(providerUsable(otherRow({ entry: { ...otherRow().entry, active: false } }))).toBe(false)
    expect(providerUsable(otherRow({ credential: missingCredential }))).toBe(false)
    expect(providerUsable(otherRow({ credential: undefined }))).toBe(false)
  })

  it('treats a reference-free registered route as provider-native authentication', () => {
    expect(providerUsable(otherRow({ apiKeyEnv: undefined, credential: undefined }))).toBe(true)
  })
})

describe('onboardingReadiness', () => {
  it('waits for the first join and skips onboarding when the adapter directory entry is absent', () => {
    expect(onboardingReadiness(state({ status: 'idle', rows: [] }))).toEqual({ kind: 'loading' })
    expect(onboardingReadiness(state({ status: 'loading', rows: [] }))).toEqual({ kind: 'loading' })
    expect(onboardingReadiness(state({ rows: [] }))).toEqual({ kind: 'adapter-absent' })
    expect(onboardingReadiness(state({
      rows: [row({
        entry: {
          ...row().entry,
          settingsNs: '',
        },
      })],
    }))).toEqual({ kind: 'adapter-absent' })
  })

  it('reports a missing writable effective credential', () => {
    expect(onboardingReadiness(state())).toEqual({ kind: 'credential-missing', rows: [row()] })
  })

  it('ends onboarding once any other registered provider can serve requests', () => {
    expect(onboardingReadiness(state({ rows: [row(), otherRow()] }))).toEqual({ kind: 'provider-ready' })
    // A provider the user cannot reach yet leaves the prompt in place, and
    // joins the row still needing a key as a second offerable candidate.
    expect(onboardingReadiness(state({
      rows: [row(), otherRow({ credential: missingCredential })],
    }))).toEqual({
      kind: 'credential-missing',
      rows: [row(), otherRow({ credential: missingCredential })],
    })
  })

  it('excludes only a row confirmed credential-locked, keeping the rest offerable', () => {
    // The default row is locked; hfai still needs a key but can take one.
    expect(onboardingReadiness(state({
      rows: [row({ credential: { configured: false, writable: false } }), otherRow({ credential: missingCredential })],
    }))).toEqual({
      kind: 'credential-missing',
      rows: [otherRow({ credential: missingCredential })],
    })
    // A route that has never had a key saved names no reference for the store
    // to describe, so its credential reads as undefined — routine, not a
    // reason to withhold it: the row stays offerable alongside its sibling.
    expect(onboardingReadiness(state({
      rows: [row({ credential: undefined }), otherRow({ credential: missingCredential })],
    }))).toEqual({
      kind: 'credential-missing',
      rows: [row({ credential: undefined }), otherRow({ credential: missingCredential })],
    })
    // Inactive is not a reason to withhold a row either: for the pi-ai family
    // it is the ordinary state of a catalog route (openai, anthropic, gemini,
    // …) before its first save, which is exactly the row onboarding exists to
    // offer — so it is included right alongside an already-live sibling.
    expect(onboardingReadiness(state({
      rows: [row(), otherRow({ entry: { ...otherRow().entry, active: false }, credential: undefined })],
    }))).toEqual({
      kind: 'credential-missing',
      rows: [row(), otherRow({ entry: { ...otherRow().entry, active: false }, credential: undefined })],
    })
    // Every candidate excluded (locked here) with none surviving: the step
    // reports unavailable instead of a prompt with nothing to offer.
    expect(onboardingReadiness(state({
      rows: [
        row({ credential: { configured: false, writable: false } }),
        otherRow({ credential: { configured: false, writable: false } }),
      ],
    }))).toEqual({ kind: 'unavailable', reason: 'no-provider-available' })
  })

  it('accepts file and process-environment credentials without prompting', () => {
    expect(onboardingReadiness(state({
      rows: [row({ credential: { configured: true, source: 'file', writable: true } })],
    }))).toEqual({ kind: 'provider-ready' })
    expect(onboardingReadiness(state({
      rows: [row({ credential: { configured: true, source: 'env', writable: false } })],
    }))).toEqual({ kind: 'provider-ready' })
  })

  it('turns missing capabilities into diagnostics that never block the product', () => {
    expect(onboardingReadiness(state({ status: 'error', error: 'settings down' }))).toEqual({
      kind: 'unavailable',
      reason: 'load-failed',
    })
    // A confirmed-locked credential is the sole per-row exclusion reason,
    // folded into this catch-all once no candidate row survives — mixed with
    // a surviving sibling in the previous test.
    expect(onboardingReadiness(state({
      rows: [row({ credential: { configured: false, writable: false } })],
    }))).toEqual({ kind: 'unavailable', reason: 'no-provider-available' })
    expect(onboardingReadiness(state({
      credentialError: 'credentials service is absent',
    }))).toEqual({
      kind: 'unavailable',
      reason: 'credentials-unavailable',
    })
    expect(onboardingReadiness(state({ writable: false }))).toEqual({
      kind: 'unavailable',
      reason: 'settings-read-only',
    })
  })
})
