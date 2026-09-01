/**
 * The Free Model Router panel store: one snapshot from `router.state()` plus
 * the mutation calls. Every mutation refetches so the UI reflects the router's
 * rebuilt pool.
 * @module @ibrahimsaleem/dsh-client-ui-free-model-router/client/store
 */

import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { IApiClient, RouterStateView } from '@deepseek-ai/dsh-api-remotes/client'

/** Panel snapshot. */
export interface FreeRouterState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  view: RouterStateView | null
  busy: string | null
}

/** One panel controller per Settings surface. */
export class FreeRouterStore {
  readonly store: SnapshotStore<FreeRouterState> = createSnapshotStore<FreeRouterState>({
    status: 'idle', error: null, view: null, busy: null,
  })

  private generation = 0

  constructor(private readonly api: Pick<IApiClient, 'router'>) {}

  /** Refresh the panel snapshot. */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((s) => { s.status = s.view === null ? 'loading' : s.status; s.error = null })
    try {
      const response = await this.api.router.state({})
      if (generation !== this.generation) return
      if (!response.result.ok) throw new Error(response.result.error.message)
      this.store.update((s) => { s.status = 'ready'; s.view = response.result.ok ? response.result.value : s.view; s.error = null })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((s) => { s.status = 'error'; s.error = error instanceof Error ? error.message : String(error) })
    }
  }

  private async run(label: string, op: () => Promise<{ result: { ok: boolean } }>): Promise<void> {
    this.store.update((s) => { s.busy = label })
    try {
      await op()
      await this.load()
    } finally {
      this.store.update((s) => { s.busy = null })
    }
  }

  setConfig(patch: { enabled?: boolean; poolPolicy?: string; keepLocalFallback?: boolean }): Promise<void> {
    return this.run('config', () => this.api.router.setConfig(patch))
  }

  activatePlatform(platformId: string, keys: string[], endpoint?: string): Promise<void> {
    return this.run(platformId, () => this.api.router.activatePlatform({
      platformId, keys, ...endpoint === undefined ? {} : { endpoint },
    }))
  }

  deactivatePlatform(platformId: string): Promise<void> {
    return this.run(platformId, () => this.api.router.deactivatePlatform({ platformId }))
  }

  async testKey(platformId: string, key: string, endpoint?: string): Promise<{ ok: boolean; message?: string; models?: string[] }> {
    const response = await this.api.router.testKey({
      platformId, key, ...endpoint === undefined ? {} : { endpoint },
    })
    return response.result.ok ? response.result.value : { ok: false, message: response.result.error.message }
  }
}
