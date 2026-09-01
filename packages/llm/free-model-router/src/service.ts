/**
 * `ctx.modelRouter` — owns the free-platform candidate pool, the health/quota
 * ledger, and the activation/state operations the settings panel drives.
 * @module @ibrahimsaleem/dsh-llm-free-model-router/service
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import { Config, FREE_MODEL_ROUTER_NAMESPACE, type PoolPolicy } from './config.ts'
import { FREE_PLATFORMS, findPlatform } from './catalog/platforms.ts'
import { credentialRefFor, platformToPiAiProfiles, routeIdsFor } from './catalog/profile-writer.ts'
import { nextDailyReset } from './classify.ts'
import { Ledger } from './ledger.ts'
import { LedgerStore } from './persistence.ts'
import { buildPool, selectCandidate, type Candidate } from './pool.ts'
import { installRequestListener } from './request-listener.ts'
import { installFailover } from './failover.ts'
import type { CandidateHealth, PlatformState, RouterMutationResult, RouterStateView } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Free-tier model routing and rate-limit/quota failover. */
    modelRouter: FreeModelRouterService
  }
}

const PI_AI_NAMESPACE = settingsNamespace('llm-pi-ai')

/** Router configuration and health service. */
export class FreeModelRouterService extends Service {
  static Config: z<Config> = Config
  static inject = ['llm']

  private source: () => Config
  private readonly ledger: Ledger
  private readonly store: LedgerStore
  private pool: Candidate[] = []

  constructor(ctx: Context, config: Config) {
    super(ctx, 'modelRouter')
    this.source = () => config
    this.ledger = new Ledger()
    this.store = new LedgerStore(resolveDshHome())
    this.ledger.onMutate = () => this.store.schedule(() => this.ledger.snapshot())

    installSettingsSection(ctx, FREE_MODEL_ROUTER_NAMESPACE, Config, config, {
      setSource: (current) => { this.source = current },
      onChange: () => this.rebuildPool(),
    })
    ctx.inject(['llm'], (lctx) => {
      lctx.on('llm/adapters-updated', () => this.rebuildPool())
    })
    ctx.inject(['credentials'], (cctx) => {
      cctx.on('credentials/reference-updated', () => {
        this.rebuildPool()
        for (const candidate of this.pool) {
          const view = this.ledger.view(candidate.key)
          if (view.state === 'disabled' && view.disabledReason?.includes('AUTH') === true) {
            this.ledger.enable(candidate.key)
          }
        }
      })
    })

    const disposeRequest = installRequestListener(ctx, this)
    const disposeFailover = installFailover(ctx, this)
    ctx.effect(() => () => {
      disposeRequest()
      disposeFailover()
    })
  }

  /** Load the persisted ledger and build the initial pool. */
  protected async [Service.init](): Promise<void> {
    this.ledger.hydrate(await this.store.load())
    this.ledger.prune()
    this.rebuildPool()
    this.ctx.effect(() => () => { this.store.cancel() })
  }

  /** Current resolved config. */
  config(): Config {
    return this.source()
  }

  /** The live candidate pool (best rank first). */
  candidates(): readonly Candidate[] {
    return this.pool
  }

  /** The health ledger. */
  get health(): Ledger {
    return this.ledger
  }

  /** Rebuild the pool from settings, restricted to routes `llm-pi-ai` registered. */
  rebuildPool(): void {
    const registered = new Set(this.ctx.get('llm')?.listProviders().map(p => p.id) ?? [])
    this.pool = buildPool(this.source(), registered).sort((a, b) => a.codingRank - b.codingRank)
    for (const candidate of this.pool) {
      this.ledger.ensure(candidate.key, nextDailyReset(candidate.platform.dailyResetZone))
    }
  }

  /** The candidate the router would send the next request to, given the resolved pick. */
  pickForRequest(prefer?: { routeId: string; modelId: string }): Candidate | undefined {
    const cfg = this.source()
    if (!cfg.enabled || this.pool.length === 0) return undefined
    return selectCandidate({
      pool: this.pool,
      ledger: this.ledger,
      poolPolicy: cfg.poolPolicy,
      ...prefer === undefined ? {} : { prefer },
    })
  }

  /** Pick the next healthy candidate excluding some keys (used by failover). */
  pickExcluding(exclude: ReadonlySet<string>, allowSmallContext = false): Candidate | undefined {
    const cfg = this.source()
    return selectCandidate({
      pool: this.pool,
      ledger: this.ledger,
      poolPolicy: cfg.poolPolicy,
      exclude,
      allowSmallContext,
    })
  }

  /** Look up a pooled candidate by route + model. */
  candidateFor(routeId: string, modelId: string): Candidate | undefined {
    return this.pool.find(c => c.routeId === routeId && c.modelId === modelId)
  }

  /** Local-Ollama candidates in the pool, best rank first (empty when the platform is not enabled). */
  localFallbacks(): Candidate[] {
    return this.pool.filter(c => c.platform.id === 'ollama-local').sort((a, b) => a.codingRank - b.codingRank)
  }

  /** Whether this candidate can serve a request right now. */
  isHealthy(candidate: Candidate): boolean {
    return this.ledger.isAvailable(candidate.key, nextDailyReset(candidate.platform.dailyResetZone))
  }

  /** Record that a request to this candidate is starting. */
  noteRequestStart(candidate: Candidate): void {
    this.ledger.noteRequestStart(candidate.key, nextDailyReset(candidate.platform.dailyResetZone))
  }

  /** Cool a candidate; `until` may be a `RATE_LIMIT`/`QUOTA` recover time or a short back-off. */
  cool(candidate: Candidate, until: number, code?: string): void {
    this.ledger.cool(candidate.key, until, code)
  }

  /** Take a candidate out of rotation (bad key). */
  disable(candidate: Candidate, reason: string): void {
    this.ledger.disable(candidate.key, reason)
  }

  /** Next daily-reset epoch ms for this candidate's platform. */
  dailyResetFor(candidate: Candidate): number {
    return nextDailyReset(candidate.platform.dailyResetZone)
  }

  /** Earliest epoch ms at which some cooling pool candidate resumes. */
  soonestRecovery(): number | undefined {
    return this.ledger.soonestRecovery(this.pool.map(c => c.key))
  }

  /** Full state for the settings panel. */
  async state(): Promise<RouterStateView> {
    const cfg = this.source()
    const credentials = this.ctx.get('credentials')
    const platforms: PlatformState[] = await Promise.all(FREE_PLATFORMS.map(async (platform) => {
      const settings = cfg.platforms[platform.id]
      const configuredKeys = platform.authless ? 0 : Math.max(settings?.keys ?? 0, 1)
      const creds: { ref: string; configured: boolean }[] = []
      for (let i = 1; i <= configuredKeys; i += 1) {
        const ref = credentialRefFor(platform, i)
        if (ref === undefined) break
        const info = await credentials?.describe(credentialRef(ref))
        creds.push({ ref, configured: info?.configured ?? false })
      }
      return {
        id: platform.id,
        displayName: platform.displayName,
        enabled: settings?.enabled ?? false,
        keys: settings?.keys ?? 0,
        maxKeys: platform.maxKeys,
        orgLevelLimits: platform.orgLevelLimits ?? false,
        authless: platform.authless ?? false,
        credentials: creds,
        ...settings?.endpoint === undefined ? {} : { endpoint: settings.endpoint },
      }
    }))

    const candidates: CandidateHealth[] = this.pool.map((candidate) => {
      const view = this.ledger.view(candidate.key)
      return {
        key: candidate.key,
        platformId: candidate.platformId,
        routeId: candidate.routeId,
        modelId: candidate.modelId,
        keyIndex: candidate.keyIndex,
        codingRank: candidate.codingRank,
        state: view.state,
        ...view.coolingUntil === undefined ? {} : { coolingUntil: view.coolingUntil },
        ...view.disabledReason === undefined ? {} : { disabledReason: view.disabledReason },
        requestsLastMinute: this.ledger.requestsLastMinute(candidate.key),
        requestsToday: this.ledger.requestsToday(candidate.key),
        ...candidate.rpm === undefined ? {} : { rpm: candidate.rpm },
        ...candidate.rpd === undefined ? {} : { rpd: candidate.rpd },
        ...view.lastFailureCode === undefined ? {} : { lastFailureCode: view.lastFailureCode },
      }
    })

    const pick = this.pickForRequest()
    return {
      enabled: cfg.enabled,
      poolPolicy: cfg.poolPolicy,
      keepLocalFallback: cfg.keepLocalFallback,
      platforms,
      candidates,
      currentPick: pick === undefined ? null : { key: pick.key, routeId: pick.routeId, modelId: pick.modelId },
    }
  }

  /** Activate a platform: store keys, write the `llm-pi-ai` routes, mark it enabled. */
  async activatePlatform(platformId: string, keys: string[], endpoint?: string): Promise<RouterMutationResult> {
    const platform = findPlatform(platformId)
    if (platform === undefined) return { ok: false, message: `unknown platform "${platformId}"` }
    const credentials = this.ctx.get('credentials')
    const settings = this.ctx.get('settings')
    if (settings === undefined) return { ok: false, message: 'settings service is unavailable' }

    const trimmed = keys.map(k => k.trim()).filter(Boolean)
    if (!platform.authless && trimmed.length === 0) return { ok: false, message: 'at least one API key is required' }
    const keyCount = platform.authless ? 1 : Math.min(trimmed.length, platform.maxKeys)

    for (let i = 1; i <= keyCount && !platform.authless; i += 1) {
      const ref = credentialRefFor(platform, i)
      if (ref === undefined || credentials === undefined) continue
      try {
        await credentials.set(credentialRef(ref), trimmed[i - 1] ?? '')
      } catch (error) {
        return { ok: false, message: `could not store ${ref}: ${error instanceof Error ? error.message : String(error)}` }
      }
    }

    const profiles = platformToPiAiProfiles(platform, keyCount, endpoint)
    const piOps: SettingsPathOp[] = Object.entries(profiles).map(([routeId, profile]) => ({
      op: 'set', path: ['providers', routeId], value: profile,
    }))
    await settings.mutate(PI_AI_NAMESPACE, piOps)
    await settings.mutate(FREE_MODEL_ROUTER_NAMESPACE, [{
      op: 'set',
      path: ['platforms', platformId],
      value: {
        enabled: true,
        keys: platform.authless ? 0 : keyCount,
        ...endpoint === undefined ? {} : { endpoint },
      },
    }])
    this.rebuildPool()
    return { ok: true }
  }

  /** Deactivate a platform: remove its routes and optionally its stored keys. */
  async deactivatePlatform(platformId: string, forgetKeys = false): Promise<RouterMutationResult> {
    const platform = findPlatform(platformId)
    if (platform === undefined) return { ok: false, message: `unknown platform "${platformId}"` }
    const settings = this.ctx.get('settings')
    if (settings === undefined) return { ok: false, message: 'settings service is unavailable' }

    const routeIds = routeIdsFor(platform, platform.maxKeys)
    await settings.mutate(PI_AI_NAMESPACE, routeIds.map(id => ({ op: 'unset' as const, path: ['providers', id] })))
    await settings.mutate(FREE_MODEL_ROUTER_NAMESPACE, [{ op: 'unset', path: ['platforms', platformId] }])

    if (forgetKeys && !platform.authless) {
      const credentials = this.ctx.get('credentials')
      for (let i = 1; i <= platform.maxKeys; i += 1) {
        const ref = credentialRefFor(platform, i)
        if (ref !== undefined && credentials !== undefined) await credentials.unset(credentialRef(ref)).catch(() => {})
      }
    }
    this.rebuildPool()
    return { ok: true }
  }

  /** Update the master toggle, pool policy, or local-fallback toggle. */
  async setConfig(patch: { enabled?: boolean; poolPolicy?: PoolPolicy; keepLocalFallback?: boolean }): Promise<RouterMutationResult> {
    const settings = this.ctx.get('settings')
    if (settings === undefined) return { ok: false, message: 'settings service is unavailable' }
    const ops: SettingsPathOp[] = []
    if (patch.enabled !== undefined) ops.push({ op: 'set', path: ['enabled'], value: patch.enabled })
    if (patch.poolPolicy !== undefined) ops.push({ op: 'set', path: ['poolPolicy'], value: patch.poolPolicy })
    if (patch.keepLocalFallback !== undefined) ops.push({ op: 'set', path: ['keepLocalFallback'], value: patch.keepLocalFallback })
    if (ops.length > 0) await settings.mutate(FREE_MODEL_ROUTER_NAMESPACE, ops)
    return { ok: true }
  }

  /** Interrogate a platform endpoint with a candidate key without storing it. */
  async testKey(platformId: string, key: string, endpoint?: string): Promise<RouterMutationResult> {
    const platform = findPlatform(platformId)
    if (platform === undefined) return { ok: false, message: `unknown platform "${platformId}"` }
    const llm = this.ctx.get('llm')
    if (llm === undefined) return { ok: false, message: 'llm service is unavailable' }
    try {
      const models = await llm.discoverModels('llm-pi-ai', {
        baseURL: endpoint ?? platform.baseURL,
        api: platform.api,
        ...platform.authless ? {} : { apiKey: key.trim() },
      })
      return { ok: true, models: models.map(m => m.id) }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Flush the ledger to disk (call before a graceful shutdown). */
  async flush(): Promise<void> {
    await this.store.flush()
  }
}

export default FreeModelRouterService
