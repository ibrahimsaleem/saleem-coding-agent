/**
 * Fold raw session-log events plus the projection cache and settings into one
 * `MonitorSnapshot`. Pure over its inputs — the polling loop in `index.ts`
 * supplies fresh reads each tick and merges the guard state.
 * @module @deepseek-ai/dsh-host-harness-monitor/aggregate
 */

import { estimateSessionCost } from './cost.ts'
import type { ProjCacheRow, SettingsModel } from './disk-read.ts'
import { scanText, SEVERITY_RANK } from './security.ts'
import type { RawEvent, SessionLogFile } from './session-logs.ts'
import { timeOf } from './session-logs.ts'
import type {
  MonitorActivity, MonitorActivityBucket, MonitorModel, MonitorPermissionEvent,
  MonitorSecurityFinding, MonitorSession, MonitorSnapshot, MonitorSummary, MonitorTokenUsage,
} from './types.ts'

/** Bounds on what one snapshot puts on the wire. */
const MAX_FINDINGS = 200
const MAX_PERMISSION_EVENTS = 100
const ACTIVITY_BUCKET_MS = 60_000
const ACTIVITY_BUCKETS = 30
const DETAIL_MAX = 120

/** One session's log paired with the events already decoded for it. */
export interface SessionInput extends SessionLogFile {
  events: RawEvent[]
}

/** Everything `buildSnapshot` needs beyond the guard state. */
export interface AggregateInput {
  sessions: SessionInput[]
  projCache: Map<string, ProjCacheRow>
  settingsModels: SettingsModel[]
  history: MonitorSnapshot['history']
  processes: MonitorSnapshot['processes']
  homeLabel: string
}

/** Read a nested property path off an unknown value. */
function at(obj: unknown, ...keys: string[]): unknown {
  let cur = obj
  for (const key of keys) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

/** Concatenated text of a `user/message` content array. */
function messageText(data: unknown): string {
  const content = at(data, 'content')
  if (!Array.isArray(content)) return ''
  return content
    .filter(part => at(part, 'type') === 'text')
    .map(part => String(at(part, 'text') ?? ''))
    .join('\n')
}

/** Describe what a running session is doing, from the tail of its log. */
function describeActivity(events: RawEvent[]): MonitorActivity {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]
    if (ev === undefined) continue
    const time = timeOf(ev) ?? null
    if (ev.type === 'tool/call') {
      let detail = ''
      try {
        const args: unknown = JSON.parse(String(at(ev.data, 'arguments') ?? '{}'))
        detail = String(at(args, 'command') ?? at(args, 'description') ?? '').slice(0, DETAIL_MAX)
      } catch { /* unparseable args */ }
      return { kind: 'tool', label: String(at(ev.data, 'name') ?? 'tool'), detail, time }
    }
    if (ev.type === 'tool/result') return { kind: 'waiting', label: 'processing tool result', detail: '', time }
    if (ev.type === 'text-chunks' || ev.type === 'reasoning-chunks') {
      const texts = at(ev.data, 'texts')
      const joined = Array.isArray(texts) ? texts.join('').slice(0, DETAIL_MAX) : ''
      return {
        kind: ev.type === 'reasoning-chunks' ? 'thinking' : 'writing',
        label: ev.type === 'reasoning-chunks' ? 'reasoning' : 'responding',
        detail: joined,
        time,
      }
    }
    if (ev.type === 'step/start') {
      return { kind: 'step', label: `turn ${String(at(ev.data, 'turn') ?? '?')}, step ${String(at(ev.data, 'step') ?? '?')}`, detail: '', time }
    }
    if (ev.type === 'user/message') return { kind: 'prompt', label: 'received prompt', detail: '', time }
  }
  return { kind: 'idle', label: 'idle', detail: '', time: null }
}

interface SessionFold {
  session: MonitorSession
  findings: MonitorSecurityFinding[]
  permissionEvents: MonitorPermissionEvent[]
  toolCallTimes: number[]
  requestCountsByModel: Record<string, number>
}

/** Fold one session's events. */
function foldSession(input: SessionInput, projCache: Map<string, ProjCacheRow>): SessionFold {
  const header = input.events.find(e => e.type === 'session')
  const id = String(at(header, 'id') ?? input.dirName)
  const cwd = (at(header, 'cwd') as string | undefined) ?? null
  const cached = projCache.get(id)

  let turns = 0
  let steps = 0
  let toolCalls = 0
  let prompts = 0
  let retries = 0
  let errors = 0
  let lastActivity = 0
  let createdAt: number | null = typeof at(header, 'createdAt') === 'number' ? at(header, 'createdAt') as number : null
  const tokens: MonitorTokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  const permissions: MonitorSession['permissions'] = {}
  const findings: MonitorSecurityFinding[] = []
  const permissionEvents: MonitorPermissionEvent[] = []
  const toolCallTimes: number[] = []
  const requestCountsByModel: Record<string, number> = {}

  for (const ev of input.events) {
    const t = timeOf(ev)
    if (typeof t === 'number' && t > lastActivity) lastActivity = t
    if (createdAt === null && typeof t === 'number') createdAt = t

    switch (ev.type) {
      case 'turn/start':
        turns += 1
        break
      case 'step/start':
        steps += 1
        break
      case 'llm/retry':
        retries += 1
        break
      case 'turn/end':
        if (at(ev.data, 'reason', 'kind') === 'error') errors += 1
        break
      case 'user/message': {
        if (at(ev.data, 'source', 'kind') === 'user') {
          prompts += 1
          for (const hit of scanText(messageText(ev.data))) {
            findings.push({ ...hit, sessionId: id, time: t ?? 0, source: 'prompt' })
          }
        }
        break
      }
      case 'tool/call': {
        toolCalls += 1
        if (typeof t === 'number') toolCallTimes.push(t)
        for (const hit of scanText(at(ev.data, 'arguments'))) {
          findings.push({ ...hit, sessionId: id, time: t ?? 0, source: `tool:${String(at(ev.data, 'name') ?? '?')}` })
        }
        break
      }
      case 'request/context': {
        const key = `${String(at(ev.data, 'provider') ?? '?')}/${String(at(ev.data, 'model') ?? '?')}`
        requestCountsByModel[key] = (requestCountsByModel[key] ?? 0) + 1
        break
      }
      case 'assistant/message': {
        const usage = at(ev.data, 'usage')
        if (usage !== undefined) {
          tokens.input += Number(at(usage, 'uncachedInputTokens') ?? at(usage, 'inputTokens') ?? 0) || 0
          tokens.output += Number(at(usage, 'outputTokens') ?? 0) || 0
          tokens.cacheRead += Number(at(usage, 'cacheReadTokens') ?? 0) || 0
          tokens.cacheWrite += Number(at(usage, 'cacheWriteTokens') ?? 0) || 0
        }
        break
      }
      case 'permission/preset':
      case 'sandbox/mode':
      case 'approval/policy': {
        const value = String(
          at(ev.data, 'preset') ?? at(ev.data, 'mode') ?? at(ev.data, 'policy') ?? '?',
        )
        if (ev.type === 'permission/preset') permissions.preset = value
        else if (ev.type === 'sandbox/mode') permissions.sandbox = value
        else permissions.approval = value
        permissionEvents.push({ sessionId: id, time: t ?? 0, type: ev.type, value })
        break
      }
      default:
        break
    }
  }

  // The projection cache is authoritative for token totals and counts when it
  // has this session; the log fold is the fallback for a session it has not
  // checkpointed yet.
  const finalTokens = cached !== undefined && sum(cached.tokens) > 0 ? cached.tokens : tokens
  const finalTurns = cached?.turns ?? turns
  const finalSteps = cached?.steps ?? steps
  const running = cached?.running ?? false
  const title = cached?.title ?? null

  const cost = estimateSessionCost(finalTokens, requestCountsByModel)
  const riskyPermission = permissions.preset === 'danger-full-access' || permissions.approval === 'never'

  return {
    session: {
      id,
      dirName: input.dirName,
      workspace: input.workspace,
      title,
      cwd,
      createdAt,
      lastActivity,
      running,
      activity: running ? describeActivity(input.events) : null,
      turns: finalTurns,
      steps: finalSteps,
      toolCalls,
      prompts,
      retries,
      errors,
      tokenUsage: finalTokens,
      cost,
      permissions,
      riskyPermission,
    },
    findings,
    permissionEvents,
    toolCallTimes,
    requestCountsByModel,
  }
}

/** Sum of a token-usage record. */
function sum(t: MonitorTokenUsage): number {
  return t.input + t.output + t.cacheRead + t.cacheWrite
}

/**
 * Build the whole snapshot.
 * @param input - fresh disk reads plus the process scan and trend history.
 * @param guard - the current in-memory guard state.
 * @returns the wire snapshot (guard included).
 */
export function buildSnapshot(input: AggregateInput, guard: MonitorSnapshot['guard']): MonitorSnapshot {
  const now = Date.now()
  const folds = input.sessions.map(s => foldSession(s, input.projCache))

  const sessions = folds.map(f => f.session).sort((a, b) => b.lastActivity - a.lastActivity)
  const allFindings = folds.flatMap(f => f.findings)
  const permissionEvents = folds.flatMap(f => f.permissionEvents)
    .sort((a, b) => b.time - a.time)
    .slice(0, MAX_PERMISSION_EVENTS)

  const toolCallCounts: Record<string, number> = {}
  const globalRequests: Record<string, number> = {}
  for (const s of input.sessions) {
    for (const ev of s.events) {
      if (ev.type === 'tool/call') {
        const name = String(at(ev.data, 'name') ?? '?')
        toolCallCounts[name] = (toolCallCounts[name] ?? 0) + 1
      }
    }
  }
  for (const f of folds) {
    for (const [key, count] of Object.entries(f.requestCountsByModel)) {
      globalRequests[key] = (globalRequests[key] ?? 0) + count
    }
  }

  const securityFindings = allFindings
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.time - a.time)
    .slice(0, MAX_FINDINGS)

  // Activity sparkline: minute buckets over the last 30 minutes, oldest first.
  const buckets: MonitorActivityBucket[] = []
  for (let i = 0; i < ACTIVITY_BUCKETS; i++) {
    buckets.push({ t: now - (ACTIVITY_BUCKETS - 1 - i) * ACTIVITY_BUCKET_MS, count: 0 })
  }
  for (const f of folds) {
    for (const time of f.toolCallTimes) {
      const idx = ACTIVITY_BUCKETS - 1 - Math.floor((now - time) / ACTIVITY_BUCKET_MS)
      if (idx >= 0 && idx < ACTIVITY_BUCKETS) {
        const bucket = buckets[idx]
        if (bucket !== undefined) bucket.count += 1
      }
    }
  }

  const models: MonitorModel[] = input.settingsModels.map(m => ({
    route: m.route,
    id: m.id,
    apiKeyEnv: m.apiKeyEnv,
    hasKey: m.apiKeyEnv === null ? null : (process.env[m.apiKeyEnv] ?? '').length > 0,
    requests: globalRequests[`${m.route}/${m.id}`] ?? 0,
  }))

  const tokens = sessions.reduce<MonitorTokenUsage>((acc, s) => ({
    input: acc.input + s.tokenUsage.input,
    output: acc.output + s.tokenUsage.output,
    cacheRead: acc.cacheRead + s.tokenUsage.cacheRead,
    cacheWrite: acc.cacheWrite + s.tokenUsage.cacheWrite,
  }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

  const estimatedCostUsd = sessions.reduce((acc, s) => acc + s.cost.knownUsd, 0)
  const hasUnknownCost = sessions.some(s => s.cost.unknownShare > 0)

  const summary: MonitorSummary = {
    sessionCount: sessions.length,
    runningSessions: sessions.filter(s => s.running).length,
    processCount: input.processes.length,
    totalTurns: sessions.reduce((a, s) => a + s.turns, 0),
    totalPrompts: sessions.reduce((a, s) => a + s.prompts, 0),
    totalToolCalls: sessions.reduce((a, s) => a + s.toolCalls, 0),
    totalRetries: sessions.reduce((a, s) => a + s.retries, 0),
    totalErrors: sessions.reduce((a, s) => a + s.errors, 0),
    modelsConnected: models.length,
    securityFindingsCount: allFindings.length,
    riskyPermissionSessions: sessions.filter(s => s.riskyPermission).length,
    tokens: { ...tokens, total: sum(tokens) },
    estimatedCostUsd,
    hasUnknownCost,
  }

  return {
    generatedAt: now,
    homeLabel: input.homeLabel,
    summary,
    models,
    toolCallCounts,
    sessions,
    processes: input.processes,
    securityFindings,
    permissionEvents,
    activityTimeline: buckets,
    history: input.history,
    guard,
  }
}
