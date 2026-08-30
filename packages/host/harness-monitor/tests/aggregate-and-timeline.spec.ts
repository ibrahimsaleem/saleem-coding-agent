import { describe, expect, it } from 'vitest'
import { buildSnapshot } from '../src/aggregate.ts'
import type { SessionInput } from '../src/aggregate.ts'
import { buildTimeline } from '../src/timeline.ts'
import type { RawEvent } from '../src/session-logs.ts'

/** A minimal synthetic session log. */
function log(events: RawEvent[]): SessionInput {
  return {
    workspace: '--ws--',
    dirName: 'session-1',
    path: '/x/session-1/session.jsonl.zstd',
    events: [
      { type: 'session', seq: 0, time: 1000, data: { id: 'session-1', cwd: 'C:\\work' } },
      ...events,
    ],
  }
}

describe('buildSnapshot', () => {
  it('folds counts, tokens, findings and permission events', () => {
    const events: RawEvent[] = [
      { type: 'permission/preset', seq: 1, time: 1001, data: { preset: 'danger-full-access' } },
      { type: 'approval/policy', seq: 2, time: 1002, data: { policy: 'never' } },
      { type: 'turn/start', seq: 3, time: 1100, data: { turn: 1 } },
      { type: 'step/start', seq: 4, time: 1101, data: { turn: 1, step: 1 } },
      { type: 'user/message', seq: 5, time: 1102, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'run rm -rf node_modules' }] } },
      { type: 'request/context', seq: 6, time: 1103, data: { provider: 'google', model: 'gemini-3.5-flash-lite' } },
      { type: 'tool/call', seq: 7, time: 1104, data: { name: 'pwsh', arguments: '{"command":"vssadmin delete shadows"}' } },
      { type: 'turn/end', seq: 8, time: 1200, data: { turn: 1, reason: { kind: 'error' } } },
    ]
    const snapshot = buildSnapshot({
      sessions: [log(events)],
      projCache: new Map(),
      settingsModels: [{ route: 'google', id: 'gemini-3.5-flash-lite', apiKeyEnv: null }],
      history: [],
      processes: [],
      homeLabel: '~/.dsh',
    }, { armed: false, armedAt: null, events: [] })

    expect(snapshot.summary.sessionCount).toBe(1)
    expect(snapshot.summary.totalTurns).toBe(1)
    expect(snapshot.summary.totalToolCalls).toBe(1)
    expect(snapshot.summary.totalPrompts).toBe(1)
    expect(snapshot.summary.totalErrors).toBe(1)
    expect(snapshot.summary.riskyPermissionSessions).toBe(1)
    // one prompt finding (rm -rf) + one tool finding (vssadmin)
    expect(snapshot.securityFindings.map(f => f.ruleId).sort()).toEqual(['destructive-fs', 'shadow-copy-deletion'])
    // high severity sorts first
    expect(snapshot.securityFindings[0]?.severity).toBe('high')
    expect(snapshot.permissionEvents).toHaveLength(2)
    expect(snapshot.models[0]?.requests).toBe(1)
    expect(snapshot.toolCallCounts.pwsh).toBe(1)
  })

  it('prefers the projection cache for token totals and running state', () => {
    const snapshot = buildSnapshot({
      sessions: [log([])],
      projCache: new Map([['session-1', {
        turns: 5, steps: 12, running: true, title: 'my session',
        tokens: { input: 100, output: 50, cacheRead: 10, cacheWrite: 0 },
      }]]),
      settingsModels: [],
      history: [],
      processes: [],
      homeLabel: '~/.dsh',
    }, { armed: false, armedAt: null, events: [] })
    const session = snapshot.sessions[0]
    expect(session?.running).toBe(true)
    expect(session?.turns).toBe(5)
    expect(session?.title).toBe('my session')
    expect(snapshot.summary.tokens.total).toBe(160)
  })
})

describe('buildTimeline', () => {
  const events: RawEvent[] = Array.from({ length: 12 }, (_, i) => ({
    type: 'tool/call', seq: i, time: 1000 + i, data: { name: `t${i}`, arguments: '{}' },
  }))

  it('returns the most recent page and a cursor', () => {
    const page = buildTimeline(events, 'session-1', 'C:\\work', 5)
    expect(page.timeline).toHaveLength(5)
    expect(page.timeline[0]?.seq).toBe(7)
    expect(page.hasMore).toBe(true)
    expect(page.oldestSeq).toBe(7)
  })

  it('pages backwards with beforeSeq', () => {
    const page = buildTimeline(events, 'session-1', null, 5, 7)
    expect(page.timeline.map(e => e.seq)).toEqual([2, 3, 4, 5, 6])
    expect(page.hasMore).toBe(true)
  })

  it('marks turn/step boundaries compact', () => {
    const page = buildTimeline(
      [{ type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } }, { type: 'tool/call', seq: 1, time: 2, data: { name: 'x', arguments: '{}' } }],
      's', null,
    )
    expect(page.timeline.find(e => e.type === 'turn/start')?.compact).toBe(true)
    expect(page.timeline.find(e => e.type === 'tool/call')?.compact).toBe(false)
  })
})
