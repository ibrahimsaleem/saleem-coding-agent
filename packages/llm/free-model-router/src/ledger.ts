/**
 * Per-candidate health and rate-limit ledger. Rolling request/token windows
 * live only in memory; cooldown and daily-quota state are durable so a spent
 * free tier stays remembered across a harness restart.
 * @module @ibrahimsaleem/dsh-llm-free-model-router/ledger
 */

import type { CandidateState, LedgerDocument, LedgerEntrySnapshot } from './types.ts'

const MINUTE_MS = 60_000
/** Fraction of the declared per-minute ceiling that counts as "near". */
const RPM_NEAR = 0.8
/** Fraction of the declared per-day ceiling that counts as "near". */
const RPD_NEAR = 0.95

interface LedgerEntry {
  state: CandidateState
  coolingUntil: number | undefined
  disabledReason: string | undefined
  /** Request start timestamps within the trailing minute. */
  minuteHits: number[]
  /** Requests since `dayResetAt`. */
  dayCount: number
  /** Epoch ms of the next daily reset for this candidate's platform. */
  dayResetAt: number
  /** Token totals within the trailing minute: [timestamp, tokens] pairs. */
  minuteTokens: [number, number][]
  lastFailureCode: string | undefined
}

/** Health ledger for every live candidate. */
export class Ledger {
  private readonly entries = new Map<string, LedgerEntry>()
  private readonly now: () => number
  /** Called after any mutation so the owner can schedule a debounced persist. */
  onMutate: () => void = () => {}

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  /** Load durable state from a persisted document. Unknown keys are kept (a candidate may reappear). */
  hydrate(doc: LedgerDocument): void {
    for (const [key, snapshot] of Object.entries(doc.entries)) {
      this.entries.set(key, {
        state: snapshot.state,
        coolingUntil: snapshot.coolingUntil,
        disabledReason: snapshot.disabledReason,
        minuteHits: [],
        dayCount: snapshot.dayCount,
        dayResetAt: snapshot.dayResetAt,
        minuteTokens: [],
        lastFailureCode: undefined,
      })
    }
  }

  /** Durable fields only. */
  snapshot(): LedgerDocument {
    const entries: Record<string, LedgerEntrySnapshot> = {}
    for (const [key, entry] of this.entries) {
      entries[key] = {
        state: entry.state,
        ...entry.coolingUntil === undefined ? {} : { coolingUntil: entry.coolingUntil },
        dayCount: entry.dayCount,
        dayResetAt: entry.dayResetAt,
        ...entry.disabledReason === undefined ? {} : { disabledReason: entry.disabledReason },
      }
    }
    return { version: 1, updatedAt: this.now(), entries }
  }

  /** Drop entries whose cooldown and daily window are both long past. */
  prune(staleAfterMs = 48 * 60 * 60_000): void {
    const cutoff = this.now() - staleAfterMs
    for (const [key, entry] of this.entries) {
      if (entry.state === 'disabled') continue
      if ((entry.coolingUntil ?? 0) < cutoff && entry.dayResetAt < cutoff) this.entries.delete(key)
    }
    this.onMutate()
  }

  /** Create an entry for a candidate the pool now contains, if absent. */
  ensure(key: string, dayResetAt: number): void {
    if (this.entries.has(key)) return
    this.entries.set(key, {
      state: 'available',
      coolingUntil: undefined,
      disabledReason: undefined,
      minuteHits: [],
      dayCount: 0,
      dayResetAt,
      minuteTokens: [],
      lastFailureCode: undefined,
    })
  }

  /** Every ledgered candidate key. */
  keys(): string[] {
    return [...this.entries.keys()]
  }

  private get(key: string): LedgerEntry {
    const entry = this.entries.get(key)
    if (entry === undefined) throw new Error(`free-model-router: ledger has no entry for "${key}"`)
    return entry
  }

  private rollDay(entry: LedgerEntry, nextResetAt: number): void {
    if (this.now() >= entry.dayResetAt) {
      entry.dayCount = 0
      entry.dayResetAt = nextResetAt
    }
  }

  private pruneWindows(entry: LedgerEntry): void {
    const cutoff = this.now() - MINUTE_MS
    entry.minuteHits = entry.minuteHits.filter(t => t >= cutoff)
    entry.minuteTokens = entry.minuteTokens.filter(([t]) => t >= cutoff)
  }

  /** Record that a request to this candidate is starting now. */
  noteRequestStart(key: string, nextDailyResetAt: number): void {
    const entry = this.get(key)
    this.rollDay(entry, nextDailyResetAt)
    this.pruneWindows(entry)
    entry.minuteHits.push(this.now())
    entry.dayCount += 1
    this.onMutate()
  }

  /** Record a successful completion and its token usage. */
  noteSuccess(key: string, tokens: number): void {
    const entry = this.get(key)
    entry.lastFailureCode = undefined
    if (tokens > 0) entry.minuteTokens.push([this.now(), tokens])
    if (entry.state === 'cooling' && (entry.coolingUntil ?? 0) <= this.now()) entry.state = 'available'
    this.onMutate()
  }

  /** Record a failure code seen on this candidate (no state change). */
  noteFailure(key: string, code: string): void {
    this.get(key).lastFailureCode = code
    this.onMutate()
  }

  /** Cool a candidate until `until` (epoch ms). */
  cool(key: string, until: number, code?: string): void {
    const entry = this.get(key)
    if (entry.state === 'disabled') return
    entry.state = 'cooling'
    entry.coolingUntil = Math.max(entry.coolingUntil ?? 0, until)
    if (code !== undefined) entry.lastFailureCode = code
    this.onMutate()
  }

  /** Take a candidate out of rotation (bad key). Reversible via {@link enable}. */
  disable(key: string, reason: string): void {
    const entry = this.get(key)
    entry.state = 'disabled'
    entry.disabledReason = reason
    entry.coolingUntil = undefined
    this.onMutate()
  }

  /** Return a disabled/cooling candidate to `available` (e.g. after a credential update). */
  enable(key: string): void {
    const entry = this.get(key)
    entry.state = 'available'
    entry.coolingUntil = undefined
    entry.disabledReason = undefined
    this.onMutate()
  }

  /** Whether the candidate can serve a request right now. Lazily expires cooldowns and rolls the day. */
  isAvailable(key: string, nextDailyResetAt: number): boolean {
    const entry = this.entries.get(key)
    if (entry === undefined) return false
    if (entry.state === 'disabled') return false
    this.rollDay(entry, nextDailyResetAt)
    if (entry.state === 'cooling' && (entry.coolingUntil ?? 0) <= this.now()) {
      entry.state = 'available'
      entry.coolingUntil = undefined
      this.onMutate()
    }
    return entry.state === 'available'
  }

  /** Whether the candidate is close to a declared ceiling and should be rotated away from proactively. */
  nearLimit(key: string, rpm?: number, rpd?: number): boolean {
    const entry = this.entries.get(key)
    if (entry === undefined) return false
    this.pruneWindows(entry)
    if (rpm !== undefined && rpm > 0 && entry.minuteHits.length >= rpm * RPM_NEAR) return true
    if (rpd !== undefined && rpd > 0 && entry.dayCount >= rpd * RPD_NEAR) return true
    return false
  }

  /** Requests to this candidate in the trailing minute. */
  requestsLastMinute(key: string): number {
    const entry = this.entries.get(key)
    if (entry === undefined) return 0
    this.pruneWindows(entry)
    return entry.minuteHits.length
  }

  /** Requests to this candidate since the last daily reset. */
  requestsToday(key: string): number {
    return this.entries.get(key)?.dayCount ?? 0
  }

  /** Full state of one candidate for the panel. */
  view(key: string): { state: CandidateState; coolingUntil?: number; disabledReason?: string; lastFailureCode?: string } {
    const entry = this.entries.get(key)
    if (entry === undefined) return { state: 'available' }
    return {
      state: entry.state,
      ...entry.coolingUntil === undefined ? {} : { coolingUntil: entry.coolingUntil },
      ...entry.disabledReason === undefined ? {} : { disabledReason: entry.disabledReason },
      ...entry.lastFailureCode === undefined ? {} : { lastFailureCode: entry.lastFailureCode },
    }
  }

  /** Earliest epoch ms at which some cooling candidate resumes, or undefined when none is cooling. */
  soonestRecovery(keys: string[]): number | undefined {
    let soonest: number | undefined
    for (const key of keys) {
      const entry = this.entries.get(key)
      if (entry?.state !== 'cooling' || entry.coolingUntil === undefined) continue
      soonest = soonest === undefined ? entry.coolingUntil : Math.min(soonest, entry.coolingUntil)
    }
    return soonest
  }
}
