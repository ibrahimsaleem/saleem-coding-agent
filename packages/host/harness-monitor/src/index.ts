/**
 * `@deepseek-ai/dsh-host-harness-monitor` — the observability service
 * (`ctx.harnessMonitor`). It runs a poll loop that re-reads `~/.dsh` (session
 * logs, `settings.yaml`, the projection cache) and scans the OS process table,
 * folds it all into a `MonitorSnapshot`, samples a once-a-minute trend line,
 * and owns the in-memory reactive kill switch. The apiproxy `monitor.*` domain
 * is a thin pass-through to the methods here; nothing renders on the host.
 *
 * Read-only over the harness's own data — no session plugin, no writes to
 * anything the harness owns. Its one side effect is `taskkill`, only when the
 * guard fires or a `killNow()` call arrives.
 * @module @deepseek-ai/dsh-host-harness-monitor
 */

import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { dshHomeDisplay, resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { buildSnapshot } from './aggregate.ts'
import type { SessionInput } from './aggregate.ts'
import { readProjCache, readSettingsModels } from './disk-read.ts'
import { HistorySampler } from './history.ts'
import { killAllHarnessProcesses, listHarnessProcesses } from './processes.ts'
import { SessionLogReader } from './session-logs.ts'
import { buildTimeline } from './timeline.ts'
import { sessionsToCsv } from './csv.ts'
import type {
  MonitorGuardState, MonitorKillResult, MonitorSnapshot, MonitorSessionTimeline, MonitorTimelineQuery,
} from './types.ts'

export type * from './types.ts'
export { RULES, AUTOKILL_LABELS, SEVERITY_RANK, scanText } from './security.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The read-only harness observability service. */
    harnessMonitor: HarnessMonitorService
  }
}

/** Number of guard firings kept in memory. */
const MAX_GUARD_EVENTS = 20
/** Timeout for one OS process scan / kill. */
const PROCESS_OP_TIMEOUT_MS = 8_000

/** Plugin config. The poll cadence and trend depth are deployment choices, not policy. */
export interface Config {
  /** Milliseconds between disk/process re-scans. */
  pollIntervalMs: number
  /** Lines of trend history read back for the panel's trend chart. */
  historyRetentionLines: number
  /** Explicit `~/.dsh` override; absent uses `$DSH_HOME` then `~/.dsh`. */
  dshHome?: string
}

export const Config: z<Config> = z.object({
  pollIntervalMs: z.natural().min(500).default(3000),
  historyRetentionLines: z.natural().min(1).default(5000),
  dshHome: z.string(),
})

/**
 * The observability service. Holds the latest snapshot and the guard state in
 * memory; both are recomputed / re-evaluated every `pollIntervalMs`.
 */
export class HarnessMonitorService extends Service {
  static Config: z<Config> = Config

  private readonly home: string
  private readonly homeLabel: string
  private readonly logs: SessionLogReader
  private readonly history: HistorySampler
  private readonly settingsPath: string
  private readonly projCachePath: string

  private snapshot: MonitorSnapshot | null = null
  private readonly guard: MonitorGuardState = { armed: false, armedAt: null, events: [] }
  private ticking = false

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'harnessMonitor')
    this.home = resolveDshHome(config.dshHome)
    this.homeLabel = dshHomeDisplay(this.home)
    this.logs = new SessionLogReader(join(this.home, 'sessions'))
    this.settingsPath = join(this.home, 'settings.yaml')
    this.projCachePath = join(this.home, 'storages', 'session_projcache.json')
    this.history = new HistorySampler(join(this.home, 'monitor', 'history.jsonl'), config.historyRetentionLines)
  }

  /** Prime the first snapshot and start the poll loop. */
  protected async [Service.init](): Promise<void> {
    await this.tick()
    this.ctx.effect(() => {
      const timer = setInterval(() => { void this.tick() }, this.config.pollIntervalMs)
      timer.unref?.()
      return () => { clearInterval(timer) }
    }, 'harnessMonitor.poll')
  }

  /** One poll cycle: re-read everything, rebuild the snapshot, run the guard. */
  private async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      const logFiles = await this.logs.listLogs()
      this.logs.prune(new Set(logFiles.map(f => f.path)))
      const sessions: SessionInput[] = await Promise.all(
        logFiles.map(async f => ({ ...f, events: await this.logs.readEvents(f.path) })),
      )
      const [projCache, settingsModels, processes, history] = await Promise.all([
        readProjCache(this.projCachePath),
        readSettingsModels(this.settingsPath),
        listHarnessProcesses(process.pid, AbortSignal.timeout(PROCESS_OP_TIMEOUT_MS)),
        this.history.read(),
      ])

      const snapshot = buildSnapshot(
        { sessions, projCache, settingsModels, processes, history, homeLabel: this.homeLabel },
        { ...this.guard, events: [...this.guard.events] },
      )
      this.snapshot = snapshot
      await this.history.maybeSample(snapshot.summary)
      await this.checkGuard(snapshot)
    } catch (error) {
      this.ctx.logger.warn(`harness-monitor: poll failed (keeping last snapshot): ${String(error)}`)
    } finally {
      this.ticking = false
    }
  }

  /**
   * When armed, the first auto-kill-flagged finding whose event is newer than
   * the arm moment fires the switch: force-kill every detected harness process
   * (this one included), record the event, and disarm (one-shot). Reactive, not
   * preventive — it can only act after the harness logged the tool call.
   */
  private async checkGuard(snapshot: MonitorSnapshot): Promise<void> {
    if (!this.guard.armed || this.guard.armedAt === null) return
    const armedAt = this.guard.armedAt
    const trigger = snapshot.securityFindings.find(f => f.autoKill && f.time > armedAt)
    if (trigger === undefined) return
    this.guard.armed = false
    const killed = await killAllHarnessProcesses(process.pid, AbortSignal.timeout(PROCESS_OP_TIMEOUT_MS))
    this.recordGuardEvent(`auto-kill: ${trigger.label}`, killed, trigger.snippet)
    this.ctx.logger.warn(`harness-monitor: GUARD FIRED — ${trigger.label}`)
  }

  private recordGuardEvent(reason: string, killed: MonitorKillResult[], snippet?: string): void {
    this.guard.events.unshift({
      time: Date.now(),
      reason,
      ...snippet === undefined ? {} : { snippet },
      killed,
    })
    this.guard.events.length = Math.min(this.guard.events.length, MAX_GUARD_EVENTS)
  }

  // ---- public surface (called by the apiproxy `monitor.*` domain) ----

  /**
   * The latest snapshot. Never null after init.
   * @returns the most recent poll's snapshot with the live guard state merged in.
   */
  getSnapshot(): MonitorSnapshot {
    const base = this.snapshot ?? this.emptySnapshot()
    return { ...base, guard: { ...this.guard, events: [...this.guard.events] } }
  }

  /**
   * One drill-down page for a session.
   * @param query - session id, page size, and optional keyset cursor.
   * @returns the timeline page, or null when no log matches the id.
   */
  async getSessionTimeline(query: MonitorTimelineQuery): Promise<MonitorSessionTimeline | null> {
    const logFiles = await this.logs.listLogs()
    for (const file of logFiles) {
      const events = await this.logs.readEvents(file.path)
      const header = events.find(e => e.type === 'session')
      const id = typeof (header?.data as { id?: unknown } | undefined)?.id === 'string'
        ? (header?.data as { id: string }).id
        : file.dirName
      if (id !== query.sessionId && file.dirName !== query.sessionId) continue
      const cwd = typeof (header?.data as { cwd?: unknown } | undefined)?.cwd === 'string'
        ? (header?.data as { cwd: string }).cwd
        : null
      return buildTimeline(events, id, cwd, query.limit, query.beforeSeq)
    }
    return null
  }

  /**
   * Arm or disarm the reactive kill switch.
   * @param armed - the desired state.
   * @returns the updated guard state.
   */
  setGuardArmed(armed: boolean): MonitorGuardState {
    this.guard.armed = armed
    this.guard.armedAt = armed ? Date.now() : null
    return { ...this.guard, events: [...this.guard.events] }
  }

  /**
   * Immediately force-kill every detected harness process, regardless of arm
   * state. Ends the current session (see the kill-switch design note).
   * @returns one result per targeted pid.
   */
  async killNow(): Promise<MonitorKillResult[]> {
    this.guard.armed = false
    const killed = await killAllHarnessProcesses(process.pid, AbortSignal.timeout(PROCESS_OP_TIMEOUT_MS))
    this.recordGuardEvent('manual stop', killed)
    return killed
  }

  /** The current snapshot as a downloadable object (same shape as {@link getSnapshot}). */
  exportJson(): MonitorSnapshot {
    return this.getSnapshot()
  }

  /** The current sessions table as CSV text. */
  exportCsv(): string {
    return sessionsToCsv(this.getSnapshot().sessions)
  }

  /** A well-formed empty snapshot, used only before the first poll completes. */
  private emptySnapshot(): MonitorSnapshot {
    return {
      generatedAt: Date.now(),
      homeLabel: this.homeLabel,
      summary: {
        sessionCount: 0, runningSessions: 0, processCount: 0, totalTurns: 0, totalPrompts: 0,
        totalToolCalls: 0, totalRetries: 0, totalErrors: 0, modelsConnected: 0,
        securityFindingsCount: 0, riskyPermissionSessions: 0,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        estimatedCostUsd: 0, hasUnknownCost: false,
      },
      models: [], toolCallCounts: {}, sessions: [], processes: [], securityFindings: [],
      permissionEvents: [], activityTimeline: [], history: [],
      guard: { armed: false, armedAt: null, events: [] },
    }
  }
}

export default HarnessMonitorService
